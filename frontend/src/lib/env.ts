import { DEFAULT_PORT, type ClientRole } from "@teammate/shared";

const params = new URLSearchParams(window.location.search);

/** ?role=viewer → viewer; anything else → host (the iPad that listens and speaks). */
export const ROLE: ClientRole = params.get("role") === "viewer" ? "viewer" : "host";
export const IS_HOST = ROLE === "host";

/** ?lab=1 (dev only): the agent figure gallery, for tuning the look of each agent and state. */
export const LAB = import.meta.env.DEV && params.get("lab") === "1";

/**
 * WebSocket URL.
 * - ?ws=wss://... overrides everything (handy for tunnels).
 * - https pages (tunnel) → same origin /ws, proxied by Vite to :8787.
 * - otherwise → ws://<page hostname>:8787.
 */
export function wsUrl(): string {
  const override = params.get("ws");
  if (override) return override;
  if (window.location.protocol === "https:") return `wss://${window.location.host}/ws`;
  return `ws://${window.location.hostname}:${DEFAULT_PORT}`;
}

/** A plain HTTP path on the session server (e.g. "/health"), reached the same way as the WebSocket. */
export function serverUrl(path: string): string {
  const override = params.get("ws");
  if (override) return new URL(path, override.replace(/^ws/, "http")).toString();
  if (window.location.protocol === "https:") return path;
  return `http://${window.location.hostname}:${DEFAULT_PORT}${path}`;
}

export const healthUrl = () => serverUrl("/health");
