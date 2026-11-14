import { WebSocket } from "ws";
import type { Speaker } from "@teammate/shared";
import * as voiceprint from "./voiceprint.ts";

/**
 * 真实麦克风 → Deepgram 流式识别 → session.onUtterance()
 *
 * 数据流：
 *   1. 主设备的浏览器采集麦克风，转成 16kHz 单声道 16 位 PCM，通过会话的 WebSocket
 *      以二进制帧发给服务端（见 frontend/src/lib/mic.ts；index.ts 把二进制帧转到 onAudioChunk）。
 *   2. 这里把音频原样转发给 Deepgram，把结果拼成一句一句的话：
 *      临时结果以 isFinal: false 送出，一句话说完以 isFinal: true 送出。
 *   3. Deepgram 只给说话人编号（0、1、2…，按首次出现的顺序）。
 *      编号按出现顺序对应到 config.speakers，所以开场请大家按名单顺序各说一句。
 *
 *   4. 如果这个团队录过声纹：每个新出现的声音，取它开头几秒去和声纹比对，对上了就绑定名字
 *      （见 voiceprint.ts）。没录过、或没对上的，仍按出现顺序对应。
 *
 * 回声屏蔽不在这里处理：队友发声期间 session.onUtterance 会自动丢弃输入。
 *
 * 用录音测试（不需要浏览器）：npm run asr:file -w server -- <音频文件>
 *
 * 环境变量：
 *   DEEPGRAM_API_KEY  必填
 *   ASR_MODEL         默认 nova-3
 */

/** LiveAudio 只需要会话的这两样东西，测试脚本可以给一个假的。 */
export interface AsrSink {
  snapshot: { config: { speakers: Speaker[]; teamId?: string } | null };
  onUtterance(input: { speakerId: string; text: string; isFinal: boolean }): void;
  /** 实时声纹跟踪认出了正在说话的人（不等语音识别出字）。可选。 */
  onSpeaking?(speakerId: string): void;
}

export const SAMPLE_RATE = 16_000;

/** 停顿多久算一句话说完（毫秒）。太短会把一句话切碎，太长主 agent 反应慢。 */
const ENDPOINTING_MS = 400;
/** 一个人连续说话不停顿时，攒到这么长就先送出一段，免得主 agent 一直等。 */
const MAX_SEGMENT_MS = 12_000;
/** 没有音频时每隔多久发一次保活。Deepgram 约 10 秒收不到数据会断开。 */
const KEEPALIVE_MS = 4_000;
const RECONNECT_MS = 1_000;
/** 连接建立前最多缓存多少音频（约 5 秒），之后丢弃最旧的。 */
const MAX_BACKLOG_BYTES = SAMPLE_RATE * 2 * 5;
/** 为声纹比对保留最近多少音频（3 分钟） */
const MAX_KEPT_BYTES = SAMPLE_RATE * 2 * 180;
/** 一个新声音至少攒够多少秒才比对声纹；没对上的话，每多攒这么多秒再试一次，最多试几次 */
const VOICE_FIRST_TRY_S = 1.5;
const VOICE_RETRY_EVERY_S = 1;
const VOICE_MAX_TRIES = 10;
/** 比对时只用这个声音最近的这么多秒：开头那一段常常混着别人的声音 */
const VOICE_WINDOW_S = 6;
/** 实时跟踪：每隔多久、用最近多长的声音去认“现在是谁在说话” */
const TRACK_EVERY_MS = 400;
const TRACK_WINDOW_S = 1.2;
/** 实时跟踪只是点亮头像，认错的代价小，判定线可以比绑定名字时宽松（仍要求明显高于第二名） */
const TRACK_THRESHOLD = 0.27;

interface DgWord {
  word: string;
  punctuated_word?: string;
  speaker?: number;
  /** 这个词在这条连接的音频里的起止时间（秒） */
  start?: number;
  end?: number;
}

interface DgMessage {
  type: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DgWord[] }[] };
  description?: string;
  message?: string;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), "[asr]", ...a);

export class LiveAudio {
  private ws: WebSocket | null = null;
  private active = false;
  private backlog: Buffer[] = [];
  private backlogBytes = 0;
  private lastAudioAt = 0;
  private keepalive: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private warnedNoKey = false;

  /** 已经确定、还没作为整句送出的部分 */
  private pending: { speaker: number; text: string; since: number } | null = null;
  /** Deepgram 的说话人编号 → 第几个出现 */
  private speakerOrder = new Map<number, number>();
  /** 声纹确认过的：Deepgram 的说话人编号 → 成员 id */
  private confirmed = new Map<number, string>();
  /** 还没确认的声音：说话的时间段、累计秒数、已经比对过几次 */
  private voices = new Map<number, { spans: [number, number][]; seconds: number; tries: number; triedAt: number }>();
  private tracker: NodeJS.Timeout | null = null;
  /** 这条连接上送出的音频（只留最近几分钟），用来按时间切出某个人的声音 */
  /** 这场会议开始时，哪些成员录过声纹 */
  private enrolledIds = new Set<string>();
  private kept: Buffer[] = [];
  private keptBytes = 0;
  private droppedBytes = 0;

  private readonly language = "en";
  private readonly model = process.env.ASR_MODEL || "nova-3";

  constructor(private session: AsrSink) {}

  start() {
    if (this.active) return;
    if (!process.env.DEEPGRAM_API_KEY) {
      if (!this.warnedNoKey) console.warn("[asr] 没有 DEEPGRAM_API_KEY，live 模式收不到语音。把 key 写进 .env。");
      this.warnedNoKey = true;
      return;
    }
    this.active = true;
    this.speakerOrder.clear();
    this.confirmed.clear();
    this.voices.clear();
    const teamId = this.session.snapshot.config?.teamId;
    this.enrolledIds = new Set(teamId ? voiceprint.enrolled(teamId) : []);
    void voiceprint.ready();
    this.pending = null;
    this.ws?.terminate(); // 上一场还在收尾的连接
    this.ws = null;
    this.connect();
    this.keepalive = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastAudioAt > KEEPALIVE_MS) {
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, KEEPALIVE_MS);
    this.tracker = setInterval(() => this.track(), TRACK_EVERY_MS);
  }

  onAudioChunk(chunk: Buffer) {
    if (!this.active) return;
    this.lastAudioAt = Date.now();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendAudio(this.ws, chunk);
      return;
    }
    this.backlog.push(chunk);
    this.backlogBytes += chunk.length;
    while (this.backlogBytes > MAX_BACKLOG_BYTES && this.backlog.length > 1) {
      this.backlogBytes -= this.backlog.shift()!.length;
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.keepalive) clearInterval(this.keepalive);
    if (this.tracker) clearInterval(this.tracker);
    this.tracker = null;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.keepalive = this.reconnect = null;
    this.backlog = [];
    this.backlogBytes = 0;
    // 让 Deepgram 把还没出完的结果出完再断开；最后一句在连接关闭时送出（见 afterClose）
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => ws.terminate(), 3000);
    } else {
      ws?.terminate();
      this.ws = null;
      this.flush();
    }
  }

  // ───────────── Deepgram 连接 ─────────────

  private connect() {
    const params = new URLSearchParams({
      model: this.model,
      language: this.language,
      encoding: "linear16",
      sample_rate: String(SAMPLE_RATE),
      channels: "1",
      interim_results: "true",
      punctuate: "true",
      diarize: "true",
      endpointing: String(ENDPOINTING_MS),
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      log(`connected — ${this.model}, ${this.language}`);
      // 新连接 = 新的时间轴和新的说话人编号
      this.kept = [];
      this.keptBytes = this.droppedBytes = 0;
      this.voices.clear();
      this.confirmed.clear();
      for (const chunk of this.backlog) this.sendAudio(ws, chunk);
      this.backlog = [];
      this.backlogBytes = 0;
    });
    ws.on("message", (raw) => {
      if (process.env.ASR_DEBUG) console.log("\n<<", raw.toString().replace(/"words":\[.*?\]/, "").slice(0, 400), this.ws === ws);
      if (this.ws !== ws) return;
      try {
        this.onMessage(JSON.parse(raw.toString()) as DgMessage);
      } catch (err) {
        log("bad message", err);
      }
    });
    // 握手被拒（key 错、参数不支持）时 Deepgram 把原因放在响应头里
    ws.on("unexpected-response", (_req, res) => {
      log(`rejected: HTTP ${res.statusCode} ${res.headers["dg-error"] ?? ""}`);
      ws.terminate();
      if (res.statusCode === 401 || res.statusCode === 400 || res.statusCode === 403) this.active = false; // 重试也没用
      this.afterClose(ws);
    });
    ws.on("error", (err) => log("error:", err.message));
    ws.on("close", (code) => {
      if (this.active) log(`closed (${code})`);
      this.afterClose(ws);
    });
  }

  private afterClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.flush();
    if (this.active && !this.reconnect) {
      this.reconnect = setTimeout(() => {
        this.reconnect = null;
        if (this.active) this.connect();
      }, RECONNECT_MS);
    }
  }

  // ───────────── 把识别结果拼成一句一句的话 ─────────────

  private onMessage(msg: DgMessage) {
    if (msg.type === "UtteranceEnd") return this.flush();
    if (msg.type === "Error") return log("deepgram error:", msg.description ?? msg.message);
    if (msg.type !== "Results") return;

    const alt = msg.channel?.alternatives?.[0];
    const runs = this.runs(alt?.words ?? [], alt?.transcript ?? "");

    if (!msg.is_final) {
      // 临时结果：只用来显示“谁在说话”，不进对话记录
      const first = runs[0];
      if (!first && !this.pending) return;
      const speaker = this.pending?.speaker ?? first!.speaker;
      const text = this.join(this.pending?.text ?? "", runs.map((r) => r.text).join(" "));
      if (text) this.session.onUtterance({ speakerId: this.speakerId(speaker), text, isFinal: false });
      return;
    }

    this.listenForVoices(alt?.words ?? []);
    for (const run of runs) {
      if (this.pending && this.pending.speaker !== run.speaker) this.flush(); // 换人了
      if (!this.pending) this.pending = { speaker: run.speaker, text: "", since: Date.now() };
      this.pending.text = this.join(this.pending.text, run.text);
    }
    if (msg.speech_final || (this.pending && Date.now() - this.pending.since > MAX_SEGMENT_MS)) this.flush();
  }

  /** 把一段结果按说话人切成连续的几段。没有逐词结果时整段算上一个说话人。 */
  private runs(words: DgWord[], transcript: string): { speaker: number; text: string }[] {
    if (words.length === 0) {
      const text = transcript.trim();
      return text ? [{ speaker: this.pending?.speaker ?? 0, text }] : [];
    }
    const out: { speaker: number; text: string }[] = [];
    for (const w of words) {
      const speaker = w.speaker ?? 0;
      const text = w.punctuated_word ?? w.word;
      const last = out[out.length - 1];
      if (last && last.speaker === speaker) last.text = this.join(last.text, text);
      else out.push({ speaker, text });
    }
    return out;
  }

  private join(a: string, b: string) {
    return a && b ? a + " " + b : a || b;
  }

  private flush() {
    const p = this.pending;
    this.pending = null;
    if (p?.text) this.session.onUtterance({ speakerId: this.speakerId(p.speaker), text: p.text, isFinal: true });
  }

  // ───────────── 谁是谁 ─────────────

  /**
   * 声纹确认过的用声纹的结果；其余的按首次出现的顺序，对应到还没被声纹认领的成员。
   * 没认出来的声音优先对应没录过声纹的成员：录过的人本该被声纹认出来，认不出说明多半不是他。
   * 超出名单人数的算作额外的人。
   */
  private speakerId(dgSpeaker: number): string {
    const sure = this.confirmed.get(dgSpeaker);
    if (sure) return sure;
    if (!this.speakerOrder.has(dgSpeaker)) this.speakerOrder.set(dgSpeaker, this.speakerOrder.size);
    const speakers = this.session.snapshot.config?.speakers ?? [];
    const claimed = new Set(this.confirmed.values());
    const unclaimed = speakers.filter((sp) => !claimed.has(sp.id));
    const free = [...unclaimed.filter((sp) => !this.enrolledIds.has(sp.id)), ...unclaimed.filter((sp) => this.enrolledIds.has(sp.id))];
    const waiting = [...this.speakerOrder.keys()].filter((k) => !this.confirmed.has(k));
    return free[waiting.indexOf(dgSpeaker)]?.id ?? `Speaker ${this.speakerOrder.get(dgSpeaker)! + 1}`;
  }

  private sendAudio(ws: WebSocket, chunk: Buffer) {
    ws.send(chunk);
    this.kept.push(chunk);
    this.keptBytes += chunk.length;
    while (this.keptBytes > MAX_KEPT_BYTES && this.kept.length > 1) {
      const old = this.kept.shift()!;
      this.keptBytes -= old.length;
      this.droppedBytes += old.length;
    }
  }

  /** 记下每个还没确认的声音在什么时间说了话；攒够了就拿去比对声纹。 */
  private listenForVoices(words: DgWord[]) {
    const teamId = this.session.snapshot.config?.teamId;
    if (!teamId || !voiceprint.available()) return;
    for (const w of words) {
      const k = w.speaker ?? 0;
      if (w.start === undefined || w.end === undefined || this.confirmed.has(k)) continue;
      const v = this.voices.get(k) ?? { spans: [], seconds: 0, tries: 0, triedAt: 0 };
      const last = v.spans[v.spans.length - 1];
      if (last && w.start - last[1] < 0.3) last[1] = w.end;
      else v.spans.push([w.start, w.end]);
      v.seconds += w.end - w.start;
      this.voices.set(k, v);
    }
    for (const [k, v] of this.voices) {
      if (this.confirmed.has(k) || v.tries >= VOICE_MAX_TRIES) continue;
      if (v.seconds < VOICE_FIRST_TRY_S || v.seconds - v.triedAt < VOICE_RETRY_EVERY_S) continue;
      v.tries++;
      v.triedAt = v.seconds;
      this.nameByVoice(teamId, k, recent(v.spans, VOICE_WINDOW_S));
    }
  }

  /**
   * 实时跟踪：不等语音识别出字，直接拿最近一小段声音和声纹比，认出来就告诉界面“现在是这个人在说话”。
   * 只对录过声纹的人有效；认不出就不出声，界面退回到用识别结果判断。
   */
  private track() {
    const teamId = this.session.snapshot.config?.teamId;
    if (!this.active || !teamId || !this.session.onSpeaking || !voiceprint.available()) return;
    if (Date.now() - this.lastAudioAt > 600) return; // 麦克风没在送声音
    const present = (this.session.snapshot.config?.speakers ?? []).map((sp) => sp.id).filter((id) => this.enrolledIds.has(id));
    if (present.length === 0) return;
    const want = Math.floor(TRACK_WINDOW_S * SAMPLE_RATE) * 2;
    if (this.keptBytes < want) return;
    const tail = Buffer.concat(this.kept.slice(-Math.ceil(want / 3200) - 1)).subarray(-want);
    // 最近半秒要有人在出声，否则是停顿或背景噪音
    const last = tail.subarray(-SAMPLE_RATE);
    let sum = 0;
    for (let i = 0; i < last.length; i += 2) sum += (last.readInt16LE(i) / 32768) ** 2;
    if (Math.sqrt(sum / (last.length / 2)) < 0.012) return;
    const { match } = voiceprint.identify(teamId, tail, present, 1, TRACK_THRESHOLD);
    if (match) this.session.onSpeaking(match.memberId);
  }

  private nameByVoice(teamId: string, dgSpeaker: number, spans: [number, number][]) {
    const speakers = this.session.snapshot.config?.speakers ?? [];
    const claimed = new Set(this.confirmed.values());
    const among = speakers.filter((sp) => !claimed.has(sp.id)).map((sp) => sp.id);
    // 按时间从保留的音频里切出这个人说的那几段
    const all = Buffer.concat(this.kept);
    const bytesPerSecond = SAMPLE_RATE * 2;
    const parts: Buffer[] = [];
    for (const [a, b] of spans) {
      const from = Math.max(0, Math.floor(a * SAMPLE_RATE) * 2 - this.droppedBytes);
      const to = Math.min(all.length, Math.ceil(b * SAMPLE_RATE) * 2 - this.droppedBytes);
      if (to - from > bytesPerSecond * 0.2) parts.push(all.subarray(from, to));
    }
    const { match, scores } = voiceprint.identify(teamId, Buffer.concat(parts), among);
    const name = (id: string) => speakers.find((sp) => sp.id === id)?.name ?? id;
    const detail = Object.entries(scores)
      .map(([id, x]) => `${name(id)} ${x.toFixed(2)}`)
      .join(", ");
    if (!match) {
      if (detail) log(`voice ${dgSpeaker}: no confident match yet (${detail})`);
      return;
    }
    this.confirmed.set(dgSpeaker, match.memberId);
    this.voices.delete(dgSpeaker);
    log(`voice ${dgSpeaker} is ${name(match.memberId)} (${detail})`);
  }
}

/** 取最近的若干时间段，总长不超过 seconds 秒。 */
function recent(spans: [number, number][], seconds: number): [number, number][] {
  const out: [number, number][] = [];
  let total = 0;
  for (let i = spans.length - 1; i >= 0 && total < seconds; i--) {
    out.unshift(spans[i]);
    total += spans[i][1] - spans[i][0];
  }
  return out;
}
