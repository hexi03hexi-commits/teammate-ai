import { WebSocket } from "ws";
import type { Speaker } from "@teammate/shared";

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
  snapshot: { config: { speakers: Speaker[] } | null };
  onUtterance(input: { speakerId: string; text: string; isFinal: boolean }): void;
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

interface DgWord {
  word: string;
  punctuated_word?: string;
  speaker?: number;
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
    this.pending = null;
    this.ws?.terminate(); // 上一场还在收尾的连接
    this.ws = null;
    this.connect();
    this.keepalive = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && Date.now() - this.lastAudioAt > KEEPALIVE_MS) {
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, KEEPALIVE_MS);
  }

  onAudioChunk(chunk: Buffer) {
    if (!this.active) return;
    this.lastAudioAt = Date.now();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
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
      for (const chunk of this.backlog) ws.send(chunk);
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

  /** 按首次出现的顺序对应到名单；超出名单人数的算作额外的人。 */
  private speakerId(dgSpeaker: number): string {
    let order = this.speakerOrder.get(dgSpeaker);
    if (order === undefined) {
      order = this.speakerOrder.size;
      this.speakerOrder.set(dgSpeaker, order);
    }
    const speakers = this.session.snapshot.config?.speakers ?? [];
    return speakers[order]?.id ?? `Speaker ${order + 1}`;
  }
}
