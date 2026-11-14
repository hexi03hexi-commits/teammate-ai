import { TEAMMATES, type TeammateId } from "@teammate/shared";

/** The main agent (the one that listens and calls the others) plus the four teammates. */
export type AgentId = "main" | TeammateId;

/**
 * What the figure is doing. This is the single knob that drives the body motion, the face and the extras.
 *   asleep     not in this meeting / inactive: grey, eyes shut, zzz
 *   idle       present, nothing to say
 *   listening  attentive, sound ticks
 *   thinking   eyes closed, orbit ring
 *   nudging    has something to say, waiting for a pause
 *   speaking   talking
 */
export type Mood = "asleep" | "idle" | "listening" | "thinking" | "nudging" | "speaking";

export interface AgentLook {
  id: AgentId;
  name: string;
  role: string;
  /** Solid accent, used for text, borders and minutes */
  color: string;
  /** Body gradient: top → bottom */
  from: string;
  to: string;
}

export const AGENTS: Record<AgentId, AgentLook> = {
  main: { id: "main", name: "Mate", role: "Listens", color: "#7C8CFF", from: "#D9CCFF", to: "#86D8F7" },
  pilot: { ...TEAMMATES.pilot, from: "#A9CBFF", to: "#4F8DFD" },
  scout: { ...TEAMMATES.scout, from: "#A6F0D2", to: "#2FBF8F" },
  sage: { ...TEAMMATES.sage, from: "#D3C7FF", to: "#9277FF" },
  rebel: { ...TEAMMATES.rebel, from: "#FFD0AE", to: "#FF7D54" },
};

export const ASLEEP_LOOK = { from: "#E4E5EA", to: "#B9BCC6" };
