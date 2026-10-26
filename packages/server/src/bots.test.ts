import { describe, expect, it } from "vitest";
import { CATALOG, canBuy, isWithheldId } from "@uhoh/rules";
import { BotLeague } from "./bots.js";
import { Cosmetics } from "./cosmetics.js";
import { Store } from "./db.js";
import {
  GAME_BONES_DAILY_CAP,
  GAME_FINISH_BONES,
  GAME_MOMENT_BONES,
  GAME_WIN_BONES,
  SEASON_FREE_TRACK,
  SEASON_PASS_ONLY,
  applyGameBones,
  bonesForGame,
  grantSeasonRewards,
} from "./economy.js";
import { Hub, type ServerMessage } from "./hub.js";
import { TIERS, gameIsRanked, settleGame } from "./ranking.js";

function memory() {
  const store = new Store(":memory:");
  const cosmetics = new Cosmetics(store);
  const hub = new Hub(store, 20, () => 0, 30_000, 1_000, 60_000, 40, () => 0);
  const bots = new BotLeague(store, hub, cosmetics);
  return { store, cosmetics, hub, bots };
}

function viewOf(messages: ServerMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type === "state") return message.view;
  }
  return null;
}

describe("bot economy", () => {
  it("starts bots at zero Bones and leaves the human test balance alone", () => {
    const { store, cosmetics, bots } = memory();
    bots.ensure();
    const bot = store.listBots()[0]!;
    const botStore = cosmetics.snapshot(bot.id);
    expect(botStore.bones).toBe(0);
    expect(botStore.goldBones).toBe(0);
    expect(botStore.testBalance).toBe(false);
    expect(botStore.owned.some((id) => isWithheldId(id))).toBe(false);

    const now = new Date().toISOString();
    store.insertUser({
      id: "human",
      display_name: "Ada",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 1,
    });
    const human = cosmetics.snapshot("human");
    expect(human.testBalance).toBe(true);
    expect(human.bones).toBe(100_000);
  });

  it("pays finish, win, and UH-OH Bones once, then stops at the daily cap", () => {
    const { store } = memory();
    const now = new Date().toISOString();
    store.insertUser({
      id: "bot_cap",
      display_name: "Cap",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 0,
    });
    store.markBot("bot_cap");
    const day = "2026-10-21";
    const first = applyGameBones(store, "bot_cap", {
      completed: false,
      won: false,
      moments: 3,
      day,
      at: now,
      roomId: "r0",
      seriesId: "s",
      gameNumber: 1,
    });
    expect(first.awarded).toBe(0);
    expect(store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get("bot_cap")).toBeUndefined();

    let paid = 0;
    for (let game = 1; game <= 12; game += 1) {
      const grant = applyGameBones(store, "bot_cap", {
        completed: true,
        won: true,
        moments: 4,
        day,
        at: now,
        roomId: `r${game}`,
        seriesId: "s",
        gameNumber: 1,
      });
      paid += grant.awarded;
      const again = applyGameBones(store, "bot_cap", {
        completed: true,
        won: true,
        moments: 4,
        day,
        at: now,
        roomId: `r${game}`,
        seriesId: "s",
        gameNumber: 1,
      });
      expect(again.already).toBe(true);
      expect(again.awarded).toBe(0);
    }
    const perGame = bonesForGame({ completed: true, won: true, moments: 4 });
    expect(perGame).toBe(GAME_FINISH_BONES + GAME_WIN_BONES + 4 * GAME_MOMENT_BONES);
    expect(paid).toBe(GAME_BONES_DAILY_CAP);
    const wallet = store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get("bot_cap") as { bones: number };
    expect(wallet.bones).toBe(GAME_BONES_DAILY_CAP);

    const nextDay = applyGameBones(store, "bot_cap", {
      completed: true,
      won: false,
      moments: 0,
      day: "2026-10-22",
      at: now,
      roomId: "next",
      seriesId: "s",
      gameNumber: 1,
    });
    expect(nextDay.awarded).toBe(GAME_FINISH_BONES);
  });

  it("buys an affordable item once through the store and refuses anything not for sale", () => {
    const { store, cosmetics, bots } = memory();
    bots.ensure();
    const bot = store.listBots()[0]!;
    const now = new Date().toISOString();
    applyGameBones(store, bot.id, {
      completed: true,
      won: true,
      moments: 44,
      day: "2026-10-21",
      at: now,
      roomId: "earn",
      seriesId: "s",
      gameNumber: 1,
    });
    const item = CATALOG.find((entry) => canBuy(entry, "bones") && entry.bones === 500);
    expect(item).toBeTruthy();
    const bought = cosmetics.buy(bot.id, item!.id, "bones");
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(bought.snapshot.bones).toBe(0);
    const again = cosmetics.buy(bot.id, item!.id, "bones");
    expect(again.ok).toBe(false);
    const wallet = store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get(bot.id) as { bones: number };
    expect(wallet.bones).toBe(0);
    const owned = store.db
      .prepare(`SELECT COUNT(*) AS n FROM owned_items WHERE user_id = ? AND item_id = ?`)
      .get(bot.id, item!.id) as { n: number };
    expect(Number(owned.n)).toBe(1);
    expect(cosmetics.buy(bot.id, "CHR-015", "bones").ok).toBe(false);
    expect(cosmetics.buy(bot.id, "FRM-011", "bones").ok).toBe(false);
    expect(cosmetics.buy(bot.id, "TT-003", "bones").ok).toBe(false);
    expect(cosmetics.equip(bot.id, "CHR-015").ok).toBe(true);
  });

  it("grants the free season track and skips the pass-only items", () => {
    const { store } = memory();
    const now = new Date().toISOString();
    store.insertUser({
      id: "climber",
      display_name: "Climber",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 0,
    });
    for (const tier of SEASON_FREE_TRACK) {
      expect(TIERS.find((item) => item.id === tier.tierId)?.min).toBe(tier.min);
    }
    expect(grantSeasonRewards(store, "climber", 0, now)).toEqual([]);
    const shark = grantSeasonRewards(store, "climber", 1800, now);
    expect(shark).toEqual(["TT-003", "FRM-004", "TBL-006", "CHR-006", "FX-003", "FRM-002"]);
    expect(grantSeasonRewards(store, "climber", 6000, now)).toEqual(["TIL-009", "CHR-023", "EMO-005", "FRM-003"]);
    const owned = store.db.prepare(`SELECT item_id FROM owned_items WHERE user_id = ?`).all("climber") as Array<{
      item_id: string;
    }>;
    const ids = owned.map((row) => row.item_id);
    for (const pass of SEASON_PASS_ONLY) expect(ids).not.toContain(pass);
    expect(ids).not.toContain("CHR-015");
  });

  it("ranks account bots and can hide them on the board", () => {
    expect(gameIsRanked([{ bot: false, userId: "a" }, { bot: false, userId: "b" }], false)).toBe(true);
    expect(gameIsRanked([{ bot: true, userId: null }, { bot: false, userId: "a" }], false)).toBe(false);
    const { store, bots } = memory();
    bots.ensure();
    const now = new Date("2026-10-21T18:00:00.000Z");
    const pair = store.listBots().slice(0, 2);
    settleGame(store, {
      roomId: "ranked",
      seriesId: "s",
      gameNumber: 1,
      casual: false,
      completed: true,
      winnerId: pair[0]!.id,
      now,
      seats: [
        { playerId: pair[0]!.id, name: pair[0]!.display_name, userId: pair[0]!.id, bot: false, score: 155, left: false, bigMoments: 1 },
        { playerId: pair[1]!.id, name: pair[1]!.display_name, userId: pair[1]!.id, bot: false, score: 40, left: false, bigMoments: 0 },
      ],
    });
    const shown = store.topByRating(50, true).filter((user) => user.is_bot === 1);
    expect(shown.length).toBeGreaterThan(0);
    expect(store.topByRating(50, false).some((user) => user.is_bot === 1)).toBe(false);
    const winner = store.user(pair[0]!.id);
    expect(winner?.ranked_games ?? 0).toBeGreaterThan(0);
    const wallet = store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get(pair[0]!.id) as { bones: number };
    expect(wallet.bones).toBeGreaterThan(0);
  });
});

describe("bot play", () => {
  it("plays a real game to 150 and keeps the Bones ledger honest", () => {
    const { bots } = memory();
    bots.ensure();
    const played = bots.playOne();
    expect(played.ok).toBe(true);
    const summary = bots.summary();
    expect(summary.matchesPlayed).toBe(1);
    expect(summary.errorsByType).toEqual({});
    const rules = summary.rules as { openingOk: number; exact150: number; overshoot: number };
    expect(rules.openingOk).toBeGreaterThan(0);
    expect(rules.exact150 + rules.overshoot).toBe(1);
  }, 60_000);

  it("fills a quick table with an account bot", async () => {
    const { store, cosmetics, hub, bots } = memory();
    bots.ensure();
    const messages: ServerMessage[] = [];
    const now = new Date().toISOString();
    store.insertUser({
      id: "solo",
      display_name: "Solo",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 1,
    });
    const seated = hub.connect(
      { type: "quick", name: "Solo", size: 2 },
      (message) => messages.push(message),
      () => undefined,
      "solo",
    );
    if (!seated.ok) throw new Error(seated.error);
    expect(viewOf(messages)?.quick?.botFillAt).toBeTruthy();
    const worn = CATALOG.find((item) => item.category === "frame" && item.obtain === "bones" && item.bones === 500);
    expect(worn).toBeTruthy();
    const owner = store.user("bot_pipsqueak");
    if (!owner) throw new Error("Pip Squeak was not created.");
    store.db
      .prepare(`INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)`)
      .run(owner.id, worn!.id, now);
    expect(cosmetics.equip(owner.id, worn!.id).ok).toBe(true);
    hub.command(seated.session.playerId, { type: "fill-bots" });
    const view = viewOf(messages);
    expect(view?.status).toBe("playing");
    const bot = view?.players.find((player) => player.accountBot);
    expect(bot?.bot).toBe(true);
    expect(bot?.frameId).toBe(worn!.id);
    expect(bot?.name.length).toBeGreaterThan(0);
    expect(isWithheldId(bot?.avatarId)).toBe(false);
    const row = store.players(store.roomByCode(view!.roomCode)!.id).find((player) => player.bot === 1);
    expect(row?.user_id).toBeTruthy();
    hub.discardRoom(seated.session.playerId);
  });

  it("checks the bot who actually sat and leaves a waiting table alone", async () => {
    const store = new Store(":memory:");
    const cosmetics = new Cosmetics(store);
    const hub = new Hub(store, 20, () => 60_000, 30_000, 1_000, 60_000, 60_000, () => 60_000);
    const bots = new BotLeague(store, hub, cosmetics);
    bots.ensure();
    const now = new Date().toISOString();
    for (const [id, name] of [
      ["holder", "Holder"],
      ["waiter", "Waiter"],
    ] as const) {
      store.insertUser({
        id,
        display_name: name,
        avatar_id: "homescreen",
        created_at: now,
        updated_at: now,
        is_guest: 1,
      });
    }
    const held: ServerMessage[] = [];
    const holding = hub.connect(
      { type: "quick", name: "Holder", size: 2 },
      (message) => held.push(message),
      () => undefined,
      "holder",
    );
    if (!holding.ok) throw new Error(holding.error);
    hub.command(holding.session.playerId, { type: "fill-bots" });
    const first = viewOf(held)?.players.find((player) => player.accountBot);
    expect(first?.name).toBe("Pip Squeak");
    expect(viewOf(held)?.status).toBe("playing");

    const next = store.listBots().find((bot) => bot.display_name === "Double Six");
    if (!next) throw new Error("Double Six was not created.");
    const worn = CATALOG.find((item) => item.category === "frame" && item.obtain === "bones" && item.bones === 500);
    expect(worn).toBeTruthy();
    store.db.prepare(`INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)`).run(next.id, worn!.id, now);
    expect(cosmetics.equip(next.id, worn!.id).ok).toBe(true);

    const waiting: ServerMessage[] = [];
    const queued = hub.connect(
      { type: "quick", name: "Waiter", size: 2 },
      (message) => waiting.push(message),
      () => undefined,
      "waiter",
    );
    if (!queued.ok) throw new Error(queued.error);
    const waitingCode = viewOf(waiting)?.roomCode;
    expect(viewOf(waiting)?.status).toBe("lobby");
    expect(viewOf(waiting)?.players).toHaveLength(1);

    await bots.probeNow();
    const summary = bots.summary();
    expect(summary.errorsByType).toEqual({});
    const probes = summary.probes as Array<{ name?: string; ok?: boolean; detail?: string }>;
    const equip = probes.find((probe) => probe.name === "equip");
    expect(equip?.ok).toBe(true);
    expect(equip?.detail).toContain(worn!.id);
    expect(equip?.detail?.startsWith("Pip Squeak")).toBe(false);

    const still = viewOf(waiting);
    expect(still?.status).toBe("lobby");
    expect(still?.players).toHaveLength(1);
    expect(still?.roomCode).toBe(waitingCode);
    hub.discardRoom(holding.session.playerId);
    hub.discardRoom(queued.session.playerId);
  });

  it("runs the throttled probes without recording a failure", async () => {
    const { bots } = memory();
    bots.ensure();
    await bots.probeNow();
    const summary = bots.summary();
    const probes = summary.probes as Array<{ name?: string; ok?: boolean; detail?: string }>;
    const failed = probes.filter((probe) => probe.ok === false);
    expect(failed).toEqual([]);
    expect(probes.map((probe) => probe.name).sort()).toEqual(
      ["abandon", "chat", "equip", "leaderboard", "private-rooms", "reconnect"].sort(),
    );
  });

  it("purges bot accounts and leaves people in place", () => {
    const { store, bots } = memory();
    bots.ensure();
    const now = new Date().toISOString();
    store.insertUser({
      id: "human",
      display_name: "Ada",
      avatar_id: "homescreen",
      created_at: now,
      updated_at: now,
      is_guest: 1,
    });
    expect(bots.purge().deleted).toBe(30);
    expect(store.listBots()).toEqual([]);
    expect(store.user("human")?.display_name).toBe("Ada");
  });
});
