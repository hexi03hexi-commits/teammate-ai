import { useEffect, useRef, useState } from "react";
import { hasCjk, type Utterance } from "@teammate/shared";

/**
 * Keyword chips: the few words the main agent "picks up" from what people say.
 * The sentences themselves are never shown — only these fragments, briefly.
 */

const STOP = new Set(
  `about above after again against already also although always among another anyone anything around because become before being below between both could doing during each either enough every everyone everything first from going great happy have having hello here honestly into just know like little maybe might more most much must never nothing only other ought over perfect please probably quite rather really right same should since some someone something sounds speaking still such sure than thank thanks that their them then there these they thing things think this those though through together under until very want well were what when where which while will with without would yeah your`.split(
    /\s+/,
  ),
);

export interface Chip {
  id: string;
  text: string;
  /** Which of the fixed positions around the agent it occupies */
  slot: number;
}

export const CHIP_SLOTS = 8;
const CHIP_LIFE_MS = 7000;
const MAX_CHIPS = 6;

/** Common Chinese function words that say nothing about the topic */
const ZH_STOP = new Set(
  "我们 你们 他们 咱们 这个 那个 这些 那些 什么 怎么 为什么 可以 就是 然后 但是 可是 不过 因为 所以 觉得 感觉 现在 已经 还是 没有 一个 一下 一些 一起 这样 那样 如果 应该 可能 时候 知道 的话 不是 还有 或者 而且 其实 比较 非常 真的 确实 好像 大家 自己 东西 是不是 有没有 是否 这里 那里 之后 之前 起来 出来 进行 需要 只是 好的 行吧 可能性 一点 有点 的确 那么 这么 多少 还要 就要 不要 不会 不能 能不能 要不要 喜欢 最好 最好的 不错 特别 好喝 好看 看到 一会儿 结束 怎么样 想法 同意 没问题 可以的 这块 那儿 那家 他们家 旁边 咱们俩 说到 听着 有点 太好了 就行 就这样".split(
    /\s+/,
  ),
);

/**
 * Chinese (and mixed Chinese/English) speech has no spaces, so split it with the browser's
 * word segmenter. English names inside a Chinese sentence ("Quizlet") are usually the most
 * telling words, so they score highest.
 */
function pickCjk(text: string, recent: Set<string>): string[] {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) return [];
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  const scored: { w: string; key: string; score: number }[] = [];
  for (const part of segmenter.segment(text)) {
    if (!part.isWordLike) continue;
    const w = part.segment;
    const key = w.toLowerCase();
    const latin = /^[A-Za-z][A-Za-z'-]*$/.test(w);
    if (latin ? w.length < 3 || STOP.has(key) : w.length < 2 || ZH_STOP.has(w) || /^[\d\s]+$/.test(w)) continue;
    if (recent.has(key) || scored.some((x) => x.key === key)) continue;
    scored.push({ w, key, score: latin ? w.length + 6 : w.length * 2 });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.w);
}

function pick(text: string, recent: Set<string>): string[] {
  if (hasCjk(text)) return pickCjk(text, recent);
  const words = text.match(/[A-Za-z][A-Za-z'-]{3,}/g) ?? [];
  const scored = words
    .map((w, i) => {
      const key = w.toLowerCase();
      if (STOP.has(key) || recent.has(key)) return null;
      // Longer words and mid-sentence capitals (names, products) carry more meaning
      const proper = i > 0 && /^[A-Z]/.test(w);
      return { w, key, score: w.length + (proper ? 6 : 0) };
    })
    .filter((x): x is { w: string; key: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const s of scored) {
    if (out.some((o) => o.toLowerCase() === s.key)) continue;
    out.push(s.w);
    if (out.length === 2) break;
  }
  return out;
}

export function useKeywordChips(heard: Utterance | null, enabled: boolean): Chip[] {
  const [chips, setChips] = useState<Chip[]>([]);
  const recent = useRef<string[]>([]);
  const nextSlot = useRef(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!heard?.isFinal || !enabled) return;
    const words = pick(heard.text, new Set(recent.current));
    if (words.length === 0) return;
    recent.current = [...recent.current, ...words.map((w) => w.toLowerCase())].slice(-24);

    const fresh: Chip[] = words.map((text) => {
      // Alternate sides so chips spread around the agent instead of clumping
      const slot = nextSlot.current;
      nextSlot.current = (slot + 3) % CHIP_SLOTS;
      return { id: `k${++seq.current}`, text, slot };
    });
    const timers = fresh.map((chip, i) =>
      window.setTimeout(() => {
        setChips((cs) => [...cs.filter((c) => c.slot !== chip.slot), chip].slice(-MAX_CHIPS));
        window.setTimeout(() => setChips((cs) => cs.filter((c) => c.id !== chip.id)), CHIP_LIFE_MS);
      }, i * 380),
    );
    return () => timers.forEach(clearTimeout);
  }, [heard, enabled]);

  useEffect(() => {
    if (!enabled) setChips([]);
  }, [enabled]);

  return chips;
}
