/**
 * 用一段录音测试语音识别，不需要浏览器，也不调用 agent：
 *
 *   npm run asr:file -w server -- recordings/meeting.wav
 *   npm run asr:file -w server -- recordings/meeting.m4a --speed 4 --speakers 小王,小李,小张
 *
 * 音频用 ffmpeg 转成和浏览器麦克风一样的格式（16kHz 单声道 16 位 PCM），
 * 按实时速度送进 LiveAudio.onAudioChunk，所以录音和真麦克风走完全相同的链路。
 * 语言用 .env 里的 ASR_LANGUAGE。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import "../config.ts"; // 读 .env
import { LiveAudio, SAMPLE_RATE, type AsrSink } from "./asr.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const speed = Number(flag("speed") ?? 1) || 1;
const names = (flag("speakers") ?? "A,B,C,D").split(",");
const file = args[0];
if (!file) {
  console.error("用法：npm run asr:file -w server -- <音频文件> [--speed 4] [--speakers 名字1,名字2]");
  process.exit(1);
}

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
const speakers = names.map((name, i) => ({ id: `s${i + 1}`, name }));
const started = Date.now();
let finals = 0;

const sink: AsrSink = {
  snapshot: { config: { speakers } },
  onUtterance({ speakerId, text, isFinal }) {
    const name = speakers.find((s) => s.id === speakerId)?.name ?? speakerId;
    if (isFinal) {
      finals++;
      const t = (((Date.now() - started) / 1000) * speed).toFixed(1).padStart(6);
      process.stdout.write(`\r\x1b[K${t}s  ${name}: ${text}\n`);
    } else if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[K        ${name}… ${text.slice(-60)}`);
    }
  },
};

const audio = new LiveAudio(sink);
audio.start();

// 每 100 毫秒一块，和浏览器发来的节奏一样
const CHUNK_BYTES = (SAMPLE_RATE * 2) / 10;
const pcm: Buffer[] = [];
const proc = spawn(ffmpeg, ["-v", "error", "-i", path.resolve(process.env.INIT_CWD ?? ".", file), "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"]);
proc.stdout.on("data", (d: Buffer) => pcm.push(d));
proc.stderr.on("data", (d: Buffer) => process.stderr.write(d));
proc.on("close", (code) => {
  if (code !== 0) process.exit(1);
  const all = Buffer.concat(pcm);
  console.log(`${file}: ${(all.length / SAMPLE_RATE / 2).toFixed(1)}s of audio, ${speed}x`);
  let offset = 0;
  const timer = setInterval(() => {
    if (offset >= all.length) {
      clearInterval(timer);
      // 补一秒静音让最后一句话收尾，再等结果回来。快进时 Deepgram 仍按接近实时的速度处理，要等它追上
      audio.onAudioChunk(Buffer.alloc(SAMPLE_RATE * 2));
      setTimeout(() => {
        audio.stop();
        setTimeout(() => {
          console.log(`\n${finals} utterances`);
          process.exit(finals ? 0 : 1);
        }, 3500);
      }, 1500 + (all.length / SAMPLE_RATE / 2) * 1000 * (1 - 1 / speed));
      return;
    }
    audio.onAudioChunk(all.subarray(offset, offset + CHUNK_BYTES));
    offset += CHUNK_BYTES;
  }, 100 / speed);
});
