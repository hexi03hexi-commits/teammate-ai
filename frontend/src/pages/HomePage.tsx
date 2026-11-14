import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AgentFigure } from "../agents/AgentFigure";
import { AGENTS, type Mood } from "../agents/meta";
import type { Team } from "../store/teams";
import { ThemeToggle } from "../ui/kit";
import { TeamList } from "./home/TeamList";

const SLEEP_AFTER = 12_000;

const MOOD_WORD: Record<Mood, string> = {
  asleep: "Atlas is asleep",
  idle: "Atlas is here",
  listening: "Atlas is listening",
  thinking: "Atlas is thinking",
  nudging: "Atlas is curious",
  speaking: "Atlas says hi",
};

export function HomePage({
  teams,
  onOpenTeam,
  onAddTeam,
}: {
  teams: Team[];
  onOpenTeam: (teamId: string) => void;
  onAddTeam: (name: string) => void;
}) {
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(320);
  const [look, setLook] = useState(0);
  const [hoverTeam, setHoverTeam] = useState<string | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [reaction, setReaction] = useState<Mood | null>(null);
  const [adding, setAdding] = useState(false);
  const lastMove = useRef(Date.now());
  const pokes = useRef(0);
  const reactTimer = useRef<number | undefined>(undefined);

  // Hero size follows the stage, so the figure never crops on small screens.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize(Math.round(Math.max(200, Math.min(380, width * 0.6, height * 0.48))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const react = useCallback((m: Mood, ms: number) => {
    window.clearTimeout(reactTimer.current);
    setReaction(m);
    reactTimer.current = window.setTimeout(() => setReaction(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(reactTimer.current), []);

  // Gaze follows the pointer; any input wakes; stillness puts it to sleep.
  useEffect(() => {
    const wake = () => {
      lastMove.current = Date.now();
      setAsleep((was) => {
        if (was) react("nudging", 1200);
        return false;
      });
    };
    const move = (e: PointerEvent) => {
      wake();
      const el = stage.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      setLook(Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2))));
    };
    const tick = window.setInterval(() => {
      if (Date.now() - lastMove.current > SLEEP_AFTER) setAsleep(true);
    }, 1000);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [react]);

  const poke = () => {
    pokes.current += 1;
    react(pokes.current % 2 ? "speaking" : "thinking", 1800);
  };

  const mood: Mood = asleep ? "asleep" : reaction ?? (hoverTeam || adding ? "listening" : "idle");
  const gaze = hoverTeam || adding ? -1 : look;
  const glow = AGENTS.main;

  return (
    <div className="flex h-full gap-4 p-4 lg:gap-6 lg:p-6">
      <aside className="flex w-[272px] shrink-0 flex-col rounded-[32px] bg-surface shadow-card lg:w-[328px]">
        <TeamList
          teams={teams}
          adding={adding}
          setAdding={setAdding}
          onOpenTeam={onOpenTeam}
          onAddTeam={onAddTeam}
          onHover={setHoverTeam}
        />
        <div className="px-4 pb-4">
          <ThemeToggle />
        </div>
      </aside>

      <main ref={stage} className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
        {/* The only colour on the page: a soft halo borrowed from Atlas */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full transition-opacity duration-1000"
          style={{
            width: size * 2.2,
            height: size * 2.2,
            background: `radial-gradient(closest-side, color-mix(in srgb, ${glow.to} 26%, transparent), color-mix(in srgb, ${glow.from} 10%, transparent) 55%, transparent)`,
            filter: "blur(30px)",
            opacity: asleep ? 0.25 : 0.9,
            transform: "translateY(-6%)",
          }}
        />

        <motion.div
          animate={reduce || asleep ? { y: 0 } : { y: [0, -12, 0] }}
          transition={reduce || asleep ? { duration: 0.6 } : { duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
          className="relative"
        >
          <motion.button
            type="button"
            aria-label="Atlas"
            onClick={poke}
            whileHover={reduce ? undefined : { scale: 1.03 }}
            whileTap={reduce ? undefined : { scale: 0.88 }}
            animate={{ rotate: reduce ? 0 : gaze * 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 14 }}
            className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <AgentFigure agent="main" mood={mood} size={size} look={mood === "asleep" ? 0 : gaze} />
          </motion.button>
        </motion.div>

        <div className="relative mt-10 flex flex-col items-center gap-2 text-center">
          <h1 className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink lg:text-[52px]">
            Teammate <span style={{ color: glow.color }}>AI</span>
          </h1>
          <div className="relative h-7 w-64 overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={mood}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28 }}
                className="absolute inset-x-0 text-lg text-ink-3"
              >
                {MOOD_WORD[mood]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
