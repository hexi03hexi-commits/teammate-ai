import type { ReactNode } from "react";
import { AGENTS, type AgentId, type Mood } from "./meta";
import "./props.css";

/**
 * What each teammate has with it. The object says what the teammate is for, and it moves with
 * what the teammate is doing, so the role and the state read together:
 *
 *   Atlas  nothing             the main agent is the one without a tool
 *   Pilot  notebook and pen    held open in front of it, so we see it from behind; the pen writes
 *                              while it works and lifts clear when it is about to speak
 *   Scout  magnifier           lifted and swept about while it looks something up
 *   Sage   round glasses       worn; pushed up while it works out the answer, slipped down when it dozes
 *   Rebel  "?"                 no object: the question hangs by its head and shakes when it is about to object
 *
 * Look: flat and plain. Each object is the teammate's own colour plus white, with no outlines,
 * no shading and no gloss, so it reads as a small sign next to the body rather than a second character.
 * The motion classes are in index.css and props.css (prop-*).
 */

/** Which of an object's motions plays for a mood */
type Act = "rest" | "calm" | "work" | "keen" | "talk";
const ACT: Record<Mood, Act> = {
  asleep: "rest",
  idle: "calm",
  listening: "work",
  thinking: "work", // writing, looking it up, working it out
  nudging: "keen",
  speaking: "talk",
};

const PAPER = "#ffffff";
const SPRING = "cubic-bezier(.3,1.4,.5,1)";

/** The three flat colours one object is made of. */
interface Paint {
  /** the teammate's colour */
  main: string;
  /** a darker step of it, for the part that needs to stand apart (clip, pen, handle, frames) */
  dark: string;
  /** a pale step of it, for marks on white */
  pale: string;
}

function paintFor(agent: AgentId): Paint {
  const c = AGENTS[agent].to;
  return {
    main: c,
    dark: `color-mix(in srgb, ${c} 68%, #121a30)`,
    pale: `color-mix(in srgb, ${c} 38%, #ffffff)`,
  };
}

/**
 * Pilot's notebook, held open in front of it the way you hold one you are writing in. We are
 * on the other side, so we see the two covers from behind, the spine between them, the page
 * edges along the top, and the upper half of the pen, which is what moves when someone writes.
 */
function Notebook({ p, act }: { p: Paint; act: Act }) {
  const writing = act === "work";
  // The pen: tucked away when Pilot dozes, resting low when idle, writing while it works, lifted clear when it is about to speak.
  const pen =
    act === "rest"
      ? { transform: "translate(-2px, 20px)", opacity: 0 }
      : act === "calm"
        ? { transform: "translate(-1px, 8px) rotate(-6deg)", opacity: 1 }
        : writing
          ? { transform: "none", opacity: 1 }
          : { transform: "translate(3px, -4px) rotate(14deg)", opacity: 1 };
  return (
    <>
      <g style={{ ...pen, transformBox: "fill-box", transformOrigin: "20% 100%", transition: `transform 0.5s ${SPRING}, opacity 0.3s` }}>
        <g className={writing ? "prop-scribble" : act === "keen" ? "prop-tap" : undefined} style={{ transformBox: "fill-box", transformOrigin: "20% 100%" }}>
          {/* white, so it shows against the body behind it */}
          <path d="M36.5 14 L43.6 -5" stroke={PAPER} strokeWidth="4.4" strokeLinecap="round" />
          <path d="M43.2 -3.8 L44.4 -7.2" style={{ stroke: p.dark }} strokeWidth="4.4" strokeLinecap="round" />
        </g>
      </g>
      {/* page edges along the top of each half */}
      <path d="M4 7.8 L22 10 M24 10 L42 7.8" stroke={PAPER} strokeWidth="4.4" strokeLinecap="round" />
      {/* the two covers, each leaning back from the spine */}
      <path d="M3 11.2 L22 13.2 V46 L2 43 Z" style={{ fill: p.main, stroke: p.main }} strokeWidth="4" strokeLinejoin="round" />
      <path d="M43 11.2 L24 13.2 V46 L44 43 Z" style={{ fill: p.main, stroke: p.main }} strokeWidth="4" strokeLinejoin="round" />
      <path d="M23 12.4 V47" style={{ stroke: p.dark }} strokeWidth="3.4" strokeLinecap="round" />
    </>
  );
}

function Magnifier({ p, act }: { p: Paint; act: Act }) {
  return (
    <g className={act === "work" ? "prop-sweep" : act === "keen" ? "prop-hop" : undefined} style={{ transformBox: "fill-box", transformOrigin: "78% 84%" }}>
      <path d="M30.5 30.5 L41 41" style={{ stroke: p.dark }} strokeWidth="6" strokeLinecap="round" />
      <circle cx="20" cy="20" r="12" fill={PAPER} fillOpacity="0.45" />
      <circle cx="20" cy="20" r="12.6" fill="none" style={{ stroke: p.main }} strokeWidth="4.8" />
      {/* one glint, so it reads as glass */}
      <path d="M13.6 18.2 A6.8 6.8 0 0 1 18.4 13.4" stroke={PAPER} strokeWidth="2.4" strokeLinecap="round" fill="none" className={act === "talk" ? "prop-glint" : undefined} />
    </g>
  );
}

/**
 * Sage's glasses, worn over the eyes. Drawn in the figure's own 100×100 box (the same one the
 * face uses) so the lenses sit exactly on the eyes at any size.
 */
function Glasses({ act }: { p: Paint; act: Act }) {
  // Round wire rims, the scholar's pair: thin frames, perfectly round, and worn a little low on
  // the nose so the eyes sit in the upper half of the lenses and look out over them.
  const EYES = [37, 63];
  const Y = 49.8; // the eyes are at 48
  const R = 9.6;
  const INK = "var(--blob-face)";
  const inner = [EYES[0] + R, EYES[1] - R]; // the facing edges of the two rims
  return (
    <g transform="scale(0.48)">
      <g className={act === "work" ? "prop-adjust" : act === "keen" ? "prop-hop" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}>
        {EYES.map((x) => (
          <circle key={x} cx={x} cy={Y} r={R} fill={PAPER} fillOpacity="0.16" stroke={INK} strokeWidth="2.3" />
        ))}
        {/* the bridge arches over the nose. No nose pads: this low on the face they crowd the mouth. */}
        <path d={`M${inner[0] - 0.6} ${Y - 3.4} Q50 ${Y - 8.6} ${inner[1] + 0.6} ${Y - 3.4}`} fill="none" stroke={INK} strokeWidth="2.3" strokeLinecap="round" />
        {/* light catching the lenses: it sweeps while Sage works something out */}
        {EYES.map((x, i) => (
          <path
            key={x}
            d={`M${x - 6} ${Y + 4.4} L${x - 3} ${Y - 0.4}`}
            stroke={PAPER}
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity={act === "rest" ? 0 : 0.85}
            className={act === "work" || act === "talk" ? "prop-glint" : undefined}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </g>
    </g>
  );
}

/** Rebel has no object. Its question hangs in the air by its head. */
function Question({ p, act }: { p: Paint; act: Act }) {
  return (
    <g
      className={act === "keen" ? "prop-shake" : act === "talk" ? "prop-pop" : act === "calm" || act === "work" ? "prop-float" : undefined}
      style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
    >
      <path d="M14.6 17.2 A9.6 9.6 0 1 1 29.2 25 C26.4 26.8 24.6 28.2 24.6 31.4" fill="none" style={{ stroke: p.main }} strokeWidth="7.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.6" cy="41.2" r="4.3" style={{ fill: p.main }} />
    </g>
  );
}

/** Where the object sits against the figure (% of the figure's box) and how it is posed for each thing the teammate does. */
interface Hold {
  left: number;
  top: number;
  size: number;
  pose: Partial<Record<Act, string>>;
  /** No drop shadow: for things worn on the body rather than held beside it */
  worn?: boolean;
  draw: (p: Paint, act: Act) => ReactNode;
}

const RAISED = "translateY(-10%) rotate(-4deg) scale(1.08)";
const LOWERED = "translateY(9%) rotate(9deg) scale(0.9)";

const HOLD: Partial<Record<AgentId, Hold>> = {
  pilot: {
    // in front of the body, just under the mouth
    left: 28,
    top: 59,
    size: 44,
    pose: {
      rest: "translate(4%, 16%) rotate(7deg) scale(0.92)", // let down
      calm: "translateY(8%)",
      work: "none", // brought up to write in
      keen: "translateY(8%)",
      talk: "translateY(14%)", // lowered so it can speak over it
    },
    draw: (p, act) => <Notebook p={p} act={act} />,
  },
  scout: {
    left: 53,
    top: 49,
    size: 46,
    // lifted towards the eye while it searches
    pose: { rest: LOWERED, calm: "rotate(4deg)", work: "translate(-7%, -29%) rotate(-6deg)", keen: RAISED, talk: RAISED },
    draw: (p, act) => <Magnifier p={p} act={act} />,
  },
  sage: {
    left: 0,
    top: 0,
    size: 100,
    worn: true,
    // slipped down the nose and askew when it dozes
    pose: { rest: "translateY(5%) rotate(5deg)" },
    draw: (p, act) => <Glasses p={p} act={act} />,
  },
  rebel: {
    left: -3,
    top: -11,
    size: 38,
    pose: { rest: "translate(10%, 26%) rotate(-24deg) scale(0.72)", calm: "rotate(-12deg)", work: "rotate(-12deg)", keen: "translate(4%, -8%) rotate(-6deg) scale(1.18)", talk: "translate(2%, -4%) rotate(-8deg) scale(1.1)" },
    draw: (p, act) => <Question p={p} act={act} />,
  },
};

export function Prop({ agent, mood }: { agent: AgentId; mood: Mood; color?: string }) {
  const hold = HOLD[agent];
  if (!hold) return null; // the main agent carries nothing
  const act = ACT[mood];
  return (
    <div
      className="absolute"
      style={{
        width: `${hold.size}%`,
        height: `${hold.size}%`,
        left: `${hold.left}%`,
        top: `${hold.top}%`,
        pointerEvents: "none",
        transform: hold.pose[act] ?? "none",
        transition: `transform 0.6s ${SPRING}, opacity 0.5s`,
        opacity: act === "rest" && !hold.worn ? (agent === "rebel" ? 0.5 : 0.9) : 1,
        filter: hold.worn ? undefined : "drop-shadow(0 2px 3px rgba(18, 26, 48, 0.18))",
      }}
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%" className="overflow-visible" aria-hidden>
        {hold.draw(paintFor(agent), act)}
      </svg>
    </div>
  );
}
