import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
      "/health": "http://127.0.0.1:8787",
      "/config.js": "http://127.0.0.1:8787",
      "/api": { target: "http://127.0.0.1:8787", xfwd: true },
    },
  },
});
