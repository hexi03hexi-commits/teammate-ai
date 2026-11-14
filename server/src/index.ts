import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ClientRole, ServerEvent } from "@teammate/shared";
import { decide, extractKeywords, runRole, updatePersonas, writeDecision } from "@teammate/agents";
import { config } from "./config.ts";
import { Session, type Brain } from "./session.ts";
import { Replay } from "./replay.ts";
import { LiveAudio } from "./audio/asr.ts";
import * as voiceprint from "./audio/voiceprint.ts";

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

/** 读完请求体（声纹录音：十秒以内的 16kHz PCM，几百 KB） */
function readBody(req: http.IncomingMessage, limit = 2_000_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * 声纹录入接口（团队设置页用）：
 *   GET    /voiceprints?team=ID            → { available, enrolled: [成员 id] }
 *   POST   /voiceprints?team=ID&member=ID  → 请求体是 16kHz 单声道 16 位 PCM；加 &replace=1 表示重录
 *   DELETE /voiceprints?team=ID&member=ID
 * 声纹只存在服务端，这些接口不返回声纹本身。
 */
async function handleVoiceprints(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const team = url.searchParams.get("team");
  const member = url.searchParams.get("member");
  const json = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  if (!team) return json(400, { ok: false, reason: "missing team" });
  const usable = await voiceprint.ready();
  if (req.method === "GET") return json(200, { available: usable, enrolled: voiceprint.enrolled(team) });
  if (!member) return json(400, { ok: false, reason: "missing member" });
  if (req.method === "DELETE") {
    voiceprint.forget(team, member);
    return json(200, { ok: true });
  }
  if (req.method === "POST") {
    const result = voiceprint.enrol(team, member, await readBody(req), url.searchParams.get("replace") === "1");
    return json(result.ok ? 200 : 422, result);
  }
  json(405, { ok: false, reason: "method not allowed" });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/voiceprints") {
    handleVoiceprints(req, res, url).catch((err) => {
      console.error("[voice]", err);
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, reason: "error" }));
    });
    return;
  }
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
  void voiceprint.ready(); // 提前加载声纹模型（第一次会下载）
  console.log(`Teammate AI server on :${config.port} — mode: ${config.mode}`);
  if (config.mode !== "scripted" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.warn("没有检测到 ANTHROPIC_API_KEY：agent 调用可能失败。把 key 写进 .env，或改用 MODE=scripted。");
  }
});
