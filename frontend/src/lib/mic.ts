/**
 * Microphone capture for the host device.
 *
 * Captures the mic, converts it to 16 kHz mono 16-bit PCM in an AudioWorklet and hands it
 * over in 100 ms chunks. The server forwards those bytes to the speech recogniser unchanged
 * (server/src/audio/asr.ts expects exactly this format).
 *
 * Raw PCM rather than MediaRecorder: Safari on iPad records mp4, which cannot be streamed.
 */

const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = TARGET_RATE / 10;

// Runs on the audio thread. Averages input samples down to 16 kHz and posts Int16 chunks.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.pos = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(${CHUNK_SAMPLES});
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.pos++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
        this.out[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.filled === this.out.length) {
          const chunk = this.out.buffer;
          this.port.postMessage(chunk, [chunk]);
          this.out = new Int16Array(${CHUNK_SAMPLES});
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** "blocked" = no microphone, permission refused, or the page is not on https / localhost. */
export class MicBlockedError extends Error {}

/** Starts capturing. Resolves with a function that stops it. */
export async function startMic(onChunk: (pcm: ArrayBuffer) => void): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
    throw new MicBlockedError("Microphone needs https (or localhost)");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation keeps the teammates' own voices out of the transcript as far as the device can.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    throw new MicBlockedError(err instanceof Error ? err.message : "Microphone unavailable");
  }

  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  let stopped = false;
  // iOS starts the context suspended when it was not created inside a tap.
  const wake = () => void ctx.resume().catch(() => {});
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("pointerdown", wake, true);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  try {
    await ctx.audioWorklet.addModule(url);
  } catch (err) {
    stop();
    throw new MicBlockedError(err instanceof Error ? err.message : "Audio capture unavailable");
  } finally {
    URL.revokeObjectURL(url);
  }

  const node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (!stopped) onChunk(e.data);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  wake();
  window.addEventListener("pointerdown", wake, true);
  return stop;
}
