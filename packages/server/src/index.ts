import { createApp, drainServer } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { app, bots, hub, lifecycle } = await createApp();
await app.listen({ port, host: "0.0.0.0" });
bots.start();

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.log(`[server] ${signal}: closing connections`);
  const forced = setTimeout(() => process.exit(0), 8_000);
  forced.unref();
  try {
    await drainServer({ app, hub, lifecycle });
  } catch (error) {
    console.warn(`[server] close failed (${error instanceof Error ? error.message : "unknown"}).`);
  }
  clearTimeout(forced);
  process.exit(0);
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
