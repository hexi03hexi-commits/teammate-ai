import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { DecisionCard } from "@teammate/shared";
import { anthropic, describeSession, renderTranscript, ROLE_MODEL, type MeetingContext } from "./context.ts";

const DECISION_PROMPT = `You write the one-page outcome of a hackathon brainstorm that has just ended, for the four people who were in it. They will act on it immediately, so record only what was actually said and agreed; where something was left open, list it as a risk rather than inventing a resolution.

- summary: two or three sentences a teammate who missed the meeting could read to know what happened: what was discussed, what changed along the way, and where it ended.
- topics: the subjects the group actually discussed, in the order they came up. Give each a short title and one to four points; each point is one plain sentence stating what was said or settled, naming the person where it matters.
- conclusion: what the team decided to build, in one or two sentences. If nothing was decided, say so.
- assignments: who took which piece of work, using the people's names. Include only assignments someone stated or accepted in the conversation.
- risks: open risks and unanswered questions, each one short sentence, most serious first. Include points the AI teammates raised that the group did not resolve.`;

const Schema = z.object({
  summary: z.string(),
  topics: z.array(z.object({ title: z.string(), points: z.array(z.string()) })),
  conclusion: z.string(),
  assignments: z.array(z.object({ owner: z.string(), task: z.string() })),
  risks: z.array(z.string()),
});

/** 会后决策卡。被采纳的卡片由服务端直接从状态里取，不让模型猜。 */
export async function writeDecision(ctx: MeetingContext): Promise<DecisionCard> {
  const teammateNotes = ctx.cards.length
    ? ctx.cards.map((c) => `- ${c.teammate} (${c.status}): ${c.title} — ${c.body}`).join("\n")
    : "(none)";

  const response = await anthropic().messages.parse({
    model: ROLE_MODEL(),
    max_tokens: 4000,
    system: `${DECISION_PROMPT}\n\n# This session\n${describeSession(ctx.config)}`,
    messages: [
      {
        role: "user",
        content: `Full conversation:\n${renderTranscript(ctx.transcript, 400)}\n\nPoints raised by the AI teammates:\n${teammateNotes}`,
      },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(Schema) },
  });
  if (!response.parsed_output) throw new Error(`decision: no parsable output (stop_reason: ${response.stop_reason})`);
  return {
    ...response.parsed_output,
    adoptedCardIds: ctx.cards.filter((c) => c.status === "adopted").map((c) => c.id),
  };
}
