import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  Accounts,
  appleConfigFromEnv,
  magicLinkDevMode,
  sessionCookie,
  type AccountOptions,
  type SignInResult,
} from "./accounts.js";
import { BOT_TURN_MS, Hub, type ClientMessage, type ServerMessage } from "./hub.js";
import { Store } from "./db.js";
import { publicBase } from "./public-url.js";

export interface AppOptions {
  store?: Store;
  accounts?: Accounts;
  /** Skip the static site. Tests use this. */
  serveWeb?: boolean;
}

export async function createApp(options: AppOptions = {}) {
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const dbFile = process.env.DB_FILE ?? path.join(dataDir, "uhoh.sqlite");
  if (!options.store && !process.env.DB_FILE && !existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const store = options.store ?? new Store(dbFile);
  const accounts =
    options.accounts ??
    new Accounts(store, {
      secret: loadSessionSecret(dataDir),
      googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
      apple: appleConfigFromEnv(),
      resendApiKey: process.env.RESEND_API_KEY ?? null,
      emailFrom: process.env.EMAIL_FROM ?? null,
      devMagicLink: !(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) && magicLinkDevMode(),
    } satisfies AccountOptions);

  const hub = new Hub(
    store,
    20_000,
    () => envMs("BOT_PACE_MS", BOT_TURN_MS),
    envMs("TURN_LIMIT_MS", 30_000),
    envMs("CONTINUE_MS", 9_000),
  );
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.get("/config.js", async (request, reply) => {
    const publicUrl = publicBase({
      publicUrl: process.env.PUBLIC_URL,
      proto: request.protocol,
      host: requestHost(request),
    });
    const auth = accounts.config();
    reply.type("application/javascript; charset=utf-8").header("cache-control", "no-store");
    return `window.__UHOH__=${JSON.stringify({
      showScoreMath: scoreMathOn(),
      publicUrl,
      googleClientId: auth.googleClientId,
      appleClientId: auth.appleClientId,
    })};\n`;
  });

  app.get("/api/me", async (request, reply) => {
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to see this profile." });
    return { user };
  });

  app.get("/api/auth/config", async () => accounts.config());

  app.post("/api/guest", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { displayName?: string };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    return sendAuth(reply, request, accounts.createGuest(body.displayName ?? "", current));
  });

  app.post("/api/profile", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to change your name." });
    const body = request.body as { displayName?: string };
    return sendAuth(reply, request, accounts.rename(user.id, body.displayName ?? ""));
  });

  app.post("/api/auth/google", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { idToken?: string; confirm?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.signInGoogle(body.idToken ?? "", current?.id ?? null, body.confirm === true);
    return sendAuth(reply, request, result);
  });

  app.post("/api/auth/apple", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { idToken?: string; confirm?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.signInApple(body.idToken ?? "", current?.id ?? null, body.confirm === true);
    return sendAuth(reply, request, result);
  });

  app.post("/api/auth/email", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { email?: string };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.requestMagicLink({
      email: body.email ?? "",
      currentUserId: current?.id ?? null,
      ip: request.ip || "unknown",
      origin: pageOrigin(request),
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return result.devLink ? { ok: true, devLink: result.devLink } : { ok: true };
  });

  app.post("/api/auth/email/consume", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { token?: string; confirm?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.consumeMagicLink(body.token ?? "", current?.id ?? null, body.confirm === true);
    return sendAuth(reply, request, result);
  });

  app.post("/api/logout", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    accounts.logout(request.headers.cookie);
    reply.header("set-cookie", sessionCookie("", request.protocol === "https", 0));
    return { ok: true };
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    let session: { playerId: string; generation: number } | null = null;
    const accountUserId = accounts.userFromCookieHeader(request.headers.cookie)?.id ?? null;
    let sawPong = true;
    const beat = setInterval(() => {
      if (socket.readyState !== 1) return;
      if (!sawPong) {
        socket.terminate();
        return;
      }
      sawPong = false;
      socket.ping();
    }, 20_000);
    beat.unref?.();
    socket.on("pong", () => {
      sawPong = true;
    });
    socket.on("close", () => clearInterval(beat));
    socket.on("error", () => undefined);

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
        const result = hub.connect(message, send, () => socket.close(), accountUserId);
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

  if (options.serveWeb !== false) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const webDist = path.resolve(here, "../../web/dist");
    if (existsSync(webDist)) {
      await app.register(fastifyStatic, { root: webDist });
      app.setNotFoundHandler((request, reply) => {
        if (request.method === "GET" && !request.url.startsWith("/ws")) return reply.sendFile("index.html");
        return reply.code(404).send({ error: "Not found" });
      });
    }
  }

  return { app, store, accounts, hub };
}

function sendAuth(reply: FastifyReply, request: FastifyRequest, result: SignInResult) {
  if (result.outcome === "not-configured") return reply.code(503).send({ error: result.error });
  if (result.outcome === "invalid") return reply.code(400).send({ error: result.error });
  if (result.outcome === "limited") return reply.code(429).send({ error: result.error });
  if (result.outcome === "already-claimed") {
    return reply.code(409).send({ outcome: "already-claimed", current: result.current, existing: result.existing });
  }
  if (result.token) reply.header("set-cookie", sessionCookie(result.token, request.protocol === "https", 30 * 24 * 60 * 60));
  return { user: result.user, outcome: "ok" as const };
}

function originOk(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return !origin;
  let host = "";
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const forwarded = request.headers["x-forwarded-host"];
  const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return host === request.headers.host || (!!forwardedHost && host === forwardedHost);
}

function requestHost(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-host"];
  const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  if (forwardedHost) return forwardedHost;
  const host = request.headers.host;
  return (Array.isArray(host) ? host[0] : host)?.trim() || request.hostname;
}

function pageOrigin(request: FastifyRequest): string {
  return (
    publicBase({
      publicUrl: process.env.PUBLIC_URL,
      proto: request.protocol,
      host: requestHost(request),
    }) || `${request.protocol}://${requestHost(request)}`
  );
}

function scoreMathOn(): boolean {
  const raw = (process.env.SHOW_SCORE_MATH ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function loadSessionSecret(dataDir: string): string {
  const fromEnv = process.env.SESSION_SECRET?.trim() ?? "";
  if (fromEnv.length >= 16) return fromEnv;
  const file = path.join(dataDir, ".session-secret");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (saved.length >= 16) return saved;
  }
  const generated = randomBytes(32).toString("hex");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "SESSION_SECRET is not set. A secret was saved on the disk. Set SESSION_SECRET in Render so a new disk does not sign everyone out.",
    );
  }
  return generated;
}

function toText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part)))).toString("utf8");
  return "";
}
