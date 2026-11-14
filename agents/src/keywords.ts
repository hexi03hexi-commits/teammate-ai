import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SessionConfig, Utterance } from "@teammate/shared";
import { anthropic } from "./context.ts";

/**
 * 关键词：主 agent “听进去了什么”。显示在它周围的那几个词块。
 *
 * 之前是在浏览器里分词加停用词表，挑出来的是“像词的片段”，没有意义。
 * 现在让模型从最近几句话里挑真正承载内容的词，没有就不挑。
 * 它只影响界面上的词块，不影响主 agent 的判断，所以用最快最便宜的模型。
 */
export const KEYWORD_MODEL = () => process.env.KEYWORD_MODEL || "claude-haiku-5-5";

const KEYWORD_PROMPT = `You watch the live transcript of a meeting. Around the listening assistant on screen, a few short terms appear to show the people what it has picked up. You choose those terms.

From the NEW lines, pick the terms that carry the substance of what was just said: the thing being discussed or proposed, a concrete product, feature, technology, method or name, a number together with what it measures, a decision, a risk someone named. A person glancing at the screen should recognise each term as something that mattered in what was just said.

Most lines contain nothing worth showing. Return an empty list for greetings, fillers, hesitations, half-finished sentences, small talk and chit-chat, agreement and acknowledgement, remarks about the meeting or the software itself, and anything whose content is not yet clear. An empty list is the usual, correct answer; one good term beats three weak ones. Never return more than three.

How to write a term:
- Use the people's own words. A term is something that was said, tidied up, not a label you invent to describe the remark: when someone asks whether an idea already exists, there is no term to show unless they named a thing.
- Write it as they would on a whiteboard: a noun or short noun phrase of one to three words, not a clause.
- Speech recognition makes mistakes and drops punctuation. Use the earlier lines and the meeting's topic to repair an obvious mis-hearing, and put a number back together with its unit and what it measures (a bare "80" after "efficiency goes up" is "efficiency +80%").
- Keep product names and technical terms as the people say them.
- Do not repeat a term already shown, or a near-synonym of one.

The earlier lines are context only; do not pick terms from them.`;

const Schema = z.object({ terms: z.array(z.string()) });

export interface KeywordInput {
  config: SessionConfig;
  /** 之前的几句话，只作上下文 */
  earlier: Utterance[];
  /** 这次要从中挑词的新句子 */
  fresh: Utterance[];
  /** 已经显示过的词 */
  shown: string[];
}

export async function extractKeywords({ config, earlier, fresh, shown }: KeywordInput): Promise<string[]> {
  if (fresh.length === 0) return [];
  const line = (u: Utterance) => `${u.speakerName}: ${u.text}`;
  const response = await anthropic().messages.parse({
    model: KEYWORD_MODEL(),
    max_tokens: 600,
    system: [{ type: "text", text: KEYWORD_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          `Meeting topic: ${config.goal}${config.industry ? ` (${config.industry})` : ""}`,
          `Already shown: ${shown.length ? shown.slice(-20).join(", ") : "(nothing yet)"}`,
          `Earlier lines (context only):\n${earlier.length ? earlier.slice(-8).map(line).join("\n") : "(none)"}`,
          `NEW lines:\n${fresh.map(line).join("\n")}`,
        ].join("\n\n"),
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(Schema) },
  });
  const seen = new Set(shown.map((s) => s.toLowerCase()));
  return (response.parsed_output?.terms ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 24 && !seen.has(t.toLowerCase()))
    .slice(0, 3);
}
