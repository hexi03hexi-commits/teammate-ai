/**
 * 冒烟测试：连上正在运行的服务端，用演示配置开一场会，打印收到的事件，N 秒后结束并等决策卡。
 *
 *   npm run smoke -w server            # 默认 20 秒后结束
 *   npm run smoke -w server -- 60      # 60 秒后结束
 */
import { WebSocket } from "ws";
import { DEFAULT_PORT, DEMO_CONFIG, type ClientMessage, type ServerEvent } from "@teammate/shared";

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const endAfterS = Number(process.argv[2] ?? 20);
const ws = new WebSocket(`ws://localhost:${port}`);
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const send = (m: ClientMessage) => ws.send(JSON.stringify(m));

ws.on("open", () => {
  send({ type: "hello", role: "host" });
  send({ type: "start_session", config: { ...DEMO_CONFIG, teamId: "t-hack" } });
  setTimeout(() => send({ type: "end_session" }), endAfterS * 1000);
});
ws.on("error", (err) => {
  console.error(`连不上 ws://localhost:${port}，服务端启动了吗？`, err.message);
  process.exit(1);
});
ws.on("message", (data) => {
  const e = JSON.parse(data.toString()) as ServerEvent;
  switch (e.type) {
    case "transcript":
    case "speaking":
      return;
    case "snapshot":
      return console.log(at(), "snapshot", e.snapshot.phase);
    case "teammate_state":
      return console.log(at(), "state   ", e.teammate, "→", e.state.status);
    case "card":
      return console.log(at(), "card    ", e.card.teammate, `L${e.card.level}`, "—", e.card.title);
    case "keywords":
      return console.log(at(), "keywords", e.words.join(" · "));
    case "card_update":
      return console.log(at(), "card    ", e.id, "→", e.status);
    case "speak":
      console.log(at(), "SPEAK   ", e.teammate, "—", e.text);
      // 假装播放了一小会儿
      send({ type: "speak_started", id: e.id });
      setTimeout(() => send({ type: "speak_done", id: e.id }), 500);
      return;
    case "decision":
      console.log(at(), "decision", "—", e.decision.conclusion);
      for (const a of e.decision.assignments) console.log("        ", a.owner, ":", a.task);
      for (const r of e.decision.risks) console.log("         risk:", r);
      return process.exit(0);
    case "error":
      return console.log(at(), "ERROR   ", e.message);
  }
});
