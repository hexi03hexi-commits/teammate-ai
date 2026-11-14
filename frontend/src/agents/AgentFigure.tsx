import { lazy, Suspense } from "react";
import { AGENTS, ASLEEP_LOOK, type AgentId, type Mood } from "./meta";
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

/** An agent: liquid body + face + the object it carries + the marks that show what it is doing. */
export function AgentFigure({ agent, mood, size, look, bare, className }: Props) {
  const a = AGENTS[agent];
  const asleep = mood === "asleep";
  const { from, to } = asleep ? ASLEEP_LOOK : a;
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
          opacity: asleep ? 0.18 : lively ? 0.75 : 0.5,
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
      <Face mood={mood} look={look} />
      {size >= 48 && <Extras mood={mood} color={a.color} />}
      {!bare && size >= 40 && <Prop agent={agent} color={a.color} asleep={asleep} />}
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
