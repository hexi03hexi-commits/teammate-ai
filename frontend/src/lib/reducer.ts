import type { ServerEvent, SessionSnapshot } from "@teammate/shared";

/** Events that change session state. transcript / speak / error are side-channel only. */
export type StateEvent = Extract<
  ServerEvent,
  { type: "snapshot" | "teammate_state" | "main_state" | "card" | "card_update" | "decision" }
>;

export function reduceSession(s: SessionSnapshot, e: StateEvent): SessionSnapshot {
  switch (e.type) {
    case "snapshot":
      return e.snapshot;
    case "main_state":
      return { ...s, main: e.status };
    case "teammate_state":
      return { ...s, teammates: { ...s.teammates, [e.teammate]: e.state } };
    case "card": {
      const i = s.cards.findIndex((c) => c.id === e.card.id);
      const cards = i === -1 ? [...s.cards, e.card] : s.cards.map((c, j) => (j === i ? e.card : c));
      return { ...s, cards };
    }
    case "card_update":
      return { ...s, cards: s.cards.map((c) => (c.id === e.id ? { ...c, status: e.status } : c)) };
    case "decision":
      return { ...s, decision: e.decision };
  }
}
