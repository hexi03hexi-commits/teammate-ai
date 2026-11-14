import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { TEAMMATE_IDS, type TeammateId } from "@teammate/shared";
import { anthropic, renderTranscript, ROLE_MODEL, type MeetingContext } from "./context.ts";

/**
 * 成员画像：每个人在会议里通常会补哪些角色。
 *
 * 用途只有一个——让主 agent 判断该等多久：有人一贯会控场，Pilot 就多给他一点时间。
 * 约束：
 *   - 只记会议里的行为（控场、查资料、把关事实、提反对意见），不记性格或个人特质。
 *   - 不公开：只存在服务端，不发给任何客户端，不传给写卡片的角色 agent。只有主 agent 读它。
 *   - 是习惯，不是保证：画像不能让某个队友永远不出场，见 orchestrator.ts 里的规则。
 */

export type Habit = "sometimes" | "reliable";

export interface Persona {
  speakerId: string;
  name: string;
  /** 参加过并被统计的会议数 */
  meetings: number;
  /** 这个人会自己补上的角色。没列出的 = 没观察到。 */
  roles: Partial<Record<TeammateId, { habit: Habit; evidence: string }>>;
}

const ROLE_MEANING: Record<TeammateId, string> = {
  pilot: "facilitates: keeps time, pulls the group back on topic, calls for decisions, assigns work",
  scout: "researches: looks things up, answers 'does this exist' from knowledge or by checking",
  sage: "keeps facts honest: questions numbers and claims, asks for sources, corrects terms",
  rebel: "challenges: raises risks and objections before the group commits",
};

/** 给主 agent 看的画像文字。只列在场的人和观察到的习惯。 */
export function renderPersonas(personas: Persona[] | undefined, presentIds: string[]): string | null {
  const lines = (personas ?? [])
    .filter((p) => presentIds.includes(p.speakerId))
    .map((p) => {
      const habits = TEAMMATE_IDS.filter((r) => p.roles[r]).map((r) => `${p.roles[r]!.habit === "reliable" ? "reliably" : "sometimes"} fills ${r} (${p.roles[r]!.evidence})`);
      return habits.length ? `- ${p.name}: ${habits.join("; ")}` : null;
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

const PROFILE_PROMPT = `You keep private working notes on how each person behaves in team meetings, for one purpose: so that AI teammates know when to stay out of the way. If a person usually does a job themselves, the matching AI teammate should give them room.

You will get the notes so far and the transcript of a meeting that just ended. Update the notes.

Track only these four meeting behaviours, and only what a person actually did in a transcript:
${TEAMMATE_IDS.map((r) => `- ${r} — ${ROLE_MEANING[r]}`).join("\n")}

For each person and each behaviour, choose:
- "none": not observed, or seen only as a one-off that the person did not follow through on.
- "sometimes": they did it at least once, clearly and on their own initiative.
- "reliable": they did it on their own initiative more than once in this meeting, or in this meeting and in the earlier notes. One strong instance is "sometimes", not "reliable".

A habit can fade: if the earlier notes say "reliable" and in this meeting the situation clearly came up and the person let it pass, step it down one level. If the situation never came up in this meeting, keep the earlier level.

Evidence is one short phrase of what they did, at most twelve words, in the past tense, with no judgement of the person ("called time at one minute and asked for a decision"). Leave it empty for "none".

These notes are about behaviour in meetings, nothing else. Do not record personality, mood, ability, or anything about the person outside what they did for the group in a transcript. Statements made by the AI teammates (pilot, scout, sage, rebel) are not the people's behaviour and do not count.`;

const HabitSchema = z.object({ habit: z.enum(["none", "sometimes", "reliable"]), evidence: z.string() });
const ProfileSchema = z.object({
  people: z.array(
    z.object({
      speakerId: z.string(),
      pilot: HabitSchema,
      scout: HabitSchema,
      sage: HabitSchema,
      rebel: HabitSchema,
    }),
  ),
});

/** 会议结束后调用一次：根据这场对话更新在场成员的画像。不在场的人原样保留。 */
export async function updatePersonas(ctx: MeetingContext, previous: Persona[]): Promise<Persona[]> {
  const present = ctx.config.speakers;
  const before = present
    .map((s) => {
      const p = previous.find((x) => x.speakerId === s.id);
      const habits = p ? TEAMMATE_IDS.filter((r) => p.roles[r]).map((r) => `${r}: ${p.roles[r]!.habit} (${p.roles[r]!.evidence})`) : [];
      return `- ${s.name} [${s.id}], ${p?.meetings ?? 0} earlier meeting(s): ${habits.length ? habits.join("; ") : "no notes yet"}`;
    })
    .join("\n");
  const teammateTurns = ctx.cards.length
    ? ctx.cards.map((c) => `- ${c.teammate} stepped in: ${c.title}`).join("\n")
    : "(none)";

  const response = await anthropic().messages.parse({
    model: ROLE_MODEL(),
    max_tokens: 4000,
    system: PROFILE_PROMPT,
    messages: [
      {
        role: "user",
        content: `Notes so far:\n${before}\n\nTranscript of the meeting that just ended:\n${renderTranscript(ctx.transcript, 600)}\n\nWhere AI teammates stepped in during this meeting (for context: a role an AI had to fill was not filled by a person at that moment):\n${teammateTurns}\n\nReturn updated notes for exactly these people, using the ids in brackets.`,
      },
    ],
    output_config: { effort: "low", format: zodOutputFormat(ProfileSchema) },
  });
  const out = response.parsed_output;
  if (!out) throw new Error(`personas: no parsable output (stop_reason: ${response.stop_reason})`);

  const updated = present.map((s): Persona => {
    const row = out.people.find((p) => p.speakerId === s.id);
    const old = previous.find((x) => x.speakerId === s.id);
    const roles: Persona["roles"] = {};
    if (row) {
      for (const r of TEAMMATE_IDS) {
        if (row[r].habit !== "none") roles[r] = { habit: row[r].habit, evidence: row[r].evidence };
      }
    }
    return { speakerId: s.id, name: s.name, meetings: (old?.meetings ?? 0) + 1, roles: row ? roles : (old?.roles ?? {}) };
  });
  const absent = previous.filter((p) => !present.some((s) => s.id === p.speakerId));
  return [...updated, ...absent];
}
