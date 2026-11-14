import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MAIN_AGENT, TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import { anthropic, describeSession, fmtClock, ORCHESTRATOR_MODEL, renderInterventions, renderTranscript, type MeetingContext } from "./context.ts";

/**
 * 主 agent 被人直接提问时的处理（“Hey Atlas, …”）。
 * 它要么自己回答（关于这场会议的问题、一般性问题），要么把问题转给更合适的专长队友。
 * 这和 orchestrator.ts 是两回事：那边是没人问的时候决定要不要主动介入，这边是有人问了。
 */

const MAIN_PROMPT = `You are ${MAIN_AGENT.name}, the main AI teammate in a live meeting. You listen to the whole conversation and coordinate four specialist teammates. Someone has just spoken to you by name. Decide whether to answer yourself or pass the question to a specialist, and do one of the two.

Answer yourself. That is the normal case: people speak to you because you have heard the whole meeting. You can say what has been said or decided, who took which task, what is still open and how much time is left; give a recap; suggest what to do next or how to use the remaining time; weigh two options against the stated goal; name the main risk in a plan; explain a concept; offer wording or a name. Use your own judgement and general knowledge.

Pass the question to a specialist only when answering well needs something you do not have:
- scout — it has to be looked up, because the answer depends on what exists out in the world right now: whether a product already exists, what competitors do, a dataset, a current figure. You cannot search; scout can.
- sage — the group needs a specific fact, number or technical claim in this session's field verified, and getting it wrong would matter.
- rebel — they explicitly ask to have the plan attacked, to hear the case against it.
- pilot — they explicitly hand over the running of the meeting (set an agenda, keep time from here).
If you are unsure whether to pass it on, answer it yourself. Only pass to a specialist listed as available; otherwise answer as well as you can and say what you could not check.

When you pass it on, set "handoff" to the specialist and write "brief": one or two sentences giving the question in the asker's own words and what to address. Leave title, body and say empty. You say nothing aloud; the screen shows that you passed it on.

When you answer yourself, leave handoff and brief empty and write:
- title: the answer in at most eight words, a plain statement.
- body: usually empty. It is a small box of supplementary information under your line, and most answers do not need one: if the question can be answered in one sentence (the time left, yes or no, a name, one recommendation and its reason), the line is the whole answer and the body stays empty. Fill it only when the answer has parts the line cannot hold, such as who took which task, or several options with their trade-offs; then give just those parts, at most 45 words, without repeating the line and without adding other things you noticed. Use what was actually said in the meeting; do not invent decisions or numbers.
- say: one spoken sentence that answers the question directly. Keep it to 20 words or fewer: it is heard, not read, and the body carries the detail, so give the headline here and do not repeat the body. It will be read aloud by a text-to-speech voice, so plain words, no symbols or lists. Unlike the specialists you are answering a question, so answer it; ask back only if you cannot tell what is being asked.

You are a peer at the table: no greetings, no "great question", no offers of further help. If you do not know, say so in a few words.`;

const Schema = z.object({
  handoff: z.enum(TEAMMATE_IDS).nullable(),
  brief: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  say: z.string().nullable(),
});

export type MainReply = { handoff: TeammateId; brief: string } | { handoff: null; title: string; body: string; say: string };

export async function askMain(ctx: MeetingContext, question: string, asker: string): Promise<MainReply> {
  const available = TEAMMATE_IDS.filter((id) => ctx.teammates[id].override !== "off" && ctx.teammates[id].status !== "muted");
  const totalMs = ctx.config.durationMin * 60_000;
  const response = await anthropic().messages.parse({
    model: ORCHESTRATOR_MODEL(),
    max_tokens: 2000,
    system: [{ type: "text", text: `${MAIN_PROMPT}\n\n# This session\n${describeSession(ctx.config)}`, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          `Clock: ${fmtClock(ctx.elapsedMs)} (minutes:seconds) into a ${ctx.config.durationMin}-minute meeting, ${fmtClock(Math.max(0, totalMs - ctx.elapsedMs))} left.`,
          `Specialists available: ${available.length ? available.join(", ") : "(none)"}`,
          `What teammates have already said to the group:\n${renderInterventions(ctx.cards)}`,
          `Conversation so far (most recent last):\n${renderTranscript(ctx.transcript, 600)}`,
          `${asker} has just said to you: "${question}"`,
        ].join("\n\n"),
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(Schema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error(`main: no parsable reply (stop_reason: ${response.stop_reason})`);
  if (out.handoff && available.includes(out.handoff)) {
    return { handoff: out.handoff, brief: out.brief ?? `${asker} asked: "${question}". Answer the question.` };
  }
  if (!out.title && !out.say) throw new Error("main: reply had neither a handoff nor an answer");
  // 偶尔会在末尾多带一个括号或引号，朗读前去掉
  const tidy = (t: string) => t.trim().replace(/[}\]"]+$/, "").trim();
  const say = tidy(out.say ?? out.title ?? "");
  return { handoff: null, title: tidy(out.title ?? say), body: tidy(out.body ?? ""), say };
}
