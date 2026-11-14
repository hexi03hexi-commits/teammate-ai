import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AgentFigure } from "../../agents/AgentFigure";
import type { Team } from "../../store/teams";
import { IconButton, MemberAvatar } from "../../ui/kit";
import { ago, sortedMeetings, teamAgents } from "../team/util";

interface Props {
  teams: Team[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  onOpenTeam: (teamId: string) => void;
  onAddTeam: (name: string) => void;
  onHover: (teamId: string | null) => void;
}

/** Sidebar: every team, newest first, plus the inline "add team" field. */
export function TeamList({ teams, adding, setAdding, onOpenTeam, onAddTeam, onHover }: Props) {
  const [name, setName] = useState("");

  const close = () => {
    setName("");
    setAdding(false);
  };
  const confirm = () => {
    const n = name.trim();
    if (!n) return close();
    onAddTeam(n);
    close();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[76px] shrink-0 items-center justify-between pr-4 pl-7">
        <span className="text-[15px] font-medium tracking-wide text-ink-3">teams</span>
        <IconButton
          icon={adding ? "close" : "plus"}
          label={adding ? "Cancel" : "Add team"}
          size={40}
          tone={adding ? "plain" : "glass"}
          onClick={() => (adding ? close() : setAdding(true))}
        />
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3" onPointerLeave={() => onHover(null)}>
        <AnimatePresence initial={false}>
          {adding && (
            <motion.div
              key="add"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="overflow-hidden"
            >
              <div className="mb-2 rounded-[24px] bg-surface-2 p-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirm();
                    if (e.key === "Escape") close();
                  }}
                  onBlur={() => !name.trim() && close()}
                  placeholder="team name"
                  aria-label="Team name"
                  className="h-12 w-full rounded-[18px] bg-surface px-4 text-[17px] font-medium text-ink shadow-card outline-none placeholder:text-ink-3"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <ul className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {teams.map((team, i) => (
              <motion.li
                key={team.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                exit={{ opacity: 0 }}
              >
                <TeamRow team={team} onOpen={() => onOpenTeam(team.id)} onHover={onHover} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

function TeamRow({ team, onOpen, onHover }: { team: Team; onOpen: () => void; onHover: (id: string | null) => void }) {
  const agents = teamAgents(team);
  const last = sortedMeetings(team)[0];
  const shown = team.members.slice(0, 4);
  const extra = team.members.length - shown.length;

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onPointerEnter={() => onHover(team.id)}
      onFocus={() => onHover(team.id)}
      onBlur={() => onHover(null)}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="group flex w-full flex-col gap-3 rounded-[24px] px-4 py-4 text-left outline-none transition-colors duration-200 hover:bg-surface-2 focus-visible:bg-surface-2"
    >
      <div className="flex w-full items-baseline justify-between gap-3">
        <span className="truncate text-[18px] font-semibold tracking-[-0.01em] text-ink">{team.name}</span>
        {last && <span className="shrink-0 text-[13px] text-ink-3">{ago(last.startedAt)}</span>}
      </div>
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center">
          {shown.map((m, i) => (
            <div key={m.id} className="rounded-full ring-2 ring-surface transition group-hover:ring-surface-2" style={{ marginLeft: i ? -7 : 0 }}>
              <MemberAvatar name={m.name} size={26} />
            </div>
          ))}
          {extra > 0 && <span className="ml-1.5 text-[12px] font-medium text-ink-3">+{extra}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {agents.map((id) => (
            <AgentFigure key={id} agent={id} mood="idle" size={22} bare />
          ))}
        </div>
      </div>
    </motion.button>
  );
}
