import type { ClientMessage, ServerEvent, AgentId } from "@teammate/shared";
import { serverUrl } from "./env";

export type SpeakEvent = Extract<ServerEvent, { type: "speak" }>;
type Send = (msg: ClientMessage) => void;

/** 44-byte silent WAV, played inside a user gesture to unlock <audio> on iOS. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** Fallback browser voices: a different voice + pitch/rate per teammate. */
const VOICE_STYLE: Record<AgentId, { pitch: number; rate: number; prefer: RegExp }> = {
  main: { pitch: 1.06, rate: 1.0, prefer: /zira|samantha|ava|google us english/i },
  pilot: { pitch: 1.0, rate: 1.02, prefer: /samantha|aria|jenny|google us english/i },
  scout: { pitch: 1.18, rate: 1.08, prefer: /daniel|guy|google uk english male/i },
  sage: { pitch: 0.82, rate: 0.94, prefer: /karen|moira|sonia|google uk english female/i },
  rebel: { pitch: 0.95, rate: 1.12, prefer: /alex|fred|ryan|rishi|tom/i },
};
const ORDER: AgentId[] = ["main", "pilot", "scout", "sage", "rebel"];

/** Hard cap so a stuck player can never block the queue (and speak_done is always sent). */
const AUDIO_TIMEOUT_MS = 30_000;

/**
 * Plays `speak` events one at a time (host only).
 * Sends speak_started when playback begins and ALWAYS sends speak_done afterwards
 * (ended, error, or timeout) — the server uses it for echo suppression.
 */
class SpeechQueue {
  private send: Send = () => {};
  private queue: SpeakEvent[] = [];
  private busy = false;
  private seen = new Set<string>();
  private audio: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  unlocked = false;

  setSender(send: Send) {
    this.send = send;
  }

  /** Must be called from a user gesture (tap) — unlocks audio + speechSynthesis on iOS Safari. */
  unlock() {
    if (this.unlocked) return;
    try {
      const a = this.getAudio();
      a.src = SILENT_WAV;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* ignore */
    }
    this.unlocked = true;
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getUnlocked = () => this.unlocked;

  enqueue(e: SpeakEvent) {
    if (this.seen.has(e.id)) return;
    this.seen.add(e.id);
    this.queue.push(e);
    this.pump();
  }

  /** Drop anything not yet played (e.g. session reset). Pending items still get speak_done. */
  clear() {
    const dropped = this.queue.splice(0);
    dropped.forEach((e) => this.send({ type: "speak_done", id: e.id }));
  }

  private pump() {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    this.play(next, () => {
      this.busy = false;
      this.pump();
    });
  }

  private play(e: SpeakEvent, next: () => void) {
    let started = false;
    let finished = false;
    let guard = 0;
    const start = () => {
      if (started || finished) return;
      started = true;
      this.send({ type: "speak_started", id: e.id });
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(guard);
      this.send({ type: "speak_done", id: e.id });
      next();
    };

    if (e.audioUrl) {
      const a = this.getAudio();
      let fellBack = false;
      const fail = () => {
        if (fellBack || finished) return;
        fellBack = true;
        a.onplaying = a.onended = a.onerror = null;
        if (started) return finish();
        // Audio failed before it began: use the browser voice so the line is still heard.
        window.clearTimeout(guard);
        this.speakTts(e, start, finish, (ms) => (guard = window.setTimeout(finish, ms)));
      };
      a.onplaying = start;
      a.onended = finish;
      a.onerror = fail;
      a.src = e.audioUrl.startsWith("/") ? serverUrl(e.audioUrl) : e.audioUrl;
      guard = window.setTimeout(finish, AUDIO_TIMEOUT_MS);
      a.play().catch(fail);
      return;
    }
    this.speakTts(e, start, finish, (ms) => (guard = window.setTimeout(finish, ms)));
  }

  private speakTts(e: SpeakEvent, start: () => void, finish: () => void, arm: (ms: number) => void) {
    // A lingering mp3 must never layer under the browser voice (only one line at a time).
    this.audio?.pause();
    if (!("speechSynthesis" in window)) return finish();
    const synth = window.speechSynthesis;
    const style = VOICE_STYLE[e.teammate];
    const u = new SpeechSynthesisUtterance(e.text);
    u.lang = "en-US";
    u.pitch = style.pitch;
    u.rate = style.rate;
    const voice = pickVoice(e.teammate);
    if (voice) u.voice = voice;
    u.onstart = start;
    u.onend = finish;
    u.onerror = finish;
    // Some browsers never fire onend; estimate the duration generously.
    arm(2500 + e.text.length * 110);
    synth.cancel();
    synth.speak(u);
    // Safari sometimes skips onstart.
    window.setTimeout(start, 400);
  }

  private getAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      this.audio.setAttribute("playsinline", "");
    }
    return this.audio;
  }
}

function pickVoice(id: AgentId): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (voices.length === 0) return null;
  const preferred = voices.find((v) => VOICE_STYLE[id].prefer.test(v.name));
  return preferred ?? voices[ORDER.indexOf(id) % voices.length] ?? null;
}

// Warm the voice list (Chrome loads it asynchronously).
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
}

/** One player per page. */
export const speech = new SpeechQueue();
