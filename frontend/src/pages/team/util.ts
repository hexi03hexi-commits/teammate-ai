import { TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import type { Meeting, Team } from "../../store/teams";

/** "Nov 13" */
export function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Nov 13 · 4:05 PM" */
export function dayTime(ms: number): string {
  return `${day(ms)} · ${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** "today", "2d", "3w" */
export function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d < 1) return "today";
  if (d < 7) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return day(ms);
}

/** Agent accent pulled toward the text colour, so it stays readable on both themes. */
export function ink(color: string, amount = 78): string {
  return `color-mix(in srgb, ${color} ${amount}%, var(--ink))`;
}

/** Faint wash of an agent colour over the surface. */
export function tint(color: string, amount = 7): string {
  return `color-mix(in srgb, ${color} ${amount}%, var(--surface))`;
}

export function sortedMeetings(team: Team): Meeting[] {
  return [...team.meetings].sort((a, b) => b.startedAt - a.startedAt);
}

/** Every agent that took part in any of the team's meetings, in canonical order. */
export function teamAgents(team: Team): TeammateId[] {
  return TEAMMATE_IDS.filter((id) => team.meetings.some((m) => m.agentIds.includes(id)));
}
