import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "@teammate/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");

try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // 没有 .env 时用默认值（scripted 模式不需要任何 key）
}

/**
 * scripted  播放 fixtures 里写死的对话和卡片，不调用任何外部服务
 * replay    播放 fixtures 里的对话，由真实 agent 决定何时介入
 * live      真实麦克风（待接入语音识别）
 */
export type Mode = "scripted" | "replay" | "live";

/** 快进回放时，所有时间常数按同样倍数缩短，保证结果和实时一致 */
const speed = Number(process.env.REPLAY_SPEED ?? 1) || 1;
const ms = (n: number) => Math.round(n / speed);

export const config = {
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  mode: (process.env.MODE ?? "scripted") as Mode,
  replaySpeed: speed,
  fixture: path.resolve(ROOT, process.env.FIXTURE ?? "fixtures/brainstorm.json"),

  // ── 以下是必须由确定性代码控制的三件事：停顿、冷却、过期。调参时改这里。──
  /** 多久没人说话算“停顿”，队友才可以开口 */
  pauseMs: ms(1500),
  /** 排队的发言等不到停顿，多久后放弃发声（卡片仍然保留） */
  speakExpiryMs: ms(20_000),
  /** 任意两次发声之间的最短间隔 */
  globalSpeakCooldownMs: ms(30_000),
  /** 同一个队友两次介入之间的最短间隔 */
  teammateCooldownMs: ms(45_000),
  /** 主 agent 两次判断之间的最短间隔 */
  orchestratorMinIntervalMs: ms(4_000),
};
