import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { CardSource, InterventionLevel, TeammateId } from "@teammate/shared";
import { anthropic, describeSession, renderTranscript, ROLE_MODEL, type MeetingContext } from "./context.ts";

/**
 * 角色 agent：被主 agent 派到时才运行，负责写卡片内容和要说的那句话。
 * 调参主要改 ROLE_PROMPTS 和 SHARED_RULES。
 */

const SHARED_RULES = `You are one of four AI teammates sitting in on a live hackathon brainstorm between four people. You have been asked to step in once, right now. The people are mid-conversation and will glance at your card for a few seconds, so everything you write must be understood at a glance.

Write:
- title: the point in at most eight words. A plain statement, no question mark, no label like "Note:".
- body: one to three short sentences, at most 45 words, with the specific fact, number or observation that makes the point worth their attention. Refer to what was actually said.
- say: one spoken sentence of at most 25 words, phrased as a question to the group rather than a verdict. It will be read aloud by a text-to-speech voice, so use plain words, no abbreviations, no symbols, no lists.

You are a peer at the table, not an assistant: no greetings, no "great idea", no offers of further help, no hedging preamble. If you are not sure of something, say so in a few words rather than guessing.`;

const ROLE_PROMPTS: Record<TeammateId, string> = {
  pilot: `Your name is Pilot and you are the facilitator. You step in when nobody is running the meeting: time is slipping, the talk has drifted, the judging criteria are being ignored, or the end is near with no decision or no division of work. Name where the group is against the clock or the criteria and offer one concrete next step. You keep the group moving; you do not have opinions on which idea is better.`,
  scout: `Your name is Scout and you are the researcher. You step in when the group lacks information: whether an idea already exists, what a named product actually does, what is available to build on. Use web search to check before you answer, prefer primary sources, and report what you found in concrete terms: names, what they do, and the gap that is left for this team. If the search turns up nothing solid, say that plainly.`,
  sage: `Your name is Sage and you are the domain expert for this session's industry. You step in when someone states a fact, number or technical claim that the plan will lean on and that is wrong, overstated or unverified, or uses a term in a way that will mislead the group. Say what is actually known, how confident that is, and give wording the team can safely use instead. Correct the claim, not the person.`,
  rebel: `Your name is Rebel and you are the devil's advocate. You step in when the group agrees too fast or is about to commit without anyone naming a risk. Raise the single most serious objection to the current plan, the one most likely to sink the demo or the score, and make it specific to what they just decided. You always ask rather than assert, and you raise one objection, not a list.`,
};

const CardSchema = z.object({ title: z.string(), body: z.string(), say: z.string() });

export interface RoleOutput {
  title: string;
  body: string;
  say: string;
  sources: CardSource[];
}

function system(teammate: TeammateId, ctx: MeetingContext): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: `${SHARED_RULES}\n\n# Your role\n${ROLE_PROMPTS[teammate]}\n\n# This session\n${describeSession(ctx.config)}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

function userMessage(ctx: MeetingContext, brief: string, level: InterventionLevel): string {
  return [
    `Recent conversation (most recent last):\n${renderTranscript(ctx.transcript, 30)}`,
    `Why you are stepping in: ${brief}`,
    level === 3 ? `Your "say" sentence will be spoken aloud at the next pause.` : `Only the card will be shown this time; still write "say" in case it is needed.`,
  ].join("\n\n");
}

/** Pilot / Sage / Rebel：一次调用，直接拿结构化结果。 */
async function runPlainRole(teammate: TeammateId, ctx: MeetingContext, brief: string, level: InterventionLevel): Promise<RoleOutput> {
  const response = await anthropic().messages.parse({
    model: ROLE_MODEL(),
    max_tokens: 4000,
    system: system(teammate, ctx),
    messages: [{ role: "user", content: userMessage(ctx, brief, level) }],
    output_config: { effort: "low", format: zodOutputFormat(CardSchema) },
  });
  if (!response.parsed_output) throw new Error(`${teammate}: no parsable card (stop_reason: ${response.stop_reason})`);
  return { ...response.parsed_output, sources: [] };
}

const SCOUT_FORMAT = `After searching, reply with exactly these three lines and nothing else.:
TITLE: <title>
BODY: <body>
SAY: <say>`;

/** Scout：带网页搜索。搜索结果自带引用，和结构化输出不能同时用，所以改用固定的三行文本格式。 */
async function runScout(ctx: MeetingContext, brief: string, level: InterventionLevel): Promise<RoleOutput> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${userMessage(ctx, brief, level)}\n\n${SCOUT_FORMAT}` },
  ];
  const sources = new Map<string, CardSource>();
  let text = "";

  // 服务端搜索可能以 pause_turn 中途返回，把回复接回去让它继续，最多 4 轮。
  for (let i = 0; i < 4; i++) {
    const response = await anthropic().messages.create({
      model: ROLE_MODEL(),
      max_tokens: 8000,
      system: system("scout", ctx),
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
      output_config: { effort: "low" },
    });
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === "web_search_result") sources.set(r.url, { title: r.title, url: r.url });
        }
      }
    }
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const pick = (label: string) => text.match(new RegExp(`${label}:\\s*(.+)`))?.[1]?.trim();
  const title = pick("TITLE");
  const body = pick("BODY");
  if (!title || !body) throw new Error(`scout: reply did not follow the TITLE/BODY/SAY format: ${text.slice(0, 200)}`);
  return { title, body, say: pick("SAY") ?? title, sources: [...sources.values()].slice(0, 3) };
}

export function runRole(teammate: TeammateId, ctx: MeetingContext, brief: string, level: InterventionLevel): Promise<RoleOutput> {
  return teammate === "scout" ? runScout(ctx, brief, level) : runPlainRole(teammate, ctx, brief, level);
}
