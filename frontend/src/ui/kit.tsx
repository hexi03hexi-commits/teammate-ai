import { useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

/** Shared small pieces. Keep this file tiny: anything page-specific lives with its page. */

type IconName = "plus" | "back" | "pause" | "play" | "stop" | "check" | "close" | "sun" | "moon" | "arrow" | "link" | "export" | "copy" | "mic" | "micOff" | "redo" | "sliders";

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  pause: <path d="M9 6v12M15 6v12" strokeWidth={2.6} />,
  play: <path d="M8.5 5.8v12.4L18.5 12Z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.6" fill="currentColor" stroke="none" />,
  check: <path d="m5.5 12.5 4.2 4.2L18.5 8" />,
  close: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
    </>
  ),
  moon: <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7Z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.5v-3a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 10.4 5.2M18.5 11.5a6.5 6.5 0 0 1-.5 2.5M12 18v2.5M4 4l16 16" />
    </>
  ),
  sliders: <path d="M5 7.5h6M15 7.5h4M5 16.5h3M12 16.5h7M13 5v5M10 14v5" />,
  redo: <path d="M19 8.5V4.5M19 8.5h-4M19 8.5a7.5 7.5 0 1 0 .5 6" />,
  export: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.6" />
      <path d="M15.5 5.5h-8a2 2 0 0 0-2 2v8" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Accessible name; never shown */
  label: string;
  size?: number;
  tone?: "plain" | "glass" | "solid" | "danger";
}

/** Round, text-free button. */
export function IconButton({ icon, label, size = 44, tone = "plain", className = "", ...rest }: IconButtonProps) {
  const tones = {
    plain: "text-ink-2 hover:bg-ink/5 hover:text-ink",
    glass: "glass text-ink hover:scale-105",
    solid: "bg-ink text-bg hover:scale-105",
    danger: "bg-[#ff5a4f] text-white shadow-[0_10px_24px_-8px_rgba(255,90,79,.7)] hover:scale-105",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid shrink-0 place-items-center rounded-full transition duration-200 active:scale-95 ${tones[tone]} ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={Math.round(size * 0.45)} />
    </button>
  );
}

/** A person: initials on a soft neutral disc. People stay grey so the agents own the colour. */
export function MemberAvatar({ name, size = 40, active, dim }: { name: string; size?: number; active?: boolean; dim?: boolean }) {
  const initials = name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full bg-surface font-semibold text-ink-2 transition-all duration-300"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        opacity: dim ? 0.35 : 1,
        boxShadow: active ? "0 0 0 2px var(--bg), 0 0 0 4px var(--ink)" : "inset 0 0 0 1px var(--line)",
        color: active ? "var(--ink)" : undefined,
      }}
    >
      {initials}
    </div>
  );
}

/** Light / dark, remembered across visits. One shared value, so every toggle and page agrees. */
type Theme = "light" | "dark";
const themeListeners = new Set<() => void>();
let currentTheme: Theme = (() => {
  const saved = localStorage.getItem("teammate.theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();
document.documentElement.dataset.theme = currentTheme;

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem("teammate.theme", currentTheme);
  themeListeners.forEach((l) => l());
}

export function useTheme(): [theme: Theme, toggle: () => void] {
  const theme = useSyncExternalStore(
    (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    () => currentTheme,
  );
  return [theme, toggleTheme];
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return <IconButton icon={theme === "dark" ? "sun" : "moon"} label="Switch theme" onClick={toggle} size={40} />;
}

/** m:ss */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
