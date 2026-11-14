import { motion } from "motion/react";
import { AgentFigure } from "../../agents/AgentFigure";
import type { Meeting, Member } from "../../store/teams";
import { MemberAvatar, clock } from "../../ui/kit";
import { day } from "./util";

/** Past meetings, newest first. The selected one drives the roster and the minutes. */
export function History({
  meetings,
  members,
  selectedId,
  onSelect,
  muted,
}: {
  meetings: Meeting[];
  /** The team, to show who attended each meeting */
  members: Member[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1 transition-opacity duration-300" style={{ opacity: muted ? 0.45 : 1 }}>
      {meetings.map((m, i) => {
        const selected = !muted && m.id === selectedId;
        const people = members.filter((p) => m.memberIds.includes(p.id));
        return (
          <motion.li
            key={m.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.05, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <motion.button
              type="button"
              onClick={() => onSelect(m.id)}
              aria-current={selected}
              whileTap={{ scale: 0.98 }}
              className="relative flex w-full flex-col gap-2.5 rounded-[22px] px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
            >
              {selected && (
                <motion.span
                  layoutId="history-selected"
                  className="absolute inset-0 rounded-[22px] bg-surface-2"
                  style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                />
              )}
              <div className="relative min-w-0">
                <div className={`truncate text-[16px] font-semibold ${selected ? "text-ink" : "text-ink-2"}`}>{m.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-3 tabular-nums">
                  <span>{day(m.startedAt)}</span>
                  <span className="h-1 w-1 rounded-full bg-ink-3/50" />
                  <span>{clock(m.durationMs)}</span>
                </div>
              </div>
              {/* who was there: people, then agents */}
              <div className="relative flex items-center justify-between">
                <div className="flex items-center">
                  {people.map((p, j) => (
                    <div key={p.id} className="rounded-full" style={{ marginLeft: j ? -6 : 0, boxShadow: `0 0 0 2px var(${selected ? "--surface-2" : "--surface"})` }} title={p.name}>
                      <MemberAvatar name={p.name} size={24} />
                    </div>
                  ))}
                </div>
                <div className="flex items-center -space-x-1">
                  {m.agentIds.map((id) => (
                    <AgentFigure key={id} agent={id} mood="idle" size={24} bare />
                  ))}
                </div>
              </div>
            </motion.button>
          </motion.li>
        );
      })}
    </ul>
  );
}
