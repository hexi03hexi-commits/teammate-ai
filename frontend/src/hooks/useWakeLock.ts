import { useEffect } from "react";

/** Keeps the screen awake while `active` (feature-detected; re-acquired when the tab becomes visible). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (disposed) void l.release();
        else lock = l;
      } catch {
        /* denied (low battery, not visible, ...) — fine */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
