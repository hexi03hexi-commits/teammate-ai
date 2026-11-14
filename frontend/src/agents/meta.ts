import { MAIN_AGENT, TEAMMATES, type AgentId } from "@teammate/shared";

export type { AgentId };


/**
 * What the figure is doing. This is the single knob that drives the body motion, the face and the extras.
 *   asleep     not in this meeting / inactive: keeps its colour, eyes shut, zzz, barely moving
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
  // The main agent: listens, calls the others, and answers when spoken to. Unlike the others it carries nothing (see Prop.tsx).
  main: { ...MAIN_AGENT, from: "#B4F5FF", to: "#0CC0EA" },
  pilot: { ...TEAMMATES.pilot, from: "#A9CBFF", to: "#4F8DFD" },
  scout: { ...TEAMMATES.scout, from: "#A6F0D2", to: "#2FBF8F" },
  sage: { ...TEAMMATES.sage, from: "#D3C7FF", to: "#9277FF" },
  rebel: { ...TEAMMATES.rebel, from: "#FFD0AE", to: "#FF7D54" },
};

