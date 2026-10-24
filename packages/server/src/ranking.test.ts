import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { Accounts } from "./accounts.js";
import { Store } from "./db.js";
import { Hub, type ServerMessage } from "./hub.js";
import {
  capDelta,
  closeness,
  denverDay,
  describePlayer,
  expectedScore,
  finalizeDelta,
  finishingPlaces,
  gameIsRanked,
  kFactor,
  leaderboard,
  ratePlayers,
  rewardForTier,
  seasonAward,
  seasonStartPoints,
  settleGame,
  START_RATING,
  tierAt,
  TIER_DROP,
  TIERS,
} from "./ranking.js";

const NOW = new Date("2026-10-19T18:00:00.000Z");

describe("rating math", () => {
  it("uses the chess expectation and a closeness score that still follows the finish", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 6);
    expect(closeness(150, 0, "higher")).toBe(1);
    expect(closeness(0, 150, "lower")).toBe(0);
    expect(closeness(150, 145, "higher")).toBe(0.6);
    expect(closeness(145, 150, "lower")).toBe(0.4);
    expect(closeness(100, 100, "tied")).toBe(0.5);
  });

  it("pays more for a blowout than a squeaker in a two-player game", () => {
    const blowout = ratePlayers([
      seat("a", 1200, 0, 150, 1),
      seat("b", 1200, 0, 0, 2),
    ]);
    const close = ratePlayers([
      seat("a", 1200, 0, 150, 1),
      seat("b", 1200, 0, 145, 2),
    ]);
    expect(blowout.get("a")).toEqual({ before: 1200, after: 1220, delta: 20 });
    expect(blowout.get("b")).toEqual({ before: 1200, after: 1180, delta: -20 });
    expect(close.get("a")?.delta).toBe(4);
    expect(close.get("b")?.delta).toBe(-4);
    expect(close.get("a")!.delta).toBeLessThan(blowout.get("a")!.delta);
  });

  it("averages the pairs so a four-player blowout matches a two-player one", () => {
    const three = ratePlayers([
      seat("a", 1200, 0, 150, 1),
      seat("b", 1200, 0, 80, 2),
      seat("c", 1200, 0, 20, 3),
    ]);
    expect(three.get("a")?.delta).toBe(13);
    expect(three.get("b")?.delta).toBe(-1);
    expect(three.get("c")?.delta).toBe(-13);

    const four = ratePlayers([
      seat("a", 1200, 0, 150, 1),
      seat("b", 1200, 0, 0, 2),
      seat("c", 1200, 0, 0, 3),
      seat("d", 1200, 0, 0, 4),
    ]);
    expect(four.get("a")?.delta).toBe(20);
    expect(four.get("a")!.delta).toBeLessThanOrEqual(40);
  });

  it("uses a bigger K for the first 20 games, then a smaller one, and the smallest at 2000", () => {
    expect(kFactor(1200, 0)).toBe(40);
    expect(kFactor(1200, 19)).toBe(40);
    expect(kFactor(1200, 20)).toBe(20);
    expect(kFactor(1999, 20)).toBe(20);
    expect(kFactor(2000, 0)).toBe(10);
    expect(kFactor(2100, 100)).toBe(10);
    const fresh = ratePlayers([seat("a", 1200, 19, 150, 1), seat("b", 1200, 19, 0, 2)]);
    const settled = ratePlayers([seat("a", 1200, 20, 150, 1), seat("b", 1200, 20, 0, 2)]);
    const expert = ratePlayers([seat("a", 2000, 0, 150, 1), seat("b", 2000, 0, 0, 2)]);
    expect(fresh.get("a")?.delta).toBe(20);
    expect(settled.get("a")?.delta).toBe(10);
    expect(expert.get("a")?.delta).toBe(5);
  });

  it("caps a game at 40 and will not drop a rating under 100", () => {
    expect(capDelta(55)).toBe(40);
    expect(capDelta(-55)).toBe(-40);
    expect(finalizeDelta(55.4)).toBe(40);
    expect(finalizeDelta(-55.4)).toBe(-40);
    const floored = ratePlayers([seat("a", 105, 0, 0, 2), seat("b", 105, 0, 150, 1)]);
    expect(floored.get("a")).toEqual({ before: 105, after: 100, delta: -5 });
    const upset = ratePlayers([seat("a", 1200, 0, 150, 1), seat("b", 2400, 30, 0, 2)]);
    expect(upset.get("a")?.delta).toBe(40);
    expect(Math.abs(upset.get("a")!.delta)).toBeLessThanOrEqual(40);
    expect(Math.abs(upset.get("b")!.delta)).toBeLessThanOrEqual(40);
  });

  it("puts a leaver last even when their score is higher", () => {
    const places = finishingPlaces([
      { playerId: "a", score: 100, left: false },
      { playerId: "b", score: 80, left: false },
      { playerId: "c", score: 140, left: true },
    ]);
    expect(places.get("a")?.place).toBe(1);
    expect(places.get("b")?.place).toBe(2);
    expect(places.get("c")?.place).toBe(3);
    const rated = ratePlayers([
      seat("a", 1200, 0, 100, 1),
      seat("b", 1200, 0, 80, 2),
      seat("c", 1200, 0, 140, 3),
    ]);
    expect(rated.get("a")!.delta).toBeGreaterThan(0);
    expect(rated.get("c")!.delta).toBeLessThan(0);
    expect(closeness(140, 100, "lower")).toBe(0.4);
    expect(closeness(100, 140, "higher")).toBe(0.6);
  });
});

describe("season points and tiers", () => {
  it("pays finish, win, second, moments, streak, and the first win, then doubles a ranked table", () => {
    const practice = seasonAward({
      completed: true,
      won: true,
      second: false,
      moments: 2,
      streakBefore: 2,
      alreadyWonToday: false,
      ranked: false,
    });
    expect(practice).toMatchObject({ finish: 10, win: 25, moments: 10, momentCount: 2, streak: 15, streakCount: 3, firstWin: 20, doubled: false });
    expect(practice.total).toBe(80);
    const ranked = seasonAward({
      completed: true,
      won: false,
      second: true,
      moments: 0,
      streakBefore: 4,
      alreadyWonToday: true,
      ranked: true,
    });
    expect(ranked.finish).toBe(20);
    expect(ranked.second).toBe(20);
    expect(ranked.win).toBe(0);
    expect(ranked.streak).toBe(0);
    expect(ranked.total).toBe(40);
    const capped = seasonAward({
      completed: true,
      won: true,
      second: false,
      moments: 0,
      streakBefore: 9,
      alreadyWonToday: true,
      ranked: false,
    });
    expect(capped.streak).toBe(25);
    const quiet = seasonAward({
      completed: false,
      won: false,
      second: false,
      moments: 1,
      streakBefore: 3,
      alreadyWonToday: false,
      ranked: false,
    });
    expect(quiet.total).toBe(15);
    expect(quiet.streak).toBe(0);
  });

  it("splits every tier but Rookie into III, II, and I", () => {
    expect(tierAt(0)).toMatchObject({ id: "rookie", step: null, nextAt: 250 });
    expect(tierAt(249).id).toBe("rookie");
    expect(tierAt(250)).toMatchObject({ id: "shuffler", step: "III" });
    expect(tierAt(365).step).toBe("III");
    expect(tierAt(366).step).toBe("II");
    expect(tierAt(482).step).toBe("II");
    expect(tierAt(483)).toMatchObject({ id: "shuffler", step: "I", nextAt: 600 });
    expect(tierAt(600)).toMatchObject({ id: "clacker", step: "III" });
    expect(tierAt(1100).id).toBe("hustler");
    expect(tierAt(1800).id).toBe("shark");
    expect(tierAt(2800).id).toBe("boss");
    expect(tierAt(4200).id).toBe("big-shot");
    expect(tierAt(6000)).toMatchObject({ id: "legend", step: "III", nextAt: 7000 });
    expect(tierAt(7000)).toMatchObject({ step: "II", nextAt: 8000 });
    expect(tierAt(8000)).toMatchObject({ step: "I", nextAt: null });
    expect(tierAt(9000).step).toBe("I");
  });

  it("drops four rungs at a new season and never below Rookie", () => {
    expect(TIER_DROP).toBe(4);
    expect(seasonStartPoints(6000, 1)).toBe(TIERS[3]!.min);
    expect(tierAt(seasonStartPoints(6000, 1)).id).toBe("hustler");
    expect(tierAt(seasonStartPoints(4200, 1)).id).toBe("clacker");
    expect(seasonStartPoints(1100, 1)).toBe(0);
    expect(seasonStartPoints(0, 1)).toBe(0);
    expect(seasonStartPoints(8000, 2)).toBe(0);
    expect(rewardForTier("legend").rewardId).toBe("cosmetic:legend");
  });

  it("uses the Denver calendar day", () => {
    expect(denverDay(new Date("2026-10-19T05:59:00.000Z"))).toBe("2026-10-18");
    expect(denverDay(new Date("2026-10-19T06:00:00.000Z"))).toBe("2026-10-19");
  });
});

describe("saved standings", () => {
  it("rates an all-human game once, and leaves a computer game off the rating", () => {
    const store = new Store(":memory:");
    const ada = user(store, "Ada");
    const bo = user(store, "Bo");
    const ranked = settleGame(store, {
      roomId: "r1",
      seriesId: "s1",
      gameNumber: 1,
      casual: false,
      completed: true,
      winnerId: "p1",
      now: NOW,
      seats: [human("p1", "Ada", ada, 150, 0), human("p2", "Bo", bo, 0, 0)],
    });
    expect(ranked.ranked).toBe(true);
    expect(ranked.players.find((player) => player.playerId === "p1")).toMatchObject({
      ratingBefore: 1200,
      ratingAfter: 1220,
      delta: 20,
      pointsEarned: 120,
      provisional: true,
    });
    expect(store.user(ada)?.rating).toBe(1220);
    expect(store.user(ada)?.season_points).toBe(120);
    expect(store.user(bo)?.rating).toBe(1180);
    expect(store.user(bo)?.ranked_wins).toBe(0);
    expect(store.user(bo)?.ranked_losses).toBe(1);
    expect(store.user(bo)?.season_points).toBe(20);

    const again = settleGame(store, {
      roomId: "r1",
      seriesId: "s1",
      gameNumber: 1,
      casual: false,
      completed: true,
      winnerId: "p1",
      now: NOW,
      seats: [human("p1", "Ada", ada, 150, 0), human("p2", "Bo", bo, 0, 0)],
    });
    expect(again.players.find((player) => player.playerId === "p1")?.delta).toBe(20);
    expect(store.user(ada)?.rating).toBe(1220);
    expect(store.user(ada)?.season_points).toBe(120);

    const bot = settleGame(store, {
      roomId: "r2",
      seriesId: "s2",
      gameNumber: 1,
      casual: false,
      completed: true,
      winnerId: "p1",
      now: NOW,
      seats: [human("p1", "Ada", ada, 150, 0), { playerId: "bot", name: "Bones", userId: null, bot: true, score: 0, left: false, bigMoments: 0 }],
    });
    expect(bot.ranked).toBe(false);
    expect(bot.vsComputer).toBe(true);
    expect(bot.players[0]).toMatchObject({ delta: null, pointsEarned: 45 });
    expect(store.user(ada)?.rating).toBe(1220);
    expect(store.user(ada)?.vs_wins).toBe(1);
    expect(store.user(ada)?.vs_games).toBe(1);
    expect(store.user(ada)?.ranked_games).toBe(1);
    expect(store.user(ada)?.season_points).toBe(165);
    expect(gameIsRanked([{ bot: true, userId: null }, { bot: false, userId: ada }], false)).toBe(false);
  });

  it("keeps a casual table and a leaver off the ranked win, and a second call does not stack", () => {
    const store = new Store(":memory:");
    const ada = user(store, "Ada");
    const bo = user(store, "Bo");
    const cay = user(store, "Cay");
    const casual = settleGame(store, {
      roomId: "rc",
      seriesId: "sc",
      gameNumber: 1,
      casual: true,
      completed: true,
      winnerId: "p1",
      now: NOW,
      seats: [human("p1", "Ada", ada, 150, 0), human("p2", "Bo", bo, 10, 0)],
    });
    expect(casual.ranked).toBe(false);
    expect(store.user(ada)?.rating).toBe(START_RATING);
    expect(store.user(ada)?.season_points).toBe(60);
    expect(store.user(ada)?.ranked_games).toBe(0);

    const left = settleGame(store, {
      roomId: "rl",
      seriesId: "sl",
      gameNumber: 2,
      casual: false,
      completed: false,
      winnerId: null,
      now: NOW,
      seats: [
        { ...human("p1", "Ada", ada, 100, 0), left: false },
        { ...human("p2", "Bo", bo, 80, 0), left: false },
        { ...human("p3", "Cay", cay, 140, 0), left: true },
      ],
    });
    const cayLine = left.players.find((player) => player.playerId === "p3");
    const adaLine = left.players.find((player) => player.playerId === "p1");
    expect(left.ranked).toBe(true);
    expect(cayLine?.delta).toBeLessThan(0);
    expect(adaLine?.delta).toBeGreaterThan(0);
    expect(cayLine?.breakdown.win).toBe(0);
    expect(store.user(cay)?.ranked_losses).toBe(0);
    expect(store.user(cay)?.ranked_games).toBe(1);
    expect(store.user(ada)?.season_points).toBeGreaterThan(60);
  });

  it("soft-resets to the tier four rungs down and records the peak reward", () => {
    const store = new Store(":memory:");
    store.setMeta("season_epoch", new Date(NOW.getTime() - 8 * 7 * 24 * 60 * 60 * 1000 - 86_400_000).toISOString());
    const id = user(store, "Ada");
    store.saveStanding(id, {
      rating: 1500,
      ranked_games: 30,
      ranked_wins: 20,
      ranked_losses: 10,
      vs_games: 0,
      vs_wins: 0,
      vs_losses: 0,
      games_played: 30,
      season_id: 1,
      season_points: 6500,
      win_streak: 4,
      last_win_day: "2026-10-18",
      peak_tier: "legend",
      peak_step: "III",
      updated_at: NOW.toISOString(),
    });
    const standing = describePlayer(store, id, NOW);
    expect(standing?.seasonPoints).toBe(1100);
    expect(standing?.tierId).toBe("hustler");
    expect(standing?.tierStep).toBe("III");
    expect(standing?.rating).toBe(1500);
    const peak = store.seasonPeak(id, 1);
    expect(peak?.tier).toBe("legend");
    expect(peak?.reward_id).toBe("cosmetic:legend");
    expect(store.user(id)?.win_streak).toBe(0);
  });

  it("keeps a guest's rating when the same profile comes back", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: "s".repeat(32), devMagicLink: true, now: () => NOW });
    const created = accounts.createGuest("Bry", null);
    if (created.outcome !== "ok" || !created.token) throw new Error("guest");
    const row = store.user(created.user.id);
    if (!row) throw new Error("missing");
    store.saveStanding(row.id, {
      rating: 1333,
      ranked_games: 6,
      ranked_wins: 4,
      ranked_losses: 2,
      vs_games: 1,
      vs_wins: 1,
      vs_losses: 0,
      games_played: 7,
      season_id: row.season_id ?? 1,
      season_points: 400,
      win_streak: 2,
      last_win_day: "2026-10-19",
      peak_tier: "shuffler",
      peak_step: "III",
      updated_at: NOW.toISOString(),
    });
    const again = accounts.userFromCookieValue(created.token);
    expect(again?.id).toBe(created.user.id);
    expect(again?.rating).toBe(1333);
    expect(again?.rankedWins).toBe(4);
    expect(again?.tierId).toBe("shuffler");
    expect(again?.provisional).toBe(false);
  });

  it("lists the top ratings and the top season totals", () => {
    const store = new Store(":memory:");
    const ada = user(store, "Ada");
    const bo = user(store, "Bo");
    settleGame(store, {
      roomId: "r",
      seriesId: "s",
      gameNumber: 1,
      casual: false,
      completed: true,
      winnerId: "a",
      now: NOW,
      seats: [human("a", "Ada", ada, 150, 0), human("b", "Bo", bo, 0, 0)],
    });
    const byRating = leaderboard(store, "rating", NOW);
    const bySeason = leaderboard(store, "season", NOW);
    expect(byRating.rows[0]?.name).toBe("Ada");
    expect(byRating.rows[0]?.rating).toBe(1220);
    expect(bySeason.rows[0]?.seasonPoints).toBe(120);
    expect(bySeason.rows).toHaveLength(2);
  });

  it("opens an old database and a casual flag still restores", () => {
    const file = `/tmp/uhoh-rank-old-${Date.now()}.sqlite`;
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
    raw.close();
    const store = new Store(file);
    expect(store.user("nobody")).toBeNull();
    const accounts = new Accounts(store, { secret: "s".repeat(32), devMagicLink: true, now: () => NOW });
    const guest = accounts.createGuest("Pat", null);
    if (guest.outcome !== "ok") throw new Error(guest.outcome);
    expect(guest.user.rating).toBe(1200);
    expect(guest.user.tierId).toBe("rookie");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hub = new Hub(store, 30, () => 0, 60_000);
      const messages: ServerMessage[] = [];
      const host = hub.connect(
        { type: "create", name: "Pat", playerCount: 2, boneyardMode: "draw_one", seriesLength: 3 },
        (message) => messages.push(message),
        () => undefined,
        guest.user.id,
      );
      if (!host.ok) throw new Error(host.error);
      hub.command(host.session.playerId, { type: "set-casual", casual: true });
      const view = messages.map((message) => (message.type === "state" ? message.view : null)).filter(Boolean).at(-1);
      expect(view?.settings.casual).toBe(true);
      expect(view?.players[0]?.rank?.rating).toBe(1200);
      expect(view?.players[0]?.rank?.tierId).toBe("rookie");
      const welcome = messages.find((message) => message.type === "welcome");
      const token = welcome?.type === "welcome" ? welcome.token : "";
      store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const restored = new Hub(store, 30, () => 0, 60_000);
      const again: ServerMessage[] = [];
      const back = restored.connect({ type: "reconnect", token }, (message) => again.push(message), () => undefined, guest.user.id);
      expect(back.ok).toBe(true);
      const next = again.map((message) => (message.type === "state" ? message.view : null)).filter(Boolean).at(-1);
      expect(next?.settings.casual).toBe(true);
      expect(next?.players[0]?.rank?.rating).toBe(1200);
    } finally {
      warn.mockRestore();
      store.db.close();
    }
  });
});

function seat(id: string, rating: number, rankedGames: number, score: number, place: number) {
  return { id, rating, rankedGames, score, place };
}

function user(store: Store, name: string): string {
  const id = `u_${name.toLowerCase()}_${Math.random().toString(16).slice(2)}`;
  const stamp = NOW.toISOString();
  store.insertUser({
    id,
    display_name: name,
    avatar_id: null,
    created_at: stamp,
    updated_at: stamp,
    is_guest: 1,
  });
  return id;
}

function human(playerId: string, name: string, userId: string, score: number, bigMoments: number) {
  return { playerId, name, userId, bot: false, score, left: false, bigMoments };
}
