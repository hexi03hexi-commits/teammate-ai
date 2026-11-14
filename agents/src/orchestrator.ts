import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TEAMMATE_IDS, type InterventionLevel, type TeammateId } from "@teammate/shared";
import {
  anthropic,
  describeSession,
  fmtClock,
  ORCHESTRATOR_MODEL,
  renderInterventions,
  renderTranscript,
  type MeetingContext,
} from "./context.ts";

/**
 * 主 agent：持续听对话，只决定三件事——要不要介入、派谁、用哪一级。
 * 它不写卡片内容，那是角色 agent 的事（见 roles.ts）。
 *
 * 调参主要改这里的 ORCHESTRATOR_PROMPT。
 */
const ORCHESTRATOR_PROMPT = `You are the silent coordinator behind "Teammate AI": four AI teammates sitting in on a live hackathon brainstorm between four people. You never speak yourself. After each thing someone says, you decide whether one teammate should step in, and how loudly.

The purpose is to make the discussion more efficient and to catch mistakes while they can still be fixed cheaply. The people are the team; the teammates only fill a role that is currently empty at the table.

The four teammates and the gap each one fills:
- pilot — facilitator. Fills in when nobody is running the meeting: the group is over time or about to be, has drifted off topic for several turns, is ignoring the judging criteria, or is near the end with no decision or no division of work.
- scout — researcher. Fills in when the group lacks information: a new idea is on the table and nobody knows whether it already exists, a product or company is named that matters to the decision, or someone asks "has anyone done this?".
- sage — domain expert for this session's industry. Fills in when someone states a specific fact, number or technical claim that the plan will lean on and that is wrong or unverified, or misuses a term in a way that will mislead the group.
- rebel — devil's advocate. Fills in when dissent is missing: everyone agrees quickly, or the group is about to commit without anyone naming a risk.

How to tell that a role is empty: the triggering situation is happening AND none of the four people is already handling it. If a person is keeping time, pulling the group back on topic, looking something up, correcting the claim, or raising the risk themselves, the role is filled — stay silent. Give people a turn or two to handle it themselves before stepping in; the exception is when the group is about to lock in a decision, where waiting makes the intervention useless.

Levels, from quietest to loudest:
- "hint" — the teammate's icon lights up, nothing else. For something useful but not urgent.
- "card" — a card appears on the shared screen. For information that is useful and relevant to what is being discussed right now.
- "speak" — the teammate says one sentence aloud at the next pause, plus a card. Only for things that would change the outcome of the meeting if missed.

Silence is the default and the right answer most of the time. An interruption costs the group attention, so intervene only when a good human teammate in that role would. Do not repeat a point a teammate has already made, and do not pile on right after another intervention unless something new has happened. If a teammate is listed as off or muted, do not pick it.

When you do intervene, write a brief for the chosen teammate: one or two sentences saying exactly what was said that triggered this (quote the key words) and what the teammate should address. The teammate sees the transcript too, so the brief is for focus, not background.`;

const DecisionSchema = z.object({
  action: z.enum(["stay_silent", "intervene"]),
  teammate: z.enum(TEAMMATE_IDS).nullable(),
  level: z.enum(["hint", "card", "speak"]).nullable(),
  brief: z.string().nullable(),
  reason: z.string().describe("One short sentence on why. Shown only in the debug log."),
});

export type Decision =
  | { action: "stay_silent"; reason: string }
  | { action: "intervene"; teammate: TeammateId; level: InterventionLevel; brief: string; reason: string };

const LEVELS: Record<"hint" | "card" | "speak", InterventionLevel> = { hint: 1, card: 2, speak: 3 };

function renderRoster(ctx: MeetingContext): string {
  return TEAMMATE_IDS.map((id) => {
    const t = ctx.teammates[id];
    const availability = t.override === "off" ? "OFF (do not pick)" : t.status === "muted" ? "muted (do not pick)" : "available";
    const seen = t.status === "hidden" ? "has not appeared yet" : "already at the table";
    return `- ${id}: ${availability}, ${seen}`;
  }).join("\n");
}

export async function decide(ctx: MeetingContext): Promise<Decision> {
  const totalMs = ctx.config.durationMin * 60_000;
  const state = [
    `Time: ${fmtClock(ctx.elapsedMs)} elapsed of ${fmtClock(totalMs)} planned (${fmtClock(Math.max(0, totalMs - ctx.elapsedMs))} left).`,
    `Teammates:\n${renderRoster(ctx)}`,
    `Interventions so far:\n${renderInterventions(ctx.cards)}`,
    `Recent conversation (most recent last):\n${renderTranscript(ctx.transcript)}`,
    `Decide what, if anything, should happen now.`,
  ].join("\n\n");

  const response = await anthropic().messages.parse({
    model: ORCHESTRATOR_MODEL(),
    max_tokens: 2000,
    system: [
      // 会议背景整场不变，和规则一起缓存；会变的内容（时间、对话）都放在 user 消息里。
      { type: "text", text: `${ORCHESTRATOR_PROMPT}\n\n# This session\n${describeSession(ctx.config)}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: state }],
    output_config: { effort: "low", format: zodOutputFormat(DecisionSchema) },
  });

  const out = response.parsed_output;
  if (!out) return { action: "stay_silent", reason: `no parsable decision (stop_reason: ${response.stop_reason})` };
  if (out.action === "stay_silent" || !out.teammate || !out.level) {
    return { action: "stay_silent", reason: out.reason };
  }
  return {
    action: "intervene",
    teammate: out.teammate,
    level: LEVELS[out.level],
    brief: out.brief ?? out.reason,
    reason: out.reason,
  };
}
