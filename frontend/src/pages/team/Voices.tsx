import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { startMic } from "../../lib/mic";
import { enrolVoice, forgetVoice, voiceStatus, type EnrolOutcome } from "../../lib/voiceprints";
import type { Member } from "../../store/teams";
import { Icon, IconButton, MemberAvatar } from "../../ui/kit";

/** How long one self-introduction is recorded. Longer recordings are recognised more reliably. */
const TAKE_MS = 6000;
const BARS = 28;

/**
 * The people on the team, and their voices.
 *
 * Each person records one self-introduction. The recording goes to the session server, which
 * turns it into a voiceprint and keeps it there; during a meeting each new voice is compared
 * with those voiceprints to put the right name on it. Without a voiceprint, people are matched
 * by the order in which they first speak.
 *
 * Record in the language the meeting will be held in: the same person sounds like a different
 * speaker to the model in another language.
 */
export function Voices({
  teamId,
  members,
  onSkill,
  onRecorded,
  onAdd,
  onRemove,
}: {
  teamId: string;
  members: Member[];
  onSkill: (memberId: string, skill: string) => void;
  /** A recording was accepted: keep its outline to draw */
  onRecorded: (memberId: string, bars: number[]) => void;
  onAdd: (name: string, skill: string) => void;
  onRemove: (memberId: string) => void;
}) {
  // Only one person records at a time
  const [recording, setRecording] = useState<string | null>(null);
  // Who the server has a voiceprint for. null = server unreachable or no speaker model.
  const [enrolled, setEnrolled] = useState<Set<string> | null>(null);
  const refresh = useCallback(() => {
    void voiceStatus(teamId).then((s) => setEnrolled(s?.available ? new Set(s.enrolled) : null));
  }, [teamId]);
  useEffect(refresh, [refresh]);

  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-2.5">
        <AnimatePresence initial={false}>
          {members.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.22 }}>
              <VoiceRow
                teamId={teamId}
                member={m}
                enrolled={enrolled === null ? null : enrolled.has(m.id)}
                busy={recording !== null && recording !== m.id}
                canRemove={members.length > 1}
                onRecording={(on) => setRecording(on ? m.id : null)}
                onSkill={(s) => onSkill(m.id, s)}
                onRecorded={(bars) => {
                  onRecorded(m.id, bars);
                  refresh();
                }}
                onRemove={() => {
                  void forgetVoice(teamId, m.id).then(refresh);
                  onRemove(m.id);
                }}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AddPerson onAdd={onAdd} />
    </div>
  );
}

type Phase = "idle" | "recording" | "sending" | "blocked" | "retry";

function VoiceRow({
  teamId,
  member,
  enrolled,
  busy,
  canRemove,
  onRecording,
  onSkill,
  onRecorded,
  onRemove,
}: {
  teamId: string;
  member: Member;
  /** true / false from the server; null when the server cannot say */
  enrolled: boolean | null;
  busy: boolean;
  canRemove: boolean;
  onRecording: (on: boolean) => void;
  onSkill: (skill: string) => void;
  onRecorded: (bars: number[]) => void;
  onRemove: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const cancel = useRef<() => void>(() => {});
  useEffect(() => () => cancel.current(), []);

  const first = member.name.replace(/^Dr\.?\s+/i, "").split(/\s+/)[0];
  const isRecording = phase === "recording";

  const record = async () => {
    if (isRecording || phase === "sending" || busy) return;
    const chunks: ArrayBuffer[] = [];
    const levels: number[] = [];
    let stopMic: (() => void) | null = null;
    let timer = 0;
    let done = false;
    const started = performance.now();

    const finish = async (keep: boolean) => {
      if (done) return;
      done = true;
      window.clearInterval(timer);
      stopMic?.();
      onRecording(false);
      setLive([]);
      setProgress(0);
      if (!keep) return setPhase("idle");

      setPhase("sending");
      const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let at = 0;
      for (const c of chunks) {
        pcm.set(new Uint8Array(c), at);
        at += c.byteLength;
      }
      const outcome: EnrolOutcome = await enrolVoice(teamId, member.id, pcm.buffer);
      if (outcome === "ok") {
        onRecorded(resample(levels, BARS));
        setPhase("idle");
      } else {
        // too quiet or too short: ask for another take; anything else means the server cannot do it now
        setPhase(outcome === "too_quiet" || outcome === "too_short" ? "retry" : "blocked");
      }
    };
    cancel.current = () => void finish(false);

    try {
      // Same capture path as a meeting: 16 kHz mono PCM in 100 ms chunks
      stopMic = await startMic((chunk) => {
        if (done) return;
        chunks.push(chunk);
        const samples = new Int16Array(chunk);
        let sum = 0;
        for (const v of samples) sum += (v / 32768) ** 2;
        // RMS, lifted so quiet speech is still visible
        levels.push(Math.min(1, Math.sqrt(sum / samples.length) * 3.2));
        setLive(levels.slice(-BARS));
      });
    } catch {
      // No microphone, permission refused, or the page is not on https / localhost
      setPhase("blocked");
      return;
    }
    if (done) return stopMic();
    setPhase("recording");
    onRecording(true);
    timer = window.setInterval(() => {
      const t = performance.now() - started;
      setProgress(Math.min(1, t / TAKE_MS));
      if (t >= TAKE_MS) void finish(true);
    }, 80);
  };

  const hasVoice = enrolled === true;
  const bars = isRecording ? live : hasVoice ? (member.voice?.bars ?? []) : [];
  const icon = isRecording ? "stop" : phase === "blocked" ? "micOff" : phase === "retry" ? "redo" : hasVoice ? "check" : "mic";
  const title = isRecording
    ? "Cancel"
    : phase === "blocked"
      ? "Microphone or voice server unavailable"
      : phase === "retry"
        ? "Could not hear you clearly: try again"
        : hasVoice
          ? "Record again"
          : "Record";

  return (
    <div
      className="group flex items-center gap-3.5 rounded-[22px] bg-surface-2 py-3 pr-3 pl-3.5 transition-opacity duration-300"
      style={{ boxShadow: `inset 0 0 0 ${isRecording ? "2px var(--ink)" : "1px var(--line)"}`, opacity: busy ? 0.45 : 1 }}
    >
      <MemberAvatar name={member.name} size={44} active={isRecording} />

      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {isRecording ? (
            // The sentence to say, shown only while recording
            <motion.p key="say" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[16px] leading-snug font-semibold text-ink">
              “Hi, I'm {first}.{member.skill ? ` I'm good at ${member.skill}.` : ""} I'm looking forward to working on this with everyone.”
            </motion.p>
          ) : (
            <motion.div key="info" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="text-[16px] leading-tight font-semibold text-ink">{member.name}</div>
              <input
                value={member.skill ?? ""}
                onChange={(e) => onSkill(e.target.value)}
                placeholder="good at…"
                aria-label={`What ${member.name} is good at`}
                maxLength={60}
                className="mt-0.5 w-full bg-transparent text-[14px] text-ink-2 outline-none placeholder:text-ink-3"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Level while recording; the saved outline afterwards */}
      <div className="flex h-9 w-[132px] shrink-0 items-center justify-end gap-[2.5px]" aria-hidden>
        {bars.map((v, i) => (
          <span
            key={i}
            className="w-[2.5px] rounded-full transition-[height] duration-75"
            style={{ height: `${Math.max(8, v * 100)}%`, background: isRecording ? "var(--ink)" : "var(--ink-3)", opacity: isRecording ? 1 : 0.7 }}
          />
        ))}
      </div>

      {canRemove && !isRecording && (
        <IconButton icon="close" label={`Remove ${member.name}`} size={32} className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" onClick={onRemove} />
      )}

      <button
        type="button"
        onClick={isRecording ? () => cancel.current() : record}
        disabled={busy || phase === "sending"}
        aria-label={isRecording ? "Cancel recording" : hasVoice ? `Record ${member.name} again` : `Record ${member.name}`}
        title={title}
        className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full transition duration-200 enabled:hover:scale-105 enabled:active:scale-95 ${
          isRecording
            ? "bg-[#ff5a4f] text-white!"
            : phase === "blocked"
              ? "bg-surface text-[#ff5a4f]!"
              : phase === "retry"
                ? "bg-surface text-[#f59e0b]!"
                : hasVoice
                  ? "bg-surface text-[#2fbf8f]!"
                  : "bg-ink text-bg!"
        } ${phase === "sending" ? "animate-pulse" : ""}`}
        style={(hasVoice || phase === "blocked" || phase === "retry") && !isRecording ? { boxShadow: "inset 0 0 0 1px var(--line)" } : undefined}
      >
        {isRecording && (
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
            <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" />
            <circle cx="24" cy="24" r="22" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - progress)} />
          </svg>
        )}
        <Icon name={icon} size={isRecording ? 16 : 20} />
      </button>
    </div>
  );
}

/** A row that turns into a small form: name, what they are good at, add. */
function AddPerson({ onAdd }: { onAdd: (name: string, skill: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [skill, setSkill] = useState("");
  const close = () => {
    setOpen(false);
    setName("");
    setSkill("");
  };
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[58px] items-center gap-3 rounded-[22px] px-4 text-[15px] font-semibold text-ink-3 transition hover:bg-surface-2 hover:text-ink"
        style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
      >
        <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2">
          <Icon name="plus" size={18} />
        </span>
        Add a person
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2.5 rounded-[22px] bg-surface-2 py-2.5 pr-2.5 pl-4"
      style={{ boxShadow: "inset 0 0 0 2px var(--ink)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim(), skill.trim());
        close();
      }}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="name" aria-label="Name" maxLength={30} className="h-10 w-[30%] min-w-0 bg-transparent text-[16px] font-semibold text-ink outline-none placeholder:font-medium placeholder:text-ink-3" />
      <input value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="good at…" aria-label="Good at" maxLength={60} className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-ink-2 outline-none placeholder:text-ink-3" />
      <IconButton icon="close" label="Cancel" size={36} onClick={close} />
      <button type="submit" disabled={!name.trim()} aria-label="Add" title="Add" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-bg! transition enabled:hover:scale-105 disabled:opacity-30">
        <Icon name="check" size={18} />
      </button>
    </form>
  );
}

/** Reduce a list of levels to exactly `n` bars (max of each bucket), so every outline has the same width. */
function resample(levels: number[], n: number): number[] {
  if (levels.length === 0) return [];
  return Array.from({ length: n }, (_, i) => {
    const a = Math.floor((i / n) * levels.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * levels.length));
    return Math.max(...levels.slice(a, b));
  });
}
