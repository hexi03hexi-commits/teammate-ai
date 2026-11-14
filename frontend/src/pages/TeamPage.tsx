import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import type { StartOptions } from "../App";
import { AgentFigure } from "../agents/AgentFigure";
import type { Team } from "../store/teams";
import { Icon, IconButton, ThemeToggle } from "../ui/kit";
import { Composer } from "./team/Composer";
import { History } from "./team/History";
import { Minutes } from "./team/Minutes";
import { Roster } from "./team/Roster";
import { sortedMeetings } from "./team/util";

const ease = [0.2, 0.8, 0.2, 1] as const;

export function TeamPage({
  team,
  initialMeetingId,
  connected,
  onBack,
  onStart,
}: {
  team: Team;
  initialMeetingId?: string;
  connected: boolean;
  onBack: () => void;
  onStart: (opts: StartOptions) => void;
}) {
  const reduce = useReducedMotion();
  const meetings = useMemo(() => sortedMeetings(team), [team]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => meetings.find((m) => m.id === initialMeetingId)?.id ?? meetings[0]?.id ?? null,
  );
  const [composing, setComposing] = useState(false);
  const [pickedMembers, setPickedMembers] = useState<string[]>([]);
  const [pickedAgents, setPickedAgents] = useState<TeammateId[]>([]);
  const [focusAgent, setFocusAgent] = useState<TeammateId | null>(null);

  const meeting = meetings.find((m) => m.id === selectedId) ?? null;

  const compose = () => {
    setPickedMembers(team.members.map((m) => m.id));
    setPickedAgents([...TEAMMATE_IDS]);
    setFocusAgent(null);
    setComposing(true);
  };
  const toggle = <T,>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const memberOn = (id: string) => (composing ? pickedMembers.includes(id) : meeting ? meeting.memberIds.includes(id) : true);
  const agentOn = (id: TeammateId) => (composing ? pickedAgents.includes(id) : meeting ? meeting.agentIds.includes(id) : false);

  const swap = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.99 },
    transition: { duration: 0.32, ease },
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[88px] shrink-0 items-center gap-3 px-4 lg:px-6">
        <IconButton icon="back" label="Back" tone="glass" onClick={onBack} />
        <h1 className="min-w-0 flex-1 truncate pl-1 text-[30px] font-semibold tracking-[-0.025em] text-ink">{team.name}</h1>
        <ThemeToggle />
        <AnimatePresence initial={false}>
          {!composing && meetings.length > 0 && (
            <motion.button
              key="new"
              type="button"
              onClick={compose}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 480, damping: 32 }}
              className="flex h-12 items-center gap-2 rounded-full bg-ink pr-6 pl-4 text-[16px] font-semibold text-bg! shadow-float"
            >
              <Icon name="plus" size={20} />
              New meeting
            </motion.button>
          )}
        </AnimatePresence>
      </header>

      <LayoutGroup>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 pb-4 md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden lg:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:pb-6">
          {/* Left: who + when */}
          <motion.section layout className="flex min-h-0 flex-col rounded-[32px] bg-surface shadow-card">
            <div className="shrink-0 p-4 pb-2 lg:p-5 lg:pb-3">
              <Roster
                members={team.members}
                memberOn={memberOn}
                agentOn={agentOn}
                focusAgent={composing ? null : focusAgent}
                onToggleMember={composing ? (id) => setPickedMembers((l) => toggle(l, id)) : undefined}
                onToggleAgent={composing ? (id) => setPickedAgents((l) => toggle(l, id)) : undefined}
              />
            </div>
            {meetings.length > 0 && (
              <>
                <div className="mx-5 h-px shrink-0 bg-line" />
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2 lg:p-3">
                  <History
                    meetings={meetings}
                    selectedId={selectedId}
                    muted={composing}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setComposing(false);
                    }}
                  />
                </div>
              </>
            )}
          </motion.section>

          {/* Right: minutes, or the new-meeting composer */}
          <motion.section layout className="no-scrollbar relative min-h-[420px] overflow-y-auto rounded-[32px] bg-surface shadow-card md:min-h-0">
            <AnimatePresence mode="wait" initial={false}>
              {composing ? (
                <motion.div key="compose" {...swap} className="h-full p-6 lg:p-9">
                  <Composer
                    connected={connected}
                    canStart={pickedMembers.length > 0}
                    onCancel={() => setComposing(false)}
                    onStart={(title, durationMin) =>
                      onStart({
                        title,
                        durationMin,
                        memberIds: team.members.filter((m) => pickedMembers.includes(m.id)).map((m) => m.id),
                        agentIds: TEAMMATE_IDS.filter((id) => pickedAgents.includes(id)),
                      })
                    }
                  />
                </motion.div>
              ) : meeting ? (
                <motion.div key={meeting.id} {...swap} className="p-6 lg:p-9">
                  <Minutes meeting={meeting} onFocusAgent={setFocusAgent} />
                </motion.div>
              ) : (
                <motion.div key="empty" {...swap} className="h-full">
                  <Empty onStart={compose} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        </div>
      </LayoutGroup>
    </div>
  );
}

/** No meetings yet: Mate dozes until you start one. */
function Empty({ onStart }: { onStart: () => void }) {
  const [awake, setAwake] = useState(false);
  return (
    <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-8 p-8">
      <motion.button
        type="button"
        aria-label="Start a meeting"
        onPointerEnter={() => setAwake(true)}
        onPointerLeave={() => setAwake(false)}
        onClick={onStart}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 420, damping: 16 }}
        className="rounded-full outline-none"
      >
        <AgentFigure agent="main" mood={awake ? "nudging" : "asleep"} size={180} />
      </motion.button>
      <motion.button
        type="button"
        onClick={onStart}
        onPointerEnter={() => setAwake(true)}
        onPointerLeave={() => setAwake(false)}
        whileTap={{ scale: 0.95 }}
        className="flex h-14 items-center gap-3 rounded-full bg-ink pr-7 pl-5 text-[18px] font-semibold text-bg! shadow-float"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-bg/15">
          <Icon name="plus" size={18} />
        </span>
        First meeting
      </motion.button>
    </div>
  );
}
