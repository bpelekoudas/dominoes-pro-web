import { describe, expect, it } from "vitest";
import { Accounts } from "./accounts.js";
import { Store } from "./db.js";
import { Hub, type ServerMessage } from "./hub.js";
import { leaderboard } from "./ranking.js";
import type { PlayerView } from "@uhoh/rules";

const NOW = new Date("2026-10-22T18:00:00.000Z");

function latestView(messages: ServerMessage[]): PlayerView | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type === "state") return message.view;
  }
  return null;
}

function connect(
  hub: Hub,
  message: Parameters<Hub["connect"]>[0],
  userId: string | null = null,
) {
  const messages: ServerMessage[] = [];
  const result = hub.connect(message, (outgoing) => messages.push(outgoing), () => undefined, userId);
  return { result, messages };
}

describe("soak tables", () => {
  it("flags a soak guest, keeps the flag after a rename, and leaves them off the leaderboard", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "s".repeat(32), now: () => NOW });
    const created = accounts.createGuest("soak-ada", null);
    if (created.outcome !== "ok") throw new Error(created.error);
    expect(store.user(created.user.id)?.is_soak).toBe(1);

    accounts.rename(created.user.id, "Ada");
    expect(store.user(created.user.id)?.display_name).toBe("Ada");
    expect(store.user(created.user.id)?.is_soak).toBe(1);

    store.db.prepare(`UPDATE users SET season_points = 99999, rating = 2500, season_id = 0 WHERE id = ?`).run(created.user.id);
    const rival = accounts.createGuest("Rival", null);
    if (rival.outcome !== "ok") throw new Error(rival.error);
    store.db.prepare(`UPDATE users SET season_points = 10, rating = 1210 WHERE id = ?`).run(rival.user.id);

    const season = leaderboard(store, "season", NOW, 50, true);
    const rating = leaderboard(store, "rating", NOW, 50, false);
    expect(season.rows.map((row) => row.name)).toEqual(["Rival"]);
    expect(rating.rows.map((row) => row.name)).toEqual(["Rival"]);
    expect(store.user(created.user.id)?.season_id).toBe(0);

    const hub = new Hub(store, 30);
    const renamed = connect(
      hub,
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3 },
      created.user.id,
    );
    expect(renamed.result.ok).toBe(true);
    expect(store.roomByCode(latestView(renamed.messages)?.roomCode ?? "")?.soak).toBe(1);
  });

  it("plays a private soak table, sends the hand seed, and refuses a quick seat", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "s".repeat(32), now: () => NOW });
    const ada = accounts.createGuest("soak-ada", null);
    const bo = accounts.createGuest("soak-bo", null);
    if (ada.outcome !== "ok" || bo.outcome !== "ok") throw new Error("guest");
    const hub = new Hub(store, 30);

    const quick = connect(hub, { type: "quick", name: "soak-ada", size: 2 }, ada.user.id);
    expect(quick.result.ok).toBe(false);

    const host = connect(
      hub,
      { type: "create", name: "soak-ada", playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, listed: true },
      ada.user.id,
    );
    expect(host.result.ok).toBe(true);
    const view = latestView(host.messages);
    const row = store.roomByCode(view?.roomCode ?? "");
    expect(row?.soak).toBe(1);
    expect(row?.listed).toBe(0);
    expect(row?.casual).toBe(1);

    const stranger = connect(hub, { type: "join", code: view?.roomCode ?? "", name: "Sam" });
    expect(stranger.result.ok).toBe(false);
    if (!stranger.result.ok) expect(stranger.result.error).toMatch(/soak/i);

    const guest = connect(hub, { type: "join", code: view?.roomCode ?? "", name: "soak-bo" }, bo.user.id);
    expect(guest.result.ok).toBe(true);
    if (host.result.ok) hub.command(host.result.session.playerId, { type: "start" });

    const seeded = host.messages.find((message) => message.type === "state" && message.audit);
    const hand = store.handsForSeries(row!.id, row!.series_id)[0];
    expect(hand?.seed).toHaveLength(64);
    expect(seeded && seeded.type === "state" ? seeded.audit?.handSeed : "").toBe(hand?.seed);

    const alex = connect(hub, {
      type: "create",
      name: "Alex",
      playerCount: 2,
      boneyardMode: "draw_one",
      seriesLength: 3,
    });
    const humanCode = latestView(alex.messages)?.roomCode ?? "";
    connect(hub, { type: "join", code: humanCode, name: "Sam" });
    if (alex.result.ok) hub.command(alex.result.session.playerId, { type: "start" });
    const humanRoom = store.roomByCode(humanCode)!;
    const hidden = store.handsForSeries(humanRoom.id, humanRoom.series_id)[0]?.seed ?? "";
    expect(hidden.length).toBe(64);
    expect(JSON.stringify(alex.messages)).not.toContain(hidden);
    expect(humanRoom.soak ?? 0).toBe(0);

    const soakedJoin = connect(hub, { type: "join", code: humanCode, name: "soak-ada" }, ada.user.id);
    expect(soakedJoin.result.ok).toBe(false);
    if (!soakedJoin.result.ok) expect(soakedJoin.result.error).toMatch(/soak/i);
  });

  it("does not write games, points, or rating history when a soak table is abandoned", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "s".repeat(32), now: () => NOW });
    const ada = accounts.createGuest("soak-ada", null);
    const bo = accounts.createGuest("soak-bo", null);
    if (ada.outcome !== "ok" || bo.outcome !== "ok") throw new Error("guest");
    const hub = new Hub(store, 30);
    const host = connect(
      hub,
      { type: "create", name: "soak-ada", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
      ada.user.id,
    );
    const code = latestView(host.messages)?.roomCode ?? "";
    connect(hub, { type: "join", code, name: "soak-bo" }, bo.user.id);
    if (host.result.ok) hub.command(host.result.session.playerId, { type: "start" });

    for (let step = 0; step < 3; step += 1) {
      const turn = latestView(host.messages)?.turnPlayerId;
      expect(turn).toBeTruthy();
      hub.missTurn(turn!);
    }
    expect(latestView(host.messages)?.status).toBe("abandoned");
    expect(store.user(ada.user.id)?.games_played ?? 0).toBe(0);
    expect(store.user(bo.user.id)?.season_points ?? 0).toBe(0);
    const history = store.db.prepare(`SELECT COUNT(*) AS n FROM rating_history`).get() as { n: number };
    expect(history.n).toBe(0);

    expect(hub.dropSoakRooms()).toBe(1);
    expect(store.roomByCode(code)).toBeNull();
    const purged = store.purgeSoak();
    expect(purged.users).toBe(2);
    expect(store.user(ada.user.id)).toBeNull();
    expect(store.user(bo.user.id)).toBeNull();
  });

  it("still records a normal abandon, so the soak skip is the reason a soak row stays empty", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "s".repeat(32), now: () => NOW });
    const ada = accounts.createGuest("Ada", null);
    const bo = accounts.createGuest("Bo", null);
    if (ada.outcome !== "ok" || bo.outcome !== "ok") throw new Error("guest");
    const hub = new Hub(store, 30);
    const host = connect(
      hub,
      { type: "create", name: "Ada", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
      ada.user.id,
    );
    const code = latestView(host.messages)?.roomCode ?? "";
    connect(hub, { type: "join", code, name: "Bo" }, bo.user.id);
    if (host.result.ok) hub.command(host.result.session.playerId, { type: "start" });
    for (let step = 0; step < 3; step += 1) hub.missTurn(latestView(host.messages)!.turnPlayerId!);
    expect(latestView(host.messages)?.status).toBe("abandoned");
    expect(store.user(ada.user.id)?.games_played ?? 0).toBeGreaterThan(0);
    expect(hub.dropSoakRooms()).toBe(0);
  });
});
