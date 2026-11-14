import { useState } from "react";
import { AgentFigure } from "../agents/AgentFigure";
import { AGENTS, type AgentId, type Mood } from "../agents/meta";

const MOODS: Mood[] = ["asleep", "idle", "listening", "thinking", "nudging", "speaking"];
const IDS = Object.keys(AGENTS) as AgentId[];

/** ?lab=1 — every agent in every mood, for tuning the look. Not part of the product. */
export function Lab() {
  const [mood, setMood] = useState<Mood>("idle");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 p-8">
      <div className="flex gap-2">
        {MOODS.map((m) => (
          <button
            key={m}
            onClick={() => setMood(m)}
            className={`rounded-full px-4 py-1.5 text-sm ${m === mood ? "bg-ink text-bg" : "bg-surface text-ink-2"}`}
          >
            {m}
          </button>
        ))}
        <button
          className="rounded-full bg-surface px-4 py-1.5 text-sm text-ink-2"
          onClick={() => {
            const el = document.documentElement;
            el.dataset.theme = el.dataset.theme === "dark" ? "light" : "dark";
          }}
        >
          theme
        </button>
      </div>
      <div className="flex items-end gap-10">
        <AgentFigure agent="main" mood={mood} size={220} />
        {IDS.filter((i) => i !== "main").map((id) => (
          <div key={id} className="flex flex-col items-center gap-3">
            <AgentFigure agent={id} mood={mood} size={130} />
            <span className="text-sm text-ink-2">{AGENTS[id].name}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        {IDS.map((id) => (
          <AgentFigure key={id} agent={id} mood={mood} size={44} />
        ))}
        {IDS.map((id) => (
          <AgentFigure key={id} agent={id} mood={mood} size={28} bare />
        ))}
      </div>
    </div>
  );
}
