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
    // ︶ ︶
    eyes = (
      <>
        <path d="M33 48 Q38 53 43 48" {...stroke} />
        <path d="M57 48 Q62 53 67 48" {...stroke} />
      </>
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
        <g style={{ transformOrigin: "50px 54px", animation: "orbit 2.6s linear infinite" }}>
          <ellipse cx="50" cy="54" rx="52" ry="13" fill="none" stroke={color} strokeWidth="1" opacity="0.45" transform="rotate(-10 50 54)" />
          <circle cx="101" cy="45" r="2.6" fill={color} />
        </g>
      </svg>
    );
  }
  return null;
}
