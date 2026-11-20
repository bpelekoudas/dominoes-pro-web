import { describe, expect, it } from "vitest";
import { Accounts, SESSION_COOKIE } from "./accounts.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import { Hub, type ServerMessage } from "./hub.js";

const SECRET = "test-secret-value-16";

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

describe("safety", () => {
  it("requires 13+, rejects a slur, and deletes the name and email", async () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app, hub } = await createApp({ store, accounts, serveWeb: false });

    const young = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Ada" } });
    expect(young.statusCode).toBe(400);
    expect(young.json().error).toBe("Confirm you are 13 or older.");

    const rude = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "shit", age13: true } });
    expect(rude.statusCode).toBe(400);
    expect(rude.json().error).toBe("Pick a different name.");

    const created = await app.inject({ method: "POST", url: "/api/guest", payload: { displayName: "Ada", age13: true } });
    expect(created.statusCode).toBe(200);
    expect(created.json().user.ageOk).toBe(true);
    const pair = cookiePair(created.headers["set-cookie"]);
    const userId = created.json().user.id as string;
    store.insertIdentity({
      id: "id-email",
      user_id: userId,
      provider: "email",
      provider_subject: "ada@example.com",
      email: "ada@example.com",
      created_at: new Date().toISOString(),
    });

    const removed = await app.inject({
      method: "POST",
      url: "/api/account/delete",
      headers: { cookie: pair },
      payload: { confirm: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(store.user(userId)?.display_name).toBe("Deleted");
    expect(store.identitiesForUser(userId)).toHaveLength(0);
    expect(store.db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId)).toEqual({ n: 0 });
    expect(String(removed.headers["set-cookie"])).toContain(`${SESSION_COOKIE}=`);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: pair } });
    expect(me.statusCode).toBe(401);
    void hub;
    await app.close();
  });

  it("hides a blocked player's line and will not seat them together again", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const ada = accounts.createGuest("Ada", null);
    const bo = accounts.createGuest("Bo", null);
    if (ada.outcome !== "ok" || bo.outcome !== "ok") throw new Error("Guests were not created.");
    const hub = new Hub(store, 30);
    const adaMessages: ServerMessage[] = [];
    const boMessages: ServerMessage[] = [];
    const opened = hub.connect(
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      (message) => adaMessages.push(message),
      () => undefined,
      ada.user.id,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const welcome = adaMessages.find((message) => message.type === "welcome");
    if (!welcome || welcome.type !== "welcome") throw new Error("No room.");
    const joined = hub.connect(
      { type: "join", name: "Bo", code: welcome.roomCode },
      (message) => boMessages.push(message),
      () => undefined,
      bo.user.id,
    );
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    store.blockUser(ada.user.id, bo.user.id, new Date().toISOString());
    hub.command(joined.session.playerId, { type: "chat", kind: "preset", packId: "table", tauntId: "gg" });
    expect(adaMessages.some((message) => message.type === "chat")).toBe(false);
    expect(boMessages.some((message) => message.type === "chat")).toBe(true);

    const again = hub.connect(
      { type: "quick", name: "Ada", size: 2 },
      () => undefined,
      () => undefined,
      ada.user.id,
    );
    expect(again.ok).toBe(true);
    const crowded = hub.connect(
      { type: "quick", name: "Bo", size: 2 },
      () => undefined,
      () => undefined,
      bo.user.id,
    );
    expect(crowded.ok).toBe(true);
    if (!again.ok || !crowded.ok) return;
    const adaRoom = store.playerById(again.session.playerId)?.room_id;
    const boRoom = store.playerById(crowded.session.playerId)?.room_id;
    expect(adaRoom).not.toBe(boRoom);
  });
});
