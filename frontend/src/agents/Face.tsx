import type { Mood } from "./meta";

/**
 * The face drawn over the body. viewBox is 100×100, matching the figure's box.
 * `look` shifts the gaze: -1 (left) … 1 (right).
 */
export function Face({ mood, look = 0 }: { mood: Mood; look?: number }) {
  const ink = "var(--blob-face)";
  const dx = look * 3;
  const stroke = { stroke: ink, strokeWidth: 3.4, strokeLinecap: "round" as const, fill: "none" };

  let eyes;
  if (mood === "asleep") {
    // – –
    eyes = (
      <>
        <path d="M33 51 L43 49" {...stroke} />
        <path d="M57 49 L67 47" {...stroke} />
      </>
    );
  } else if (mood === "thinking") {
    // Eyes open, looking up and to the side, towards the thought bubbles
    eyes = (
      <g style={{ transform: "translate(2.5px, -3.5px)", transition: "transform 0.5s cubic-bezier(.3,1.4,.5,1)" }}>
        <ellipse cx="38" cy="48" rx="4.6" ry="6" fill={ink} />
        <circle cx="40.4" cy="44.8" r="1.6" fill="#fff" opacity="0.9" />
        <ellipse cx="62" cy="48" rx="4.6" ry="6" fill={ink} />
        <circle cx="64.4" cy="44.8" r="1.6" fill="#fff" opacity="0.9" />
      </g>
    );
  } else {
    eyes = (
      <g style={{ transform: `translateX(${dx}px)`, transition: "transform 0.5s cubic-bezier(.3,1.4,.5,1)" }}>
        <g className="eye">
          <ellipse cx="38" cy="48" rx="4.6" ry="6" fill={ink} />
          <circle cx="39.6" cy="45.6" r="1.5" fill="#fff" opacity="0.9" />
        </g>
        <g className="eye">
          <ellipse cx="62" cy="48" rx="4.6" ry="6" fill={ink} />
          <circle cx="63.6" cy="45.6" r="1.5" fill="#fff" opacity="0.9" />
        </g>
      </g>
    );
  }

  let mouth;
  if (mood === "speaking") {
    mouth = <ellipse className="mouth-talk" cx="50" cy="62" rx="5" ry="4.6" fill={ink} />;
  } else if (mood === "asleep") {
    mouth = null;
  } else if (mood === "thinking") {
    // a small, closed, slightly off-centre mouth: concentrating
    mouth = <path d="M47 62 Q51 63.5 55 61" {...stroke} strokeWidth={3} />;
  } else if (mood === "listening" || mood === "nudging") {
    mouth = <ellipse cx="50" cy="61.5" rx="2.6" ry="2.2" fill={ink} />;
  } else {
    mouth = <path d="M45 60 Q50 65 55 60" {...stroke} strokeWidth={3} />;
  }

  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      {eyes}
      {mouth}
    </svg>
  );
}

/** Little marks around the figure that say what it is doing. Same 100×100 box, drawn outside the body. */
export function Extras({ mood, color }: { mood: Mood; color: string }) {
  if (mood === "asleep") {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {[0, 1.05, 2.1].map((delay, i) => (
          <text
            key={i}
            className="zzz"
            x={70 + i * 7}
            y={26 - i * 7}
            fontSize={9 + i * 3}
            fontWeight={800}
            fill={color}
            style={{ animationDelay: `${delay}s` }}
          >
            z
          </text>
        ))}
      </svg>
    );
  }
  if (mood === "listening" || mood === "nudging" || mood === "speaking") {
    // Three ticks at the upper right, like a sound mark
    const fast = mood !== "listening";
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <g transform="rotate(32 82 16)">
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              className="tick"
              x={76 + i * 6}
              y={i === 1 ? 4 : 8}
              width={3.2}
              height={i === 1 ? 13 : 9}
              rx={1.6}
              fill={color}
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: fast ? "0.5s" : "0.95s" }}
            />
          ))}
        </g>
      </svg>
    );
  }
  if (mood === "thinking") {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        {/* Thought bubbles: three dots rising from the head, lighting up one after another */}
        {[
          { cx: 78, cy: 21, r: 2.4 },
          { cx: 86.5, cy: 12.5, r: 3.5 },
          { cx: 97, cy: 2.5, r: 4.9 },
        ].map((d, i) => (
          <circle key={i} className="think" {...d} fill={color} style={{ animationDelay: `${i * 0.22}s` }} />
        ))}
      </svg>
    );
  }
  return null;
}
