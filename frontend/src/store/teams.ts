import { useSyncExternalStore } from "react";
import { DEMO_CONFIG, type Card, type CardSource, type CardStatus, type AgentId, type DecisionCard, type TeammateId } from "@teammate/shared";

/**
 * Teams and their past meetings. Kept in the browser (localStorage): the server only knows
 * about the one meeting that is live right now.
 */

export interface Member {
  /** Also used as the speaker id during a meeting */
  id: string;
  name: string;
  skill?: string;
  /**
   * The loudness outline of this person's last accepted voice recording, kept only to draw it.
   * Whether they are enrolled is the server's call (it holds the voiceprint); see lib/voiceprints.ts.
   */
  voice?: { enrolledAt: number; bars: number[] };
}

/** One thing an agent contributed during a meeting. The minutes are a list of these. */
export interface MinuteEntry {
  id: string;
  /** ms since the meeting started */
  t: number;
  /** One of the four teammates, or the main agent when it answered a direct question */
  agent: AgentId;
  title: string;
  body: string;
  sources?: CardSource[];
  status: CardStatus;
}

export interface Meeting {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  /** Who was in the room */
  memberIds: string[];
  /** Which agents were called in */
  agentIds: TeammateId[];
  entries: MinuteEntry[];
  decision: DecisionCard | null;
}

export interface Team {
  id: string;
  name: string;
  members: Member[];
  /** Defaults used when a new meeting starts */
  scope: string;
  criteria: string;
  industry: string;
  /** Length of the last meeting, offered again next time. Unset until the team has chosen one. */
  durationMin?: number;
  meetings: Meeting[];
}

const KEY = "teammate.teams.v4";
const DAY = 86_400_000;

function seed(): Team[] {
  const now = Date.now();
  return [
    {
      id: "t-hack",
      name: "IC AI Hack",
      members: DEMO_CONFIG.speakers.map((s) => ({ ...s })),
      scope: DEMO_CONFIG.scope,
      criteria: DEMO_CONFIG.criteria,
      industry: DEMO_CONFIG.industry,
      meetings: [
        {
          id: "m-seed-2",
          title: "Which track do we enter",
          startedAt: now - 1 * DAY - 3_600_000,
          durationMs: 11 * 60_000,
          memberIds: ["s1", "s2", "s3", "s4"],
          agentIds: ["pilot", "scout", "rebel"],
          entries: [
            { id: "e1", t: 95_000, agent: "scout", title: "Education track has the fewest entries", body: "Last year 9 of 62 teams entered education, against 24 in productivity. Less competition for the track prize.", status: "adopted" },
            { id: "e2", t: 340_000, agent: "rebel", title: "Fewer entries may mean harder judging", body: "A small track often gets the most specialised judges. Is anyone on the team able to defend the pedagogy?", status: "active" },
            { id: "e3", t: 560_000, agent: "pilot", title: "Ten minutes in, two options left", body: "Education and productivity are still open. Impact is 20% of the score and favours education.", status: "adopted" },
          ],
          decision: {
            summary:
              "The team compared the education and productivity tracks. Entry numbers and the impact criterion both pointed to education, and the group committed to it while noting that nobody has a teaching background.",
            topics: [
              { title: "Track options", points: ["Education and productivity were the two candidates; health was ruled out early for lack of data.", "Ben preferred productivity because the team already uses those tools daily."] },
              { title: "Competition per track", points: ["Last year 9 of 62 teams entered education against 24 in productivity.", "A smaller track may come with more specialised judges."] },
              { title: "Fit with judging criteria", points: ["Impact is 20% of the score and is easier to argue in education.", "Henry will check the track brief before any idea is fixed."] },
            ],
            conclusion: "Enter the education track.",
            assignments: [
              { owner: "Henry", task: "Read the track brief and list the judging criteria" },
              { owner: "Dr. Lin", task: "Check which APIs the organisers provide" },
            ],
            risks: ["Nobody on the team has a teaching background."],
            adoptedCardIds: ["e1", "e3"],
          },
        },
        {
          id: "m-seed-1",
          title: "Team roles and working hours",
          startedAt: now - 2 * DAY,
          durationMs: 7 * 60_000,
          memberIds: ["s1", "s2", "s3"],
          agentIds: ["pilot"],
          entries: [
            { id: "e1", t: 250_000, agent: "pilot", title: "No owner for the demo video yet", body: "Design, code and server are covered. The two-minute video is 20% of the score and has no owner.", status: "adopted" },
          ],
          decision: {
            summary: "A short session to split responsibilities. Design, code and server each have an owner; the demo video was unowned until Pilot pointed it out, and Ava took it.",
            topics: [
              { title: "Who does what", points: ["Ava takes design, Ben takes code, Dr. Lin joins later for the server.", "Henry coordinates and writes the script."] },
              { title: "Working hours", points: ["Everyone is reachable from 10:00 to 22:00.", "A short sync at 14:00 and 20:00 each day."] },
            ],
            conclusion: "Ava owns the video; everyone is online 10:00 to 22:00.",
            assignments: [{ owner: "Ava", task: "Storyboard the two-minute video" }],
            risks: [],
            adoptedCardIds: ["e1"],
          },
        },
      ],
    },
    {
      id: "t-studio",
      name: "Design Studio",
      members: [
        { id: "s1", name: "Mika", skill: "brand" },
        { id: "s2", name: "Jon", skill: "motion" },
        { id: "s3", name: "Priya", skill: "research" },
      ],
      scope: "A direction the client can approve this week",
      criteria: "Clarity, distinctiveness, feasibility",
      industry: "Brand design",
      meetings: [
        {
          id: "m-studio-1",
          title: "Rebrand kickoff",
          startedAt: now - 5 * DAY,
          durationMs: 18 * 60_000,
          memberIds: ["s1", "s2", "s3"],
          agentIds: ["sage", "rebel"],
          entries: [
            { id: "e1", t: 420_000, agent: "sage", title: "That contrast ratio fails AA", body: "Light grey on white at 14px is about 2.3:1. Body text needs 4.5:1 to pass WCAG AA.", status: "adopted" },
            { id: "e2", t: 800_000, agent: "rebel", title: "All three routes look alike", body: "Each direction uses the same geometric sans and a single accent. What would a truly different route be?", status: "dismissed" },
          ],
          decision: {
            summary: "Three brand routes were reviewed. One failed accessibility contrast and was dropped; the remaining two will be developed, with a new serif route added to widen the range.",
            topics: [
              { title: "Review of the three routes", points: ["All three use a geometric sans and a single accent colour.", "The monochrome route fails WCAG AA contrast for body text."] },
              { title: "Motion scope", points: ["Jon wants a motion system for the wordmark.", "The client has not confirmed a budget for it."] },
            ],
            conclusion: "Develop two routes; drop the monochrome one.",
            assignments: [{ owner: "Mika", task: "Second route with a serif wordmark" }],
            risks: ["Client has not confirmed the budget for motion."],
            adoptedCardIds: ["e1"],
          },
        },
      ],
    },
    {
      id: "t-thesis",
      name: "Thesis Group",
      members: [
        { id: "s1", name: "Noor", skill: "statistics" },
        { id: "s2", name: "Leo", skill: "writing" },
      ],
      scope: "An outline the supervisor will sign off",
      criteria: "Originality, rigour, feasibility in one term",
      industry: "Academic research",
      meetings: [],
    },
  ];
}

function load(): Team[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Team[];
  } catch {
    // fall through to the seed
  }
  return seed();
}

let teams: Team[] = load();
const listeners = new Set<() => void>();

function commit(next: Team[]) {
  teams = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(teams));
  } catch {
    // storage full or blocked: keep working in memory
  }
  listeners.forEach((l) => l());
}

export function useTeams(): Team[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => teams,
  );
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function addTeam(name: string): Team {
  const team: Team = {
    id: uid("t"),
    name: name.trim() || "New team",
    members: DEMO_CONFIG.speakers.map((s) => ({ ...s })),
    // Nothing about the work is assumed: the team fills in its brief (TeamSettings).
    scope: "",
    criteria: "",
    industry: "",
    meetings: [],
  };
  commit([team, ...teams]);
  return team;
}

export function addMeeting(teamId: string, meeting: Omit<Meeting, "id">): Meeting {
  const full: Meeting = { ...meeting, id: uid("m") };
  commit(teams.map((t) => (t.id === teamId ? { ...t, meetings: [full, ...t.meetings] } : t)));
  return full;
}

export function removeTeam(teamId: string) {
  commit(teams.filter((t) => t.id !== teamId));
}

export function updateTeam(teamId: string, patch: Partial<Omit<Team, "id" | "meetings" | "members">>) {
  commit(teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)));
}

export function addMember(teamId: string, name: string, skill: string): Member {
  const member: Member = { id: uid("p"), name, skill: skill || undefined };
  commit(teams.map((t) => (t.id === teamId ? { ...t, members: [...t.members, member] } : t)));
  return member;
}

export function removeMember(teamId: string, memberId: string) {
  commit(teams.map((t) => (t.id === teamId ? { ...t, members: t.members.filter((m) => m.id !== memberId) } : t)));
}

export function updateMember(teamId: string, memberId: string, patch: Partial<Omit<Member, "id">>) {
  commit(teams.map((t) => (t.id === teamId ? { ...t, members: t.members.map((m) => (m.id === memberId ? { ...m, ...patch } : m)) } : t)));
}

/** Turn the cards of a finished session into minutes. */
export function cardsToEntries(cards: Card[]): MinuteEntry[] {
  return cards.map((c) => ({ id: c.id, t: c.t, agent: c.teammate, title: c.title, body: c.body, sources: c.sources, status: c.status }));
}
