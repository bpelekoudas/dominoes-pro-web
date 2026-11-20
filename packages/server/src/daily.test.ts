import { describe, expect, it } from "vitest";
import { TEST_BONES } from "@uhoh/rules";
import { Accounts, SESSION_COOKIE } from "./accounts.js";
import { clearAdminCache } from "./admin.js";
import { createApp } from "./app.js";
import { Store } from "./db.js";
import {
  challengesOn,
  claimLogin,
  dailyAdmin,
  dailyStatus,
  defsFor,
  mergeDaily,
  noteHand,
  noteScore,
  previewDaily,
  recordDailyProgress,
  shiftDay,
  type ChallengeId,
} from "./daily.js";
import { GAME_FINISH_BONES, LOGIN_STREAK_BONES, applyGameBones } from "./economy.js";
import { denverDay } from "./ranking.js";

const SECRET = "test-secret-value-16";

function noon(day: string): Date {
  return new Date(`${day}T18:00:00.000Z`);
}

function guestId(accounts: Accounts, name: string): string {
  const result = accounts.createGuest(name, null, null, true);
  if (result.outcome !== "ok") throw new Error(result.outcome);
  return result.user.id;
}

function bonesOf(store: Store, userId: string): { bones: number; earned_today: number } {
  return store.db.prepare(`SELECT bones, earned_today FROM wallets WHERE user_id = ?`).get(userId) as {
    bones: number;
    earned_today: number;
  };
}

function cookiePair(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : (header ?? "");
  return raw.split(";")[0] ?? "";
}

describe("daily login and challenges", () => {
  it("pays the ladder once per Denver day, resets after a miss, and loops after day 7", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const id = guestId(accounts, "Ada");
    const before = bonesOf(store, id);

    expect(denverDay(new Date("2026-10-19T05:59:00.000Z"))).toBe("2026-10-18");
    expect(denverDay(new Date("2026-10-19T06:00:00.000Z"))).toBe("2026-10-19");
    const late = claimLogin(store, id, new Date("2026-10-19T05:59:00.000Z"));
    expect(late.login.ladderDay).toBe(1);
    expect(late.awarded).toBe(50);
    const nextMorning = claimLogin(store, id, new Date("2026-10-19T06:00:00.000Z"));
    expect(nextMorning.already).toBe(false);
    expect(nextMorning.login.ladderDay).toBe(2);
    expect(nextMorning.login.streakTotal).toBe(2);
    expect(nextMorning.awarded).toBe(50);

    const repeat = claimLogin(store, id, new Date("2026-10-19T20:00:00.000Z"));
    expect(repeat.already).toBe(true);
    expect(repeat.awarded).toBe(0);
    expect(bonesOf(store, id).earned_today).toBe(0);
    expect(bonesOf(store, id).bones).toBe(before.bones + 100);

    const missed = claimLogin(store, id, noon("2026-10-21"));
    expect(missed.login.ladderDay).toBe(1);
    expect(missed.login.streakTotal).toBe(1);
    expect(missed.awarded).toBe(50);

    const fresh = guestId(accounts, "Bea");
    for (let index = 0; index < 7; index += 1) {
      const day = shiftDay("2026-11-01", index);
      const claimed = claimLogin(store, fresh, noon(day));
      expect(claimed.login.ladderDay).toBe(index + 1);
      expect(claimed.login.streakTotal).toBe(index + 1);
      expect(claimed.awarded).toBe(LOGIN_STREAK_BONES[index]);
      expect(claimed.login.days[6]?.big).toBe(true);
    }
    const loop = claimLogin(store, fresh, noon("2026-11-08"));
    expect(loop.login.ladderDay).toBe(1);
    expect(loop.login.streakTotal).toBe(8);
    expect(loop.awarded).toBe(50);
    expect(loop.login.days.filter((day) => day.claimed).map((day) => day.day)).toEqual([1]);
  });

  it("keeps login Bones outside the game earning cap", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const id = guestId(accounts, "Cara");
    const claimed = claimLogin(store, id, noon("2026-10-20"));
    const paid = applyGameBones(store, id, {
      completed: true,
      won: false,
      moments: 0,
      day: claimed.today,
      at: noon("2026-10-20").toISOString(),
      roomId: "room",
      seriesId: "series",
      gameNumber: 1,
    });
    expect(paid.awarded).toBe(GAME_FINISH_BONES);
    expect(bonesOf(store, id).earned_today).toBe(GAME_FINISH_BONES);
    expect(bonesOf(store, id).bones).toBe(TEST_BONES + LOGIN_STREAK_BONES[0] + GAME_FINISH_BONES);
  });

  it("pays each challenge once and ignores a short count, a small play, and an unfinished game", () => {
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const at = noon("2026-10-20").toISOString();
    const cases: Array<{ id: ChallengeId; delta: Record<string, number>; bones: number }> = [
      { id: "play3", delta: { games: 3 }, bones: 25 },
      { id: "no-draw", delta: { no_draw_hands: 1 }, bones: 25 },
      { id: "win1", delta: { wins: 1 }, bones: 25 },
      { id: "score15", delta: { score15: 1 }, bones: 25 },
      { id: "win2", delta: { wins: 2 }, bones: 35 },
      { id: "score25", delta: { score25: 1 }, bones: 35 },
      { id: "double", delta: { double_hands: 1 }, bones: 35 },
      { id: "margin50", delta: { margin50: 1 }, bones: 40 },
      { id: "match", delta: { matches: 1 }, bones: 40 },
      { id: "lock", delta: { locks: 1 }, bones: 40 },
      { id: "win3", delta: { wins: 3 }, bones: 40 },
    ];
    for (const item of cases) {
      const id = guestId(accounts, item.id);
      const lines = recordDailyProgress(store, id, "2026-10-20", item.delta, at, defsFor([item.id]));
      expect(lines).toEqual([`Daily challenge complete +${item.bones} Bones`]);
      const again = recordDailyProgress(store, id, "2026-10-20", item.delta, at, defsFor([item.id]));
      expect(again).toEqual([]);
      expect(bonesOf(store, id).earned_today).toBe(0);
      expect(bonesOf(store, id).bones).toBe(TEST_BONES + item.bones);
    }

    const partial = guestId(accounts, "Partial");
    expect(recordDailyProgress(store, partial, "2026-10-20", { games: 2 }, at, defsFor(["play3"]))).toEqual([]);
    expect(recordDailyProgress(store, partial, "2026-10-20", { games: 1 }, at, defsFor(["play3"]))).toEqual([
      "Daily challenge complete +25 Bones",
    ]);

    const scorer = guestId(accounts, "Scorer");
    noteScore(store, scorer, 10, noon("2026-10-20"));
    noteScore(store, scorer, 15, noon("2026-10-20"));
    noteScore(store, scorer, 25, noon("2026-10-20"));
    const scores = store.db
      .prepare(`SELECT score15, score25, games FROM daily_progress WHERE user_id = ?`)
      .get(scorer) as { score15: number; score25: number; games: number };
    expect(scores).toEqual({ score15: 2, score25: 1, games: 0 });

    const hand = guestId(accounts, "Hand");
    noteHand(
      store,
      {
        userId: hand,
        gameFinished: false,
        gameWon: false,
        wonHand: true,
        drew: true,
        doubleOnBoard: true,
        margin: 10,
        matchWon: false,
        lockGame: false,
      },
      noon("2026-10-20"),
    );
    const open = store.db
      .prepare(`SELECT games, wins, no_draw_hands, double_hands, margin50, matches, locks FROM daily_progress WHERE user_id = ?`)
      .get(hand) as Record<string, number>;
    expect(open.games).toBe(0);
    expect(open.wins).toBe(0);
    expect(open.no_draw_hands).toBe(0);
    expect(open.double_hands).toBe(1);

    const locked = guestId(accounts, "Lock");
    noteHand(
      store,
      {
        userId: locked,
        gameFinished: true,
        gameWon: true,
        wonHand: true,
        drew: false,
        doubleOnBoard: false,
        margin: 50,
        matchWon: true,
        lockGame: true,
      },
      noon("2026-10-20"),
    );
    const closed = store.db
      .prepare(`SELECT games, wins, no_draw_hands, margin50, matches, locks FROM daily_progress WHERE user_id = ?`)
      .get(locked) as Record<string, number>;
    expect(closed).toMatchObject({ games: 1, wins: 1, no_draw_hands: 1, margin50: 1, matches: 1, locks: 1 });

    const soak = guestId(accounts, "Soak");
    store.db.prepare(`UPDATE users SET is_soak = 1 WHERE id = ?`).run(soak);
    expect(noteScore(store, soak, 25, noon("2026-10-20"))).toEqual([]);
    expect(store.db.prepare(`SELECT 1 AS n FROM daily_progress WHERE user_id = ?`).get(soak)).toBeUndefined();
  });

  it("picks the same three challenges for a day, one of each tier, with no repeat from yesterday", () => {
    let previous = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const day = shiftDay("2026-10-01", index);
      const set = challengesOn(day);
      expect(set.map((item) => item.tier)).toEqual(["easy", "medium", "hard"]);
      expect(set.reduce((sum, item) => sum + item.bones, 0)).toBe(100);
      expect(Math.max(...set.map((item) => item.minGames))).toBeGreaterThanOrEqual(2);
      const ids = set.map((item) => item.id);
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(previous.has(id)).toBe(false);
      previous = new Set(ids);
    }
    expect(challengesOn("2026-12-01").map((item) => item.id)).toEqual(challengesOn("2026-12-01").map((item) => item.id));
    expect(previewDaily("nope")).toBeNull();
    expect(previewDaily("2026-02-31")).toBeNull();
    const preview = previewDaily("2026-12-01");
    expect(preview?.challenges).toHaveLength(3);
    expect(preview?.loginBones).toEqual([...LOGIN_STREAK_BONES]);
  });

  it("keeps a guest streak on the same account, and moves it when they confirm a switch", async () => {
    const store = new Store(":memory:");
    let now = noon("2026-10-20");
    const accounts = new Accounts(store, {
      secret: SECRET,
      now: () => now,
      googleClientId: "google-client",
      verifyGoogle: async (token) => ({ sub: token, email: `${token}@example.com` }),
    });
    const ada = accounts.createGuest("Ada", null, null, true);
    if (ada.outcome !== "ok") throw new Error(ada.outcome);
    claimLogin(store, ada.user.id, now);
    const attached = await accounts.signInGoogle("ada", ada.user.id, true, true);
    expect(attached.outcome).toBe("ok");
    if (attached.outcome !== "ok") return;
    expect(attached.user.id).toBe(ada.user.id);
    expect(dailyStatus(store, ada.user.id, now).login.claimed).toBe(true);
    expect(dailyStatus(store, ada.user.id, now).login.streakTotal).toBe(1);

    const bea = accounts.createGuest("Bea", null, null, true);
    if (bea.outcome !== "ok") throw new Error(bea.outcome);
    await accounts.signInGoogle("bea", bea.user.id, true, true);
    now = noon("2026-10-21");
    claimLogin(store, ada.user.id, now);
    now = noon("2026-10-22");
    claimLogin(store, ada.user.id, now);
    const beaBones = bonesOf(store, bea.user.id).bones;
    const switched = await accounts.signInGoogle("bea", ada.user.id, true, true);
    expect(switched.outcome).toBe("ok");
    if (switched.outcome !== "ok") return;
    expect(switched.user.id).toBe(bea.user.id);
    const moved = dailyStatus(store, bea.user.id, now);
    expect(moved.login.claimed).toBe(true);
    expect(moved.login.streakTotal).toBe(3);
    expect(moved.login.ladderDay).toBe(3);
    expect(bonesOf(store, bea.user.id).bones).toBe(beaBones);

    let play3 = "";
    for (let index = 0; index < 40; index += 1) {
      const candidate = shiftDay("2026-10-01", index);
      if (challengesOn(candidate).some((item) => item.id === "play3")) {
        play3 = candidate;
        break;
      }
    }
    const from = guestId(accounts, "From");
    const to = guestId(accounts, "To");
    recordDailyProgress(store, from, play3, { games: 2 }, noon(play3).toISOString(), defsFor(["play3"]));
    recordDailyProgress(store, to, play3, { games: 1 }, noon(play3).toISOString(), defsFor(["play3"]));
    const toBefore = bonesOf(store, to).bones;
    mergeDaily(store, from, to, noon(play3));
    expect(bonesOf(store, to).bones).toBe(toBefore + 25);
    const claim = store.db
      .prepare(`SELECT bones FROM challenge_claims WHERE user_id = ? AND challenge_id = 'play3'`)
      .get(to) as { bones: number };
    expect(claim.bones).toBe(25);
  });

  it("serves the claim on the session cookie and lets only an admin preview a day", async () => {
    const previous = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    const store = new Store(":memory:");
    const accounts = new Accounts(store, { secret: SECRET });
    const { app } = await createApp({ store, accounts, serveWeb: false });
    try {
      const signedOut = await app.inject({ method: "GET", url: "/api/daily" });
      expect(signedOut.statusCode).toBe(401);

      const created = await app.inject({
        method: "POST",
        url: "/api/guest",
        payload: { displayName: "Nia", age13: true },
      });
      const cookie = cookiePair(created.headers["set-cookie"]);
      expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
      const first = await app.inject({ method: "POST", url: "/api/daily/claim", headers: { cookie } });
      expect(first.statusCode).toBe(200);
      expect(first.json().awarded).toBe(50);
      expect(first.json().login.claimed).toBe(true);
      expect(first.json().challenges).toHaveLength(3);
      const second = await app.inject({ method: "POST", url: "/api/daily/claim", headers: { cookie } });
      expect(second.json().already).toBe(true);
      expect(second.json().awarded).toBe(0);
      expect(second.json().bones).toBe(first.json().bones);

      const claimsBefore = store.db.prepare(`SELECT COUNT(*) AS n FROM login_claims`).get() as { n: number };
      const hidden = await app.inject({
        method: "GET",
        url: "/api/admin/daily?day=2026-12-25",
        headers: { cookie },
      });
      expect(hidden.statusCode).toBe(403);
      const claimsAfter = store.db.prepare(`SELECT COUNT(*) AS n FROM login_claims`).get() as { n: number };
      expect(claimsAfter.n).toBe(claimsBefore.n);

      const userId = created.json().user.id as string;
      store.insertIdentity({
        id: "id-admin",
        user_id: userId,
        provider: "google",
        provider_subject: "nia",
        email: "bpelekoudas@gmail.com",
        created_at: new Date().toISOString(),
      });
      const preview = await app.inject({
        method: "GET",
        url: "/api/admin/daily?day=2026-12-25",
        headers: { cookie },
      });
      expect(preview.statusCode).toBe(200);
      expect(preview.json().challenges).toHaveLength(3);
      expect(preview.json().day).toBe("2026-12-25");
      const still = store.db.prepare(`SELECT COUNT(*) AS n FROM login_claims`).get() as { n: number };
      expect(still.n).toBe(claimsBefore.n);

      clearAdminCache();
      const stats = dailyAdmin(store, new Date());
      expect(stats.loginsToday).toBeGreaterThanOrEqual(0);
      expect(stats.streak).toHaveLength(7);
      expect(stats.challengeBonesToday.easy + stats.challengeBonesToday.medium + stats.challengeBonesToday.hard).toBeGreaterThanOrEqual(0);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
      clearAdminCache();
      await app.close();
    }
  });
});
