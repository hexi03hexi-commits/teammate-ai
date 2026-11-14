import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { emptySnapshot, type ClientMessage, type ServerEvent, type SessionSnapshot, type Utterance } from "@teammate/shared";
import { reduceSession } from "../lib/reducer";
import { ROLE, wsUrl } from "../lib/env";
import type { SpeakEvent } from "../lib/speech";

const RECONNECT_MS = 1500;

export interface Session {
  snapshot: SessionSnapshot;
  connected: boolean;
  send: (msg: ClientMessage) => void;
  /** Host only: one chunk of microphone audio (16 kHz mono 16-bit PCM). */
  sendAudio: (pcm: ArrayBuffer) => void;
  /** The most recent thing someone said. Drives "who is talking" and the keyword chips; the sentence itself is never shown. */
  heard: Utterance | null;
}

export function useSession(opts: { onSpeak?: (e: SpeakEvent) => void } = {}): Session {
  const [snapshot, dispatch] = useReducer(reduceSession, undefined, emptySnapshot);
  const [connected, setConnected] = useState(false);
  const [heard, setHeard] = useState<Utterance | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const onSpeak = useRef(opts.onSpeak);
  useEffect(() => {
    onSpeak.current = opts.onSpeak;
  });

  const handle = useCallback((e: ServerEvent) => {
    switch (e.type) {
      case "transcript":
        setHeard(e.utterance);
        return;
      case "speak":
        if (ROLE === "host") onSpeak.current?.(e);
        return;
      case "error":
        console.warn("[server]", e.message);
        return;
      default:
        dispatch(e);
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    let disposed = false;

    const connect = () => {
      const sock = new WebSocket(wsUrl());
      socket.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ type: "hello", role: ROLE } satisfies ClientMessage));
      };
      sock.onmessage = (m) => {
        try {
          handle(JSON.parse(String(m.data)) as ServerEvent);
        } catch (err) {
          console.warn("[ws] bad message", err);
        }
      };
      sock.onclose = () => {
        setConnected(false);
        if (!disposed) timer = window.setTimeout(connect, RECONNECT_MS);
      };
      sock.onerror = () => sock.close();
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      socket.current?.close();
    };
  }, [handle]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else console.warn("[ws] dropped (offline)", msg.type);
  }, []);

  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    const ws = socket.current;
    // Audio is only useful live: drop it while offline or while the socket is backed up.
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 256_000) ws.send(pcm);
  }, []);

  return { snapshot, connected, send, sendAudio, heard };
}
