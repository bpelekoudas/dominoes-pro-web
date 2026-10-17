import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { Hub, type ClientMessage, type ServerMessage } from "./hub.js";
import { Store } from "./db.js";

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbFile = process.env.DB_FILE ?? path.join(dataDir, "uhoh.sqlite");

if (!process.env.DB_FILE && !existsSync(dataDir)) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dataDir, { recursive: true });
}

const store = new Store(dbFile);
const hub = new Hub(store);
const app = Fastify({ logger: true });

await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/ws", { websocket: true }, (socket) => {
  let session: { playerId: string; generation: number } | null = null;

  const send = (message: ServerMessage): void => {
    if (socket.readyState === 1) socket.send(JSON.stringify(message));
  };

  socket.on("message", (raw: unknown) => {
    const text = toText(raw);
    if (text.length > 4_000) {
      send({ type: "error", message: "That message is too long." });
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(text) as ClientMessage;
    } catch {
      send({ type: "error", message: "That message could not be read." });
      return;
    }
    if (!session) {
      const result = hub.connect(message, send, () => socket.close());
      if (!result.ok) {
        send({ type: "error", message: result.error });
        return;
      }
      session = result.session;
      return;
    }
    hub.command(session.playerId, message);
  });

  socket.on("close", () => {
    if (session) hub.disconnect(session.playerId, session.generation);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/ws")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
}

await app.listen({ port, host: "0.0.0.0" });

function toText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part)))).toString("utf8");
  return "";
}
