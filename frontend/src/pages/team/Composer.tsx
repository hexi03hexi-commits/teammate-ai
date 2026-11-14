import { useState } from "react";
import { motion } from "motion/react";
import { AgentFigure } from "../../agents/AgentFigure";
import { Icon, IconButton } from "../../ui/kit";

const DURATIONS = [5, 10, 15, 30] as const;
const spring = { type: "spring", stiffness: 480, damping: 34 } as const;

interface Props {
  connected: boolean;
  /** At least one member is picked */
  canStart: boolean;
  onCancel?: () => void;
  onStart: (title: string, durationMin: number) => void;
}

/** New meeting: a topic, a length, go. Who attends is picked in the roster on the left. */
export function Composer({ connected, canStart, onCancel, onStart }: Props) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState<number>(5);
  const [focused, setFocused] = useState(false);
  const ready = title.trim().length > 0 && canStart;
  const enabled = ready && connected;

  const submit = () => {
    if (enabled) onStart(title.trim(), duration);
  };

  return (
    <form
      className="flex min-h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start justify-between">
        <AgentFigure agent="main" size={112} mood={ready ? "nudging" : focused || title ? "listening" : "idle"} look={focused ? 0.4 : 0} />
        {onCancel && <IconButton icon="close" label="Cancel" onClick={onCancel} />}
      </div>

      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === "Escape" && onCancel?.()}
        placeholder="what are we deciding?"
        aria-label="Meeting topic"
        required
        className="mt-8 w-full border-b-2 border-line bg-transparent pb-4 text-[34px] leading-tight font-semibold tracking-[-0.025em] text-ink outline-none transition-colors placeholder:text-ink-3/70 focus:border-ink/30"
      />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div role="radiogroup" aria-label="Duration" className="relative flex rounded-full bg-surface-2 p-1" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
          {DURATIONS.map((m) => {
            const on = m === duration;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setDuration(m)}
                className={`relative h-11 min-w-[72px] rounded-full px-4 text-[16px] font-semibold tabular-nums transition-colors ${on ? "text-ink!" : "text-ink-3! hover:text-ink-2!"}`}
              >
                {on && <motion.span layoutId="duration-pill" className="absolute inset-0 rounded-full bg-surface shadow-card" transition={spring} />}
                <span className="relative">
                  {m}
                  <span className="ml-0.5 text-[13px] font-medium text-ink-3">min</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-auto flex items-center justify-end gap-3 pt-10">
        {!connected && (
          <span className="flex items-center gap-2 text-ink-3" title="Offline" aria-label="Offline">
            <span className="relative grid h-3 w-3 place-items-center">
              <span className="absolute h-3 w-3 animate-ping rounded-full bg-[#ff5a4f]/40" />
              <span className="h-2 w-2 rounded-full bg-[#ff5a4f]" />
            </span>
            <OfflineIcon />
          </span>
        )}
        <motion.button
          type="submit"
          disabled={!enabled}
          whileTap={enabled ? { scale: 0.95 } : undefined}
          animate={{ opacity: enabled ? 1 : 0.35 }}
          transition={spring}
          className="flex h-14 items-center gap-3 rounded-full bg-ink pr-7 pl-5 text-[18px] font-semibold text-bg! shadow-float disabled:cursor-not-allowed disabled:shadow-none"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-bg/15">
            <Icon name="play" size={16} />
          </span>
          Start
        </motion.button>
      </div>
    </form>
  );
}

function OfflineIcon() {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="M2.5 9a14 14 0 0 1 5-3M12 5.5a14 14 0 0 1 9.5 3.5M5.5 12.5a9 9 0 0 1 3.5-2M15 10.8a9 9 0 0 1 3.5 1.7M8.8 15.8a4.5 4.5 0 0 1 6.4 0M12 19.2h.01M3.5 3.5l17 17" />
    </svg>
  );
}
