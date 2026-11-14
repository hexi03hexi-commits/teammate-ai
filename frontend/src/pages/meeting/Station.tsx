import { motion } from "motion/react";
import type { Card, TeammateStatus } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { AGENTS, type Mood } from "../../agents/meta";
import { Icon, IconButton } from "../../ui/kit";

export const SPRING = { type: "spring", stiffness: 260, damping: 26, mass: 0.9 } as const;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface Props {
  card: Card;
  status: TeammateStatus;
  /** Tighter layout when three or four agents share the stage */
  compact: boolean;
  /** Someone else is speaking: step back */
  dimmed: boolean;
  canAct: boolean;
  onAdopt: () => void;
  onDismiss: () => void;
}

/**
 * One agent that has stepped forward: its figure, what it says (a speech bubble pulled out of it)
 * and the supporting information beside it.
 */
export function Station({ card, status, compact, dimmed, canAct, onAdopt, onDismiss }: Props) {
  const a = AGENTS[card.teammate];
  const speaking = status === "speaking";
  const mood: Mood = speaking ? "speaking" : status === "has_something" ? "nudging" : "idle";
  const figure = compact ? 76 : 128;
  // The bubble carries the spoken line when there is one; otherwise the headline.
  const line = card.say ?? card.title;
  const showTitle = Boolean(card.say);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 36, scale: 0.9 }}
      animate={{ opacity: dimmed ? 0.5 : 1, y: 0, scale: speaking ? 1.02 : 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.92, transition: { duration: 0.22 } }}
      transition={SPRING}
      className={`flex min-w-0 items-start ${compact ? "gap-3" : "gap-5"}`}
    >
      <motion.div layoutId={`agent-${card.teammate}`} transition={SPRING} className="shrink-0" style={{ marginTop: compact ? 0 : 4 }}>
        <AgentFigure agent={card.teammate} mood={mood} size={figure} look={0.5} />
      </motion.div>

      <div className={`flex min-w-0 flex-1 flex-col ${compact ? "gap-2" : "gap-3"}`}>
        {/* What it says */}
        <motion.div
          initial={{ opacity: 0, x: -18, scale: 0.94 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ ...SPRING, delay: 0.14 }}
          className={`glass relative origin-top-left rounded-[26px] rounded-tl-[8px] ${compact ? "px-4 py-3" : "px-6 py-5"}`}
          style={{
            boxShadow: speaking
              ? `inset 0 1px 0 var(--glass-edge), 0 0 0 2px ${a.color}, 0 18px 44px -18px ${a.color}`
              : undefined,
            transition: "box-shadow 0.4s",
          }}
        >
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: a.color }}>
            {a.name}
          </div>
          <p className={`font-semibold leading-snug text-ink ${compact ? "text-[16px]" : "text-[21px]"}`}>{line}</p>
        </motion.div>

        {/* Supporting information */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.3 }}
          className={`relative overflow-hidden rounded-[22px] bg-surface shadow-card ${compact ? "py-3 pr-3 pl-5" : "py-4 pr-4 pl-6"}`}
        >
          <span className="absolute inset-y-0 left-0 w-[5px]" style={{ background: a.color }} />
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {showTitle && <div className={`font-semibold text-ink ${compact ? "text-[14px]" : "text-[16px]"}`}>{card.title}</div>}
              <p className={`text-ink-2 ${compact ? "line-clamp-3 text-[13px] leading-snug" : "mt-0.5 text-[15px] leading-relaxed"}`}>{card.body}</p>
              {card.sources && card.sources.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {card.sources.map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      title={s.title}
                      className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition hover:text-ink"
                    >
                      <Icon name="link" size={12} />
                      {host(s.url)}
                    </a>
                  ))}
                </div>
              )}
            </div>
            {canAct && (
              <div className={`flex shrink-0 ${compact ? "flex-col gap-1.5" : "gap-2"}`}>
                <IconButton icon="close" label="Dismiss" size={compact ? 32 : 38} onClick={onDismiss} />
                <button
                  type="button"
                  aria-label="Adopt"
                  title="Adopt"
                  onClick={onAdopt}
                  className="grid place-items-center rounded-full text-white transition duration-200 hover:scale-105 active:scale-95"
                  style={{ width: compact ? 32 : 38, height: compact ? 32 : 38, background: a.color }}
                >
                  <Icon name="check" size={compact ? 15 : 18} />
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
