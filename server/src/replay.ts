import fs from "node:fs";
import type { CardSource, InterventionLevel, TeammateId } from "@teammate/shared";
import { config } from "./config.ts";
import type { Session } from "./session.ts";

type FixtureItem =
  | { t: number; type: "utterance"; speaker: string; text: string }
  | { t: number; type: "scripted"; teammate: TeammateId; level: InterventionLevel; title: string; body: string; say?: string; sources?: CardSource[] };

/**
 * 开场先跳过素材里的这么多秒（单位是 fixtures 里的 t，即秒）。
 *
 * 第一个队友真正开口的卡片在 t=29，开场四句话（t=2..25）原本要铺垫半分钟。
 * 演示时这段前奏太长，观众等不到声音；这里整条时间轴前移 4 秒，第一句落在 25 秒。
 * 在除以 replaySpeed 之前减掉，所以不管几倍速，开口的时刻都一样；
 * 前面几句的间距是完全不变的，只是整体提前。
 *
 * 只改这里，不改 fixtures：agents/src/eval.ts 和 fixtures/eval/cases.json 直接读
 * 素材里的绝对 t（scout 21–43s 那个窗口），挪动素材会连带改坏评测。
 */
const START_OFFSET_S = 4;

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
      const due = ((item.t - START_OFFSET_S) * 1000) / config.replaySpeed - this.offset;
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
