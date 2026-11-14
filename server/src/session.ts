import {
  emptySnapshot,
  TEAMMATE_IDS,
  TEAMMATES,
  type Card,
  type CardSource,
  type ClientMessage,
  type InterventionLevel,
  type ServerEvent,
  type SessionConfig,
  type SessionSnapshot,
  type TeammateId,
  type TeammateStatus,
  type Utterance,
} from "@teammate/shared";
import { newMemory, type Decision, type MeetingContext, type Persona, type RoleOutput } from "@teammate/agents";
import { loadPersonas, savePersonas } from "./personaStore.ts";
import { config } from "./config.ts";
import { synthesize } from "./audio/tts.ts";

/** agent 的接口。scripted 模式下为 null（卡片来自 fixtures）。 */
export interface Brain {
  decide(ctx: MeetingContext): Promise<Decision>;
  runRole(teammate: TeammateId, ctx: MeetingContext, brief: string, level: InterventionLevel): Promise<RoleOutput>;
  writeDecision(ctx: MeetingContext): Promise<SessionSnapshot["decision"] & {}>;
  updatePersonas(ctx: MeetingContext, previous: Persona[]): Promise<Persona[]>;
}

interface PendingSpeak {
  id: string;
  teammate: TeammateId;
  text: string;
  cardId: string;
  queuedAt: number;
  /** 被点名的回答：不受发声冷却限制，人在等它 */
  direct: boolean;
}

export interface InterventionInput {
  teammate: TeammateId;
  level: InterventionLevel;
  title: string;
  body: string;
  say?: string;
  sources?: CardSource[];
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/**
 * 一场会议的全部状态和调度逻辑。
 *
 * 分工：agent 决定“说不说、谁说、说什么”；这里决定“什么时候真的说出口”——
 * 停顿检测、冷却、排队、过期、静音、回声屏蔽都是确定性的代码。
 */
export class Session {
  snapshot: SessionSnapshot = emptySnapshot();
  transcript: Utterance[] = [];

  private lastSpeechAt = 0;
  private lastDecisionAt = 0;
  private deciding = false;
  private decideAgain = false;
  private lastSpeakAt = 0;
  private lastInterventionAt: Partial<Record<TeammateId, number>> = {};
  private lastAnyInterventionAt = 0;
  /** 主 agent 跨轮次的观察（它在留意、还没到要介入的事） */
  private memory = newMemory();
  /** 成员画像：不公开，只传给主 agent，从不广播 */
  private personas: Persona[] = [];
  private mutedUntil: Partial<Record<TeammateId, number>> = {};
  private speakQueue: PendingSpeak[] = [];
  private nowSpeaking: PendingSpeak | null = null;
  private nowSpeakingSince = 0;
  private seq = 0;
  private pausedAt = 0;
  private timer: NodeJS.Timeout;
  /** 暂停 / 继续时通知外部（回放用它来停表） */
  onPause: (paused: boolean) => void = () => {};
  /** 会话开始 / 结束 / 重置时通知外部（回放、语音识别用它来启停） */
  onPhaseChange: (phase: SessionSnapshot["phase"]) => void = () => {};

  constructor(
    private broadcast: (e: ServerEvent) => void,
    private brain: Brain | null,
  ) {
    this.timer = setInterval(() => this.tick(), 250);
  }

  dispose() {
    clearInterval(this.timer);
  }

  // ───────────── 基础 ─────────────

  private id(prefix: string) {
    return `${prefix}${++this.seq}`;
  }

  elapsedMs() {
    if (!this.snapshot.startedAt) return 0;
    return (this.snapshot.paused ? this.pausedAt : Date.now()) - this.snapshot.startedAt;
  }

  /** 队友正在发声：这段时间麦克风听到的是队友自己，语音识别结果应当丢弃。 */
  get isSpeaking() {
    return this.nowSpeaking !== null;
  }

  private context(): MeetingContext {
    return {
      config: this.snapshot.config!,
      elapsedMs: this.elapsedMs(),
      transcript: this.transcript,
      teammates: this.snapshot.teammates,
      cards: this.snapshot.cards,
      memory: this.memory,
      personas: this.personas,
    };
  }

  private setStatus(teammate: TeammateId, status: TeammateStatus) {
    const state = this.snapshot.teammates[teammate];
    if (state.status === status) return;
    state.status = status;
    this.broadcast({ type: "teammate_state", teammate, state });
  }

  private isMuted(teammate: TeammateId) {
    return (this.mutedUntil[teammate] ?? 0) > Date.now();
  }

  private canUse(teammate: TeammateId) {
    return this.snapshot.teammates[teammate].override !== "off" && !this.isMuted(teammate);
  }

  /** 队友空闲时应当显示什么状态 */
  private restingStatus(teammate: TeammateId): TeammateStatus {
    if (this.isMuted(teammate)) return "muted";
    const hasUnseenHint = this.snapshot.cards.some((c) => c.teammate === teammate && c.level === 1 && c.status === "active");
    return hasUnseenHint ? "has_something" : "idle";
  }

  // ───────────── 生命周期 ─────────────

  start(cfg: SessionConfig) {
    this.reset(false);
    this.snapshot.phase = "live";
    this.snapshot.config = cfg;
    this.snapshot.startedAt = Date.now();
    this.personas = this.brain ? loadPersonas(cfg.teamId) : [];
    if (this.personas.length) log(`loaded private notes on ${this.personas.length} people`);
    for (const id of TEAMMATE_IDS) {
      if (this.snapshot.teammates[id].override === "on") this.snapshot.teammates[id].status = "idle";
    }
    this.lastSpeechAt = Date.now();
    this.broadcast({ type: "snapshot", snapshot: this.snapshot });
    log(`session started (${config.mode}) — ${cfg.goal}`);
    this.onPhaseChange("live");
  }

  async end() {
    if (this.snapshot.phase !== "live") return;
    this.snapshot.phase = "ended";
    this.speakQueue = [];
    this.broadcast({ type: "snapshot", snapshot: this.snapshot });
    this.onPhaseChange("ended");

    // 画像更新在后台进行，不耽误出纪要。先把这场会议的内容留住，之后的 reset 不会影响它。
    const finished = this.context();
    const teamId = finished.config.teamId;
    if (this.brain && teamId && finished.transcript.length >= 6) {
      void this.brain
        .updatePersonas(finished, this.personas)
        .then((personas) => {
          savePersonas(teamId, personas);
          log(`private notes updated for ${personas.length} people`);
        })
        .catch((err) => log("persona update failed:", err));
    }

    const adoptedCardIds = this.snapshot.cards.filter((c) => c.status === "adopted").map((c) => c.id);
    try {
      this.snapshot.decision = this.brain
        ? await this.brain.writeDecision(this.context())
        : // scripted 模式没有 agent：给一张固定的决策卡，够前端调样式用
          {
            summary:
              "The team started from an AI flashcard idea, found the space already crowded, and moved to a companion that works live during the lecture. After a short detour the group committed to it, softened an unsupported retention claim, and agreed a pre-recorded fallback for the demo.",
            topics: [
              { title: "Flashcards from lecture recordings", points: ["Ben proposed turning lecture recordings into flashcards automatically.", "Dr. Lin asked whether it already exists; Quizlet, Anki add-ons and NotebookLM cover it.", "None of the existing tools work live during the lecture."] },
              { title: "Live lecture companion", points: ["Henry reframed the idea as a companion that works during the lecture.", "The claim that students learn 80% better was dropped in favour of wording the evidence supports.", "Everyone agreed to go with this idea."] },
              { title: "Demo risk and fallback", points: ["Live transcription in a noisy hall is the hardest part and is the whole demo.", "Dr. Lin proposed a pre-recorded lecture clip as fallback; MIT OpenCourseWare lectures can be used."] },
            ],
            conclusion: "Build a live lecture companion that turns what is being said into study cards during the lecture.",
            assignments: [
              { owner: "Ben", task: "Transcription pipeline" },
              { owner: "Ava", task: "Interface and the video" },
              { owner: "Dr. Lin", task: "Server and the fallback recording" },
              { owner: "Henry", task: "Script, and keeping the work on the judging criteria" },
            ],
            risks: [
              "Live transcription in a noisy hall is unproven; the pre-recorded fallback is not built yet.",
              "The retention claim needs wording that the evidence supports.",
            ],
            adoptedCardIds,
          };
    } catch (err) {
      log("decision card failed:", err);
      this.snapshot.decision = { conclusion: "Could not generate the summary.", assignments: [], risks: [], adoptedCardIds };
      this.broadcast({ type: "error", message: "Decision card generation failed" });
    }
    this.broadcast({ type: "decision", decision: this.snapshot.decision });
  }

  reset(announce = true) {
    const overrides = this.snapshot.teammates;
    this.snapshot = emptySnapshot();
    for (const id of TEAMMATE_IDS) this.snapshot.teammates[id].override = overrides[id].override;
    this.transcript = [];
    this.speakQueue = [];
    this.nowSpeaking = null;
    this.lastInterventionAt = {};
    this.lastAnyInterventionAt = 0;
    this.memory = newMemory();
    this.mutedUntil = {};
    this.lastSpeakAt = 0;
    this.lastDecisionAt = 0;
    if (announce) {
      this.broadcast({ type: "snapshot", snapshot: this.snapshot });
      this.onPhaseChange("setup");
    }
  }

  // ───────────── 输入：对话 ─────────────

  speakerName(speakerId: string) {
    return this.snapshot.config?.speakers.find((s) => s.id === speakerId)?.name ?? speakerId;
  }

  /** 语音识别（或回放）每产出一句话就调用这里。 */
  onUtterance(input: { speakerId: string; text: string; isFinal: boolean }) {
    if (this.snapshot.phase !== "live") return;
    if (this.isSpeaking || this.snapshot.paused) return; // 回声屏蔽 / 暂停
    this.lastSpeechAt = Date.now();

    const utterance: Utterance = {
      id: this.id("u"),
      speakerId: input.speakerId,
      speakerName: this.speakerName(input.speakerId),
      text: input.text,
      t: this.elapsedMs(),
      isFinal: input.isFinal,
    };
    this.broadcast({ type: "transcript", utterance });
    if (!input.isFinal) return;

    this.transcript.push(utterance);
    log(`  ${utterance.speakerName}: ${utterance.text}`);
    if (this.handleVoiceCommand(utterance)) return;
    void this.think(utterance);
  }

  /** “先别说”一类的口头叫停。返回 true 表示这句话已处理，不再交给 agent。 */
  private handleVoiceCommand(u: Utterance): boolean {
    if (/\b(not now|hold on|be quiet|quiet please)\b/i.test(u.text) && /\b(pilot|scout|sage|rebel|teammates?|guys)\b/i.test(u.text)) {
      this.mute("all", 60);
      return true;
    }
    return false;
  }

  /** 被点名：“Hey Scout, …”。点名优先于主动介入，跳过主 agent 和冷却。 */
  private calledTeammate(u: Utterance): TeammateId | null {
    for (const id of TEAMMATE_IDS) {
      const name = TEAMMATES[id].name;
      if (new RegExp(`\\b(hey|hi|ok|okay)[,\\s]+${name}\\b|^${name}\\b[,\\s]`, "i").test(u.text)) return id;
    }
    return null;
  }

  private async think(u: Utterance) {
    if (!this.brain) return;

    const called = this.calledTeammate(u);
    if (called) {
      if (this.snapshot.teammates[called].override === "off") return;
      log(`  → ${called} was called by name`);
      await this.produce(called, 3, `${u.speakerName} asked you directly: "${u.text}". Answer the question.`, true);
      return;
    }

    // 主 agent 一次只跑一个；跑的过程中又有人说话，就在结束后再判断一次。
    if (this.deciding) {
      this.decideAgain = true;
      return;
    }
    const wait = config.orchestratorMinIntervalMs - (Date.now() - this.lastDecisionAt);
    if (wait > 0) {
      this.decideAgain = true;
      setTimeout(() => this.flushDecide(), wait);
      return;
    }
    await this.runDecide();
  }

  private flushDecide() {
    if (this.decideAgain && !this.deciding && this.snapshot.phase === "live") void this.runDecide();
  }

  private async runDecide() {
    if (!this.brain) return;
    this.deciding = true;
    this.decideAgain = false;
    this.lastDecisionAt = Date.now();
    try {
      const d = await this.brain.decide(this.context());
      if (d.action === "stay_silent") {
        log(`  · silent — ${d.reason}`);
      } else if (!this.canUse(d.teammate)) {
        log(`  · ${d.teammate} is off or muted, skipped`);
      } else if (Date.now() - this.lastAnyInterventionAt < config.interventionGapMs) {
        // 不丢弃：等间隔结束后重新判断一次，那时这个点如果还成立就会被派出
        const wait = config.interventionGapMs - (Date.now() - this.lastAnyInterventionAt);
        log(`  · ${d.teammate} held back for ${Math.round(wait / 1000)}s, another teammate just stepped in — ${d.reason}`);
        setTimeout(() => {
          this.decideAgain = true;
          this.flushDecide();
        }, wait + 50);
      } else if (Date.now() - (this.lastInterventionAt[d.teammate] ?? 0) < config.teammateCooldownMs) {
        log(`  · ${d.teammate} is cooling down, skipped — ${d.reason}`);
      } else {
        log(`  → ${d.teammate} L${d.level} — ${d.reason}`);
        await this.produce(d.teammate, d.level, d.brief, false);
      }
    } catch (err) {
      log("orchestrator failed:", err);
    } finally {
      this.deciding = false;
      this.flushDecide();
    }
  }

  /** 让角色 agent 写内容，然后发出介入。 */
  private async produce(teammate: TeammateId, level: InterventionLevel, brief: string, direct: boolean) {
    if (!this.brain) return;
    this.lastInterventionAt[teammate] = Date.now(); // 先占住冷却，避免同一个队友被重复派出
    if (!direct) this.lastAnyInterventionAt = Date.now();
    if (this.snapshot.teammates[teammate].status === "hidden") this.setStatus(teammate, "idle");
    try {
      const out = await this.brain.runRole(teammate, this.context(), brief, level);
      if (this.snapshot.phase !== "live") return;
      this.intervene({ teammate, level, ...out }, direct);
    } catch (err) {
      log(`${teammate} failed:`, err);
    }
  }

  // ───────────── 输出：介入 ─────────────

  /** 发出一次介入。agent 和 scripted 回放都走这里。 */
  intervene(input: InterventionInput, direct = false) {
    if (this.snapshot.phase !== "live" || this.snapshot.paused) return;
    const { teammate } = input;
    if (!direct && !this.canUse(teammate)) return;

    const card: Card = {
      id: this.id("c"),
      teammate,
      level: input.level,
      title: input.title,
      body: input.body,
      say: input.say,
      sources: input.sources?.length ? input.sources : undefined,
      status: "active",
      t: this.elapsedMs(),
    };
    this.snapshot.cards.push(card);
    this.lastInterventionAt[teammate] = Date.now();
    this.broadcast({ type: "card", card });

    const wantsToSpeak = input.level === 3 && !!input.say && !this.isMuted(teammate);
    if (wantsToSpeak) {
      // 先亮起，等到停顿再开口
      this.setStatus(teammate, "has_something");
      this.speakQueue.push({ id: this.id("s"), teammate, text: input.say!, cardId: card.id, queuedAt: Date.now(), direct });
    } else {
      this.setStatus(teammate, input.level === 1 ? "has_something" : this.restingStatus(teammate));
    }
  }

  /** 每 250ms 检查一次：有没有排队的发言可以说、有没有过期、静音是否到期。 */
  private tick() {
    if (this.snapshot.phase !== "live" || this.snapshot.paused) return;
    const now = Date.now();

    // 静音到期
    for (const id of TEAMMATE_IDS) {
      if (this.snapshot.teammates[id].status === "muted" && !this.isMuted(id)) this.setStatus(id, this.restingStatus(id));
    }

    // 主设备没回 speak_done（比如页面被关掉）时的保险：按字数估算时长后自动结束
    if (this.nowSpeaking && now - this.nowSpeakingSince > 4000 + this.nowSpeaking.text.length * 90) {
      this.finishSpeaking(this.nowSpeaking.id);
    }
    if (this.nowSpeaking) return;

    // 过期的发言放弃发声，卡片保留
    this.speakQueue = this.speakQueue.filter((p) => {
      const expired = now - p.queuedAt > config.speakExpiryMs || this.isMuted(p.teammate);
      if (expired) {
        log(`  · ${p.teammate} gave up speaking (no pause / muted); card stays`);
        this.setStatus(p.teammate, this.restingStatus(p.teammate));
      }
      return !expired;
    });

    const next = this.speakQueue[0];
    if (!next) return;
    const paused = now - this.lastSpeechAt >= config.pauseMs;
    const cooled = next.direct || now - this.lastSpeakAt >= config.globalSpeakCooldownMs;
    if (!paused || !cooled) return;

    this.speakQueue.shift();
    this.nowSpeaking = next;
    this.nowSpeakingSince = now;
    this.setStatus(next.teammate, "speaking");
    log(`  🔊 ${next.teammate}: ${next.text}`);
    void synthesize(next.teammate, next.text).then((audioUrl) => {
      this.broadcast({ type: "speak", id: next.id, teammate: next.teammate, text: next.text, audioUrl: audioUrl ?? undefined, cardId: next.cardId });
    });
  }

  private finishSpeaking(id: string) {
    if (this.nowSpeaking?.id !== id) return;
    const { teammate } = this.nowSpeaking;
    this.nowSpeaking = null;
    this.lastSpeakAt = Date.now();
    this.lastSpeechAt = Date.now(); // 队友刚说完，给人留出接话的时间
    this.setStatus(teammate, this.restingStatus(teammate));
  }

  private mute(target: TeammateId | "all", seconds: number) {
    const until = Date.now() + seconds * 1000;
    for (const id of target === "all" ? TEAMMATE_IDS : [target]) {
      this.mutedUntil[id] = until;
      if (this.snapshot.teammates[id].status !== "hidden") this.setStatus(id, seconds > 0 ? "muted" : this.restingStatus(id));
    }
    log(`  muted ${target} for ${seconds}s`);
  }

  /** 暂停：停表、停止收音和介入。继续时把开始时间往后挪，计时不跳。 */
  private setPaused(paused: boolean) {
    if (this.snapshot.phase !== "live" || this.snapshot.paused === paused) return;
    this.snapshot.paused = paused;
    if (paused) {
      this.pausedAt = Date.now();
      this.speakQueue = [];
    } else {
      const gap = Date.now() - this.pausedAt;
      this.snapshot.startedAt! += gap;
      this.lastSpeechAt = Date.now();
    }
    this.broadcast({ type: "snapshot", snapshot: this.snapshot });
    this.onPause(paused);
    log(paused ? "  paused" : "  resumed");
  }

  // ───────────── 输入：前端操作 ─────────────

  handleClient(msg: ClientMessage) {
    switch (msg.type) {
      case "start_session":
        return this.start(msg.config);
      case "end_session":
        return void this.end();
      case "reset":
        return this.reset();
      case "pause":
        return this.setPaused(true);
      case "resume":
        return this.setPaused(false);
      case "dismiss_card":
      case "adopt_card": {
        const card = this.snapshot.cards.find((c) => c.id === msg.id);
        if (!card) return;
        card.status = msg.type === "adopt_card" ? "adopted" : "dismissed";
        this.broadcast({ type: "card_update", id: card.id, status: card.status });
        // 忽略卡片时，同一张卡排队中的发言也一并取消
        if (card.status === "dismissed") this.speakQueue = this.speakQueue.filter((p) => p.cardId !== card.id);
        if (this.snapshot.teammates[card.teammate].status === "has_something") {
          this.setStatus(card.teammate, this.restingStatus(card.teammate));
        }
        return;
      }
      case "mute":
        return this.mute(msg.target, msg.seconds);
      case "set_teammate": {
        const state = this.snapshot.teammates[msg.teammate];
        state.override = msg.override;
        if (msg.override === "off") state.status = "hidden";
        else if (msg.override === "on" && state.status === "hidden") state.status = "idle";
        this.broadcast({ type: "teammate_state", teammate: msg.teammate, state });
        return;
      }
      case "speak_started":
        return;
      case "speak_done":
        return this.finishSpeaking(msg.id);
      case "hello":
        return;
    }
  }
}
