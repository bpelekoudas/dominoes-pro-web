import { createApp } from "./app.js";
import { huntReportedScores } from "./score-hunt.js";

const port = Number(process.env.PORT ?? 8787);
const { app, bots, store } = await createApp();
await app.listen({ port, host: "0.0.0.0" });
bots.start();
try {
  huntReportedScores(store);
} catch (error) {
  console.log(`SCOREHUNT failed ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
