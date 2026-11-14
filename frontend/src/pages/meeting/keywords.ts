import { useEffect, useRef, useState } from "react";
import type { Utterance } from "@teammate/shared";

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

function pick(text: string, recent: Set<string>): string[] {
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
