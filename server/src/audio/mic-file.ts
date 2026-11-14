/**
 * 把一段录音当作主设备的麦克风，喂进一场真实的会议。
 * 和 asr-file.ts 的区别：那个只测语音识别；这个走完整链路——
 * 录音 → WebSocket → 服务端 → Deepgram → 主 agent → 角色 agent → 卡片 / 发声 / 纪要。
 *
 * 先用 live 模式启动服务端（需要 DEEPGRAM_API_KEY 和 ANTHROPIC_API_KEY）：
 *   MODE=live npm run start -w server
 * 然后：
 *   npm run mic:file -w server -- recordings/meeting.wav
 *   npm run mic:file -w server -- recordings/meeting.m4a --speakers Henry,Ava,Ben --minutes 15
 *
 * 说话人按出现顺序对应 --speakers 里的名字。不要同时开着主设备的页面，否则会有两个麦克风。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { WebSocket } from "ws";
import { DEFAULT_PORT, DEMO_CONFIG, type ClientMessage, type ServerEvent, type SessionConfig } from "@teammate/shared";
import { ROOT } from "../config.ts";
import { SAMPLE_RATE } from "./asr.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const names = flag("speakers")?.split(",");
const minutes = Number(flag("minutes") ?? 5);
/** 团队 id：服务端按它取成员画像和声纹 */
const teamId = flag("team");
/** 录音放完后再等多久（秒），让还在准备的队友把话说完 */
const tailS = Number(flag("tail") ?? 25);
const file = args[0];
if (!file) {
  console.error("用法：npm run mic:file -w server -- <音频文件> [--speakers 名字1,名字2] [--minutes 5] [--team 团队id] [--tail 25]");
  process.exit(1);
}

const config: SessionConfig = {
  ...DEMO_CONFIG,
  durationMin: minutes,
  teamId,
  speakers: names ? names.map((name, i) => ({ id: `s${i + 1}`, name })) : DEMO_CONFIG.speakers,
};

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? DEFAULT_PORT}`);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const send = (m: ClientMessage) => ws.send(JSON.stringify(m));
let lastSpeaking = "";

ws.on("error", (err) => {
  console.error("连不上服务端，它启动了吗？", err.message);
  process.exit(1);
});

ws.on("open", () => {
  send({ type: "hello", role: "host" });
  send({ type: "reset" });
  send({ type: "start_session", config });

  // 和浏览器麦克风一样的格式：16kHz 单声道 16 位 PCM，每 100ms 一帧，按实时速度发送
  const decoder = spawn(ffmpeg, ["-loglevel", "error", "-i", path.resolve(ROOT, file), "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"]);
  const chunks: Buffer[] = [];
  decoder.stdout.on("data", (d: Buffer) => chunks.push(d));
  decoder.stderr.on("data", (d: Buffer) => process.stderr.write(d));
  decoder.on("close", () => {
    const pcm = Buffer.concat(chunks);
    const frame = (SAMPLE_RATE * 2) / 10;
    const total = Math.ceil(pcm.length / frame);
    console.log(`${at()} audio    ${(pcm.length / SAMPLE_RATE / 2).toFixed(1)}s, streaming as the microphone`);
    let i = 0;
    const timer = setInterval(() => {
      if (i >= total) {
        clearInterval(timer);
        console.log(`${at()} audio    finished; waiting ${tailS}s for teammates still preparing`);
        setTimeout(() => send({ type: "end_session" }), tailS * 1000);
        return;
      }
      ws.send(pcm.subarray(i * frame, (i + 1) * frame));
      i++;
    }, 100);
  });
});

ws.on("message", (data, isBinary) => {
  if (isBinary) return;
  const e = JSON.parse(data.toString()) as ServerEvent;
  switch (e.type) {
    case "transcript":
      if (e.utterance.isFinal) console.log(`${at()} heard    ${e.utterance.speakerName}: ${e.utterance.text}`);
      return;
    case "speaking":
      // 只在换人时打印，看实时跟踪多快认出人
      if (e.speakerId !== lastSpeaking) console.log(`${at()} speaking ${config.speakers.find((sp) => sp.id === e.speakerId)?.name ?? e.speakerId}`);
      lastSpeaking = e.speakerId;
      return;
    case "keywords":
      return console.log(`${at()} keywords ${e.words.join(" · ")}`);
    case "teammate_state":
      if (e.state.status === "preparing") console.log(`${at()} state    ${e.teammate} is preparing`);
      return;
    case "card":
      console.log(`${at()} card     ${e.card.teammate} L${e.card.level} — ${e.card.title}\n                ${e.card.body}`);
      return;
    case "speak":
      console.log(`${at()} SPEAK    ${e.teammate} — ${e.text}`);
      // 假装把这句话念完：服务端在此期间会屏蔽麦克风（回声屏蔽）
      send({ type: "speak_started", id: e.id });
      setTimeout(() => send({ type: "speak_done", id: e.id }), 1500 + e.text.length * 120);
      return;
    case "decision":
      console.log(`${at()} minutes  ${e.decision.conclusion}`);
      if (e.decision.summary) console.log(`                ${e.decision.summary}`);
      for (const a of e.decision.assignments) console.log(`                · ${a.owner}: ${a.task}`);
      for (const r of e.decision.risks) console.log(`                ! ${r}`);
      return process.exit(0);
    case "error":
      return console.log(`${at()} ERROR    ${e.message}`);
  }
});
