/**
 * 离线调参工具：不开服务端、不开界面，把一段对话逐句喂给 agent，打印它在每句话后的决定。
 *
 *   npm run agents:dry                         # 用 fixtures/brainstorm.json
 *   npm run agents:dry -- path/to/other.json   # 换一段对话
 *   npm run agents:dry -- --no-roles           # 只看主 agent 的决定，不生成卡片（更快更省）
 *
 * 改完提示词后重跑同一段对话，对比介入的时机和内容是变好还是变差。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CONFIG, emptySnapshot, findCalledAgent, TEAMMATE_IDS, type Card, type SessionConfig, type Utterance } from "@teammate/shared";
import { fmtClock, type MeetingContext } from "./context.ts";
import { decide, newMemory } from "./orchestrator.ts";
import { runRole } from "./roles.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // 没有 .env 也可以，只要环境里有凭证
}

const args = process.argv.slice(2);
const withRoles = !args.includes("--no-roles");
// 路径相对于仓库根目录（npm 会把工作目录切到 agents/，所以不能依赖当前目录）
const file = path.resolve(root, args.find((a) => !a.startsWith("--")) ?? "fixtures/brainstorm.json");

interface FixtureItem {
  t: number;
  type: string;
  speaker?: string;
  text?: string;
}
const fixture = JSON.parse(fs.readFileSync(file, "utf8")) as { items: FixtureItem[]; config?: Partial<SessionConfig> };
const items = fixture.items.filter(
  (i) => i.type === "utterance",
);

const ctx: MeetingContext = {
  config: { ...DEMO_CONFIG, ...fixture.config },
  elapsedMs: 0,
  transcript: [],
  teammates: emptySnapshot().teammates,
  cards: [],
  memory: newMemory(),
};
const nameOf = (id: string) => DEMO_CONFIG.speakers.find((s) => s.id === id)?.name ?? id;

for (const [i, item] of items.entries()) {
  const u: Utterance = {
    id: `u${i}`,
    speakerId: item.speaker!,
    speakerName: nameOf(item.speaker!),
    text: item.text!,
    t: item.t * 1000,
    isFinal: true,
  };
  ctx.transcript.push(u);
  ctx.elapsedMs = u.t;
  console.log(`\n[${fmtClock(u.t)}] ${u.speakerName}: ${u.text}`);

  // 和服务端一致：被点名时跳过主 agent，直接让那个队友回答
  const called = findCalledAgent(u.text);
  if (called === "main") continue;
  if (called) {
    console.log(`    ▶ ${called.toUpperCase()} called by name`);
    if (withRoles) {
      const roleStarted = Date.now();
      const out = await runRole(called, ctx, `${u.speakerName} asked you directly: "${u.text}". Answer the question.`, 3);
      console.log(`      card (${Date.now() - roleStarted}ms): ${out.title}\n        ${out.body}\n        say: “${out.say}”`);
      ctx.cards.push({ id: `c${ctx.cards.length}`, teammate: called, level: 3, status: "active", t: u.t, ...out });
    }
    continue;
  }

  const started = Date.now();
  const d = await decide(ctx);
  const ms = Date.now() - started;
  if (d.action === "stay_silent") {
    console.log(`    · silent (${ms}ms) — ${d.reason}`);
    continue;
  }
  // 和服务端一致：任意两次主动介入之间至少隔 18 秒
  const lastCard = ctx.cards.at(-1);
  if (lastCard && u.t - lastCard.t < 18_000) {
    console.log(`    · ${d.teammate} L${d.level} held back by the gap (${ms}ms) — ${d.reason}`);
    continue;
  }
  console.log(`    ▶ ${d.teammate.toUpperCase()} L${d.level} (${ms}ms) — ${d.reason}`);
  console.log(`      brief: ${d.brief}`);

  const card: Card = { id: `c${ctx.cards.length}`, teammate: d.teammate, level: d.level, title: d.brief, body: "", status: "active", t: u.t };
  if (withRoles) {
    const roleStarted = Date.now();
    const out = await runRole(d.teammate, ctx, d.brief, d.level);
    Object.assign(card, out);
    console.log(`      card (${Date.now() - roleStarted}ms): ${out.title}`);
    console.log(`        ${out.body}`);
    console.log(`        say: “${out.say}”`);
    for (const s of out.sources) console.log(`        src: ${s.title} — ${s.url}`);
  }
  ctx.cards.push(card);
  if (ctx.teammates[d.teammate].status === "hidden") ctx.teammates[d.teammate].status = "idle";
}
