import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AgentFigure } from "../../agents/AgentFigure";
import { forgetTeamData } from "../../lib/voiceprints";
import { removeTeam, updateTeam, type Team } from "../../store/teams";
import { Icon, IconButton, MemberAvatar } from "../../ui/kit";
import { ago, sortedMeetings, teamAgents } from "../team/util";
import { NewTeam } from "./NewTeam";

interface Props {
  teams: Team[];
  adding: boolean;
  setAdding: (v: boolean) => void;
  onOpenTeam: (teamId: string) => void;
  onAddTeam: (name: string) => void;
  onHover: (teamId: string | null) => void;
}

/** Sidebar: every team, the "new team" panel, and a manage mode for renaming and deleting teams. */
export function TeamList({ teams, adding, setAdding, onOpenTeam, onAddTeam, onHover }: Props) {
  const [managing, setManaging] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[76px] shrink-0 items-center gap-1 pr-4 pl-7">
        <span className="flex-1 text-[15px] font-medium tracking-wide text-ink-3">Teams</span>
        {teams.length > 0 && !adding && (
          <IconButton icon={managing ? "check" : "edit"} label={managing ? "Done" : "Manage teams"} size={40} tone={managing ? "solid" : "plain"} onClick={() => setManaging(!managing)} />
        )}
        {!managing && (
          <IconButton icon={adding ? "close" : "plus"} label={adding ? "Cancel" : "Add team"} size={40} tone={adding ? "plain" : "glass"} onClick={() => setAdding(!adding)} />
        )}
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
              <NewTeam
                onCancel={() => setAdding(false)}
                onCreate={(name) => {
                  onAddTeam(name);
                  setAdding(false);
                }}
              />
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
                exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
              >
                {managing ? <ManageRow team={team} /> : <TeamRow team={team} onOpen={() => onOpenTeam(team.id)} onHover={onHover} />}
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

/** A team in manage mode: the name can be edited in place, and the team deleted after a second tap. */
function ManageRow({ team }: { team: Team }) {
  const [confirming, setConfirming] = useState(false);
  const meetings = team.meetings.length;

  return (
    <div className="flex items-center gap-2 rounded-[24px] bg-surface-2 py-2.5 pr-2.5 pl-4" style={{ boxShadow: `inset 0 0 0 ${confirming ? "2px #ff5a4f" : "1px var(--line)"}` }}>
      <div className="min-w-0 flex-1">
        <input
          value={team.name}
          onChange={(e) => updateTeam(team.id, { name: e.target.value })}
          onBlur={(e) => !e.target.value.trim() && updateTeam(team.id, { name: "Untitled team" })}
          aria-label="Team name"
          maxLength={40}
          className="w-full bg-transparent text-[17px] font-semibold text-ink outline-none"
        />
        <div className="text-[12px] text-ink-3">
          {confirming ? "Delete this team and its meetings?" : `${team.members.length} people · ${meetings} meeting${meetings === 1 ? "" : "s"}`}
        </div>
      </div>
      {confirming ? (
        <>
          <IconButton icon="close" label="Keep team" size={36} onClick={() => setConfirming(false)} />
          <button
            type="button"
            aria-label={`Delete ${team.name}`}
            title="Delete"
            onClick={() => {
              // the server holds this team's voiceprints and private notes: remove those too
              void forgetTeamData(team.id);
              removeTeam(team.id);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#ff5a4f] text-white! transition hover:scale-105 active:scale-95"
          >
            <Icon name="check" size={16} />
          </button>
        </>
      ) : (
        <IconButton icon="trash" label={`Delete ${team.name}`} size={36} onClick={() => setConfirming(true)} />
      )}
    </div>
  );
}
