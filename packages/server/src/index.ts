import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const { app } = await createApp();
await app.listen({ port, host: "0.0.0.0" });
