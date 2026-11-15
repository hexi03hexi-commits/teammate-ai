import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TEAMMATE_IDS } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { Icon } from "../../ui/kit";

/** Short, readable code like "k7mq-x2fd". Not a real invitation yet: there is no backend for joining. */
function makeCode(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const part = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
  return `${part()}-${part()}`;
}

/**
 * The panel that opens under the plus button: name the team, share its invite link, create it.
 * The four agents come with every team, so they are shown as already on board.
 */
export function NewTeam({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => `teammate.ai/join/${makeCode()}`, []);
  const ready = name.trim().length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
    } catch {
      // clipboard blocked (e.g. no https): still acknowledge the tap
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <form
      className="mb-2 flex flex-col gap-3 rounded-[26px] bg-surface-2 p-3"
      style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCreate(name.trim());
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        aria-label="Team name"
        maxLength={40}
        className="h-12 w-full rounded-[18px] bg-surface px-4 text-[17px] font-semibold text-ink shadow-card outline-none placeholder:font-medium placeholder:text-ink-3"
      />

      {/* Invite link */}
      <div>
        <div className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Invite link</div>
        <div className="flex h-11 items-center gap-2 rounded-[16px] bg-surface pr-1.5 pl-3.5" style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}>
          <span className="shrink-0 text-ink-3">
            <Icon name="link" size={15} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink-2 tabular-nums">{link}</span>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy invite link"
            title="Copy"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-2 transition hover:bg-ink/5 hover:text-ink active:scale-90"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied ? "ok" : "copy"} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={{ duration: 0.14 }} style={{ color: copied ? "#2fbf8f" : undefined }}>
                <Icon name={copied ? "check" : "copy"} size={16} />
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Who is on the team from the start */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1">
          {TEAMMATE_IDS.map((id) => (
            <AgentFigure key={id} agent={id} mood={ready ? "idle" : "asleep"} size={26} bare />
          ))}
        </div>
        <button
          type="submit"
          disabled={!ready}
          className="flex h-10 items-center gap-1.5 rounded-full bg-ink pr-4 pl-3 text-[14px] font-semibold text-bg transition enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:opacity-30 dark:bg-surface-2 dark:text-ink dark:shadow-[inset_0_0_0_1px_var(--line)]"
        >
          <Icon name="plus" size={16} />
          Create
        </button>
      </div>
    </form>
  );
}
