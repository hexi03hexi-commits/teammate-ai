import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// The server listens on :8787. When the page is opened over HTTPS (a tunnel, or
// `npm run dev:https`), only this port is reachable, so the client connects to
// wss://<host>/ws and reads /health from the same origin; this proxy forwards both.
//
// `--mode https` serves the page with a self-signed certificate. Browsers only allow the
// microphone on https or localhost, so the iPad needs this to listen on the local network.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "https" ? [basicSsl()] : [])],
  server: {
    host: true,
    proxy: {
      "/ws": { target: "ws://localhost:8787", ws: true, changeOrigin: true },
      "/health": { target: "http://localhost:8787", changeOrigin: true },
      "/voiceprints": { target: "http://localhost:8787", changeOrigin: true },
      "/audio": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
}));
