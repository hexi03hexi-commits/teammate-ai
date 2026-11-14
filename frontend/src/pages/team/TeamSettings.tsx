import type { ReactNode } from "react";
import type { TeammateId } from "@teammate/shared";
import { AgentFigure } from "../../agents/AgentFigure";
import { addMember, removeMember, updateMember, updateTeam, type Team } from "../../store/teams";
import { IconButton } from "../../ui/kit";
import { Voices } from "./Voices";

/**
 * What stays true across a team's meetings, editable at any time:
 *   Brief   the target, how the work is judged, and the track. Every meeting of this team uses it;
 *           a meeting itself only adds a topic and a length.
 *   People  who is on the team, and each person's recorded voice, used to put names on speakers.
 * Changes save as you type.
 */
export function TeamSettings({ team, onClose }: { team: Team; onClose?: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-ink-3">Team</div>
          <h2 className="mt-1.5 text-[30px] leading-[1.12] font-semibold tracking-[-0.025em] text-ink">{team.name}</h2>
        </div>
        {onClose && <IconButton icon="check" label="Done" tone="solid" onClick={onClose} />}
      </header>

      <section>
        <Label>Brief</Label>
        <div className="flex flex-col gap-2.5">
          {/* The small figure shows which agent relies on the field */}
          <Field
            label="Target"
            placeholder="how far should the work go?"
            value={team.scope}
            onChange={(scope) => updateTeam(team.id, { scope })}
            agent="pilot"
          />
          <Field
            label="Judging criteria"
            placeholder="how will it be judged?"
            value={team.criteria}
            onChange={(criteria) => updateTeam(team.id, { criteria })}
            agent="pilot"
            rows={2}
          />
          <Field
            label="Track"
            placeholder="industry or track"
            value={team.industry}
            onChange={(industry) => updateTeam(team.id, { industry })}
            agent="sage"
          />
        </div>
      </section>

      <section>
        <Label count={String(team.members.length)}>People</Label>
        <Voices
          teamId={team.id}
          members={team.members}
          onSkill={(id, skill) => updateMember(team.id, id, { skill })}
          onRecorded={(id, bars) => updateMember(team.id, id, { voice: { enrolledAt: Date.now(), bars } })}
          onAdd={(name, skill) => addMember(team.id, name, skill)}
          onRemove={(id) => removeMember(team.id, id)}
        />
      </section>
    </div>
  );
}

function Label({ children, count }: { children: ReactNode; count?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.16em] text-ink-3">{children}</h3>
      {count && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-ink-3 tabular-nums">{count}</span>}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  agent,
  rows = 1,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  agent: TeammateId;
  rows?: number;
}) {
  return (
    <label
      className="flex items-start gap-3 rounded-[22px] bg-surface-2 py-3 pr-3.5 pl-4 transition-shadow focus-within:shadow-[inset_0_0_0_2px_var(--ink)]"
      style={{ boxShadow: "inset 0 0 0 1px var(--line)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{label}</div>
        <textarea
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={240}
          className="mt-1 block w-full resize-none bg-transparent text-[17px] leading-snug font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
        />
      </div>
      <AgentFigure agent={agent} mood={value.trim() ? "idle" : "asleep"} size={34} />
    </label>
  );
}
