import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server listens on :8787. When the page is opened through an HTTPS tunnel
// (only one port exposed), the client connects to wss://<host>/ws instead and
// this proxy forwards it to the local server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      "/ws": { target: "ws://localhost:8787", ws: true, changeOrigin: true },
    },
  },
});
