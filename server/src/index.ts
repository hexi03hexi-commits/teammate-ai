import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ClientRole, ServerEvent } from "@teammate/shared";
import { decide, extractKeywords, runRole, updatePersonas, writeDecision } from "@teammate/agents";
import { config } from "./config.ts";
import { Session, type Brain } from "./session.ts";
import { Replay } from "./replay.ts";
import { LiveAudio } from "./audio/asr.ts";

const clients = new Map<WebSocket, ClientRole>();

function broadcast(event: ServerEvent) {
  const data = JSON.stringify(event);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// scripted 模式不调用模型；其余模式用真实 agent
const brain: Brain | null = config.mode === "scripted" ? null : { decide, runRole, writeDecision, updatePersonas, extractKeywords };
const session = new Session(broadcast, brain);
const replay = new Replay(session);
const audio = new LiveAudio(session);

session.onPhaseChange = (phase) => {
  if (config.mode === "live") {
    if (phase === "live") audio.start();
    else audio.stop();
  } else {
    if (phase === "live") replay.start();
    else replay.stop();
  }
};

session.onPause = (paused) => {
  if (config.mode === "live") return;
  if (paused) replay.pause();
  else replay.resume();
};

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, mode: config.mode, phase: session.snapshot.phase, clients: clients.size }));
    return;
  }
  res.statusCode = 404;
  res.end("Teammate AI server. WebSocket only.");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  clients.set(ws, "viewer");
  ws.send(JSON.stringify({ type: "snapshot", snapshot: session.snapshot } satisfies ServerEvent));

  ws.on("message", (raw, isBinary) => {
    if (isBinary) {
      // 主设备的麦克风音频
      if (clients.get(ws) === "host") audio.onAudioChunk(raw as Buffer);
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      clients.set(ws, msg.role);
      return;
    }
    session.handleClient(msg);
  });
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

server.listen(config.port, () => {
  console.log(`Teammate AI server on :${config.port} — mode: ${config.mode}`);
  if (config.mode !== "scripted" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("没有检测到 ANTHROPIC_API_KEY：agent 调用可能失败。把 key 写进 .env，或改用 MODE=scripted。");
  }
});
