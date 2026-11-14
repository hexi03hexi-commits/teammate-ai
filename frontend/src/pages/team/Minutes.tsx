import { motion, useReducedMotion } from "motion/react";
import type { TeammateId } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { AGENTS } from "../../agents/meta";
import type { Meeting, MinuteEntry } from "../../store/teams";
import { Icon, MemberAvatar, clock } from "../../ui/kit";
import { dayTime, ink, tint } from "./util";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** The record of one meeting: decision first, then what each agent brought, in time order. */
export function Minutes({ meeting, onFocusAgent }: { meeting: Meeting; onFocusAgent: (id: TeammateId | null) => void }) {
  const reduce = useReducedMotion();
  const d = meeting.decision;
  const entries = [...meeting.entries].sort((a, b) => a.t - b.t);
  const rise = (i: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + i * 0.06, duration: 0.42, ease },
  });

  return (
    <div className="flex flex-col gap-8">
      <motion.header {...rise(0)} className="pr-2">
        <div className="flex items-center gap-2 text-[14px] text-ink-3 tabular-nums">
          <span>{dayTime(meeting.startedAt)}</span>
          <span className="h-1 w-1 rounded-full bg-ink-3/50" />
          <span>{clock(meeting.durationMs)}</span>
        </div>
        <h2 className="mt-2 text-[32px] leading-[1.1] font-semibold tracking-[-0.025em] text-ink">{meeting.title}</h2>
      </motion.header>

      {d && (
        <motion.section {...rise(1)} className="rounded-[28px] bg-surface-2 p-6" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <div className="flex items-start gap-4">
            <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-bg">
              <Icon name="check" size={16} />
            </span>
            <p className="text-[24px] leading-[1.25] font-semibold tracking-[-0.015em] text-ink">{d.conclusion}</p>
          </div>

          {d.assignments.length > 0 && (
            <ul className="mt-5 flex flex-col gap-2 lg:pl-12">
              {d.assignments.map((a, i) => (
                <li key={i} className="flex items-center gap-3 rounded-[18px] bg-surface px-3 py-2.5 shadow-card">
                  <MemberAvatar name={a.owner} size={30} />
                  <span className="shrink-0 text-[15px] font-semibold text-ink">{a.owner}</span>
                  <span className="min-w-0 text-[15px] text-ink-2">{a.task}</span>
                </li>
              ))}
            </ul>
          )}

          {d.risks.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2 lg:pl-12">
              {d.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-3 text-[15px] text-ink-2">
                  <span className="mt-0.5 shrink-0 text-ink-3">
                    <RiskIcon />
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      )}

      {entries.length > 0 && (
        <ol className="relative flex flex-col gap-3">
          {entries.map((e, i) => (
            <motion.li key={e.id} {...rise(i + 2)}>
              <Entry entry={e} onFocus={onFocusAgent} />
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Entry({ entry: e, onFocus }: { entry: MinuteEntry; onFocus: (id: TeammateId | null) => void }) {
  const a = AGENTS[e.agent];
  const dismissed = e.status === "dismissed";
  const adopted = e.status === "adopted";
  return (
    <article
      onPointerEnter={() => onFocus(e.agent)}
      onPointerLeave={() => onFocus(null)}
      className="relative flex gap-4 overflow-hidden rounded-[24px] py-4 pr-5 pl-5 transition-opacity duration-300"
      style={{
        background: dismissed ? "var(--surface)" : tint(a.color, 8),
        boxShadow: `inset 0 0 0 1px ${dismissed ? "var(--line)" : `color-mix(in srgb, ${a.color} 18%, transparent)`}`,
        opacity: dismissed ? 0.5 : 1,
      }}
    >
      {/* colour rail */}
      <span className="absolute top-4 bottom-4 left-0 w-[4px] rounded-r-full" style={{ background: dismissed ? "var(--ink-3)" : a.color }} />
      <div className="shrink-0 pt-0.5">
        <AgentFigure agent={e.agent} mood={dismissed ? "asleep" : "idle"} size={44} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] tabular-nums">
          <span className="font-semibold" style={{ color: dismissed ? "var(--ink-3)" : ink(a.color) }}>
            {a.name}
          </span>
          <span className="text-ink-3">{clock(e.t)}</span>
          {adopted && (
            <span
              className="ml-auto grid h-6 w-6 place-items-center rounded-full"
              style={{ background: tint(a.color, 22), color: ink(a.color) }}
              aria-label="Adopted"
              title="Adopted"
            >
              <Icon name="check" size={14} />
            </span>
          )}
        </div>
        <h3 className={`mt-1 text-[17px] leading-snug font-semibold text-ink ${dismissed ? "line-through decoration-ink-3/60" : ""}`}>{e.title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{e.body}</p>
        {e.sources && e.sources.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {e.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium text-ink-2 shadow-card transition hover:text-ink"
              >
                <span style={{ color: ink(a.color) }}>
                  <Icon name="link" size={14} />
                </span>
                <span className="truncate">{s.title}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function RiskIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4.5 3.8 18.5h16.4Z" />
      <path d="M12 10v3.6M12 16.4h.01" />
    </svg>
  );
}
