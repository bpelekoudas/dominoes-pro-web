import type { BoardState } from "@uhoh/rules";
import { isDouble } from "@uhoh/rules";
import type { Store } from "./db.js";
import {
  CHALLENGE_EASY_BONES,
  CHALLENGE_HARD_BONES,
  CHALLENGE_MEDIUM_BONES,
  LOGIN_STREAK_BONES,
  grantBonusBones,
} from "./economy.js";
import { denverDay } from "./ranking.js";

/**
 * Three challenges a day, one from each tier. The same three for every player.
 * A set always needs at least two finished games, and it never repeats an id
 * from the day before. Games against the computer count, at any difficulty.
 */
export type ChallengeId =
  | "play3"
  | "no-draw"
  | "win1"
  | "score15"
  | "win2"
  | "score25"
  | "double"
  | "margin50"
  | "match"
  | "lock"
  | "win3";

export type ChallengeTier = "easy" | "medium" | "hard";

export interface ChallengeDef {
  id: ChallengeId;
  tier: ChallengeTier;
  title: string;
  detail: string;
  bones: number;
  goal: number;
  /** Finished games a player needs before this one can be done. */
  minGames: number;
}

const EASY: ChallengeId[] = ["play3", "no-draw", "win1", "score15"];
const MEDIUM: ChallengeId[] = ["win2", "score25", "double"];
const HARD: ChallengeId[] = ["margin50", "match", "lock", "win3"];

const DEFS: Record<ChallengeId, ChallengeDef> = {
  play3: {
    id: "play3",
    tier: "easy",
    title: "Play 3 games",
    detail: "Finish 3 games. A game left early does not count.",
    bones: CHALLENGE_EASY_BONES,
    goal: 3,
    minGames: 3,
  },
  "no-draw": {
    id: "no-draw",
    tier: "easy",
    title: "Win a hand without drawing",
    detail: "Win the hand without taking from the boneyard.",
    bones: CHALLENGE_EASY_BONES,
    goal: 1,
    minGames: 1,
  },
  win1: {
    id: "win1",
    tier: "easy",
    title: "Win a game",
    detail: "Win one game. The computer counts.",
    bones: CHALLENGE_EASY_BONES,
    goal: 1,
    minGames: 1,
  },
  score15: {
    id: "score15",
    tier: "easy",
    title: "Score 15+ on one play",
    detail: "One play awards 15 or more. A running total does not count.",
    bones: CHALLENGE_EASY_BONES,
    goal: 1,
    minGames: 1,
  },
  win2: {
    id: "win2",
    tier: "medium",
    title: "Win 2 games",
    detail: "Win two games today. The computer counts.",
    bones: CHALLENGE_MEDIUM_BONES,
    goal: 2,
    minGames: 2,
  },
  score25: {
    id: "score25",
    tier: "medium",
    title: "Score 25+ on one play",
    detail: "One play awards 25 or more. A running total does not count.",
    bones: CHALLENGE_MEDIUM_BONES,
    goal: 1,
    minGames: 1,
  },
  double: {
    id: "double",
    tier: "medium",
    title: "Win a hand with a double on the board",
    detail: "Win the hand while a double is on the table.",
    bones: CHALLENGE_MEDIUM_BONES,
    goal: 1,
    minGames: 1,
  },
  margin50: {
    id: "margin50",
    tier: "hard",
    title: "Win a game by 50 points",
    detail: "Finish at least 50 points ahead of the next score.",
    bones: CHALLENGE_HARD_BONES,
    goal: 1,
    minGames: 1,
  },
  match: {
    id: "match",
    tier: "hard",
    title: "Win a match",
    detail: "Win a full series, best of 3, 5, or 7.",
    bones: CHALLENGE_HARD_BONES,
    goal: 1,
    minGames: 2,
  },
  lock: {
    id: "lock",
    tier: "hard",
    title: "Win a game with a UH-OH lock",
    detail: "Win the locked hand, and that hand wins the game.",
    bones: CHALLENGE_HARD_BONES,
    goal: 1,
    minGames: 1,
  },
  win3: {
    id: "win3",
    tier: "hard",
    title: "Win 3 games",
    detail: "Win three games today. The computer counts.",
    bones: CHALLENGE_HARD_BONES,
    goal: 3,
    minGames: 3,
  },
};

const EPOCH = Date.UTC(2020, 0, 1);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pickCache = new Map<number, { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId }>();

interface Counters {
  games: number;
  wins: number;
  no_draw_hands: number;
  double_hands: number;
  score15: number;
  score25: number;
  margin50: number;
  matches: number;
  locks: number;
}

interface LoginRow {
  day: string;
  streak_day: number;
  streak_total: number;
  bones: number;
}

const ZERO: Counters = {
  games: 0,
  wins: 0,
  no_draw_hands: 0,
  double_hands: 0,
  score15: 0,
  score25: 0,
  margin50: 0,
  matches: 0,
  locks: 0,
};

export interface HandCredit {
  userId: string;
  gameFinished: boolean;
  gameWon: boolean;
  wonHand: boolean;
  drew: boolean;
  doubleOnBoard: boolean;
  margin: number;
  matchWon: boolean;
  lockGame: boolean;
}

export interface LoginDay {
  day: number;
  bones: number;
  claimed: boolean;
  today: boolean;
  big: boolean;
}

export interface DailyChallengeView {
  id: ChallengeId;
  tier: ChallengeTier;
  title: string;
  detail: string;
  bones: number;
  progress: number;
  goal: number;
  done: boolean;
}

export interface DailyStatus {
  today: string;
  bones: number;
  awarded: number;
  already: boolean;
  login: {
    claimed: boolean;
    ladderDay: number;
    streakTotal: number;
    bones: number;
    days: LoginDay[];
  };
  challenges: DailyChallengeView[];
  done: number;
}

export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (date ?? 1) + delta)).toISOString().slice(0, 10);
}

export function dayIndex(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.round((Date.UTC(year!, (month ?? 1) - 1, date ?? 1) - EPOCH) / 86_400_000);
}

export function boardHasDouble(board: BoardState | null | undefined): boolean {
  if (!board?.center) return false;
  if (isDouble(board.center.tileId)) return true;
  for (const arm of Object.values(board.arms)) {
    for (const tile of arm) if (isDouble(tile.tileId)) return true;
  }
  return false;
}

export function challengeLine(bones: number): string {
  return `Daily challenge complete +${bones} Bones`;
}

export function challengesOn(day: string): ChallengeDef[] {
  const pick = ensurePick(Math.max(0, dayIndex(day)));
  return [DEFS[pick.easy], DEFS[pick.medium], DEFS[pick.hard]];
}

export function defsFor(ids: ChallengeId[]): ChallengeDef[] {
  return ids.map((id) => DEFS[id]);
}

/** Read-only look at a Denver day. It does not read or write player rows. */
export function previewDaily(day: string): {
  day: string;
  challenges: Array<{ id: ChallengeId; tier: ChallengeTier; title: string; bones: number }>;
  loginBones: number[];
} | null {
  if (!isDay(day)) return null;
  return {
    day,
    challenges: challengesOn(day).map((item) => ({
      id: item.id,
      tier: item.tier,
      title: item.title,
      bones: item.bones,
    })),
    loginBones: [...LOGIN_STREAK_BONES],
  };
}

export function dailyStatus(store: Store, userId: string, now: Date): DailyStatus {
  const today = denverDay(now);
  const login = loginView(store, userId, today);
  const challenges = challengeViews(store, userId, today);
  return {
    today,
    bones: walletBones(store, userId),
    awarded: 0,
    already: false,
    login,
    challenges,
    done: challenges.filter((item) => item.done).length,
  };
}

export function claimLogin(store: Store, userId: string, now: Date): DailyStatus {
  const today = denverDay(now);
  const at = now.toISOString();
  let awarded = 0;
  let already = false;
  transaction(store, () => {
    const existing = loginOn(store, userId, today);
    if (existing) {
      already = true;
      return;
    }
    const view = loginView(store, userId, today);
    const total = view.streakTotal + 1;
    store.db
      .prepare(
        `INSERT INTO login_claims (user_id, day, streak_day, streak_total, bones, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, today, view.ladderDay, total, view.bones, at);
    awarded = grantBonusBones(store, userId, view.bones, at).awarded;
  });
  const status = dailyStatus(store, userId, now);
  return { ...status, awarded, already };
}

/** A scoring play. 15+ and 25+ are separate. The hand total is not used. */
export function noteScore(store: Store, userId: string, awarded: number, now: Date): string[] {
  if (!Number.isFinite(awarded) || awarded < 15) return [];
  if (skipUser(store, userId)) return [];
  const delta: Partial<Counters> = { score15: 1 };
  if (awarded >= 25) delta.score25 = 1;
  return recordDailyProgress(store, userId, denverDay(now), delta, now.toISOString());
}

/** One finished hand. Abandoned games never call this. */
export function noteHand(store: Store, credit: HandCredit, now: Date): string[] {
  if (skipUser(store, credit.userId)) return [];
  const delta: Partial<Counters> = {};
  if (credit.gameFinished) delta.games = 1;
  if (credit.gameWon) delta.wins = 1;
  if (credit.wonHand && !credit.drew) delta.no_draw_hands = 1;
  if (credit.wonHand && credit.doubleOnBoard) delta.double_hands = 1;
  if (credit.gameWon && credit.margin >= 50) delta.margin50 = 1;
  if (credit.matchWon) delta.matches = 1;
  if (credit.lockGame) delta.locks = 1;
  if (Object.values(delta).every((value) => !value)) return [];
  return recordDailyProgress(store, credit.userId, denverDay(now), delta, now.toISOString());
}

/**
 * Move a guest's streak onto the account they confirmed. Bones already paid
 * stay on the first payout. Progress adds up, and a challenge that becomes
 * finished pays the destination once.
 */
export function mergeDaily(store: Store, fromId: string, toId: string, now: Date): void {
  if (!fromId || !toId || fromId === toId) return;
  if (skipUser(store, fromId) || skipUser(store, toId)) return;
  const today = denverDay(now);
  const at = now.toISOString();
  transaction(store, () => {
    const toDays = new Set(loginRows(store, toId).map((row) => row.day));
    for (const row of loginRows(store, fromId)) {
      if (toDays.has(row.day)) continue;
      store.db
        .prepare(
          `INSERT INTO login_claims (user_id, day, streak_day, streak_total, bones, created_at)
           VALUES (?, ?, ?, ?, 0, ?)`,
        )
        .run(toId, row.day, row.streak_day, row.streak_total, at);
    }
    for (const row of progressRows(store, fromId)) {
      addProgress(store, toId, row.day, row);
    }
    const claims = store.db
      .prepare(`SELECT day, challenge_id, tier FROM challenge_claims WHERE user_id = ?`)
      .all(fromId) as Array<{ day: string; challenge_id: string; tier: string }>;
    const insertClaim = store.db.prepare(
      `INSERT INTO challenge_claims (user_id, day, challenge_id, tier, bones, created_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(user_id, day, challenge_id) DO NOTHING`,
    );
    for (const row of claims) insertClaim.run(toId, row.day, row.challenge_id, row.tier, at);
    payReady(store, toId, today, at, challengesOn(today));
  });
}

export function recordDailyProgress(
  store: Store,
  userId: string,
  day: string,
  delta: Partial<Counters>,
  at: string,
  challenges: ChallengeDef[] = challengesOn(day),
): string[] {
  let lines: string[] = [];
  transaction(store, () => {
    addProgress(store, userId, day, delta);
    lines = payReady(store, userId, day, at, challenges);
  });
  return lines;
}

export interface DailyAdmin {
  loginsToday: number;
  loginBonesToday: number;
  loginBonesWeek: number;
  streak: number[];
  challengesToday: Record<ChallengeTier, number>;
  challengesWeek: Record<ChallengeTier, number>;
  challengeBonesToday: Record<ChallengeTier, number>;
  challengeBonesWeek: Record<ChallengeTier, number>;
}

export function dailyAdmin(store: Store, now = new Date()): DailyAdmin {
  const today = denverDay(now);
  const start = shiftDay(today, -6);
  const humans = `u.is_bot = 0 AND COALESCE(u.is_soak, 0) = 0`;
  const loginsToday = count(
    store,
    `SELECT COUNT(*) AS n FROM login_claims c JOIN users u ON u.id = c.user_id WHERE c.day = ? AND ${humans}`,
    today,
  );
  const loginBonesToday = count(
    store,
    `SELECT COALESCE(SUM(c.bones), 0) AS n FROM login_claims c JOIN users u ON u.id = c.user_id WHERE c.day = ? AND ${humans}`,
    today,
  );
  const loginBonesWeek = count(
    store,
    `SELECT COALESCE(SUM(c.bones), 0) AS n FROM login_claims c JOIN users u ON u.id = c.user_id WHERE c.day >= ? AND c.day <= ? AND ${humans}`,
    start,
    today,
  );
  const streakRows = store.db
    .prepare(
      `SELECT c.streak_day AS day, COUNT(*) AS n FROM login_claims c JOIN users u ON u.id = c.user_id
       WHERE c.day = ? AND ${humans} GROUP BY c.streak_day`,
    )
    .all(today) as Array<{ day: number; n: number }>;
  const streak = [0, 0, 0, 0, 0, 0, 0];
  for (const row of streakRows) {
    if (row.day >= 1 && row.day <= 7) streak[row.day - 1] = Number(row.n);
  }
  return {
    loginsToday,
    loginBonesToday,
    loginBonesWeek,
    streak,
    challengesToday: tierCounts(store, today, today),
    challengesWeek: tierCounts(store, start, today),
    challengeBonesToday: tierBones(store, today, today),
    challengeBonesWeek: tierBones(store, start, today),
  };
}

function tierCounts(store: Store, start: string, end: string): Record<ChallengeTier, number> {
  const rows = store.db
    .prepare(
      `SELECT c.tier AS tier, COUNT(*) AS n FROM challenge_claims c JOIN users u ON u.id = c.user_id
       WHERE c.day >= ? AND c.day <= ? AND u.is_bot = 0 AND COALESCE(u.is_soak, 0) = 0
       GROUP BY c.tier`,
    )
    .all(start, end) as Array<{ tier: string; n: number }>;
  return fillTiers(rows);
}

function tierBones(store: Store, start: string, end: string): Record<ChallengeTier, number> {
  const rows = store.db
    .prepare(
      `SELECT c.tier AS tier, COALESCE(SUM(c.bones), 0) AS n FROM challenge_claims c JOIN users u ON u.id = c.user_id
       WHERE c.day >= ? AND c.day <= ? AND u.is_bot = 0 AND COALESCE(u.is_soak, 0) = 0
       GROUP BY c.tier`,
    )
    .all(start, end) as Array<{ tier: string; n: number }>;
  return fillTiers(rows);
}

function fillTiers(rows: Array<{ tier: string; n: number }>): Record<ChallengeTier, number> {
  const out = { easy: 0, medium: 0, hard: 0 };
  for (const row of rows) {
    if (row.tier === "easy" || row.tier === "medium" || row.tier === "hard") out[row.tier] = Number(row.n);
  }
  return out;
}

function ensurePick(index: number): { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId } {
  const cached = pickCache.get(index);
  if (cached) return cached;
  let prev: { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId } | null = null;
  let from = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const found = pickCache.get(cursor);
    if (found) {
      prev = found;
      from = cursor + 1;
      break;
    }
  }
  for (let cursor = from; cursor <= index; cursor += 1) {
    const pick = choose(cursor, prev);
    pickCache.set(cursor, pick);
    prev = pick;
  }
  return pickCache.get(index)!;
}

function choose(
  epoch: number,
  prev: { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId } | null,
): { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId } {
  let best: { pick: { easy: ChallengeId; medium: ChallengeId; hard: ChallengeId }; offset: number; games: number } | null =
    null;
  for (let easyStep = 0; easyStep < EASY.length; easyStep += 1) {
    for (let mediumStep = 0; mediumStep < MEDIUM.length; mediumStep += 1) {
      for (let hardStep = 0; hardStep < HARD.length; hardStep += 1) {
        const easy = EASY[(epoch + easyStep) % EASY.length]!;
        const medium = MEDIUM[(epoch + mediumStep) % MEDIUM.length]!;
        const hard = HARD[(epoch + hardStep) % HARD.length]!;
        if (prev && (easy === prev.easy || medium === prev.medium || hard === prev.hard)) continue;
        const games = Math.max(DEFS[easy].minGames, DEFS[medium].minGames, DEFS[hard].minGames);
        if (games < 2) continue;
        const offset = easyStep + mediumStep + hardStep;
        if (!best || offset < best.offset || (offset === best.offset && games > best.games)) {
          best = { pick: { easy, medium, hard }, offset, games };
        }
      }
    }
  }
  if (!best) throw new Error("No daily challenge set.");
  return best.pick;
}

function loginView(store: Store, userId: string, today: string): DailyStatus["login"] {
  const todayRow = loginOn(store, userId, today);
  const previous = latestLoginBefore(store, userId, today);
  const anchor = todayRow ?? (previous && previous.day === shiftDay(today, -1) ? previous : null);
  const claimed = Boolean(todayRow);
  let ladderDay = 1;
  let streakTotal = 0;
  if (todayRow) {
    ladderDay = clampLadder(todayRow.streak_day);
    streakTotal = todayRow.streak_total;
  } else if (anchor) {
    ladderDay = anchor.streak_day === 7 ? 1 : clampLadder(anchor.streak_day) + 1;
    if (ladderDay > 7) ladderDay = 1;
    streakTotal = anchor.streak_total;
  }
  const bones = LOGIN_STREAK_BONES[ladderDay - 1] ?? LOGIN_STREAK_BONES[0];
  const days = LOGIN_STREAK_BONES.map((amount, index) => {
    const day = index + 1;
    const checked = Boolean(anchor) && (claimed ? day <= ladderDay : day < ladderDay);
    return { day, bones: amount, claimed: checked, today: day === ladderDay, big: day === 7 };
  });
  return { claimed, ladderDay, streakTotal, bones, days };
}

function challengeViews(store: Store, userId: string, today: string): DailyChallengeView[] {
  const row = progressOn(store, userId, today);
  const claimed = new Set(
    (
      store.db.prepare(`SELECT challenge_id FROM challenge_claims WHERE user_id = ? AND day = ?`).all(userId, today) as Array<{
        challenge_id: string;
      }>
    ).map((item) => item.challenge_id),
  );
  return challengesOn(today).map((item) => {
    const progress = Math.min(item.goal, progressValue(item.id, row));
    const done = claimed.has(item.id) || progress >= item.goal;
    return {
      id: item.id,
      tier: item.tier,
      title: item.title,
      detail: item.detail,
      bones: item.bones,
      progress: done ? item.goal : progress,
      goal: item.goal,
      done,
    };
  });
}

function progressValue(id: ChallengeId, row: Counters): number {
  if (id === "play3") return row.games;
  if (id === "win1" || id === "win2" || id === "win3") return row.wins;
  if (id === "no-draw") return row.no_draw_hands;
  if (id === "double") return row.double_hands;
  if (id === "score15") return row.score15;
  if (id === "score25") return row.score25;
  if (id === "margin50") return row.margin50;
  if (id === "match") return row.matches;
  return row.locks;
}

function payReady(store: Store, userId: string, day: string, at: string, challenges: ChallengeDef[]): string[] {
  const row = progressOn(store, userId, day);
  const lines: string[] = [];
  const insert = store.db.prepare(
    `INSERT INTO challenge_claims (user_id, day, challenge_id, tier, bones, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day, challenge_id) DO NOTHING`,
  );
  for (const challenge of challenges) {
    if (progressValue(challenge.id, row) < challenge.goal) continue;
    const result = insert.run(userId, day, challenge.id, challenge.tier, challenge.bones, at);
    if (Number(result.changes) === 0) continue;
    grantBonusBones(store, userId, challenge.bones, at);
    lines.push(challengeLine(challenge.bones));
  }
  return lines;
}

function addProgress(store: Store, userId: string, day: string, delta: Partial<Counters>): void {
  const current = { ...progressOn(store, userId, day) };
  for (const key of Object.keys(ZERO) as Array<keyof Counters>) {
    current[key] += Math.max(0, Math.floor(delta[key] ?? 0));
  }
  store.db
    .prepare(
      `INSERT INTO daily_progress (
         user_id, day, games, wins, no_draw_hands, double_hands, score15, score25, margin50, matches, locks
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         games = excluded.games,
         wins = excluded.wins,
         no_draw_hands = excluded.no_draw_hands,
         double_hands = excluded.double_hands,
         score15 = excluded.score15,
         score25 = excluded.score25,
         margin50 = excluded.margin50,
         matches = excluded.matches,
         locks = excluded.locks`,
    )
    .run(
      userId,
      day,
      current.games,
      current.wins,
      current.no_draw_hands,
      current.double_hands,
      current.score15,
      current.score25,
      current.margin50,
      current.matches,
      current.locks,
    );
}

function progressOn(store: Store, userId: string, day: string): Counters {
  const row = store.db
    .prepare(
      `SELECT games, wins, no_draw_hands, double_hands, score15, score25, margin50, matches, locks
       FROM daily_progress WHERE user_id = ? AND day = ?`,
    )
    .get(userId, day) as Counters | undefined;
  return row ? { ...ZERO, ...row } : { ...ZERO };
}

function progressRows(store: Store, userId: string): Array<Counters & { day: string }> {
  return store.db
    .prepare(
      `SELECT day, games, wins, no_draw_hands, double_hands, score15, score25, margin50, matches, locks
       FROM daily_progress WHERE user_id = ?`,
    )
    .all(userId) as unknown as Array<Counters & { day: string }>;
}

function loginOn(store: Store, userId: string, day: string): LoginRow | null {
  return (
    (store.db
      .prepare(`SELECT day, streak_day, streak_total, bones FROM login_claims WHERE user_id = ? AND day = ?`)
      .get(userId, day) as LoginRow | undefined) ?? null
  );
}

function latestLoginBefore(store: Store, userId: string, day: string): LoginRow | null {
  return (
    (store.db
      .prepare(
        `SELECT day, streak_day, streak_total, bones FROM login_claims
         WHERE user_id = ? AND day < ? ORDER BY day DESC LIMIT 1`,
      )
      .get(userId, day) as LoginRow | undefined) ?? null
  );
}

function loginRows(store: Store, userId: string): LoginRow[] {
  return store.db
    .prepare(`SELECT day, streak_day, streak_total, bones FROM login_claims WHERE user_id = ? ORDER BY day`)
    .all(userId) as unknown as LoginRow[];
}

function walletBones(store: Store, userId: string): number {
  const row = store.db.prepare(`SELECT bones FROM wallets WHERE user_id = ?`).get(userId) as { bones: number } | undefined;
  return row?.bones ?? 0;
}

function skipUser(store: Store, userId: string): boolean {
  const user = store.user(userId);
  if (!user) return true;
  return user.is_bot === 1 || user.is_soak === 1;
}

function clampLadder(day: number): number {
  if (!Number.isInteger(day) || day < 1) return 1;
  if (day > 7) return 7;
  return day;
}

function isDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const check = new Date(Date.UTC(year!, month! - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month! - 1 && check.getUTCDate() === date;
}

function count(store: Store, sql: string, ...args: string[]): number {
  const row = store.db.prepare(sql).get(...args) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

function transaction(store: Store, run: () => void): void {
  store.db.exec("BEGIN");
  try {
    run();
    store.db.exec("COMMIT");
  } catch (error) {
    try {
      store.db.exec("ROLLBACK");
    } catch {
      // The original error is the one that matters.
    }
    throw error;
  }
}
