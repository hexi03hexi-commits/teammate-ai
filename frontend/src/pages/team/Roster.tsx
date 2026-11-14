import type { ReactNode } from "react";
import { motion } from "motion/react";
import { TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { AGENTS, type Mood } from "../../agents/meta";
import type { Member } from "../../store/teams";
import { Icon, MemberAvatar } from "../../ui/kit";

interface Props {
  members: Member[];
  /** Who is lit */
  memberOn: (id: string) => boolean;
  agentOn: (id: TeammateId) => boolean;
  /** When set, tiles are toggles (new-meeting mode) */
  onToggleMember?: (id: string) => void;
  onToggleAgent?: (id: TeammateId) => void;
  /** Agent being pointed at in the minutes */
  focusAgent?: TeammateId | null;
}

const spring = { type: "spring", stiffness: 520, damping: 26 } as const;

/** The team's people and the four agents. Lit = in the meeting (or picked for the next one). */
export function Roster({ members, memberOn, agentOn, onToggleMember, onToggleAgent, focusAgent }: Props) {
  const selectable = !!onToggleMember;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-4 gap-x-2 gap-y-4">
        {members.map((m) => {
          const on = memberOn(m.id);
          return (
            <Tile
              key={m.id}
              label={m.name}
              on={on}
              selectable={selectable}
              onClick={onToggleMember ? () => onToggleMember(m.id) : undefined}
            >
              <MemberAvatar name={m.name} size={52} dim={!on} />
            </Tile>
          );
        })}
      </div>

      <div className="h-px bg-line" />

      <div className="grid grid-cols-4 gap-2">
        {TEAMMATE_IDS.map((id) => {
          const on = agentOn(id);
          const mood: Mood = !on ? "asleep" : focusAgent === id ? "speaking" : selectable ? "listening" : "idle";
          return (
            <Tile
              key={id}
              label={AGENTS[id].name}
              color={on ? AGENTS[id].color : undefined}
              on={on}
              selectable={selectable}
              onClick={onToggleAgent ? () => onToggleAgent(id) : undefined}
            >
              <motion.div animate={{ scale: focusAgent === id ? 1.12 : 1, y: focusAgent === id ? -3 : 0 }} transition={spring}>
                <AgentFigure agent={id} mood={mood} size={56} />
              </motion.div>
            </Tile>
          );
        })}
      </div>
    </div>
  );
}

function Tile({
  children,
  label,
  on,
  color,
  selectable,
  onClick,
}: {
  children: ReactNode;
  label: string;
  on: boolean;
  color?: string;
  selectable: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="relative">
        {children}
        {selectable && (
          <motion.span
            initial={false}
            animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }}
            transition={spring}
            className="absolute -top-0.5 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink text-bg shadow-card"
          >
            <Icon name="check" size={12} />
          </motion.span>
        )}
      </div>
      <span
        className="max-w-full truncate text-[13px] font-medium transition-colors duration-300"
        style={{ color: on ? (color ? `color-mix(in srgb, ${color} 70%, var(--ink))` : "var(--ink)") : "var(--ink-3)" }}
      >
        {label}
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-col items-center gap-2 rounded-[22px] py-2";
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      className={`${cls} outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2`}
    >
      {body}
    </motion.button>
  );
}
