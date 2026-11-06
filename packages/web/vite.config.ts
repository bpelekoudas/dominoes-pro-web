import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { BUILD_SHA_PATTERN, stampShell } from "./src/build-stamp";

const root = path.dirname(fileURLToPath(import.meta.url));

function gitBuildSha(): string {
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", { cwd: root, encoding: "utf8" }).trim();
    if (BUILD_SHA_PATTERN.test(sha)) return sha;
  } catch {
    // A build without git still has to ship a worker. The placeholder stays obvious.
  }
  return "dev0000";
}

function stampServiceWorker(sha: string): Plugin {
  return {
    name: "stamp-service-worker",
    apply: "build",
    closeBundle() {
      const file = path.join(root, "dist", "sw.js");
      writeFileSync(file, stampShell(readFileSync(file, "utf8"), sha));
    },
  };
}

const sha = gitBuildSha();

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
  },
  plugins: [react(), stampServiceWorker(sha)],
  server: {
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
      "/health": "http://127.0.0.1:8787",
      "/config.js": "http://127.0.0.1:8787",
      "/api": { target: "http://127.0.0.1:8787", xfwd: true },
    },
  },
});
