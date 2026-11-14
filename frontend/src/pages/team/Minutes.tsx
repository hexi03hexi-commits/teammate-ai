import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { AGENTS } from "../../agents/meta";
import type { Meeting, MinuteEntry, Team } from "../../store/teams";
import { Icon, MemberAvatar, clock } from "../../ui/kit";
import { ink, tint } from "./util";

const ease = [0.2, 0.8, 0.2, 1] as const;

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;

/**
 * The written record of one meeting, laid out like minutes:
 * header facts → attendees → summary → decision → action items → discussion by topic
 * → what each agent contributed (colour-coded) → open risks.
 */
export function Minutes({ meeting, team, onFocusAgent }: { meeting: Meeting; team: Team; onFocusAgent: (id: TeammateId | null) => void }) {
  const reduce = useReducedMotion();
  const d = meeting.decision;
  const entries = [...meeting.entries].sort((a, b) => a.t - b.t);
  const people = team.members.filter((m) => meeting.memberIds.includes(m.id));
  const absent = team.members.filter((m) => !meeting.memberIds.includes(m.id));
  const agents = TEAMMATE_IDS.filter((id) => meeting.agentIds.includes(id));

  let step = 0;
  const rise = () => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.04 + step++ * 0.05, duration: 0.4, ease },
  });

  return (
    <div className="flex flex-col gap-7">
      {/* ───── Title and export ───── */}
      <motion.header {...rise()} className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-ink-3">Meeting minutes · {team.name}</div>
          <h2 className="mt-1.5 text-[30px] leading-[1.12] font-semibold tracking-[-0.025em] text-ink">{meeting.title}</h2>
        </div>
        <button
          type="button"
          aria-label="Export minutes"
          title="Export"
          className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface-2 px-4 text-[14px] font-semibold text-ink-2 transition hover:text-ink active:scale-95"
          style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
        >
          <Icon name="export" size={16} />
          Export
        </button>
      </motion.header>

      {/* ───── Facts ───── */}
      <motion.dl {...rise()} className="grid grid-cols-2 overflow-hidden rounded-[22px] bg-surface-2 lg:grid-cols-4" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <Fact label="Date" value={fmtDate(meeting.startedAt)} />
        <Fact label="Time" value={`${fmtTime(meeting.startedAt)} – ${fmtTime(meeting.startedAt + meeting.durationMs)}`} />
        <Fact label="Duration" value={`${minutes(meeting.durationMs)} · ${clock(meeting.durationMs)}`} />
        <Fact label="Agent input" value={entries.length ? `${entries.length} contribution${entries.length === 1 ? "" : "s"}` : "None"} />
      </motion.dl>

      {/* ───── Attendees: people and agents ───── */}
      <motion.section {...rise()}>
        <Label>Attendees</Label>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {people.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <MemberAvatar name={m.name} size={30} />
              <div className="leading-tight">
                <div className="text-[14px] font-semibold text-ink">{m.name}</div>
                {m.skill && <div className="text-[12px] text-ink-3">{m.skill}</div>}
              </div>
            </div>
          ))}
          {agents.length > 0 && <span className="h-7 w-px bg-line" />}
          {agents.map((id) => {
            const count = entries.filter((e) => e.agent === id).length;
            return (
              <div key={id} className="flex items-center gap-1.5" onPointerEnter={() => onFocusAgent(id)} onPointerLeave={() => onFocusAgent(null)}>
                <AgentFigure agent={id} mood="idle" size={32} bare />
                <div className="leading-tight">
                  <div className="text-[14px] font-semibold" style={{ color: ink(AGENTS[id].color) }}>
                    {AGENTS[id].name}
                  </div>
                  <div className="text-[12px] text-ink-3">
                    {AGENTS[id].role} · {count}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {absent.length > 0 && <div className="mt-2.5 text-[13px] text-ink-3">Absent: {absent.map((m) => m.name).join(", ")}</div>}
      </motion.section>

      {/* ───── Summary ───── */}
      {d?.summary && (
        <motion.section {...rise()}>
          <Label>Summary</Label>
          <p className="max-w-[68ch] text-[16px] leading-relaxed text-ink-2">{d.summary}</p>
        </motion.section>
      )}

      {/* ───── Decision ───── */}
      {d && (
        <motion.section {...rise()}>
          <Label>Decision</Label>
          <div className="flex items-start gap-3.5 rounded-[22px] bg-ink px-5 py-4 text-bg">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg/15">
              <Icon name="check" size={15} />
            </span>
            <p className="text-[20px] leading-snug font-semibold tracking-[-0.01em]">{d.conclusion}</p>
          </div>
        </motion.section>
      )}

      {/* ───── Action items ───── */}
      {d && d.assignments.length > 0 && (
        <motion.section {...rise()}>
          <Label count={d.assignments.length}>Action items</Label>
          <ul className="overflow-hidden rounded-[22px] bg-surface" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
            {d.assignments.map((a, i) => (
              <li key={i} className={`flex items-center gap-3 px-4 py-3 ${i ? "border-t border-line" : ""}`}>
                <span className="w-5 shrink-0 text-[13px] font-semibold text-ink-3 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="h-[18px] w-[18px] shrink-0 rounded-[6px]" style={{ boxShadow: "inset 0 0 0 1.5px var(--ink-3)" }} />
                <span className="min-w-0 flex-1 text-[15px] text-ink">{a.task}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <MemberAvatar name={a.owner} size={24} />
                  <span className="text-[14px] font-semibold text-ink-2">{a.owner}</span>
                </span>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {/* ───── Discussion, by topic ───── */}
      {d?.topics && d.topics.length > 0 && (
        <motion.section {...rise()}>
          <Label count={d.topics.length}>Discussion</Label>
          <ol className="flex flex-col gap-4">
            {d.topics.map((t, i) => (
              <li key={i} className="flex gap-3.5">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-bold text-ink-2 tabular-nums">{i + 1}</span>
                <div className="min-w-0">
                  <h3 className="text-[16px] font-semibold text-ink">{t.title}</h3>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {t.points.map((p, j) => (
                      <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed text-ink-2">
                        <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </motion.section>
      )}

      {/* ───── What the agents raised ───── */}
      {entries.length > 0 && (
        <motion.section {...rise()}>
          <Label count={entries.length}>Agent contributions</Label>
          <ol className="flex flex-col gap-2.5">
            {entries.map((e) => (
              <li key={e.id}>
                <Entry entry={e} onFocus={onFocusAgent} />
              </li>
            ))}
          </ol>
        </motion.section>
      )}

      {/* ───── Open risks ───── */}
      {d && d.risks.length > 0 && (
        <motion.section {...rise()}>
          <Label count={d.risks.length}>Open risks</Label>
          <ul className="flex flex-col gap-2">
            {d.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-3 rounded-[18px] bg-surface-2 px-4 py-3 text-[15px] leading-relaxed text-ink-2">
                <span className="mt-0.5 shrink-0 text-ink-3">
                  <RiskIcon />
                </span>
                {r}
              </li>
            ))}
          </ul>
        </motion.section>
      )}
    </div>
  );
}

function Label({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-ink-3">{children}</h3>
      {count !== undefined && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-ink-3 tabular-nums">{count}</span>}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line px-4 py-3 not-first:border-l max-lg:nth-[3]:border-l-0 max-lg:nth-[n+3]:border-t">
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Entry({ entry: e, onFocus }: { entry: MinuteEntry; onFocus: (id: TeammateId | null) => void }) {
  const a = AGENTS[e.agent];
  return (
    <article
      onPointerEnter={() => onFocus(e.agent === "main" ? null : e.agent)}
      onPointerLeave={() => onFocus(null)}
      className="relative flex gap-3.5 overflow-hidden rounded-[20px] py-3.5 pr-4 pl-5"
      style={{ background: tint(a.color, 8), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${a.color} 18%, transparent)` }}
    >
      {/* colour rail */}
      <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: a.color }} />
      <div className="shrink-0 pt-0.5">
        <AgentFigure agent={e.agent} mood="idle" size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] tabular-nums">
          <span className="font-bold" style={{ color: ink(a.color) }}>
            {a.name}
          </span>
          <span className="text-ink-3">{a.role}</span>
          <span className="h-1 w-1 rounded-full bg-ink-3/50" />
          <span className="text-ink-3">{clock(e.t)}</span>
        </div>
        <h4 className="mt-1 text-[16px] leading-snug font-semibold text-ink">{e.title}</h4>
        {e.body.trim() && <p className="mt-0.5 text-[14.5px] leading-relaxed text-ink-2">{e.body}</p>}
        {e.sources && e.sources.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {e.sources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition hover:text-ink"
                style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
              >
                <span style={{ color: ink(a.color) }}>
                  <Icon name="link" size={13} />
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
