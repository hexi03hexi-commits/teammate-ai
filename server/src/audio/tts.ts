import type { AgentId } from "@teammate/shared";

/**
 * 把一句话合成为语音，返回主设备可以播放的音频地址。
 *
 * TODO(老师)：接入 ElevenLabs（或其他 TTS）。四个队友各用一个音色。
 * 建议做法：合成后把音频放在内存里，通过 index.ts 的 HTTP 服务以 /audio/<id>.mp3 提供，这里返回该地址。
 *
 * 现在返回 null：前端会用浏览器自带的 speechSynthesis 兜底，所以骨架阶段已经能出声。
 */
export async function synthesize(_teammate: AgentId, _text: string): Promise<string | null> {
  return null;
}
