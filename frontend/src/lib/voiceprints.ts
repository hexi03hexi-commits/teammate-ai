import { serverUrl } from "./env";

/**
 * Voice enrolment, talking to the session server. The server keeps the voiceprints and never
 * sends them back: the browser only learns who is enrolled.
 */

export interface VoiceStatus {
  /** false when the server could not load its speaker model: people are then matched by order of speaking */
  available: boolean;
  enrolled: string[];
}

export async function voiceStatus(teamId: string): Promise<VoiceStatus | null> {
  try {
    const r = await fetch(serverUrl(`/voiceprints?team=${encodeURIComponent(teamId)}`));
    return r.ok ? ((await r.json()) as VoiceStatus) : null;
  } catch {
    return null; // server not running
  }
}

export type EnrolOutcome = "ok" | "too_short" | "too_quiet" | "unavailable" | "offline";

/** Send one recording (16 kHz mono 16-bit PCM). It replaces any earlier recording of this person. */
export async function enrolVoice(teamId: string, memberId: string, pcm: ArrayBuffer): Promise<EnrolOutcome> {
  try {
    const r = await fetch(serverUrl(`/voiceprints?team=${encodeURIComponent(teamId)}&member=${encodeURIComponent(memberId)}&replace=1`), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm,
    });
    const body = (await r.json()) as { ok: boolean; reason?: EnrolOutcome };
    return body.ok ? "ok" : (body.reason ?? "unavailable");
  } catch {
    return "offline";
  }
}

export async function forgetVoice(teamId: string, memberId: string): Promise<void> {
  try {
    await fetch(serverUrl(`/voiceprints?team=${encodeURIComponent(teamId)}&member=${encodeURIComponent(memberId)}`), { method: "DELETE" });
  } catch {
    // nothing to forget if the server is not there
  }
}
