import type { Session } from "../session.ts";

/**
 * 真实麦克风 → 流式语音识别 → session.onUtterance()
 *
 * TODO(老师)：接入 Deepgram 流式识别（英语，开启说话人区分）。建议的数据流：
 *   1. 主 iPad 的浏览器用 getUserMedia({ audio: { echoCancellation: true } }) 采集，
 *      通过同一条 WebSocket 以二进制帧发给服务端（index.ts 里已经把二进制帧转到 onAudioChunk）。
 *   2. 这里把音频转发给 Deepgram，收到结果后调用：
 *        session.onUtterance({ speakerId, text, isFinal })
 *      临时结果传 isFinal: false，一句话说完传 isFinal: true。
 *   3. 说话人编号 → speakerId：开场 4 个人按顺序各说一句自我介绍，
 *      按出现顺序把识别服务给的编号映射到 config.speakers[0..3].id（"s1".."s4"）。
 *
 * 回声屏蔽不用在这里处理：队友发声期间 session.onUtterance 会自动丢弃输入。
 *
 * 回放真实录音：读 wav 文件，按实时速度把音频块送进同一个 onAudioChunk，
 * 这样录音和真麦克风走完全相同的链路。
 */
export class LiveAudio {
  constructor(private session: Session) {}

  start() {
    console.warn("[asr] live 模式尚未接入语音识别，见 server/src/audio/asr.ts");
  }

  onAudioChunk(_chunk: Buffer) {
    void this.session;
  }

  stop() {}
}
