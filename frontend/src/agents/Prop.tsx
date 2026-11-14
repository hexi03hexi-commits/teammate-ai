import type { AgentId } from "./meta";

/**
 * The object each teammate carries, so its job reads at a glance:
 *   Pilot  stopwatch       keeps time, keeps the meeting on course
 *   Scout  magnifier       looks things up
 *   Sage   open book       knows the field
 *   Rebel  "?" bubble      asks the awkward question
 * Drawn as a small glass token so it belongs to the same material as the body.
 */
const ICONS: Record<Exclude<AgentId, "main">, (c: string) => React.ReactNode> = {
  pilot: (c) => (
    <>
      <circle cx="12" cy="13.5" r="6.5" fill="none" stroke={c} strokeWidth="2" />
      <path d="M12 13.5 V9.8 M10 4 H14 M12 4 V7 M17.4 8 L18.6 6.8" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  scout: (c) => (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke={c} strokeWidth="2.2" />
      <path d="M14.8 14.8 L19.5 19.5" stroke={c} strokeWidth="2.6" strokeLinecap="round" />
    </>
  ),
  sage: (c) => (
    <path
      d="M12 7.2 C10 5.6 7 5.2 4.2 5.8 V17.6 C7 17 10 17.4 12 19 C14 17.4 17 17 19.8 17.6 V5.8 C17 5.2 14 5.6 12 7.2 Z M12 7.2 V19"
      fill="none"
      stroke={c}
      strokeWidth="1.9"
      strokeLinejoin="round"
    />
  ),
  rebel: (c) => (
    <>
      <path d="M5 5 H19 A2 2 0 0 1 21 7 V14 A2 2 0 0 1 19 16 H12 L8 19.5 V16 H5 A2 2 0 0 1 3 14 V7 A2 2 0 0 1 5 5 Z" fill="none" stroke={c} strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M10.2 9.2 A1.9 1.9 0 1 1 12 11.2 V11.8" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="13.7" r="0.95" fill={c} />
    </>
  ),
};

export function Prop({ agent, color, asleep }: { agent: AgentId; color: string; asleep: boolean }) {
  if (agent === "main") return null;
  return (
    <div
      className="glass absolute grid place-items-center rounded-full"
      style={{
        width: "38%",
        height: "38%",
        right: "-4%",
        bottom: "2%",
        transition: "opacity 0.5s, transform 0.5s cubic-bezier(.3,1.4,.5,1)",
        opacity: asleep ? 0.55 : 1,
        transform: asleep ? "scale(0.88) rotate(-8deg)" : "scale(1)",
      }}
    >
      <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden>
        {ICONS[agent](asleep ? "var(--ink-3)" : color)}
      </svg>
    </div>
  );
}
