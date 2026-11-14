/**
 * 试关键词提取：把一段对话按“停顿后的一小批句子”喂进去，看每批挑出什么词。
 *
 *   npm run keywords -w agents                              # 英文演示对话
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CONFIG, type SessionConfig, type Utterance } from "@teammate/shared";
import { extractKeywords } from "./keywords.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // 没有 .env 也可以，只要环境里有凭证
}

const file = path.resolve(root, process.argv[2] ?? "fixtures/brainstorm.json");
const fixture = JSON.parse(fs.readFileSync(file, "utf8")) as { config?: Partial<SessionConfig>; items: { t: number; type?: string; speaker?: string; text?: string }[] };
const config = { ...DEMO_CONFIG, ...fixture.config };
const nameOf = (id: string) => config.speakers.find((s) => s.id === id)?.name ?? id;
const all: Utterance[] = fixture.items
  .filter((i) => i.speaker && i.text && (i.type ?? "utterance") === "utterance")
  .map((i, n) => ({ id: `u${n}`, speakerId: i.speaker!, speakerName: nameOf(i.speaker!), text: i.text!, t: i.t * 1000, isFinal: true }));

// 和服务端一样分批：相邻两句间隔不到 2.5 秒的算同一批
const batches: Utterance[][] = [];
for (const u of all) {
  const last = batches.at(-1);
  if (last && u.t - last.at(-1)!.t < 2500) last.push(u);
  else batches.push([u]);
}

const shown: string[] = [];
let done = 0;
for (const fresh of batches) {
  const started = Date.now();
  const words = await extractKeywords({ config, earlier: all.slice(0, done), fresh, shown });
  done += fresh.length;
  shown.push(...words);
  for (const u of fresh) console.log(`  ${u.speakerName}: ${u.text}`);
  console.log(`      → ${words.length ? words.map((w) => `[${w}]`).join(" ") : "—"}   (${Date.now() - started}ms)\n`);
}
