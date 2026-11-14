import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Member } from "../../store/teams";
import { Icon, MemberAvatar } from "../../ui/kit";

/** How long one self-introduction is recorded */
const TAKE_MS = 4000;
const BARS = 28;

/**
 * Voice enrolment: each person says one sentence (name + what they are good at).
 * That sentence is what speaker recognition will learn each voice from.
 *
 * What this does today: opens the microphone, records for a few seconds, shows the live level,
 * and remembers the loudness outline. The audio is not kept or uploaded: the server-side
 * voiceprint model is not connected yet (see server/src/audio/asr.ts). When it is, send the
 * recording from `record()` below.
 */
export function Voices({
  members,
  onSkill,
  onEnrolled,
}: {
  members: Member[];
  onSkill: (memberId: string, skill: string) => void;
  onEnrolled: (memberId: string, bars: number[]) => void;
}) {
  // Only one person records at a time
  const [recording, setRecording] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-2.5">
      {members.map((m) => (
        <li key={m.id}>
          <VoiceRow
            member={m}
            busy={recording !== null && recording !== m.id}
            onRecording={(on) => setRecording(on ? m.id : null)}
            onSkill={(s) => onSkill(m.id, s)}
            onEnrolled={(bars) => onEnrolled(m.id, bars)}
          />
        </li>
      ))}
    </ul>
  );
}

type Phase = "idle" | "recording" | "blocked";

function VoiceRow({
  member,
  busy,
  onRecording,
  onSkill,
  onEnrolled,
}: {
  member: Member;
  busy: boolean;
  onRecording: (on: boolean) => void;
  onSkill: (skill: string) => void;
  onEnrolled: (bars: number[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const enrolled = member.voice;
  const first = member.name.replace(/^Dr\.?\s+/i, "").split(/\s+/)[0];

  const record = async () => {
    if (phase === "recording" || busy) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      // No microphone, permission refused, or the page is not on https
      setPhase("blocked");
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const levels: number[] = [];
    const started = performance.now();
    let raf = 0;
    let lastSample = 0;
    let done = false;

    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      onRecording(false);
      setPhase("idle");
      setLive([]);
      setProgress(0);
      if (keep) onEnrolled(resample(levels, BARS));
    };
    stop.current = () => finish(false);

    const tick = (now: number) => {
      const t = now - started;
      if (now - lastSample > 70) {
        lastSample = now;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        // RMS, lifted so quiet speech is still visible
        levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 3.2));
        setLive(levels.slice(-BARS));
        setProgress(Math.min(1, t / TAKE_MS));
      }
      if (t >= TAKE_MS) finish(true);
      else raf = requestAnimationFrame(tick);
    };

    setPhase("recording");
    onRecording(true);
    raf = requestAnimationFrame(tick);
  };

  const isRecording = phase === "recording";
  const bars = isRecording ? live : (enrolled?.bars ?? []);

  return (
    <div
      className="flex items-center gap-3.5 rounded-[22px] bg-surface-2 py-3 pr-3 pl-3.5 transition-opacity duration-300"
      style={{ boxShadow: `inset 0 0 0 ${isRecording ? "2px var(--ink)" : "1px var(--line)"}`, opacity: busy ? 0.45 : 1 }}
    >
      <MemberAvatar name={member.name} size={44} active={isRecording} />

      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          {isRecording ? (
            // The sentence to say, shown only while recording
            <motion.p key="say" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[16px] leading-snug font-semibold text-ink">
              “Hi, I'm {first}.{member.skill ? ` I'm good at ${member.skill}.` : ""}”
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

      <button
        type="button"
        onClick={isRecording ? () => stop.current() : record}
        disabled={busy}
        aria-label={isRecording ? "Cancel recording" : enrolled ? `Record ${member.name} again` : `Record ${member.name}`}
        title={phase === "blocked" ? "Microphone unavailable" : isRecording ? "Cancel" : enrolled ? "Record again" : "Record"}
        className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full transition duration-200 enabled:hover:scale-105 enabled:active:scale-95 ${
          isRecording ? "bg-[#ff5a4f] text-white!" : enrolled ? "bg-surface text-[#2fbf8f]!" : phase === "blocked" ? "bg-surface text-[#ff5a4f]!" : "bg-ink text-bg!"
        }`}
        style={enrolled && !isRecording ? { boxShadow: "inset 0 0 0 1px var(--line)" } : undefined}
      >
        {isRecording && (
          <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
            <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" />
            <circle cx="24" cy="24" r="22" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - progress)} />
          </svg>
        )}
        <Icon name={isRecording ? "stop" : phase === "blocked" ? "micOff" : enrolled ? "check" : "mic"} size={isRecording ? 16 : 20} />
      </button>
    </div>
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
