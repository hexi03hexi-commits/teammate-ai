import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TEAMMATE_IDS, type SessionConfig, type TeammateId } from "@teammate/shared";
import { IS_HOST, LAB } from "./lib/env";
import { speech } from "./lib/speech";
import { useSession } from "./hooks/useSession";
import { useWakeLock } from "./hooks/useWakeLock";
import { addMeeting, addTeam, cardsToEntries, useTeams } from "./store/teams";
import { Lab } from "./pages/Lab";
import { HomePage } from "./pages/HomePage";
import { TeamPage } from "./pages/TeamPage";
import { MeetingPage } from "./pages/MeetingPage";

type View = { name: "home" } | { name: "team"; teamId: string; meetingId?: string } | { name: "meeting"; teamId: string };

export interface StartOptions {
  title: string;
  durationMin: number;
  memberIds: string[];
  agentIds: TeammateId[];
}

const ACTIVE_TEAM_KEY = "teammate.activeTeam";

export function App() {
  const teams = useTeams();
  const [view, setView] = useState<View>({ name: "home" });
  const session = useSession({ onSpeak: (e) => speech.enqueue(e) });
  const { snapshot, send } = session;
  useEffect(() => speech.setSender(send), [send]);
  useWakeLock(IS_HOST && snapshot.phase === "live");

  // A meeting is live (we started it, or we joined / reloaded while it runs): show it.
  useEffect(() => {
    if (snapshot.phase !== "live" || view.name === "meeting") return;
    const teamId = localStorage.getItem(ACTIVE_TEAM_KEY) ?? teams[0]?.id;
    if (teamId) setView({ name: "meeting", teamId });
  }, [snapshot.phase, view.name, teams]);

  // The meeting ended and its summary is ready: file it under the team and go read it.
  const filed = useRef(false);
  useEffect(() => {
    if (snapshot.phase !== "ended") {
      filed.current = false;
      return;
    }
    if (!snapshot.decision || filed.current || view.name !== "meeting") return;
    filed.current = true;
    const team = teams.find((t) => t.id === view.teamId);
    const cfg = snapshot.config;
    if (!team || !cfg) return setView({ name: "home" });
    const last = snapshot.cards.at(-1)?.t ?? 0;
    const meeting = addMeeting(team.id, {
      title: cfg.goal,
      startedAt: snapshot.startedAt ?? Date.now(),
      durationMs: snapshot.startedAt ? Math.max(last, Date.now() - snapshot.startedAt) : last,
      memberIds: cfg.speakers.map((s) => s.id),
      agentIds: TEAMMATE_IDS.filter((id) => snapshot.cards.some((c) => c.teammate === id)),
      entries: cardsToEntries(snapshot.cards),
      decision: snapshot.decision,
    });
    if (IS_HOST) send({ type: "reset" });
    setView({ name: "team", teamId: team.id, meetingId: meeting.id });
  }, [snapshot, view, teams, send]);

  const start = useCallback(
    (teamId: string, opts: StartOptions) => {
      const team = teams.find((t) => t.id === teamId);
      if (!team) return;
      speech.unlock(); // we are inside a tap: lets iOS play the agents' voices later
      localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
      for (const id of TEAMMATE_IDS) {
        send({ type: "set_teammate", teammate: id, override: opts.agentIds.includes(id) ? "auto" : "off" });
      }
      const config: SessionConfig = {
        goal: opts.title,
        scope: team.scope,
        criteria: team.criteria,
        industry: team.industry,
        durationMin: opts.durationMin,
        speakers: team.members.filter((m) => opts.memberIds.includes(m.id)),
      };
      send({ type: "start_session", config });
      setView({ name: "meeting", teamId });
    },
    [teams, send],
  );

  if (LAB) return <Lab />;

  const team = view.name === "home" ? undefined : teams.find((t) => t.id === view.teamId);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view.name === "home" ? "home" : `${view.name}-${view.teamId}`}
        className="h-full"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.01 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {view.name === "meeting" && team ? (
          <MeetingPage session={session} team={team} />
        ) : view.name === "team" && team ? (
          <TeamPage
            team={team}
            initialMeetingId={view.meetingId}
            connected={session.connected}
            onBack={() => setView({ name: "home" })}
            onStart={(opts) => start(team.id, opts)}
          />
        ) : (
          <HomePage
            teams={teams}
            onOpenTeam={(teamId) => setView({ name: "team", teamId })}
            onAddTeam={(name) => setView({ name: "team", teamId: addTeam(name).id })}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
