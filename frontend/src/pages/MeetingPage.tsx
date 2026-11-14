import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { TEAMMATE_IDS, type Card, type TeammateId } from "@teammate/shared";
import { AgentFigure } from "../agents/AgentFigure";
import { AGENTS, type Mood } from "../agents/meta";
import type { Session } from "../hooks/useSession";
import { useNow } from "../hooks/useNow";
import { IS_HOST } from "../lib/env";
import type { Team } from "../store/teams";
import { clock, IconButton, MemberAvatar } from "../ui/kit";
import { CHIP_SLOTS, useKeywordChips } from "./meeting/keywords";
import { SPRING, Station } from "./meeting/Station";

/** How long someone counts as "talking" after their last words arrive */
const TALKING_MS = 2600;
/** A card steps back into the dock by itself after this long (it stays reachable there) */
const STATION_LIFE_MS = 45_000;
const MAIN_SIZE = 280;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 1180, h: 820 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * The live meeting.
 *
 * Two arrangements, and the page moves between them on its own:
 *   listening  the main agent sits large in the centre, reacts to whoever is talking,
 *              and keywords it picks up appear around it
 *   stage      one to four agents have something to contribute: the main agent shrinks and
 *              rises to the top, and each active agent gets a station (figure, speech bubble,
 *              supporting information). The grid adapts to how many are active.
 */
export function MeetingPage({ session, team }: { session: Session; team: Team }) {
  const { snapshot, send, heard, connected } = session;
  const now = useNow(250);
  const [rootRef, size] = useSize<HTMLDivElement>();
  const live = snapshot.phase === "live";
  const paused = snapshot.paused;
  const wrappingUp = snapshot.phase === "ended";

  // ───── Who is talking ─────
  const heardAt = useRef(0);
  useEffect(() => {
    if (heard) heardAt.current = Date.now();
  }, [heard]);
  const talkingId = live && !paused && heard && now - heardAt.current < TALKING_MS ? heard.speakerId : null;
  const members = snapshot.config?.speakers ?? team.members;
  const talkingIndex = members.findIndex((m) => m.id === talkingId);

  // ───── Which agents are on stage ─────
  const firstSeen = useRef(new Map<string, number>());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());

  /** The latest card of each agent that is still open for discussion */
  const latest = useMemo(() => {
    const map = new Map<TeammateId, Card>();
    for (const c of snapshot.cards) if (c.status === "active") map.set(c.teammate, c);
    return map;
  }, [snapshot.cards]);

  for (const c of latest.values()) if (!firstSeen.current.has(c.id)) firstSeen.current.set(c.id, Date.now());

  // A pause does not count against a card's time on stage: shift every card by the length of the pause.
  const pausedAt = useRef(0);
  useEffect(() => {
    if (paused) {
      pausedAt.current = Date.now();
    } else if (pausedAt.current) {
      const gap = Date.now() - pausedAt.current;
      pausedAt.current = 0;
      for (const [id, t] of firstSeen.current) firstSeen.current.set(id, t + gap);
    }
  }, [paused]);

  const anySpeaking = TEAMMATE_IDS.some((id) => snapshot.teammates[id].status === "speaking");
  const stations = live
    ? [...latest.values()]
        .filter((c) => {
          const status = snapshot.teammates[c.teammate].status;
          if (status === "speaking" || opened.has(c.id)) return true;
          if (closed.has(c.id) || c.level === 1) return false;
          return paused || now - (firstSeen.current.get(c.id) ?? now) < STATION_LIFE_MS;
        })
        .sort((a, b) => (firstSeen.current.get(a.id) ?? 0) - (firstSeen.current.get(b.id) ?? 0))
    : [];
  const staged = stations.length > 0;
  const onStage = new Set(stations.map((c) => c.teammate));

  const toggleFromDock = (id: TeammateId) => {
    const card = latest.get(id);
    if (!card) return;
    setOpened((s) => new Set(s).add(card.id));
    setClosed((s) => {
      const n = new Set(s);
      n.delete(card.id);
      return n;
    });
  };
  const close = (card: Card, type: "adopt_card" | "dismiss_card") => {
    send({ type, id: card.id });
    setClosed((s) => new Set(s).add(card.id));
    setOpened((s) => {
      const n = new Set(s);
      n.delete(card.id);
      return n;
    });
  };

  // ───── Main agent ─────
  const mainMood: Mood = paused ? "asleep" : wrappingUp ? "thinking" : talkingId ? "listening" : "idle";
  // Look towards whoever is talking (members sit along the bottom left) or down at the stage
  // …or, when it has just called a teammate who is still getting ready, towards the dock on the right
  const someonePreparing = TEAMMATE_IDS.some((id) => snapshot.teammates[id].status === "preparing");
  const mainLook = talkingIndex >= 0 ? -0.9 + (talkingIndex / Math.max(1, members.length - 1)) * 0.8 : someonePreparing ? 0.9 : 0;
  const chips = useKeywordChips(heard, live && !paused && !staged);

  // ───── Layout ─────
  const narrow = size.w < 900;
  // Phones (usually someone following along): one column that scrolls, and no dock
  const phone = size.w < 640;
  const n = stations.length;
  const columns = n <= 1 || phone ? 1 : narrow ? (n >= 3 ? 2 : 1) : n === 3 ? 3 : 2;
  const compact = phone || n >= 3 || (narrow && n === 2);
  const mainSmall = 0.3;
  const mainY = staged ? -size.h / 2 + 34 + (MAIN_SIZE * mainSmall) / 2 : -size.h * 0.045;
  const chipRx = Math.min(size.w * 0.34, 330);
  const chipRy = Math.min(size.h * 0.27, 215);

  // ───── Clock ─────
  const frozenAt = useRef(0);
  if (!paused && live) frozenAt.current = now;
  // The clock stops when the meeting is paused and when it ends (while the minutes are being written)
  const elapsed = snapshot.startedAt ? Math.max(0, (frozenAt.current || now) - snapshot.startedAt) : 0;
  const total = (snapshot.config?.durationMin ?? 0) * 60_000;
  const over = total > 0 && elapsed > total;

  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => {
    if (!confirmStop) return;
    const t = window.setTimeout(() => setConfirmStop(false), 3500);
    return () => clearTimeout(t);
  }, [confirmStop]);

  return (
    <LayoutGroup>
      <div ref={rootRef} className="relative h-full overflow-hidden">
        {/* Soft light behind the stage, tinted by whoever is speaking */}
        <SpeakerWash teammates={snapshot.teammates} />

        {/* ───── Top: topic and clock ───── */}
        <header className={`absolute inset-x-0 top-0 z-20 flex items-start justify-between ${phone ? "px-4 pt-5" : "px-8 pt-7"}`}>
          <h1 className="max-w-[36%] truncate text-[17px] font-semibold text-ink-2">{snapshot.config?.goal}</h1>
          <div className="flex items-center gap-2.5 text-[17px] font-semibold tabular-nums">
            <span className="transition-colors duration-500" style={{ color: over ? "#ff5a4f" : "var(--ink)" }}>
              {clock(elapsed)}
            </span>
            {total > 0 && <span className="text-ink-3">{clock(total)}</span>}
            <span
              className="ml-1 h-2 w-2 rounded-full transition-colors"
              style={{ background: connected ? "#2fbf8f" : "#ff5a4f" }}
              aria-label={connected ? "Connected" : "Offline"}
            />
          </div>
        </header>

        {/* ───── Main agent ───── */}
        <motion.div
          className="absolute left-1/2 top-1/2 z-10"
          style={{ width: MAIN_SIZE, height: MAIN_SIZE, marginLeft: -MAIN_SIZE / 2, marginTop: -MAIN_SIZE / 2 }}
          initial={false}
          animate={{ y: mainY, scale: staged ? mainSmall : 1 }}
          transition={{ type: "spring", stiffness: 170, damping: 24 }}
        >
          <motion.div animate={{ y: [0, -7, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <AgentFigure agent="main" mood={mainMood} size={MAIN_SIZE} look={staged ? 0 : mainLook} />
          </motion.div>
        </motion.div>

        {/* ───── Keywords the main agent picks up ───── */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10" style={{ transform: `translateY(${-size.h * 0.045}px)` }}>
          <AnimatePresence>
            {chips.map((chip) => {
              const angle = (chip.slot / CHIP_SLOTS) * Math.PI * 2 - Math.PI / 2 + 0.4;
              const x = Math.cos(angle) * chipRx;
              const y = Math.sin(angle) * chipRy;
              return (
                <motion.div
                  key={chip.id}
                  className="glass absolute whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-semibold text-ink"
                  style={{ translateX: "-50%", translateY: "-50%" }}
                  initial={{ x: x * 1.25, y: y * 1.25, opacity: 0, scale: 0.6 }}
                  animate={{ x, y, opacity: 1, scale: 1 }}
                  // absorbed: drawn into the agent
                  exit={{ x: 0, y: 0, opacity: 0, scale: 0.2, transition: { duration: 0.6, ease: [0.6, 0, 0.8, 0.4] } }}
                  transition={SPRING}
                >
                  {chip.text}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* ───── Stage: the agents that have stepped forward ───── */}
        <div
          className={`no-scrollbar absolute inset-x-0 z-10 grid items-start justify-center overflow-y-auto ${phone ? "px-4 py-2" : "px-8"}`}
          style={{
            top: phone ? 118 : 140,
            bottom: phone ? 104 : 118,
            // centred while it fits, top-aligned and scrollable once it does not
            alignContent: "safe center",
            gridTemplateColumns: `repeat(${columns}, minmax(0, ${columns === 1 ? 700 : columns === 2 ? 540 : 380}px))`,
            gap: compact ? "22px 26px" : "34px 44px",
            pointerEvents: staged ? "auto" : "none",
          }}
        >
          <AnimatePresence mode="popLayout">
            {stations.map((card) => {
              const status = snapshot.teammates[card.teammate].status;
              return (
                <Station
                  key={card.teammate}
                  card={card}
                  status={status}
                  compact={compact}
                  dimmed={anySpeaking && status !== "speaking"}
                  canAct
                  onAdopt={() => close(card, "adopt_card")}
                  onDismiss={() => close(card, "dismiss_card")}
                />
              );
            })}
          </AnimatePresence>
        </div>

        {/* ───── Bottom: people · controls · agents ───── */}
        <footer className={`absolute inset-x-0 bottom-0 z-20 flex items-end justify-between ${phone ? "px-4 pb-5" : "px-8 pb-7"}`}>
          {/* People: the one talking steps up */}
          <div className={`flex items-end ${phone ? "gap-2" : "gap-3"}`}>
            {members.map((m) => {
              const talking = m.id === talkingId;
              return (
                <motion.div key={m.id} className="flex flex-col items-center gap-1.5" animate={{ y: talking ? -6 : 0, scale: talking ? 1.14 : 1 }} transition={SPRING}>
                  <div className="flex h-4 items-end gap-[3px]">
                    {talking && [0, 1, 2, 3].map((i) => <span key={i} className="tick w-[3px] rounded-full bg-ink" style={{ height: [8, 14, 10, 6][i], animationDelay: `${i * 0.12}s`, animationDuration: "0.6s" }} />)}
                  </div>
                  <MemberAvatar name={m.name} size={phone ? 36 : 46} active={talking} dim={paused} />
                  <span className={`text-[12px] font-semibold transition-colors ${talking ? "text-ink" : "text-ink-3"}`}>{m.name.replace(/^Dr\.?\s+/i, "")}</span>
                </motion.div>
              );
            })}
          </div>

          {/* Controls */}
          {IS_HOST && (
            <div className="glass absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full p-2">
              <AnimatePresence mode="popLayout" initial={false}>
                {confirmStop ? (
                  <motion.div key="confirm" className="flex items-center gap-2" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <IconButton icon="close" label="Keep going" size={52} onClick={() => setConfirmStop(false)} />
                    <IconButton icon="check" label="End meeting" tone="danger" size={52} onClick={() => send({ type: "end_session" })} />
                  </motion.div>
                ) : (
                  <motion.div key="controls" className="flex items-center gap-2" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <IconButton
                      icon={paused ? "play" : "pause"}
                      label={paused ? "Resume" : "Pause"}
                      tone={paused ? "solid" : "plain"}
                      size={52}
                      disabled={!live}
                      onClick={() => send({ type: paused ? "resume" : "pause" })}
                    />
                    <IconButton icon="stop" label="End meeting" tone="danger" size={52} disabled={!live} onClick={() => setConfirmStop(true)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Agents waiting in the dock */}
          <div className={phone ? "hidden" : "flex items-end gap-2"}>
            {TEAMMATE_IDS.map((id) => {
              const t = snapshot.teammates[id];
              const away = onStage.has(id);
              const hasCard = latest.has(id);
              const preparing = !paused && t.status === "preparing";
              const mood: Mood = paused || t.status === "hidden" || t.status === "muted" ? "asleep" : preparing ? "thinking" : t.status === "has_something" ? "nudging" : "idle";
              return (
                <div key={id} className="relative grid h-[62px] w-[62px] place-items-center">
                  {/* the empty seat it leaves behind */}
                  <span className="absolute h-9 w-9 rounded-full transition-opacity duration-500" style={{ background: AGENTS[id].color, opacity: away ? 0.14 : 0 }} />
                  {!away && (
                    <motion.button
                      type="button"
                      layoutId={`agent-${id}`}
                      transition={SPRING}
                      aria-label={AGENTS[id].name}
                      title={AGENTS[id].name}
                      disabled={!hasCard}
                      onClick={() => toggleFromDock(id)}
                      animate={{ y: preparing ? -10 : 0, scale: preparing ? 1.18 : 1 }}
                      whileTap={hasCard ? { scale: 0.9 } : undefined}
                      className="disabled:cursor-default"
                    >
                      <AgentFigure agent={id} mood={mood} size={58} />
                    </motion.button>
                  )}
                </div>
              );
            })}
          </div>
        </footer>
      </div>
    </LayoutGroup>
  );
}

/** A very soft wash of the speaking agent's colour across the top of the page. */
function SpeakerWash({ teammates }: { teammates: Session["snapshot"]["teammates"] }) {
  const speaker = TEAMMATE_IDS.find((id) => teammates[id].status === "speaking");
  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-700"
      style={{
        opacity: speaker ? 0.2 : 0,
        background: `radial-gradient(60% 55% at 50% 0%, ${speaker ? AGENTS[speaker].color : "transparent"}, transparent 70%)`,
      }}
    />
  );
}
