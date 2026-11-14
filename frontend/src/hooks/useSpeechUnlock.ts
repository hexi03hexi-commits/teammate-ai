import { useEffect, useSyncExternalStore } from "react";
import { speech } from "../lib/speech";

/**
 * Host only: unlocks audio on the first tap anywhere (iOS needs a user gesture),
 * and reports whether that has happened yet.
 */
export function useSpeechUnlock(enabled: boolean): boolean {
  const unlocked = useSyncExternalStore(speech.subscribe, speech.getUnlocked);
  useEffect(() => {
    if (!enabled || unlocked) return;
    const onTap = () => speech.unlock();
    window.addEventListener("pointerdown", onTap, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", onTap, { capture: true });
  }, [enabled, unlocked]);
  return unlocked;
}
