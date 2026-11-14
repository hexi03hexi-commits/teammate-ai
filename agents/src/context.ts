import Anthropic from "@anthropic-ai/sdk";
import type { Card, SessionConfig, TeammateId, TeammateState, Utterance } from "@teammate/shared";
import type { Persona } from "./personas.ts";

/** 每次调用 agent 时服务端传进来的会议现场。 */
export interface MeetingContext {
  config: SessionConfig;
  /** 距开场的毫秒数 */
  elapsedMs: number;
  /** 已说完的话，按时间顺序。agent 只看最近一段。 */
  transcript: Utterance[];
  teammates: Record<TeammateId, TeammateState>;
  /** 已经发出的卡片（用来避免重复介入） */
  cards: Card[];
  /** 主 agent 跨轮次的记忆：它上一轮留给自己的观察。由调用方保存并原样传回。 */
  memory?: OrchestratorMemory;
  /** 成员画像（不公开）。只有主 agent 读它，角色 agent 不读。 */
  personas?: Persona[];
}

export interface OrchestratorMemory {
  /** 正在留意、但还没到需要介入程度的事 */
  watching: string | null;
}

let client: Anthropic | null = null;
/** 延迟创建：让服务端有机会先加载 .env。 */
export function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export const ORCHESTRATOR_MODEL = () => process.env.ORCHESTRATOR_MODEL || "claude-sonnet-5-5";
export const ROLE_MODEL = () => process.env.ROLE_MODEL || "claude-opus-5-5";

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 会议背景：整场不变，放在 system 里以便命中提示词缓存。 */
export function describeSession(config: SessionConfig): string {
  const people = config.speakers
    .map((s) => `- ${s.name}${s.skill ? ` (good at: ${s.skill})` : ""}`)
    .join("\n");
  return [
    `Goal of this brainstorm: ${config.goal}`,
    `Target scope: ${config.scope}`,
    `Judging criteria: ${config.criteria}`,
    `Industry / track: ${config.industry}`,
    `Planned length: ${config.durationMin} minutes`,
    `People at the table:\n${people}`,
  ].join("\n");
}

/** 最近的对话，带时间戳和说话人。 */
export function renderTranscript(transcript: Utterance[], lastN = 40): string {
  const recent = transcript.slice(-lastN);
  if (recent.length === 0) return "(nobody has spoken yet)";
  return recent.map((u) => `[${fmtClock(u.t)}] ${u.speakerName}: ${u.text}`).join("\n");
}

/** 已经发生过的介入，避免同一件事说两遍。 */
export function renderInterventions(cards: Card[], lastN = 8): string {
  const recent = cards.slice(-lastN);
  if (recent.length === 0) return "(none yet)";
  return recent
    .map((c) => `[${fmtClock(c.t)}] ${c.teammate} L${c.level} — ${c.title} (${c.status})`)
    .join("\n");
}
