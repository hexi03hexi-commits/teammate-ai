import { randomUUID } from "node:crypto";
import type http from "node:http";
import type { AgentId } from "@teammate/shared";

/**
 * 把队友要说的一句话合成为语音（ElevenLabs），每个队友一个固定音色。
 *
 * 合成好的音频放在内存里，由 index.ts 通过 /audio/<id>.mp3 提供；synthesize() 返回这个路径。
 * 没有 ELEVENLABS_API_KEY、合成失败或超时都返回 null：前端会改用浏览器自带的语音，所以一句话总能说出来。
 *
 * 同一个队友的同一句话只合成一次。session 在卡片出现时就先调用一次（此时还在等停顿），
 * 等真正轮到它开口时音频已经准备好，不会在停顿之后再让人等。
 *
 * 环境变量：
 *   ELEVENLABS_API_KEY
 *   TTS_MODEL            默认 eleven_flash_v2_5（延迟最低的那个）
 *   TTS_VOICE_<AGENT>    换某个队友的音色，例如 TTS_VOICE_REBEL=N2lVS1w4EtoT3dr4eOWO（npm run voices -w server 列出可选的）
 */

/** 每个队友的音色（ElevenLabs 预置音色）。挑的是彼此容易听出区别的五个。 */
const VOICES: Record<AgentId, { id: string; name: string }> = {
  main: { id: "SAz9YHcvj6GT2YYXdXww", name: "River" }, // 中性、平静、讲解型：协调者
  pilot: { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" }, // 成熟、让人安心、自信：主持
  scout: { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie" }, // 澳洲口音、有活力：刚查到东西的研究员
  sage: { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" }, // 英式、温和成熟：领域专家
  rebel: { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura" }, // 俏皮、带点态度：唱反调的
};

const MODEL = () => process.env.TTS_MODEL || "eleven_flash_v2_5";
const voiceFor = (agent: AgentId) => process.env[`TTS_VOICE_${agent.toUpperCase()}`] || VOICES[agent].id;

/** 合成最多等这么久；再慢就让浏览器自己念，别让队友在停顿之后迟迟不开口 */
const TIMEOUT_MS = 6000;
/** 内存里最多留这么多段音频（一段约 30–60KB） */
const KEEP = 80;

interface Clip {
  id: string;
  audio: Buffer;
}
/** 以“音色 + 模型 + 文字”为键；值是进行中或已完成的合成 */
const clips = new Map<string, Promise<Clip | null>>();
const byId = new Map<string, Clip>();
let warned = false;

export const ttsAvailable = () => !!process.env.ELEVENLABS_API_KEY;

export async function synthesize(agent: AgentId, text: string): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  const line = text.trim();
  if (!key || !line) return null;

  const cacheKey = `${voiceFor(agent)}|${MODEL()}|${line}`;
  let pending = clips.get(cacheKey);
  if (!pending) {
    pending = request(key, agent, line);
    clips.set(cacheKey, pending);
    // 失败的不留在缓存里，下次还可以再试
    void pending.then((clip) => {
      if (!clip) clips.delete(cacheKey);
      else trim();
    });
  }
  const clip = await pending;
  return clip ? `/audio/${clip.id}.mp3` : null;
}

async function request(key: string, agent: AgentId, text: string): Promise<Clip | null> {
  const started = Date.now();
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceFor(agent)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      // 额度用完、key 没有权限这类问题每句话都会重复：只详细说一次
      if (!warned) console.warn(`[tts] ElevenLabs answered ${res.status}: ${detail}\n[tts] falling back to the browser voice`);
      warned = true;
      return null;
    }
    const clip: Clip = { id: randomUUID(), audio: Buffer.from(await res.arrayBuffer()) };
    byId.set(clip.id, clip);
    warned = false;
    console.log(`[tts] ${agent} (${VOICES[agent].name}) ${Date.now() - started}ms · ${Math.round(clip.audio.length / 1024)}KB`);
    return clip;
  } catch (err) {
    console.warn(`[tts] ${agent}: ${err instanceof Error ? err.message : err}; falling back to the browser voice`);
    return null;
  }
}

/** 超出上限时丢掉最早的音频 */
function trim() {
  while (byId.size > KEEP) {
    const oldest = byId.keys().next().value as string;
    byId.delete(oldest);
    for (const [k, p] of clips) {
      void p.then((c) => c?.id === oldest && clips.delete(k));
    }
  }
}

/**
 * GET /audio/<id>.mp3。支持 Range：iOS Safari 播放音频前会先要头两个字节，不支持的话它不播。
 * 返回 false 表示这个地址不归它管。
 */
export function serveAudio(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  const m = /^\/audio\/([0-9a-f-]+)\.mp3$/.exec(pathname);
  if (!m) return false;
  const clip = byId.get(m[1]!);
  if (!clip) {
    res.statusCode = 404;
    res.end();
    return true;
  }
  const total = clip.audio.length;
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=-N" 是最后 N 个字节
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start > end || start >= total) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${total}`);
      res.end();
      return true;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    res.end(req.method === "HEAD" ? undefined : clip.audio.subarray(start, end + 1));
    return true;
  }
  res.setHeader("Content-Length", total);
  res.end(req.method === "HEAD" ? undefined : clip.audio);
  return true;
}
