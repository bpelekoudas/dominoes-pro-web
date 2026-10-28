import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
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
import { BotLeague, leaderboardIncludesBots } from "./bots.js";
import { BOT_TURN_MS, Hub, QUICK_BOT_FILL_MS, cleanSoakRun, type ClientMessage, type ServerMessage } from "./hub.js";
import { Cosmetics } from "./cosmetics.js";
import { Store } from "./db.js";
import { leaderboard } from "./ranking.js";
import { legalHtml } from "./legal.js";
import { aliasRedirect, canonicalPage, publicBase, PUBLISHED_ORIGINS, withCanonical } from "./public-url.js";
import { cleanPulseNote, pulseName } from "./pulse.js";
import { CoinShop, shopFromEnv, WEBHOOK_PATH } from "./stripe-shop.js";
import {
  accountEmails,
  adminDeniedMessage,
  collectAdminStats,
  noteAgeBlocked,
  notePresence,
  noteServerError,
  userIsAdmin,
} from "./admin.js";
import { adminDashboardHtml, adminSignInHtml } from "./admin-page.js";

export interface AppOptions {
  store?: Store;
  accounts?: Accounts;
  /** Skip the static site. Tests use this. */
  serveWeb?: boolean;
  /** Tests pass a shop. Production builds one from the environment. */
  shop?: CoinShop;
}

/** Shared with the process signal handler. Health fails while this is draining. */
export interface ServerLifecycle {
  draining: boolean;
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

  const cosmetics = new Cosmetics(store);
  const shop =
    options.shop ??
    (await shopFromEnv(store, {
      secretKey: process.env.VITEST === "true" ? null : process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.VITEST === "true" ? null : process.env.STRIPE_WEBHOOK_SECRET,
    }));
  const hub = new Hub(
    store,
    20_000,
    () => envMs("BOT_PACE_MS", BOT_TURN_MS),
    envMs("TURN_LIMIT_MS", 30_000),
    envMs("CONTINUE_MS", 9_000),
    envMs("QUICK_WAIT_MS", 60_000),
    envMs("QUICK_BOT_FILL_MS", QUICK_BOT_FILL_MS),
  );
  const bots = new BotLeague(store, hub, cosmetics);
  const lifecycle: ServerLifecycle = { draining: false };
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });
  await app.register(websocket);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (requestPath(request.url) === WEBHOOK_PATH) {
      done(null, raw);
      return;
    }
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw.toString("utf8")) as unknown);
    } catch {
      const error = new Error("That message could not be read.") as Error & { statusCode: number };
      error.statusCode = 400;
      done(error);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const target = aliasRedirect(requestHost(request), request.url);
    if (target) return reply.redirect(target, 301);
  });

  app.get("/health", async (_request, reply) => {
    if (lifecycle.draining) return reply.code(503).send({ ok: false });
    return { ok: true };
  });

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
    notePresence(store, user.id);
    return { user };
  });

  app.get("/admin", async (request, reply) => {
    reply.header("cache-control", "no-store").header("x-robots-tag", "noindex");
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).type("text/html; charset=utf-8").send(adminSignInHtml());
    if (!userIsAdmin(store, user.id)) {
      return reply.code(403).type("text/plain; charset=utf-8").send(adminDeniedMessage(accountEmails(store, user.id)));
    }
    return reply.type("text/html; charset=utf-8").send(adminDashboardHtml());
  });

  app.get("/api/admin/stats", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to see this." });
    if (!userIsAdmin(store, user.id)) {
      return reply.code(403).send({ error: adminDeniedMessage(accountEmails(store, user.id)) });
    }
    const shape = shop.statusReport().secretKey;
    return collectAdminStats({ store, hub, dataDir, dbFile, shopShape: shape });
  });

  app.get("/api/open-tables", async (request) => {
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    return { tables: hub.openTables(user?.id ?? null) };
  });

  app.addHook("onResponse", async (_request, reply) => {
    if (reply.statusCode < 500) return;
    noteServerError(store);
  });

  app.get("/api/leaderboard", async (request) => {
    const query = request.query as { board?: string; bots?: string };
    const board = query.board === "season" ? "season" : "rating";
    const includeBots = leaderboardIncludesBots() && query.bots !== "0" && query.bots !== "false";
    return { board, ...leaderboard(store, board, new Date(), 50, includeBots) };
  });

  app.get("/api/bots/summary", async () => bots.summary());

  app.post("/api/admin/bots/purge", async (request, reply) => {
    const expected = process.env.BOT_ADMIN_TOKEN?.trim() ?? "";
    if (!expected) return reply.code(404).send({ error: "Not found." });
    const header = request.headers["x-bot-admin"];
    const token = Array.isArray(header) ? header[0] : header;
    if (token !== expected) return reply.code(403).send({ error: "Not allowed." });
    return bots.purge();
  });

  app.get("/api/auth/config", async () => accounts.config());

  app.post("/api/soak/cleanup", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = (request.body ?? {}) as { runId?: string };
    const runId = cleanSoakRun(body.runId);
    if (!runId) return reply.code(400).send({ error: "Name the soak run to clean up." });
    const dropped = hub.dropSoakRooms(runId);
    const purged = store.purgeSoak(runId);
    return { dropped, ...purged };
  });

  app.post("/api/guest", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { displayName?: string; soakRun?: string; age13?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    return sendAuth(
      reply,
      request,
      accounts.createGuest(body.displayName ?? "", current, cleanSoakRun(body.soakRun), body.age13 === true),
      store,
    );
  });

  app.post("/api/profile", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to change your name." });
    const body = request.body as { displayName?: string; avatarId?: string };
    if (typeof body.avatarId === "string") {
      const saved = accounts.setAvatar(user.id, body.avatarId);
      if (saved.outcome !== "ok" || typeof body.displayName !== "string") return sendAuth(reply, request, saved, store);
    }
    return sendAuth(reply, request, accounts.rename(user.id, body.displayName ?? ""), store);
  });

  app.get("/api/store/status", async () => shop.statusReport());

  app.get("/api/store", async (request, reply) => {
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to open the store." });
    return cosmetics.snapshot(user.id);
  });

  app.post("/api/store/buy", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to open the store." });
    const body = request.body as { itemId?: string; currency?: string };
    const currency = body.currency === "gold" ? "gold" : body.currency === "bones" ? "bones" : null;
    if (!currency || typeof body.itemId !== "string") return reply.code(400).send({ error: "Pick an item and a currency." });
    const result = cosmetics.buy(user.id, body.itemId, currency);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.snapshot;
  });

  app.post("/api/store/equip", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to open the store." });
    const body = request.body as { itemId?: string };
    if (typeof body.itemId !== "string") return reply.code(400).send({ error: "Pick an item." });
    const result = cosmetics.equip(user.id, body.itemId);
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return result.snapshot;
  });

  app.post("/api/auth/google", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { idToken?: string; confirm?: boolean; age13?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.signInGoogle(body.idToken ?? "", current?.id ?? null, body.confirm === true, body.age13 === true);
    return sendAuth(reply, request, result, store);
  });

  app.post("/api/auth/apple", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { idToken?: string; confirm?: boolean; age13?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.signInApple(body.idToken ?? "", current?.id ?? null, body.confirm === true, body.age13 === true);
    return sendAuth(reply, request, result, store);
  });

  app.post("/api/auth/email", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { email?: string; age13?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.requestMagicLink({
      email: body.email ?? "",
      currentUserId: current?.id ?? null,
      ip: request.ip || "unknown",
      origin: pageOrigin(request),
      age13: body.age13 === true,
    });
    if (!result.ok) {
      if (/13 or older/i.test(result.error)) noteAgeBlocked(store);
      return reply.code(result.status).send({ error: result.error });
    }
    return result.devLink ? { ok: true, devLink: result.devLink } : { ok: true };
  });

  app.post("/api/auth/email/consume", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const body = request.body as { token?: string; confirm?: boolean; age13?: boolean };
    const current = accounts.userFromCookieHeader(request.headers.cookie);
    const result = await accounts.consumeMagicLink(body.token ?? "", current?.id ?? null, body.confirm === true, body.age13 === true);
    return sendAuth(reply, request, result, store);
  });

  app.post("/api/account/delete", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to delete this account." });
    const body = (request.body ?? {}) as { confirm?: boolean };
    if (body.confirm !== true) return reply.code(400).send({ error: "Confirm that you want the account deleted." });
    const erased = store.erasePersonalData(user.id, new Date().toISOString());
    if (!erased) return reply.code(400).send({ error: "That account cannot be deleted." });
    hub.scrubUser(user.id);
    accounts.logout(request.headers.cookie);
    reply.header("set-cookie", sessionCookie("", request.protocol === "https", 0));
    return { ok: true };
  });

  app.post("/api/safety/report", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to report a player." });
    const body = (request.body ?? {}) as { playerId?: string; reason?: string };
    const reason = body.reason === "rude" || body.reason === "cheat" || body.reason === "other" ? body.reason : null;
    if (!reason || typeof body.playerId !== "string") return reply.code(400).send({ error: "Pick a reason." });
    const seat = store.playerById(body.playerId);
    if (!seat?.user_id) return reply.code(400).send({ error: "That seat cannot be reported." });
    if (seat.user_id === user.id) return reply.code(400).send({ error: "You cannot report yourself." });
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if (store.reportCountSince(user.id, since) >= 8) return reply.code(429).send({ error: "Wait a while before another report." });
    const room = store.room(seat.room_id);
    store.insertReport({
      id: randomUUID(),
      reporterUserId: user.id,
      reportedUserId: seat.user_id,
      roomCode: room?.code ?? null,
      reason,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  app.post("/api/safety/block", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to block a player." });
    const body = (request.body ?? {}) as { playerId?: string };
    if (typeof body.playerId !== "string") return reply.code(400).send({ error: "Pick a player." });
    const seat = store.playerById(body.playerId);
    if (!seat?.user_id) return reply.code(400).send({ error: "That seat cannot be blocked." });
    if (seat.user_id === user.id) return reply.code(400).send({ error: "You cannot block yourself." });
    store.blockUser(user.id, seat.user_id, new Date().toISOString());
    return { ok: true };
  });

  app.post("/api/pulse", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    if (!pulseAllowed(request.ip)) return reply.code(429).send({ error: "Slow down." });
    const body = (request.body ?? {}) as { name?: unknown; message?: unknown };
    const name = pulseName(body.name);
    if (!name) return reply.code(400).send({ error: "That count is not used." });
    const day = new Date().toISOString().slice(0, 10);
    store.bumpPulse(name, day);
    if (name === "error") {
      const note = cleanPulseNote(body.message) || "error";
      store.noteClientError(randomUUID(), note, new Date().toISOString());
    }
    return { ok: true };
  });

  app.post("/api/logout", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    accounts.logout(request.headers.cookie);
    reply.header("set-cookie", sessionCookie("", request.protocol === "https", 0));
    return { ok: true };
  });

  app.get("/terms", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").header("cache-control", "no-cache");
    return legalHtml("terms");
  });

  app.get("/privacy", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").header("cache-control", "no-cache");
    return legalHtml("privacy");
  });

  app.get("/api/shop", async (request, reply) => {
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in to open the store." });
    return shop.catalog();
  });

  app.post("/api/shop/checkout", async (request, reply) => {
    if (!originOk(request)) return reply.code(403).send({ error: "That request came from somewhere else." });
    const user = accounts.userFromCookieHeader(request.headers.cookie);
    if (!user) return reply.code(401).send({ error: "Sign in or continue as a guest, then buy Gold Bones." });
    const body = (request.body ?? {}) as { lookupKey?: unknown };
    const lookupKey = typeof body.lookupKey === "string" ? body.lookupKey : "";
    const result = await shop.startCheckout(user.id, lookupKey);
    if ("error" in result) return reply.code(result.status).send({ error: result.error });
    return { url: result.url };
  });

  app.post(WEBHOOK_PATH, async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    const header = Array.isArray(signature) ? signature[0] : signature;
    if (!Buffer.isBuffer(request.body)) return reply.code(400).send({ error: "The signature did not match." });
    const result = shop.receive(request.body, header);
    return reply.code(result.status).send(result.body);
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    if (!originOk(request)) {
      socket.close(1008, "That request came from somewhere else.");
      return;
    }
    let session: { playerId: string; generation: number } | null = null;
    const accountUserId = accounts.userFromCookieHeader(request.headers.cookie)?.id ?? null;
    if (accountUserId) notePresence(store, accountUserId);
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
        const result = hub.connect(
          message,
          send,
          () => {
            if (lifecycle.draining) socket.close(1001, "Server is restarting.");
            else socket.close();
          },
          accountUserId,
        );
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
      const indexFile = path.join(webDist, "index.html");
      app.setNotFoundHandler((request, reply) => {
        if (request.method === "GET" && !request.url.startsWith("/ws") && existsSync(indexFile)) {
          reply.type("text/html; charset=utf-8").header("cache-control", "no-cache");
          return reply.send(withCanonical(readFileSync(indexFile, "utf8"), canonicalPage(request.url)));
        }
        return reply.code(404).send({ error: "Not found" });
      });
    }
  }

  bots.setHealth(async () => {
    const started = performance.now();
    const response = await app.inject({ method: "GET", url: "/health" });
    return { status: response.statusCode, ms: Math.round(performance.now() - started) };
  });

  return { app, store, accounts, hub, bots, shop, lifecycle, dataDir: path.dirname(dbFile) };
}

/** Stop taking traffic, close seats so they reconnect, then close the HTTP server. */
export async function drainServer(parts: {
  app: { close: () => Promise<void> };
  hub: Hub;
  lifecycle: ServerLifecycle;
}): Promise<void> {
  parts.lifecycle.draining = true;
  parts.hub.closeConnections();
  await parts.app.close();
}

function requestPath(url: string): string {
  return (url.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
}

function sendAuth(reply: FastifyReply, request: FastifyRequest, result: SignInResult, store: Store) {
  if (result.outcome === "not-configured") return reply.code(503).send({ error: result.error });
  if (result.outcome === "invalid") {
    if (/13 or older/i.test(result.error)) noteAgeBlocked(store);
    return reply.code(400).send({ error: result.error });
  }
  if (result.outcome === "limited") return reply.code(429).send({ error: result.error });
  if (result.outcome === "already-claimed") {
    return reply.code(409).send({ outcome: "already-claimed", current: result.current, existing: result.existing });
  }
  if (result.token) reply.header("set-cookie", sessionCookie(result.token, request.protocol === "https", 30 * 24 * 60 * 60));
  return { user: result.user, outcome: "ok" as const };
}

const pulseHits = new Map<string, { at: number; n: number }>();

function pulseAllowed(ip: string): boolean {
  const now = Date.now();
  const row = pulseHits.get(ip);
  if (!row || now - row.at > 60_000) {
    if (pulseHits.size > 500) pulseHits.clear();
    pulseHits.set(ip, { at: now, n: 1 });
    return true;
  }
  row.n += 1;
  return row.n <= 30;
}

function originOk(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin || Array.isArray(origin)) return !origin;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if ((PUBLISHED_ORIGINS as readonly string[]).includes(parsed.origin)) return true;
  const forwarded = request.headers["x-forwarded-host"];
  const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return parsed.host === request.headers.host || (!!forwardedHost && parsed.host === forwardedHost);
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
