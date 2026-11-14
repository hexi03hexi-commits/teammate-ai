/**
 * Teammate AI — 三方共用的事件格式（前端 / 服务端 / agent）。
 * 改这个文件前请在群里说一声：它是三个人之间唯一的接口。
 */

// ───────────────────────── 队友 ─────────────────────────

export const TEAMMATE_IDS = ["pilot", "scout", "sage", "rebel"] as const;
export type TeammateId = (typeof TEAMMATE_IDS)[number];

export interface TeammateMeta {
  id: TeammateId;
  name: string;
  /** 一句话角色说明，显示在界面上 */
  role: string;
  /** 主题色（hex），界面和卡片共用 */
  color: string;
}

export const TEAMMATES: Record<TeammateId, TeammateMeta> = {
  pilot: { id: "pilot", name: "Pilot", role: "Facilitator", color: "#4F8DFD" },
  scout: { id: "scout", name: "Scout", role: "Researcher", color: "#2FBF8F" },
  sage: { id: "sage", name: "Sage", role: "Domain expert", color: "#9277FF" },
  rebel: { id: "rebel", name: "Rebel", role: "Devil's advocate", color: "#FF7D54" },
};

/**
 * hidden    还没出场（没被识别为需要）
 * idle      已出场，待命（L0）
 * preparing 被叫到了，正在准备要说的内容（查资料、组织语言），还没有卡片
 * has_something  图标亮起，有话说（L1）
 * speaking  正在发声（L3）
 * muted     被静音
 */
export type TeammateStatus = "hidden" | "idle" | "preparing" | "has_something" | "speaking" | "muted";

/** auto = 由主 agent 决定是否出场；on / off = 人手动打开或关闭 */
export type TeammateOverride = "auto" | "on" | "off";

export interface TeammateState {
  status: TeammateStatus;
  override: TeammateOverride;
}

// ───────────────────────── 点名与口头叫停 ─────────────────────────

/** 语音识别可能把队友的名字写成什么。接上真实语音后，按识别结果里实际出现的写法增删。 */
export const TEAMMATE_ALIASES: Record<TeammateId, string[]> = {
  pilot: ["pilot"],
  scout: ["scout", "scott"],
  sage: ["sage"],
  rebel: ["rebel"],
};

const GREETING = "(?:hey|hi|ok|okay)";

/**
 * 这句话是不是在点名某个队友："Hey Scout, …" "Scout, check that".
 * 只认开头的称呼或带招呼语的称呼，句子中间顺带提到名字不算。
 */
export function findCalledTeammate(text: string): TeammateId | null {
  const t = text.trim();
  for (const id of TEAMMATE_IDS) {
    const names = TEAMMATE_ALIASES[id].join("|");
    // 称呼后面必须是停顿或标点，避免 "Scouting report" 这类误中
    const after = String.raw`(?=$|[\s,.!?:])`;
    const gap = String.raw`[\s,]*`;
    const called = new RegExp(`^(?:${GREETING}${gap})?(?:${names})${after}|${GREETING}${gap}(?:${names})${after}`, "i");
    if (called.test(t)) return id;
  }
  return null;
}

/** 口头叫停："not now, guys". 返回 true 时让所有队友安静一会儿。 */
export function isHushCommand(text: string): boolean {
  return /\b(not now|hold on|be quiet|quiet please)\b/i.test(text) && /\b(pilot|scout|sage|rebel|teammates?|guys)\b/i.test(text);
}

// ───────────────────────── 会话 ─────────────────────────

export interface Speaker {
  /** 稳定 id，例如 "s1" */
  id: string;
  name: string;
  /** 自我介绍里说的擅长什么 */
  skill?: string;
}

export interface SessionConfig {
  /** 项目目的 */
  goal: string;
  /** 要做到什么程度 */
  scope: string;
  /** 评分标准 */
  criteria: string;
  /** 行业 / 赛道，决定 Sage 的领域 */
  industry: string;
  /** 这场讨论计划多长（分钟），Pilot 判断超时用 */
  durationMin: number;
  speakers: Speaker[];
  /** 哪个团队在开会。服务端用它在多场会议之间保留只有它自己知道的东西（成员画像）。 */
  teamId?: string;
}

export type SessionPhase = "setup" | "live" | "ended";

// ───────────────────────── 对话与卡片 ─────────────────────────

export interface Utterance {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  /** 距会话开始的毫秒数 */
  t: number;
  /** false = 识别中的临时结果，true = 这句话说完了 */
  isFinal: boolean;
}

/** 1 = 只亮图标；2 = 弹卡片；3 = 卡片 + 发声。L0（静默）不产生事件。 */
export type InterventionLevel = 1 | 2 | 3;

export type CardStatus = "active" | "dismissed" | "adopted";

export interface CardSource {
  title: string;
  url: string;
}

export interface Card {
  id: string;
  teammate: TeammateId;
  level: InterventionLevel;
  title: string;
  body: string;
  /** L3 时队友要说的那句话（≤ 15 秒，问句） */
  say?: string;
  sources?: CardSource[];
  status: CardStatus;
  /** 距会话开始的毫秒数 */
  t: number;
}

export interface Assignment {
  owner: string;
  task: string;
}

/** 讨论过的一个议题和它的要点，用于会后纪要 */
export interface Topic {
  title: string;
  points: string[];
}

export interface DecisionCard {
  conclusion: string;
  /** 两三句话的会议概述 */
  summary?: string;
  /** 按讨论顺序排列的议题 */
  topics?: Topic[];
  assignments: Assignment[];
  risks: string[];
  adoptedCardIds: string[];
}

/** 完整快照：新设备连入、或状态大变时下发 */
export interface SessionSnapshot {
  phase: SessionPhase;
  config: SessionConfig | null;
  /** 会话开始的时间戳（Date.now()），setup 阶段为 null */
  startedAt: number | null;
  /** 会议被暂停：不收音、不介入，计时也停住 */
  paused: boolean;
  teammates: Record<TeammateId, TeammateState>;
  cards: Card[];
  decision: DecisionCard | null;
}

// ───────────────────────── 服务端 → 前端 ─────────────────────────

export type ServerEvent =
  | { type: "snapshot"; snapshot: SessionSnapshot }
  | { type: "transcript"; utterance: Utterance }
  | { type: "teammate_state"; teammate: TeammateId; state: TeammateState }
  /** 主 agent 从刚才的话里“听进去”的几个词，显示在它周围。没有值得显示的就不发。 */
  | { type: "keywords"; words: string[] }
  | { type: "card"; card: Card }
  | { type: "card_update"; id: string; status: CardStatus }
  /**
   * 只有主设备（host）播放。audioUrl 为空时前端用浏览器自带的 speechSynthesis 兜底。
   * 播放开始和结束时前端要回 speak_started / speak_done，服务端靠它屏蔽回声。
   */
  | { type: "speak"; id: string; teammate: TeammateId; text: string; audioUrl?: string; cardId?: string }
  | { type: "decision"; decision: DecisionCard }
  | { type: "error"; message: string };

// ───────────────────────── 前端 → 服务端 ─────────────────────────

/** host = 主 iPad（收音 + 发声）；viewer = 其他连入设备（只看） */
export type ClientRole = "host" | "viewer";

export type ClientMessage =
  | { type: "hello"; role: ClientRole }
  | { type: "start_session"; config: SessionConfig }
  | { type: "end_session" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "dismiss_card"; id: string }
  | { type: "adopt_card"; id: string }
  | { type: "mute"; target: TeammateId | "all"; seconds: number }
  | { type: "set_teammate"; teammate: TeammateId; override: TeammateOverride }
  | { type: "speak_started"; id: string }
  | { type: "speak_done"; id: string };

// ───────────────────────── 默认值 ─────────────────────────

export const DEFAULT_PORT = 8787;

export function emptySnapshot(): SessionSnapshot {
  const teammates = Object.fromEntries(
    TEAMMATE_IDS.map((id) => [id, { status: "hidden", override: "auto" } satisfies TeammateState]),
  ) as Record<TeammateId, TeammateState>;
  return { phase: "setup", config: null, startedAt: null, paused: false, teammates, cards: [], decision: null };
}

/** 演示用配置，和 fixtures/brainstorm.json 里的对话配套 */
export const DEMO_CONFIG: SessionConfig = {
  goal: "Pick one idea for the AI hackathon and split the work",
  scope: "A working demo and a 2-minute video within 20 hours",
  criteria: "Innovation 30%, technical execution 30%, impact 20%, presentation 20%",
  industry: "Education technology",
  durationMin: 5,
  speakers: [
    { id: "s1", name: "Henry", skill: "product and UX" },
    { id: "s2", name: "Ava", skill: "visual design" },
    { id: "s3", name: "Ben", skill: "full-stack coding" },
    { id: "s4", name: "Dr. Lin", skill: "systems engineering" },
  ],
};
