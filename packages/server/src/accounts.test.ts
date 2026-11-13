import { unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { shuffleWithSeed } from "@uhoh/rules";
import { Accounts, SESSION_COOKIE, type PublicUser, type SignInResult } from "./accounts.js";
import { createApp, drainServer } from "./app.js";
import { Store } from "./db.js";
import { Hub, type ServerMessage } from "./hub.js";

const SECRET = "test-secret-value-16";

function accountsFor(store: Store, extra: ConstructorParameters<typeof Accounts>[1] = { secret: SECRET }): Accounts {
  return new Accounts(store, { secret: SECRET, devMagicLink: true, ...extra });
}

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

function welcomeCode(messages: ServerMessage[]): string {
  const welcome = messages.find((message) => message.type === "welcome");
  if (!welcome || welcome.type !== "welcome") throw new Error("No welcome.");
  return welcome.roomCode;
}

describe("accounts", () => {
  it("starts on 2 Hot 4 TV and keeps a chosen look", () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const created = accounts.createGuest("Ada", null);
    expect(created.outcome).toBe("ok");
    if (created.outcome !== "ok" || !created.token) throw new Error("Guest was not created.");
    expect(created.user.avatarId).toBe("2hot4tv");
    const saved = accounts.setAvatar(created.user.id, "golfer");
    expect(saved.outcome).toBe("ok");
    if (saved.outcome !== "ok") throw new Error("Look was not saved.");
    expect(saved.user.avatarId).toBe("golfer");
    expect(accounts.userFromCookieValue(created.token)?.avatarId).toBe("golfer");
    expect(accounts.setAvatar(created.user.id, "nope").outcome).toBe("invalid");
  });

  it("treats a signed-in account as already 13 or older, and saves a guest confirmation", () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const created = accounts.createGuest("Bryan", null, null, true);
    expect(created.outcome).toBe("ok");
    if (created.outcome !== "ok" || !created.token) throw new Error("Guest was not created.");
    store.db.prepare(`UPDATE users SET is_guest = 0, age_ok = 0 WHERE id = ?`).run(created.user.id);
    store.insertIdentity({
      id: "id-google",
      user_id: created.user.id,
      provider: "google",
      provider_subject: "bryan-sub",
      email: "bryan@gmail.com",
      created_at: new Date().toISOString(),
    });
    const healed = accounts.userFromCookieValue(created.token);
    expect(healed?.ageOk).toBe(true);
    expect(healed?.guest).toBe(false);
    expect(store.user(created.user.id)?.age_ok).toBe(1);

    const guest = accounts.createGuest("Ada", null, null, true);
    if (guest.outcome !== "ok") throw new Error("Guest was not created.");
    store.db.prepare(`UPDATE users SET age_ok = 0 WHERE id = ?`).run(guest.user.id);
    expect(accounts.userFromCookieValue(guest.token ?? "")?.ageOk).toBe(false);
    expect(accounts.confirmAge(guest.user.id)?.ageOk).toBe(true);
    expect(store.user(guest.user.id)?.age_ok).toBe(1);
  });

  it("keeps the same guest across a later visit", () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const created = accounts.createGuest("Bryan", null);
    expect(created.outcome).toBe("ok");
    if (created.outcome !== "ok" || !created.token) throw new Error("Guest was not created.");
    const again = accounts.userFromCookieValue(created.token);
    expect(again?.id).toBe(created.user.id);
    expect(again?.guest).toBe(true);
    expect(again?.displayName).toBe("Bryan");
    const renamed = accounts.createGuest("Bry", again);
    expect(renamed.outcome).toBe("ok");
    if (renamed.outcome !== "ok") throw new Error("Rename failed.");
    expect(renamed.user.id).toBe(created.user.id);
    expect(renamed.token).toBeNull();
    expect(accounts.userFromCookieValue(created.token)?.displayName).toBe("Bry");
    const users = store.db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(users.n).toBe(1);
    const raw = created.token.split(".")[1] ?? "";
    const saved = JSON.stringify(store.db.prepare(`SELECT token_hash FROM sessions`).all());
    expect(saved.includes(raw)).toBe(false);
    expect(saved.includes(created.token)).toBe(false);
  });

  it("claims a guest with Google and keeps the same user id", async () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store, {
      secret: SECRET,
      googleClientId: "google-client",
      verifyGoogle: async () => ({ sub: "google-sub-1", email: "bryan@example.com" }),
    });
    const guest = accounts.createGuest("Nick", null);
    if (guest.outcome !== "ok") throw new Error("Guest was not created.");
    const claimed = await accounts.signInGoogle("fake-id-token", guest.user.id, false);
    expect(claimed.outcome).toBe("ok");
    if (claimed.outcome !== "ok") throw new Error("Claim failed.");
    expect(claimed.user.id).toBe(guest.user.id);
    expect(claimed.user.guest).toBe(false);
    expect(claimed.user.displayName).toBe("Nick");
    expect(claimed.user.providers).toContain("google");
    const users = store.db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(users.n).toBe(1);
    expect(store.identity("google", "google-sub-1")?.user_id).toBe(guest.user.id);

    const other = accounts.createGuest("Other", null);
    if (other.outcome !== "ok") throw new Error("Second guest was not created.");
    const blocked = await accounts.signInGoogle("fake-id-token", other.user.id, false);
    expect(blocked.outcome).toBe("already-claimed");
    if (blocked.outcome !== "already-claimed") throw new Error("Expected a choice.");
    expect(blocked.existing.id).toBe(guest.user.id);
    expect(store.identity("google", "google-sub-1")?.user_id).toBe(guest.user.id);
    expect(accounts.userFromCookieValue(other.token!)?.id).toBe(other.user.id);

    const switched = await accounts.signInGoogle("fake-id-token", other.user.id, true);
    expect(switched.outcome).toBe("ok");
    if (switched.outcome !== "ok") throw new Error("Switch failed.");
    expect(switched.user.id).toBe(guest.user.id);
    expect(store.user(other.user.id)?.id).toBe(other.user.id);
  });

  it("signs in with an email link and refuses the link the second time", async () => {
    const store = new Store(":memory:");
    let sent = "";
    const accounts = accountsFor(store, {
      secret: SECRET,
      devMagicLink: false,
      sendEmail: async (_to, link) => {
        sent = link;
      },
    });
    const guest = accounts.createGuest("Ada", null);
    if (guest.outcome !== "ok") throw new Error("Guest was not created.");
    const requested = await accounts.requestMagicLink({
      email: "Ada@Example.com",
      currentUserId: guest.user.id,
      ip: "203.0.113.8",
      origin: "https://uhoh-dominoes.onrender.com",
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error("Link was not requested.");
    expect(requested.devLink).toBeUndefined();
    const token = new URL(sent).searchParams.get("email-token");
    expect(token).toBeTruthy();
    const consumed = await accounts.consumeMagicLink(token!, guest.user.id, false);
    expect(consumed.outcome).toBe("ok");
    if (consumed.outcome !== "ok") throw new Error("Link was not accepted.");
    expect(consumed.user.id).toBe(guest.user.id);
    expect(consumed.user.guest).toBe(false);
    expect(consumed.user.displayName).toBe("Ada");
    const again = await accounts.consumeMagicLink(token!, guest.user.id, false);
    expect(again.outcome).toBe("invalid");
  });

  it("returns a test link only when email sending is off and dev mode is on", async () => {
    const store = new Store(":memory:");
    const open = accountsFor(store, { secret: SECRET, devMagicLink: true });
    const shown = await open.requestMagicLink({
      email: "test@example.com",
      currentUserId: null,
      ip: "203.0.113.9",
      origin: "http://127.0.0.1:8787",
    });
    expect(shown.ok && shown.devLink).toBeTruthy();

    const shut = accountsFor(new Store(":memory:"), { secret: SECRET, devMagicLink: false });
    const refused = await shut.requestMagicLink({
      email: "test@example.com",
      currentUserId: null,
      ip: "203.0.113.9",
      origin: "https://uhoh-dominoes.onrender.com",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("Email should be unavailable.");
    expect(refused.status).toBe(503);
    expect(refused.error).toBe("Email sign-in is not available yet.");
  });

  it("answers a refused magic-link send with a clean error, not a 502", async () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store, {
      secret: SECRET,
      devMagicLink: false,
      resendApiKey: "re_test",
      emailFrom: "login@example.com",
      sendEmail: async () => {
        throw new Error("domain is not verified");
      },
    });
    const refused = await accounts.requestMagicLink({
      email: "bryan@example.com",
      currentUserId: null,
      ip: "203.0.113.10",
      origin: "https://uhohdominoes.com",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("The send should have failed.");
    expect(refused.status).not.toBe(502);
    expect(refused.status).toBe(503);
    expect(refused.error).toBe("Email sign-in is temporarily unavailable, try Google or play as guest");

    const { app } = await createApp({ store, accounts, serveWeb: false });
    const mailed = await app.inject({
      method: "POST",
      url: "/api/auth/email",
      headers: { host: "uhohdominoes.com", "x-forwarded-proto": "https" },
      payload: { email: "player@example.com", age13: true },
    });
    expect(mailed.statusCode).toBe(503);
    expect(mailed.json().error).toBe("Email sign-in is temporarily unavailable, try Google or play as guest");
    await app.close();
  });

  it("rejects a bad session and an expired session", () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    expect(accounts.userFromCookieValue("nope")).toBeNull();
    expect(accounts.userFromCookieValue("v1.aaaa.bbbb")).toBeNull();
    const created = accounts.createGuest("Pat", null);
    if (created.outcome !== "ok" || !created.token) throw new Error("Guest was not created.");
    store.db.prepare(`UPDATE sessions SET expires_at = ?`).run("2000-01-01T00:00:00.000Z");
    expect(accounts.userFromCookieValue(created.token)).toBeNull();
    const apple = accounts.signInApple("token", null, false);
    return expect(apple).resolves.toMatchObject({ outcome: "not-configured" });
  });

  it("starts from an old database, then a guest can sit down on that account", () => {
    const file = `/tmp/uhoh-accounts-old-${Date.now()}.sqlite`;
    const deck = shuffleWithSeed(Buffer.alloc(32, 7));
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL, series_id TEXT NOT NULL,
        player_count INTEGER NOT NULL, boneyard_mode TEXT NOT NULL, series_length INTEGER NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE players (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
        seat INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE hands (
        id TEXT PRIMARY KEY, room_id TEXT NOT NULL, series_id TEXT NOT NULL, game_number INTEGER NOT NULL,
        hand_number INTEGER NOT NULL, seed TEXT NOT NULL, deck_json TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE actions (
        hand_id TEXT NOT NULL, seq INTEGER NOT NULL, player_id TEXT NOT NULL, payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (hand_id, seq)
      );
    `);
    const stamp = "2020-01-01T00:00:00.000Z";
    raw.prepare(
      `INSERT INTO rooms (id, code, host_id, series_id, player_count, boneyard_mode, series_length, status, created_at)
       VALUES ('r_old', 'OLDROOM', 'p_old', 's_old', 2, 'draw_one', 3, 'playing', ?)`,
    ).run(stamp);
    raw.prepare(
      `INSERT INTO players (id, room_id, name, token, seat, created_at) VALUES ('p_old', 'r_old', 'Pat', ?, 0, ?)`,
    ).run("o".repeat(32), stamp);
    raw.prepare(
      `INSERT INTO players (id, room_id, name, token, seat, created_at) VALUES ('p_old2', 'r_old', 'Jo', ?, 1, ?)`,
    ).run("q".repeat(32), stamp);
    raw.prepare(
      `INSERT INTO hands (id, room_id, series_id, game_number, hand_number, seed, deck_json, result_json, created_at)
       VALUES ('h_old', 'r_old', 's_old', 1, 1, ?, ?, NULL, ?)`,
    ).run(Buffer.alloc(32, 7).toString("hex"), JSON.stringify(deck), stamp);
    raw.prepare(
      `INSERT INTO actions (hand_id, seq, player_id, payload_json, created_at) VALUES ('h_old', 1, 'not-seated', ?, ?)`,
    ).run(JSON.stringify({ type: "play", tileId: deck[0], endId: "lead" }), stamp);
    raw.close();

    const store = new Store(file);
    expect(() => new Hub(store, 30)).not.toThrow();
    expect(store.room("r_old")?.status).toBe("abandoned");
    const columns = store.db.prepare(`PRAGMA table_info(players)`).all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "user_id")).toBe(true);
    expect(store.db.prepare(`SELECT name FROM sqlite_master WHERE name = 'users'`).get()).toBeTruthy();
    const accounts = accountsFor(store);
    const guest = accounts.createGuest("Bryan", null);
    expect(guest.outcome).toBe("ok");
    if (guest.outcome !== "ok") throw new Error("Guest was not created.");
    const messages: ServerMessage[] = [];
    const seated = new Hub(store, 30).connect(
      { type: "create", name: "Bryan", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => messages.push(message),
      () => undefined,
      guest.user.id,
    );
    expect(seated.ok).toBe(true);
    const room = store.roomByCode(welcomeCode(messages));
    const players = store.players(room!.id);
    expect(players[0]?.user_id).toBe(guest.user.id);
    store.db.close();
    unlinkSync(file);
  });

  it("stamps a seat with the account and does not replace it later", () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const first = mustUser(accounts.createGuest("Ada", null));
    const second = mustUser(accounts.createGuest("Bea", null));
    const hub = new Hub(store, 30);
    const messages: ServerMessage[] = [];
    const created = hub.connect(
      { type: "solo", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, difficulty: "easy" },
      (message) => messages.push(message),
      () => undefined,
      first.id,
    );
    expect(created.ok).toBe(true);
    const room = store.roomByCode(welcomeCode(messages));
    const seats = store.players(room!.id);
    expect(seats.find((seat) => seat.bot === 0)?.user_id).toBe(first.id);
    expect(seats.find((seat) => seat.bot === 1)?.user_id ?? null).toBeNull();
    const token = seats.find((seat) => seat.bot === 0)?.token ?? "";
    hub.connect({ type: "reconnect", token }, () => undefined, () => undefined, second.id);
    expect(store.playerByToken(token)?.user_id).toBe(first.id);

    const blank: ServerMessage[] = [];
    hub.connect(
      { type: "create", name: "Bea", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
      (message) => blank.push(message),
      () => undefined,
      null,
    );
    const open = store.roomByCode(welcomeCode(blank));
    const human = store.players(open!.id)[0]!;
    expect(human.user_id ?? null).toBeNull();
    hub.connect({ type: "reconnect", token: human.token }, () => undefined, () => undefined, second.id);
    expect(store.playerByToken(human.token)?.user_id).toBe(second.id);
  });

  it("fails health and closes seats while a deploy drains", async () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const { app, hub, lifecycle } = await createApp({ store, accounts, serveWeb: false });
    const ready = await app.inject({ method: "GET", url: "/health" });
    expect(ready.statusCode).toBe(200);
    let closed = 0;
    const seated = hub.connect(
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      () => undefined,
      () => {
        closed += 1;
      },
    );
    expect(seated.ok).toBe(true);
    await drainServer({ app, hub, lifecycle });
    expect(lifecycle.draining).toBe(true);
    expect(closed).toBe(1);
  });

  it("answers health, sets a session cookie, and checks the origin", async () => {
    const store = new Store(":memory:");
    const accounts = accountsFor(store);
    const { app } = await createApp({ store, accounts, serveWeb: false });
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const created = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Bryan", age13: true } });
    expect(created.statusCode).toBe(200);
    const setCookie = String(created.headers["set-cookie"]);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
    const pair = cookiePair(created.headers["set-cookie"]);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: pair } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(created.json().user.id);
    expect(me.json().user.displayName).toBe("Bryan");

    const missing = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: `${SESSION_COOKIE}=v1.not-a-real-token.not-a-signature` },
    });
    expect(missing.statusCode).toBe(401);

    const foreign = await app.inject({
      method: "POST",
      url: "/api/guest",
      headers: { origin: "https://evil.example", host: "uhoh-dominoes.onrender.com" },
      payload: { displayName: "Nope", age13: true },
    });
    expect(foreign.statusCode).toBe(403);

    const fromCanonical = await app.inject({
      method: "POST",
      url: "/api/guest",
      headers: { origin: "https://uhohdominoes.com", host: "uhoh-dominoes.onrender.com" },
      payload: { displayName: "Canonical", age13: true },
    });
    expect(fromCanonical.statusCode).toBe(200);
    expect(String(fromCanonical.headers["set-cookie"])).not.toContain("Domain=");

    const google = await app.inject({ method: "POST", url: "/api/auth/google", payload: { idToken: "x" } });
    expect(google.statusCode).toBe(503);
    expect(google.json().error).toBe("Google sign-in is not configured yet.");
    const apple = await app.inject({ method: "POST", url: "/api/auth/apple", payload: { idToken: "x" } });
    expect(apple.statusCode).toBe(503);

    const mailed = await app.inject({
      method: "POST",
      url: "/api/auth/email",
      headers: { host: "127.0.0.1:8901" },
      payload: { email: "bryan@example.com", age13: true },
    });
    expect(mailed.statusCode).toBe(200);
    const devLink = mailed.json().devLink as string;
    expect(devLink.startsWith("http://127.0.0.1:8901/?email-token=")).toBe(true);

    const previousPublic = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    const aliasMail = await app.inject({
      method: "POST",
      url: "/api/auth/email",
      headers: { host: "uhoh-dominoes.onrender.com" },
      payload: { email: "alias@example.com", age13: true },
    });
    if (previousPublic === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previousPublic;
    expect(aliasMail.statusCode).toBe(200);
    expect(String(aliasMail.json().devLink).startsWith("https://uhohdominoes.com/?email-token=")).toBe(true);
    const token = new URL(devLink).searchParams.get("email-token");
    const consumed = await app.inject({
      method: "POST",
      url: "/api/auth/email/consume",
      headers: { cookie: pair },
      payload: { token },
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().user.id).toBe(created.json().user.id);
    expect(consumed.json().user.guest).toBe(false);

    const signedOut = await app.inject({ method: "POST", url: "/api/logout", headers: { cookie: pair } });
    expect(signedOut.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: pair } });
    expect(after.statusCode).toBe(401);
    const home = await app.inject({
      method: "GET",
      url: "/r/AB12CD",
      headers: { host: "uhoh-dominoes.onrender.com" },
    });
    expect(home.statusCode).toBe(301);
    expect(home.headers.location).toBe("https://uhohdominoes.com/r/AB12CD");

    const wwwHealth = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "www.uhohdominoes.com" },
    });
    expect(wwwHealth.statusCode).toBe(200);

    const api = await app.inject({
      method: "POST",
      url: "/api/guest",
      headers: { host: "uhoh-dominoes.onrender.com" },
      payload: { displayName: "Still here", age13: true },
    });
    expect(api.statusCode).toBe(200);

    const savedPublic = process.env.PUBLIC_URL;
    delete process.env.PUBLIC_URL;
    const canonicalHome = await app.inject({
      method: "GET",
      url: "/config.js",
      headers: { host: "uhohdominoes.com", "x-forwarded-proto": "https" },
    });
    if (savedPublic === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = savedPublic;
    expect(canonicalHome.statusCode).toBe(200);
    expect(canonicalHome.body).toContain('"publicUrl":"https://uhohdominoes.com"');

    await app.close();
  });
});

function mustUser(result: SignInResult): PublicUser {
  if (result.outcome !== "ok") throw new Error(result.outcome);
  return result.user;
}
