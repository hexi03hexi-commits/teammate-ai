import fs from "node:fs";
import type { CardSource, InterventionLevel, TeammateId } from "@teammate/shared";
import { config } from "./config.ts";
import type { Session } from "./session.ts";

type FixtureItem =
  | { t: number; type: "utterance"; speaker: string; text: string }
  | { t: number; type: "scripted"; teammate: TeammateId; level: InterventionLevel; title: string; body: string; say?: string; sources?: CardSource[] };

/**
 * 按时间播放 fixtures 里的对话。
 *   scripted 模式：对话和写死的卡片都播放（不需要任何 key）
 *   replay 模式：只播放对话，卡片由真实 agent 产生
 */
export class Replay {
  private timers: NodeJS.Timeout[] = [];
  private items: FixtureItem[] = [];
  /** 已经播放到的位置（毫秒，按回放速度折算后的真实时间） */
  private offset = 0;
  private resumedAt = 0;

  constructor(private session: Session) {}

  start() {
    this.stop();
    const { items } = JSON.parse(fs.readFileSync(config.fixture, "utf8")) as { items: FixtureItem[] };
    this.items = items.filter((i) => i.type === "utterance" || config.mode === "scripted");
    this.offset = 0;
    this.schedule();
    console.log(`[replay] ${this.items.length} items from ${config.fixture} at ${config.replaySpeed}x`);
  }

  private schedule() {
    this.resumedAt = Date.now();
    for (const item of this.items) {
      const due = (item.t * 1000) / config.replaySpeed - this.offset;
      if (due < 0) continue;
      this.timers.push(
        setTimeout(() => {
          if (item.type === "utterance") {
            this.session.onUtterance({ speakerId: item.speaker, text: item.text, isFinal: true });
          } else {
            this.session.intervene(item);
          }
        }, due),
      );
    }
  }

  pause() {
    if (this.timers.length === 0) return;
    this.offset += Date.now() - this.resumedAt + 1;
    this.clear();
  }

  resume() {
    if (this.items.length) this.schedule();
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  stop() {
    this.clear();
    this.items = [];
  }
}
