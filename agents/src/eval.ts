/**
 * 介入时机测试：主 agent 是否只在真人没补上角色时才派人。
 *
 *   npm run agents:eval                # 每个场景跑 3 次
 *   npm run agents:eval -- --runs 5    # 每个场景跑 5 次
 *   npm run agents:eval -- --only drift-nobody-steers,on-pace
 *   npm run agents:eval -- --file holdout   # 换一个测试集（fixtures/eval/holdout.json）
 *   npm run agents:eval -- --label v2  # 结果另存一份 fixtures/eval/results-v2.json，方便对比
 *
 * 只跑主 agent（不生成卡片内容），并套用和服务端相同的间隔、冷却、点名规则。
 * 一次通过 = 该来的都来了（在时间窗内），且没有任何多余的介入。
 * 同一场景跑多次是因为模型的判断有随机性：要看的是通过率，不是某一次的结果。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CONFIG, emptySnapshot, findCalledAgent, TEAMMATE_IDS, type SessionConfig, type TeammateId, type Utterance } from "@teammate/shared";
import type { MeetingContext } from "./context.ts";
import { decide, newMemory } from "./orchestrator.ts";
import type { Persona } from "./personas.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // 没有 .env 也可以，只要环境里有凭证
}

// 和 server/src/config.ts 保持一致
const GAP_S = 18;
const COOLDOWN_S = 45;

interface Item {
  t: number;
  type?: string;
  speaker?: string;
  text?: string;
}
interface Expect {
  teammate: TeammateId;
  from: number;
  to: number;
}
interface Case {
  id: string;
  about: string;
  durationMin: number;
  expect: Expect[];
  /** 介入与否都算对的队友（判断题本身两可的场景） */
  allow?: TeammateId[];
  items?: Item[];
  fixture?: string;
  /** 这场会议开始前已有的成员画像 */
  personas?: Persona[];
  /** 谁在场（默认四个人都在） */
  present?: string[];
}
interface Fired {
  teammate: TeammateId;
  t: number;
  level: number;
  reason: string;
}
interface RunResult {
  pass: boolean;
  fired: Fired[];
  missed: Expect[];
  extra: Fired[];
  ms: number[];
}

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const RUNS = Number(arg("runs") ?? 3);
const only = arg("only")?.split(",");
const label = arg("label");
const file = arg("file") ?? "cases";

const suite = JSON.parse(fs.readFileSync(path.join(root, `fixtures/eval/${file}.json`), "utf8")) as { cases: Case[]; config?: Partial<SessionConfig> };
const all = suite.cases;
const cases = only ? all.filter((c) => only.includes(c.id)) : all;
const nameOf = (id: string) => DEMO_CONFIG.speakers.find((s) => s.id === id)?.name ?? id;

function itemsOf(c: Case): Item[] {
  const items = c.fixture ? (JSON.parse(fs.readFileSync(path.join(root, "fixtures", c.fixture), "utf8")) as { items: Item[] }).items : c.items!;
  return items.filter((i) => i.speaker && i.text && (i.type ?? "utterance") === "utterance");
}

async function runOnce(c: Case): Promise<RunResult> {
  const ctx: MeetingContext = {
    config: {
      ...DEMO_CONFIG,
      ...suite.config,
      durationMin: c.durationMin,
      speakers: DEMO_CONFIG.speakers.filter((s) => !c.present || c.present.includes(s.id)),
    },
    personas: c.personas,
    elapsedMs: 0,
    transcript: [],
    teammates: emptySnapshot().teammates,
    cards: [],
    memory: newMemory(),
  };
  const fired: Fired[] = [];
  const ms: number[] = [];
  const lastBy: Partial<Record<TeammateId, number>> = {};
  let lastAny = -Infinity;

  for (const [i, item] of itemsOf(c).entries()) {
    const u: Utterance = { id: `u${i}`, speakerId: item.speaker!, speakerName: nameOf(item.speaker!), text: item.text!, t: item.t * 1000, isFinal: true };
    ctx.transcript.push(u);
    ctx.elapsedMs = u.t;

    // 点名由服务端直接处理，不经过主 agent，也不计入测试
    const called = findCalledAgent(u.text);
    if (called === "main") continue;
  if (called) {
      ctx.cards.push({ id: `c${ctx.cards.length}`, teammate: called, level: 3, title: `Answered ${u.speakerName}'s direct question`, body: "", status: "active", t: u.t });
      ctx.teammates[called].status = "idle";
      continue;
    }

    const started = Date.now();
    const d = await decide(ctx);
    ms.push(Date.now() - started);
    if (d.action !== "intervene") continue;
    if (item.t - lastAny < GAP_S) continue; // 被间隔拦下：服务端会稍后重新判断，这里等下一句话
    if (item.t - (lastBy[d.teammate] ?? -Infinity) < COOLDOWN_S) continue;

    fired.push({ teammate: d.teammate, t: item.t, level: d.level, reason: d.reason });
    lastAny = item.t;
    lastBy[d.teammate] = item.t;
    // 测试不生成卡片内容，用一句话代表“这个队友已经就这件事向大家说过了”
    ctx.cards.push({ id: `c${ctx.cards.length}`, teammate: d.teammate, level: d.level, title: `Reported to the group on: ${d.brief}`, body: "", status: "active", t: u.t });
    ctx.teammates[d.teammate].status = "idle";
  }

  const used = new Set<Fired>();
  const missed = c.expect.filter((e) => {
    const hit = fired.find((f) => !used.has(f) && f.teammate === e.teammate && f.t >= e.from && f.t <= e.to);
    if (hit) used.add(hit);
    return !hit;
  });
  const extra = fired.filter((f) => !used.has(f) && !c.allow?.includes(f.teammate));
  return { pass: missed.length === 0 && extra.length === 0, fired, missed, extra, ms };
}

/** 并发跑，限制同时进行的数量 */
async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

const jobs = cases.flatMap((c) => Array.from({ length: RUNS }, () => () => runOnce(c)));
const started = Date.now();
const flat = await pool(jobs, 6);

let passed = 0;
let missedTotal = 0;
let extraTotal = 0;
const allMs: number[] = [];
const summary: Record<string, unknown> = {};
console.log();
for (const [ci, c] of cases.entries()) {
  const runs = flat.slice(ci * RUNS, ci * RUNS + RUNS);
  const ok = runs.filter((r) => r.pass).length;
  passed += ok;
  const kind = c.expect.length ? `expect ${c.expect.map((e) => e.teammate).join(", ")}` : "expect silence";
  console.log(`${ok === RUNS ? "✔" : ok === 0 ? "✘" : "~"} ${c.id.padEnd(26)} ${ok}/${RUNS}   ${kind}`);
  for (const [ri, r] of runs.entries()) {
    allMs.push(...r.ms);
    missedTotal += r.missed.length;
    extraTotal += r.extra.length;
    if (r.pass) continue;
    for (const m of r.missed) console.log(`      run ${ri + 1}: MISSED ${m.teammate} (should step in between ${m.from}s and ${m.to}s)`);
    for (const x of r.extra) console.log(`      run ${ri + 1}: EXTRA  ${x.teammate} L${x.level} at ${x.t}s — ${x.reason}`);
  }
  summary[c.id] = { pass: ok, runs: RUNS, results: runs.map(({ ms: _ms, ...r }) => r) };
}

const total = cases.length * RUNS;
allMs.sort((a, b) => a - b);
const pct = (p: number) => allMs[Math.min(allMs.length - 1, Math.floor(allMs.length * p))];
console.log(`\n${passed}/${total} runs passed · ${missedTotal} missed · ${extraTotal} unwanted · decision time median ${pct(0.5)}ms, p90 ${pct(0.9)}ms · ${((Date.now() - started) / 1000).toFixed(0)}s`);

if (label) {
  const out = path.join(root, `fixtures/eval/results-${label}.json`);
  fs.writeFileSync(out, JSON.stringify({ label, passed, total, missed: missedTotal, extra: extraTotal, cases: summary }, null, 2));
  console.log(`saved ${path.relative(root, out)}`);
}
