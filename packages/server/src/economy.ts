import { isWithheldId, itemById, TEST_BONES, TEST_GOLD } from "@uhoh/rules";
import type { Store } from "./db.js";

/** Bones for finishing a completed game. Incomplete games pay nothing. */
export const GAME_FINISH_BONES = 20;
/** Extra Bones for the winner, on top of the finish pay. */
export const GAME_WIN_BONES = 40;
/** Bones for each UH-OH (a play awarded 20 or more). */
export const GAME_MOMENT_BONES = 10;
/** Game Bones stop here for the Denver day. Login and challenges are separate and not paid here. */
export const GAME_BONES_DAILY_CAP = 600;

/**
 * Free season-track items. Pass-only extras stay out of this list.
 * Thresholds match the tier table; bots.test checks they still do.
 */
export const SEASON_FREE_TRACK = [
  { tierId: "shuffler", min: 250, items: ["TT-003"] },
  { tierId: "clacker", min: 600, items: ["FRM-004"] },
  { tierId: "hustler", min: 1100, items: ["TBL-006"] },
  { tierId: "shark", min: 1800, items: ["CHR-006", "FX-003", "FRM-002"] },
  { tierId: "boss", min: 2800, items: ["TIL-009"] },
  { tierId: "big-shot", min: 4200, items: ["CHR-023", "EMO-005"] },
  { tierId: "legend", min: 6000, items: ["FRM-003"] },
] as const;

/** Season-pass extras. They are never granted and never sold. */
export const SEASON_PASS_ONLY = ["TT-008", "EMO-006", "FX-010"] as const;

export function bonesForGame(input: { completed: boolean; won: boolean; moments: number }): number {
  if (!input.completed) return 0;
  const moments = Math.max(0, Math.floor(input.moments));
  return GAME_FINISH_BONES + (input.won ? GAME_WIN_BONES : 0) + moments * GAME_MOMENT_BONES;
}

export interface BoneGrant {
  awarded: number;
  balance: number;
  gross: number;
  /** True when this game was already paid, so the wallet did not move. */
  already: boolean;
}

/**
 * Pay game Bones once per account per game. The daily cap counts only these
 * earnings. A missing human wallet is opened at the test balance first.
 * A bot wallet is opened at zero.
 */
export function applyGameBones(
  store: Store,
  userId: string,
  input: {
    completed: boolean;
    won: boolean;
    moments: number;
    day: string;
    at: string;
    roomId: string;
    seriesId: string;
    gameNumber: number;
  },
): BoneGrant {
  const user = store.user(userId);
  if (!user) return { awarded: 0, balance: 0, gross: 0, already: false };
  const gross = bonesForGame(input);
  const prior = store.db
    .prepare(
      `SELECT amount FROM bone_grants WHERE user_id = ? AND room_id = ? AND series_id = ? AND game_number = ?`,
    )
    .get(userId, input.roomId, input.seriesId, input.gameNumber) as { amount: number } | undefined;
  if (prior) {
    const wallet = readWallet(store, userId);
    return { awarded: 0, balance: wallet?.bones ?? 0, gross, already: true };
  }
  if (gross === 0) {
    store.db
      .prepare(
        `INSERT INTO bone_grants (user_id, room_id, series_id, game_number, amount, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(userId, input.roomId, input.seriesId, input.gameNumber, input.at);
    const wallet = readWallet(store, userId);
    return { awarded: 0, balance: wallet?.bones ?? 0, gross: 0, already: false };
  }

  const opened = ensureWallet(store, user, input.at);
  const day = input.day;
  const earnedToday = opened.earned_day === day ? opened.earned_today : 0;
  const room = Math.max(0, GAME_BONES_DAILY_CAP - earnedToday);
  const awarded = Math.min(gross, room);
  const next = opened.bones + awarded;
  if (next < 0 || awarded < 0) {
    console.warn(`[economy] refused a negative Bones update for ${userId}`);
    return { awarded: 0, balance: opened.bones, gross, already: false };
  }
  store.db
    .prepare(`UPDATE wallets SET bones = ?, earned_day = ?, earned_today = ? WHERE user_id = ?`)
    .run(next, day, earnedToday + awarded, userId);
  store.db
    .prepare(
      `INSERT INTO bone_grants (user_id, room_id, series_id, game_number, amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, input.roomId, input.seriesId, input.gameNumber, awarded, input.at);
  return { awarded, balance: next, gross, already: false };
}

/** Grant every free-track item the account's season points have reached. Idempotent. */
export function grantSeasonRewards(store: Store, userId: string, points: number, at: string): string[] {
  const granted: string[] = [];
  const passOnly = new Set<string>(SEASON_PASS_ONLY);
  for (const tier of SEASON_FREE_TRACK) {
    if (points < tier.min) continue;
    for (const itemId of tier.items) {
      if (passOnly.has(itemId) || isWithheldId(itemId)) continue;
      const item = itemById(itemId);
      if (!item || item.obtain !== "season") continue;
      const result = store.db
        .prepare(
          `INSERT INTO owned_items (user_id, item_id, acquired_at) VALUES (?, ?, ?)
           ON CONFLICT(user_id, item_id) DO NOTHING`,
        )
        .run(userId, itemId, at);
      if (Number(result.changes) > 0) granted.push(itemId);
    }
  }
  return granted;
}

interface WalletRow {
  bones: number;
  gold_bones: number;
  earned_day: string | null;
  earned_today: number;
}

function readWallet(store: Store, userId: string): WalletRow | null {
  return (
    (store.db.prepare(`SELECT bones, gold_bones, earned_day, earned_today FROM wallets WHERE user_id = ?`).get(userId) as
      | WalletRow
      | undefined) ?? null
  );
}

function ensureWallet(store: Store, user: { id: string; is_bot?: number }, at: string): WalletRow {
  const existing = readWallet(store, user.id);
  if (existing) return existing;
  const bot = user.is_bot === 1;
  store.db
    .prepare(
      `INSERT INTO wallets (user_id, bones, gold_bones, created_at, earned_today) VALUES (?, ?, ?, ?, 0)`,
    )
    .run(user.id, bot ? 0 : TEST_BONES, bot ? 0 : TEST_GOLD, at);
  return readWallet(store, user.id) ?? { bones: 0, gold_bones: 0, earned_day: null, earned_today: 0 };
}
