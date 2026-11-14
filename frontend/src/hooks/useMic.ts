import { useEffect, useState } from "react";
import { healthUrl } from "../lib/env";
import { startMic } from "../lib/mic";

export type MicState = "off" | "on" | "blocked";

/**
 * Asks the server which mode it runs in. Only "live" listens to the microphone;
 * in scripted and replay mode the page must not ask for microphone access at all.
 */
export function useServerMode(connected: boolean): string | null {
  const [mode, setMode] = useState<string | null>(null);
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    fetch(healthUrl())
      .then((r) => r.json())
      .then((h: { mode?: string }) => !cancelled && setMode(h.mode ?? null))
      .catch(() => !cancelled && setMode(null));
    return () => {
      cancelled = true;
    };
  }, [connected]);
  return mode;
}

/** Streams the microphone to the server while `active`. */
export function useMic(active: boolean, sendAudio: (pcm: ArrayBuffer) => void): MicState {
  const [state, setState] = useState<MicState>("off");
  useEffect(() => {
    if (!active) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startMic(sendAudio).then(
      (s) => {
        if (cancelled) return s();
        stop = s;
        setState("on");
      },
      (err) => {
        console.warn("[mic]", err);
        if (!cancelled) setState("blocked");
      },
    );
    return () => {
      cancelled = true;
      stop?.();
      setState((s) => (s === "on" ? "off" : s));
    };
  }, [active, sendAudio]);
  return state;
}
