import { writeBackup } from "./backup.js";
import { createApp, drainServer } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { app, bots, hub, lifecycle, store, dataDir } = await createApp();
await app.listen({ port, host: "0.0.0.0" });
console.log(`[data] sqlite directory ${dataDir}`);
bots.start();

const backupEvery = envMs("BACKUP_EVERY_MS", 6 * 60 * 60 * 1000);
if (backupEvery > 0) {
  const first = setTimeout(() => {
    void saveBackup("scheduled");
  }, 30_000);
  first.unref();
  const timer = setInterval(() => {
    void saveBackup("scheduled");
  }, backupEvery);
  timer.unref();
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[server] ${signal}: closing connections`);
  const forced = setTimeout(() => process.exit(0), 8_000);
  forced.unref();
  try {
    await saveBackup("shutdown");
    await drainServer({ app, hub, lifecycle });
  } catch (error) {
    console.warn(`[server] close failed (${error instanceof Error ? error.message : "unknown"}).`);
  }
  clearTimeout(forced);
  process.exit(0);
}

async function saveBackup(reason: string): Promise<void> {
  try {
    const file = await writeBackup(store.db, dataDir);
    console.log(`[backup] ${reason} ${file}`);
  } catch (error) {
    console.warn(`[backup] ${reason} failed (${error instanceof Error ? error.message : "unknown"}).`);
  }
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

// Node exits on SIGTERM immediately unless something handles it. Render sends
// that signal when the new instance is ready, and an instant exit drops the
// sockets the proxy still had open.
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
