import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ROOT } from "../config.ts";
import { SAMPLE_RATE } from "./asr.ts";

/**
 * 声纹：从一段语音里算出一个代表音色的向量，用它认出“这是谁的声音”。
 *
 * 分工：语音识别（Deepgram）负责把不同的声音分开；这里只负责给每个声音对上名字。
 * 所以每个人一场会议只需要比对一两次，而不是每句话都比。
 *
 * 模型：3D-Speaker ERes2Net（用中文母语者的语音训练）。对比过四个模型，
 * 用英语母语者训练的模型分不开中文母语者，哪怕他们说的是英语；这个模型在 5 位真人、
 * 190 对比较里没有把任何两个人认混。
 * 限制：同一个人说中文和说英文会被当成两个人。录声纹和开会要用同一种语言。
 *
 * 声纹只存在服务端（data/voiceprints.json），不发给任何设备，不进 git。存的是向量，不是录音。
 */

const MODEL_NAME = "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/${MODEL_NAME}`;
const MODEL_PATH = path.join(ROOT, "data", "models", MODEL_NAME);
const STORE_PATH = path.join(ROOT, "data", "voiceprints.json");

/**
 * 相似度达到多少算同一个人。实测：同一个人通常 0.5–0.9，不同的人 0.1 以下，最高见过 0.32。
 * 用你们自己的录音校准后可以调整（VOICE_THRESHOLD）。
 */
const THRESHOLD = Number(process.env.VOICE_THRESHOLD ?? 0.38);
/** 最像的人要比第二像的人高出这么多，否则不敢认 */
const MARGIN = 0.1;
/** 一段录入语音至少要多长（秒） */
export const MIN_ENROL_SECONDS = 2.5;
/** 每人最多保留几段录入（多录几段取平均更稳） */
const MAX_CLIPS = 5;

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), "[voice]", ...a);

// ───────────── 模型 ─────────────

interface Extractor {
  dim: number;
  createStream(): { acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void };
  compute(stream: unknown): Float32Array;
}
let extractor: Extractor | null = null;
let loading: Promise<boolean> | null = null;

async function download(): Promise<void> {
  log(`downloading the speaker model (about 40 MB) from ${new URL(MODEL_URL).host}…`);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  const tmp = `${MODEL_PATH}.part`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, MODEL_PATH);
}

/** 加载模型（第一次会下载）。失败时返回 false：会议照常进行，只是按出场顺序对应名字。 */
export function ready(): Promise<boolean> {
  loading ??= (async () => {
    try {
      if (!fs.existsSync(MODEL_PATH)) await download();
      // sherpa-onnx-node 是 CommonJS 的原生模块
      const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as {
        SpeakerEmbeddingExtractor: new (config: { model: string; numThreads: number; debug: boolean }) => Extractor;
      };
      extractor = new sherpa.SpeakerEmbeddingExtractor({ model: MODEL_PATH, numThreads: 2, debug: false });
      log(`ready (${extractor.dim}-dim, threshold ${THRESHOLD})`);
      return true;
    } catch (err) {
      log("unavailable:", err instanceof Error ? err.message : err);
      loading = null; // 下次再试
      return false;
    }
  })();
  return loading;
}

export const available = () => extractor !== null;

// ───────────── 向量 ─────────────

function normalise(v: ArrayLike<number>): number[] {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

function cosine(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

function mean(vs: number[][]): number[] {
  const m = new Array<number>(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < m.length; i++) m[i] += v[i] / vs.length;
  return normalise(m);
}

/** 16kHz 单声道 16 位 PCM → 声纹向量 */
function embed(pcm: Buffer): number[] {
  if (!extractor) throw new Error("voiceprint model is not loaded");
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const stream = extractor.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
  return normalise(extractor.compute(stream));
}

const seconds = (pcm: Buffer) => pcm.length / 2 / SAMPLE_RATE;

/** 这段录音里有没有足够响的声音（防止录进去一段静音） */
function loudEnough(pcm: Buffer): boolean {
  let sum = 0;
  const n = Math.floor(pcm.length / 2);
  for (let i = 0; i < n; i++) sum += (pcm.readInt16LE(i * 2) / 32768) ** 2;
  return Math.sqrt(sum / Math.max(1, n)) > 0.008;
}

// ───────────── 存储 ─────────────

/** teamId → memberId → 每次录入的向量 */
type Store = Record<string, Record<string, number[][]>>;

function read(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Store;
  } catch {
    return {};
  }
}

function write(store: Store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store));
}

export function enrolled(teamId: string): string[] {
  return Object.keys(read()[teamId] ?? {});
}

export type EnrolResult = { ok: true; seconds: number; clips: number } | { ok: false; reason: "unavailable" | "too_short" | "too_quiet" };

/** 录入一段语音。replace = true 时丢掉这个人之前的录入重新开始。 */
export function enrol(teamId: string, memberId: string, pcm: Buffer, replace: boolean): EnrolResult {
  if (!extractor) return { ok: false, reason: "unavailable" };
  if (seconds(pcm) < MIN_ENROL_SECONDS) return { ok: false, reason: "too_short" };
  if (!loudEnough(pcm)) return { ok: false, reason: "too_quiet" };
  const store = read();
  const team = (store[teamId] ??= {});
  const clips = replace ? [] : (team[memberId] ?? []);
  clips.push(embed(pcm));
  team[memberId] = clips.slice(-MAX_CLIPS);
  write(store);
  log(`enrolled ${memberId} in ${teamId}: ${seconds(pcm).toFixed(1)}s, ${team[memberId].length} clip(s)`);
  return { ok: true, seconds: seconds(pcm), clips: team[memberId].length };
}

export function forget(teamId: string, memberId: string) {
  const store = read();
  if (store[teamId]?.[memberId]) {
    delete store[teamId][memberId];
    write(store);
  }
}

export interface Match {
  memberId: string;
  score: number;
  /** 所有候选人的分数，调阈值时看 */
  scores: Record<string, number>;
}

/**
 * 这段语音是候选人里的谁。认不出（没人过线，或前两名太接近）返回 null 和分数。
 * `among` 是这场会议里还没被认领的成员。
 */
export function identify(teamId: string, pcm: Buffer, among: string[]): { match: Match | null; scores: Record<string, number> } {
  const team = read()[teamId] ?? {};
  const candidates = among.filter((id) => team[id]?.length);
  if (!extractor || candidates.length === 0 || seconds(pcm) < 1.5) return { match: null, scores: {} };
  const v = embed(pcm);
  const scores: Record<string, number> = {};
  for (const id of candidates) scores[id] = Number(cosine(v, mean(team[id])).toFixed(3));
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestId, best] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? -1;
  if (best < THRESHOLD || best - runnerUp < MARGIN) return { match: null, scores };
  return { match: { memberId: bestId, score: best, scores }, scores };
}
