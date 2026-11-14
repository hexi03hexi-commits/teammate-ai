import { lazy, Suspense } from "react";
import { AGENTS, type AgentId, type Mood } from "./meta";
import { Extras, Face } from "./Face";
import { Prop } from "./Prop";

const Blob = lazy(() => import("./Blob").then((m) => ({ default: m.Blob })));

/** Below this size the body is a CSS gradient instead of WebGL: it is too small to tell, and saves GPU contexts. */
const WEBGL_MIN = 64;

interface Props {
  agent: AgentId;
  mood: Mood;
  /** Rendered size in px (the figure is square) */
  size: number;
  /** Gaze direction, -1 … 1 */
  look?: number;
  /** Hide the carried object (e.g. in tiny list avatars) */
  bare?: boolean;
  className?: string;
}

/**
 * An agent: liquid body + face + the marks that show what it is doing + the object it has at hand
 * (Prop), which says what it is for and moves with what it is doing.
 */
export function AgentFigure({ agent, mood, size, look, bare, className }: Props) {
  const a = AGENTS[agent];
  const asleep = mood === "asleep";
  // Asleep agents keep their own colour so you can still tell who is who; only the glow dims.
  const { from, to } = a;
  const lively = mood === "speaking" || mood === "nudging";

  return (
    <div className={`relative shrink-0 select-none ${className ?? ""}`} style={{ width: size, height: size }} data-agent={agent} data-mood={mood}>
      {/* Coloured light pooled under the figure */}
      <div
        className="absolute rounded-[50%]"
        style={{
          left: "14%",
          right: "14%",
          bottom: "-6%",
          height: "22%",
          background: to,
          filter: `blur(${Math.max(6, size * 0.09)}px)`,
          opacity: asleep ? 0.28 : lively ? 0.75 : 0.5,
          transition: "opacity 0.6s, background 0.6s",
        }}
      />
      {size >= WEBGL_MIN ? (
        <Suspense fallback={<CssBody from={from} to={to} />}>
          <Blob from={from} to={to} mood={mood} />
        </Suspense>
      ) : (
        <CssBody from={from} to={to} />
      )}
      {/* Pilot looks down at its notebook while it is writing in it */}
      <Face mood={mood} look={look} down={agent === "pilot" && !bare && (mood === "thinking" || mood === "listening")} />
      {size >= 48 && <Extras mood={mood} color={a.color} />}
      {!bare && size >= 40 && <Prop agent={agent} mood={mood} color={a.color} />}
    </div>
  );
}

function CssBody({ from, to }: { from: string; to: string }) {
  return (
    <div
      className="absolute"
      style={{
        inset: "9%",
        background: `radial-gradient(circle at 32% 24%, #fff 0%, transparent 34%), linear-gradient(165deg, ${from}, ${to})`,
        boxShadow: "inset 0 -6px 12px rgba(0,0,0,0.08), inset 0 2px 3px rgba(255,255,255,0.7)",
        animation: "blob-morph 9s ease-in-out infinite",
        transition: "background 0.6s",
      }}
    />
  );
}
