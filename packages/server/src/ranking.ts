import { randomUUID } from "node:crypto";
import {
  accuracyPercent,
  parseAccuracyRecent,
  recentAccuracyPercent,
  resolveAvatar,
  type PointBreakdown,
  type RankRecap,
  type RankedPlayerRecap,
  type SeatRank,
  type TierStep,
} from "@uhoh/rules";
import type { StandingUpdate, Store, UserRow } from "./db.js";
import { applyGameBones, grantSeasonRewards } from "./economy.js";

export const START_RATING = 1200;
export const RATING_FLOOR = 100;
export const DELTA_CAP = 40;
export const PROVISIONAL_GAMES = 5;
/** Legend lands on Hustler. Four rungs down, and Rookie is the floor. */
export const TIER_DROP = 4;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LEGEND_STEP = 1000;

export const TIERS = [
  { id: "rookie", name: "Rookie", min: 0 },
  { id: "shuffler", name: "Shuffler", min: 250 },
  { id: "clacker", name: "Clacker", min: 600 },
  { id: "hustler", name: "Hustler", min: 1100 },
  { id: "shark", name: "Shark", min: 1800 },
  { id: "boss", name: "Boss", min: 2800 },
  { id: "big-shot", name: "Big Shot", min: 4200 },
  { id: "legend", name: "UH-OH Legend", min: 6000 },
] as const;

export type TierId = (typeof TIERS)[number]["id"];

export interface TierPlacement {
  id: TierId;
  name: string;
  index: number;
  step: TierStep | null;
  stepFloor: number;
  nextAt: number | null;
}

export interface RateSeat {
  id: string;
  rating: number;
  rankedGames: number;
  score: number;
  place: number;
}

export interface FinishSeat {
  playerId: string;
  name: string;
  userId: string | null;
  bot: boolean;
  score: number;
  left: boolean;
  bigMoments: number;
}

export interface SettleInput {
  roomId: string;
  seriesId: string;
  gameNumber: number;
  casual: boolean;
  completed: boolean;
  winnerId: string | null;
  now: Date;
  seats: FinishSeat[];
}

export interface PublicStanding {
  rating: number;
  provisional: boolean;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  gamesPlayed: number;
  vsComputerGames: number;
  vsComputerWins: number;
  vsComputerLosses: number;
  seasonId: number;
  seasonPoints: number;
  seasonEndsAt: string;
  tierId: string;
  tierName: string;
  tierStep: TierStep | null;
  nextAt: number | null;
  stepFloor: number;
  peakTierId: string;
  peakTierName: string;
  peakStep: TierStep | null;
  /** Decision-weighted share of best moves. Null until a game had a real choice. */
  playAccuracy: number | null;
  /** Average of each of the last 10 counted games. Null until one is counted. */
  playAccuracyRecent: number | null;
  /** Games that had at least one real choice. */
  playAccuracyGames: number;
}

interface SeasonWindow {
  id: number;
  startsAt: string;
  endsAt: string;
}

interface Standing extends PublicStanding {
  winStreak: number;
  lastWinDay: string | null;
}

const STEPS: TierStep[] = ["III", "II", "I"];

export function kFactor(rating: number, rankedGames: number): number {
  if (rating >= 2000) return 10;
  if (rankedGames < 20) return 40;
  return 20;
}

export function expectedScore(you: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - you) / 400));
}

export function closeness(yourScore: number, oppScore: number, relation: "higher" | "lower" | "tied"): number {
  let score = 0.5 + (yourScore - oppScore) / 300;
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  if (relation === "higher") score = Math.max(score, 0.6);
  if (relation === "lower") score = Math.min(score, 0.4);
  return score;
}

export function capDelta(delta: number): number {
  if (delta > DELTA_CAP) return DELTA_CAP;
  if (delta < -DELTA_CAP) return -DELTA_CAP;
  return delta;
}

/** Cap the averaged change, then round to a whole number. The floor is applied after. */
export function finalizeDelta(raw: number): number {
  return Math.round(capDelta(raw));
}

export function provisional(rankedGames: number): boolean {
  return rankedGames < PROVISIONAL_GAMES;
}

export function finishingPlaces(
  seats: Array<{ playerId: string; score: number; left: boolean }>,
): Map<string, { place: number; tied: boolean }> {
  const stayed = seats
    .filter((seat) => !seat.left)
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  const left = seats.filter((seat) => seat.left).sort((a, b) => a.playerId.localeCompare(b.playerId));
  const places = new Map<string, { place: number; tied: boolean }>();
  let index = 0;
  while (index < stayed.length) {
    let next = index + 1;
    while (next < stayed.length && stayed[next]!.score === stayed[index]!.score) next += 1;
    const place = index + 1;
    const tied = next - index > 1;
    for (let cursor = index; cursor < next; cursor += 1) places.set(stayed[cursor]!.playerId, { place, tied });
    index = next;
  }
  if (left.length > 0) {
    const place = stayed.length + 1;
    const tied = left.length > 1;
    for (const seat of left) places.set(seat.playerId, { place, tied });
  }
  return places;
}

export function ratePlayers(seats: RateSeat[]): Map<string, { before: number; after: number; delta: number }> {
  const rated = new Map<string, { before: number; after: number; delta: number }>();
  for (const you of seats) {
    const k = kFactor(you.rating, you.rankedGames);
    const pairDeltas: number[] = [];
    for (const opponent of seats) {
      if (opponent.id === you.id) continue;
      const relation = you.place < opponent.place ? "higher" : you.place > opponent.place ? "lower" : "tied";
      const result = closeness(you.score, opponent.score, relation);
      const expected = expectedScore(you.rating, opponent.rating);
      pairDeltas.push(k * (result - expected));
    }
    const average = pairDeltas.length === 0 ? 0 : pairDeltas.reduce((sum, value) => sum + value, 0) / pairDeltas.length;
    const rounded = finalizeDelta(average);
    let after = you.rating + rounded;
    if (after < RATING_FLOOR) after = RATING_FLOOR;
    rated.set(you.id, { before: you.rating, after, delta: after - you.rating });
  }
  return rated;
}

export function gameIsRanked(seats: Array<{ bot: boolean; userId: string | null }>, casual: boolean): boolean {
  if (casual || seats.length < 2) return false;
  return seats.every((seat) => !seat.bot && Boolean(seat.userId));
}

export function seasonAward(input: {
  completed: boolean;
  won: boolean;
  second: boolean;
  moments: number;
  streakBefore: number;
  alreadyWonToday: boolean;
  ranked: boolean;
}): PointBreakdown {
  const finish = 10;
  const win = input.completed && input.won ? 25 : 0;
  const second = input.completed && input.second ? 10 : 0;
  const momentCount = Math.max(0, Math.floor(input.moments));
  const moments = momentCount * 5;
  const streakCount = input.completed && input.won ? input.streakBefore + 1 : 0;
  const streak = streakCount > 0 ? Math.min(25, streakCount * 5) : 0;
  const firstWin = input.completed && input.won && !input.alreadyWonToday ? 20 : 0;
  const multiplier = input.ranked ? 2 : 1;
  return {
    finish: finish * multiplier,
    win: win * multiplier,
    second: second * multiplier,
    moments: moments * multiplier,
    momentCount,
    streak: streak * multiplier,
    streakCount,
    firstWin: firstWin * multiplier,
    doubled: multiplier === 2,
    total: (finish + win + second + moments + streak + firstWin) * multiplier,
  };
}

export function tierAt(points: number): TierPlacement {
  const safe = Math.max(0, Math.floor(points));
  let index = 0;
  for (let cursor = 0; cursor < TIERS.length; cursor += 1) {
    if (safe >= TIERS[cursor]!.min) index = cursor;
  }
  const tier = TIERS[index]!;
  if (index === 0) {
    return { id: tier.id, name: tier.name, index, step: null, stepFloor: 0, nextAt: TIERS[1]!.min };
  }
  if (index === TIERS.length - 1) {
    const stepIndex = Math.min(2, Math.max(0, Math.floor((safe - tier.min) / LEGEND_STEP)));
    return {
      id: tier.id,
      name: tier.name,
      index,
      step: STEPS[stepIndex]!,
      stepFloor: tier.min + stepIndex * LEGEND_STEP,
      nextAt: stepIndex < 2 ? tier.min + (stepIndex + 1) * LEGEND_STEP : null,
    };
  }
  const nextMin = TIERS[index + 1]!.min;
  const span = nextMin - tier.min;
  let stepIndex = 0;
  for (let cursor = 2; cursor >= 1; cursor -= 1) {
    if (safe >= tier.min + Math.floor((cursor * span) / 3)) {
      stepIndex = cursor;
      break;
    }
  }
  return {
    id: tier.id,
    name: tier.name,
    index,
    step: STEPS[stepIndex]!,
    stepFloor: tier.min + Math.floor((stepIndex * span) / 3),
    nextAt: stepIndex < 2 ? tier.min + Math.floor(((stepIndex + 1) * span) / 3) : nextMin,
  };
}

export function seasonStartPoints(points: number, seasonsCrossed: number): number {
  let current = Math.max(0, Math.floor(points));
  const steps = Math.max(0, Math.floor(seasonsCrossed));
  for (let cursor = 0; cursor < steps; cursor += 1) {
    const next = Math.max(0, tierAt(current).index - TIER_DROP);
    current = TIERS[next]!.min;
  }
  return current;
}

/** Cosmetic hook for the later store. Keyed by the tier they peaked at. */
export function rewardForTier(tierId: string): { rewardId: string; label: string } {
  const tier = TIERS.find((item) => item.id === tierId) ?? TIERS[0]!;
  return { rewardId: `cosmetic:${tier.id}`, label: `${tier.name} mark` };
}

export function denverDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function seasonLengthMs(env: NodeJS.ProcessEnv = process.env): number {
  const weeks = Number(env.SEASON_WEEKS ?? "8");
  if (!Number.isFinite(weeks) || weeks <= 0) return 8 * WEEK_MS;
  return weeks * WEEK_MS;
}

export function ensureEpoch(store: Store, now: Date, env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = env.SEASON_EPOCH?.trim();
  if (fromEnv) {
    const parsed = Date.parse(fromEnv);
    if (Number.isFinite(parsed)) return parsed;
  }
  const saved = store.meta("season_epoch");
  if (saved) {
    const parsed = Date.parse(saved);
    if (Number.isFinite(parsed)) return parsed;
  }
  store.setMeta("season_epoch", now.toISOString());
  return now.getTime();
}

export function currentSeason(store: Store, now: Date, env: NodeJS.ProcessEnv = process.env): SeasonWindow {
  const epoch = ensureEpoch(store, now, env);
  const length = seasonLengthMs(env);
  const elapsed = now.getTime() - epoch;
  const index = elapsed < 0 ? 0 : Math.floor(elapsed / length);
  const starts = epoch + index * length;
  return {
    id: index + 1,
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + length).toISOString(),
  };
}

export function describePlayer(store: Store, userId: string, now: Date): PublicStanding | null {
  const standing = peekStanding(store, userId, now);
  if (!standing) return null;
  return { ...standing };
}

export function seatRankOf(standing: PublicStanding): SeatRank {
  return {
    rating: standing.rating,
    provisional: standing.provisional,
    tierId: standing.tierId,
    tierName: standing.tierName,
    step: standing.tierStep,
  };
}

export function leaderboard(store: Store, board: "rating" | "season", now: Date, limit = 50, includeBots = false) {
  const season = currentSeason(store, now);
  for (const user of store.allUsers()) {
    if ((user.is_soak ?? 0) === 1) continue;
    if ((user.season_id ?? 0) !== season.id) alignSeason(store, user.id, season, now);
  }
  const rows = board === "season" ? store.topBySeason(limit, includeBots) : store.topByRating(limit, includeBots);
  return {
    seasonId: season.id,
    seasonEndsAt: season.endsAt,
    includeBots,
    rows: rows.map((user) => {
      const tier = tierAt(user.season_points ?? 0);
      return {
        name: user.display_name,
        avatarId: resolveAvatar(user.avatar_id),
        guest: user.is_guest === 1,
        bot: user.is_bot === 1,
        rating: user.rating ?? START_RATING,
        provisional: provisional(user.ranked_games ?? 0),
        tierId: tier.id,
        tierName: tier.name,
        step: tier.step,
        seasonPoints: user.season_points ?? 0,
      };
    }),
  };
}

export function settleGame(store: Store, input: SettleInput): RankRecap {
  const season = currentSeason(store, input.now);
  const ranked = gameIsRanked(input.seats, input.casual);
  const vsComputer = input.seats.some((seat) => seat.bot);
  const places = finishingPlaces(input.seats);
  const cached = new Map<string, Standing>();
  const standingFor = (userId: string): Standing => {
    const found = cached.get(userId);
    if (found) return found;
    const standing = alignSeason(store, userId, season, input.now);
    cached.set(userId, standing);
    return standing;
  };

  const eloSeats: RateSeat[] = [];
  if (ranked) {
    for (const seat of input.seats) {
      if (!seat.userId) continue;
      const standing = standingFor(seat.userId);
      eloSeats.push({
        id: seat.playerId,
        rating: standing.rating,
        rankedGames: standing.rankedGames,
        score: seat.score,
        place: places.get(seat.playerId)?.place ?? input.seats.length,
      });
    }
  }
  const changes = ratePlayers(eloSeats);
  const today = denverDay(input.now);
  const players: RankedPlayerRecap[] = [];

  for (const seat of input.seats) {
    if (!seat.userId || seat.bot) continue;
    const prior = store.ratingEvent(seat.userId, input.roomId, input.seriesId, input.gameNumber);
    if (prior) {
      players.push(recapFromHistory(prior, seat.playerId));
      continue;
    }
    const standing = standingFor(seat.userId);
    const place = places.get(seat.playerId);
    const won = input.completed && input.winnerId === seat.playerId;
    const second = Boolean(input.completed && place?.place === 2 && input.seats.length >= 3);
    const breakdown = seasonAward({
      completed: input.completed,
      won,
      second,
      moments: seat.bigMoments,
      streakBefore: standing.winStreak,
      alreadyWonToday: standing.lastWinDay === today,
      ranked,
    });
    const change = changes.get(seat.playerId);
    const ratingBefore = standing.rating;
    const ratingAfter = ranked && change ? change.after : standing.rating;
    const delta = ratingAfter - ratingBefore;
    const pointsBefore = standing.seasonPoints;
    const pointsAfter = pointsBefore + breakdown.total;
    const beforeTier = tierAt(pointsBefore);
    const afterTier = tierAt(pointsAfter);
    const rankedGames = standing.rankedGames + (ranked ? 1 : 0);
    const peak = betterPeak(standing.peakTierId, standing.peakStep, afterTier);
    let winStreak = standing.winStreak;
    let lastWinDay = standing.lastWinDay;
    if (input.completed) {
      if (won) {
        winStreak += 1;
        lastWinDay = today;
      } else {
        winStreak = 0;
      }
    }
    store.saveStanding(seat.userId, {
      rating: ratingAfter,
      ranked_games: rankedGames,
      ranked_wins: standing.rankedWins + (ranked && input.completed && won ? 1 : 0),
      ranked_losses: standing.rankedLosses + (ranked && input.completed && !won ? 1 : 0),
      vs_games: standing.vsComputerGames + (vsComputer ? 1 : 0),
      vs_wins: standing.vsComputerWins + (vsComputer && input.completed && won ? 1 : 0),
      vs_losses: standing.vsComputerLosses + (vsComputer && input.completed && !won ? 1 : 0),
      games_played: standing.gamesPlayed + 1,
      season_id: season.id,
      season_points: pointsAfter,
      win_streak: winStreak,
      last_win_day: lastWinDay,
      peak_tier: peak.id,
      peak_step: peak.step,
      updated_at: input.now.toISOString(),
    });
    cached.set(seat.userId, {
      ...standing,
      rating: ratingAfter,
      provisional: provisional(rankedGames),
      rankedGames,
      rankedWins: standing.rankedWins + (ranked && input.completed && won ? 1 : 0),
      rankedLosses: standing.rankedLosses + (ranked && input.completed && !won ? 1 : 0),
      vsComputerGames: standing.vsComputerGames + (vsComputer ? 1 : 0),
      vsComputerWins: standing.vsComputerWins + (vsComputer && input.completed && won ? 1 : 0),
      vsComputerLosses: standing.vsComputerLosses + (vsComputer && input.completed && !won ? 1 : 0),
      gamesPlayed: standing.gamesPlayed + 1,
      seasonPoints: pointsAfter,
      tierId: afterTier.id,
      tierName: afterTier.name,
      tierStep: afterTier.step,
      nextAt: afterTier.nextAt,
      stepFloor: afterTier.stepFloor,
      peakTierId: peak.id,
      peakTierName: TIERS.find((item) => item.id === peak.id)?.name ?? afterTier.name,
      peakStep: peak.step,
      winStreak,
      lastWinDay,
    });
    const row: RankedPlayerRecap = {
      playerId: seat.playerId,
      ranked,
      ratingBefore: ranked ? ratingBefore : null,
      ratingAfter: ranked ? ratingAfter : null,
      delta: ranked ? delta : null,
      provisional: provisional(rankedGames),
      pointsEarned: breakdown.total,
      pointsBefore,
      pointsAfter,
      breakdown,
      tierBeforeId: beforeTier.id,
      tierBeforeName: beforeTier.name,
      tierBeforeStep: beforeTier.step,
      tierAfterId: afterTier.id,
      tierAfterName: afterTier.name,
      tierAfterStep: afterTier.step,
      steppedUp: steppedUp(beforeTier, afterTier),
      stepFloor: afterTier.stepFloor,
      nextAt: afterTier.nextAt,
    };
    applyGameBones(store, seat.userId, {
      completed: input.completed,
      won,
      moments: seat.bigMoments,
      day: today,
      at: input.now.toISOString(),
      roomId: input.roomId,
      seriesId: input.seriesId,
      gameNumber: input.gameNumber,
    });
    const seasonGrants = grantSeasonRewards(store, seat.userId, pointsAfter, input.now.toISOString());
    if (seasonGrants.length > 0) {
      console.log(`[season] ${seat.name} earned ${seasonGrants.join(", ")}`);
      store.insertBotEvent("grant", seat.name, JSON.stringify({ items: seasonGrants, points: pointsAfter }), input.now.toISOString());
    }
    store.insertRatingEvent({
      id: randomUUID(),
      user_id: seat.userId,
      room_id: input.roomId,
      series_id: input.seriesId,
      game_number: input.gameNumber,
      player_id: seat.playerId,
      ranked: ranked ? 1 : 0,
      provisional: row.provisional ? 1 : 0,
      rating_before: ratingBefore,
      rating_after: ratingAfter,
      delta,
      season_id: season.id,
      points_earned: breakdown.total,
      points_before: pointsBefore,
      points_after: pointsAfter,
      tier_before: beforeTier.id,
      tier_after: afterTier.id,
      step_before: beforeTier.step,
      step_after: afterTier.step,
      stepped_up: row.steppedUp ? 1 : 0,
      breakdown_json: JSON.stringify(breakdown),
      created_at: input.now.toISOString(),
    });
    players.push(row);
  }

  return {
    gameNumber: input.gameNumber,
    ranked,
    casual: input.casual,
    vsComputer,
    seasonEndsAt: season.endsAt,
    players,
  };
}

function peekStanding(store: Store, userId: string, now: Date): Standing | null {
  const user = store.user(userId);
  if (!user) return null;
  const season = currentSeason(store, now);
  if ((user.season_id ?? 0) !== season.id) return alignSeason(store, userId, season, now);
  return toStanding(user, season);
}

function alignSeason(store: Store, userId: string, season: SeasonWindow, now: Date): Standing {
  const user = store.user(userId);
  if (!user) throw new Error("That player has no profile.");
  if ((user.season_id ?? 0) === season.id) return toStanding(user, season);

  let points = user.season_points ?? 0;
  let peakTier = user.peak_tier ?? "rookie";
  let peakStep = (user.peak_step as TierStep | null) ?? null;
  let seasonId = user.season_id ?? 0;
  if (seasonId === 0) {
    const tier = tierAt(points);
    store.saveStanding(user.id, standingPatch(user, {
      season_id: season.id,
      season_points: points,
      peak_tier: tier.id,
      peak_step: tier.step,
      updated_at: now.toISOString(),
    }));
    return toStanding(store.user(user.id)!, season);
  }

  while (seasonId < season.id) {
    const reward = rewardForTier(peakTier);
    store.saveSeasonPeak({
      user_id: user.id,
      season_id: seasonId,
      tier: peakTier,
      step: peakStep,
      points,
      reward_id: reward.rewardId,
      created_at: now.toISOString(),
    });
    const next = Math.max(0, tierAt(points).index - TIER_DROP);
    points = TIERS[next]!.min;
    const landed = tierAt(points);
    peakTier = landed.id;
    peakStep = landed.step;
    seasonId += 1;
  }

  store.saveStanding(user.id, standingPatch(user, {
    season_id: season.id,
    season_points: points,
    win_streak: 0,
    peak_tier: peakTier,
    peak_step: peakStep,
    updated_at: now.toISOString(),
  }));
  return toStanding(store.user(user.id)!, season);
}

function standingPatch(user: UserRow, patch: Partial<StandingUpdate>): StandingUpdate {
  return {
    rating: patch.rating ?? user.rating ?? START_RATING,
    ranked_games: patch.ranked_games ?? user.ranked_games ?? 0,
    ranked_wins: patch.ranked_wins ?? user.ranked_wins ?? 0,
    ranked_losses: patch.ranked_losses ?? user.ranked_losses ?? 0,
    vs_games: patch.vs_games ?? user.vs_games ?? 0,
    vs_wins: patch.vs_wins ?? user.vs_wins ?? 0,
    vs_losses: patch.vs_losses ?? user.vs_losses ?? 0,
    games_played: patch.games_played ?? user.games_played ?? 0,
    season_id: patch.season_id ?? user.season_id ?? 0,
    season_points: patch.season_points ?? user.season_points ?? 0,
    win_streak: patch.win_streak ?? user.win_streak ?? 0,
    last_win_day: patch.last_win_day === undefined ? (user.last_win_day ?? null) : patch.last_win_day,
    peak_tier: patch.peak_tier ?? user.peak_tier ?? "rookie",
    peak_step: patch.peak_step === undefined ? ((user.peak_step as TierStep | null) ?? null) : patch.peak_step,
    updated_at: patch.updated_at ?? user.updated_at,
  };
}

function toStanding(user: UserRow, season: SeasonWindow): Standing {
  const points = user.season_points ?? 0;
  const tier = tierAt(points);
  const peakId = (user.peak_tier ?? "rookie") as TierId;
  const peak = TIERS.find((item) => item.id === peakId) ?? TIERS[0]!;
  const rankedGames = user.ranked_games ?? 0;
  return {
    rating: user.rating ?? START_RATING,
    provisional: provisional(rankedGames),
    rankedGames,
    rankedWins: user.ranked_wins ?? 0,
    rankedLosses: user.ranked_losses ?? 0,
    gamesPlayed: user.games_played ?? 0,
    vsComputerGames: user.vs_games ?? 0,
    vsComputerWins: user.vs_wins ?? 0,
    vsComputerLosses: user.vs_losses ?? 0,
    seasonId: user.season_id ?? season.id,
    seasonPoints: points,
    seasonEndsAt: season.endsAt,
    tierId: tier.id,
    tierName: tier.name,
    tierStep: tier.step,
    nextAt: tier.nextAt,
    stepFloor: tier.stepFloor,
    peakTierId: peak.id,
    peakTierName: peak.name,
    peakStep: (user.peak_step as TierStep | null) ?? null,
    winStreak: user.win_streak ?? 0,
    lastWinDay: user.last_win_day ?? null,
    playAccuracy: accuracyPercent(user.accuracy_matched ?? 0, user.accuracy_choices ?? 0),
    playAccuracyRecent: recentAccuracyPercent(parseAccuracyRecent(user.accuracy_recent)),
    playAccuracyGames: user.accuracy_games ?? 0,
  };
}

function betterPeak(
  peakId: string,
  peakStep: TierStep | null,
  after: TierPlacement,
): { id: string; step: TierStep | null } {
  const current = tierAt(TIERS.find((item) => item.id === peakId)?.min ?? 0);
  const currentRank = current.index * 10 + stepRank(peakStep);
  const nextRank = after.index * 10 + stepRank(after.step);
  if (nextRank >= currentRank) return { id: after.id, step: after.step };
  return { id: peakId, step: peakStep };
}

function stepRank(step: TierStep | null): number {
  if (step === "I") return 3;
  if (step === "II") return 2;
  if (step === "III") return 1;
  return 0;
}

function steppedUp(before: TierPlacement, after: TierPlacement): boolean {
  return after.index > before.index || (after.index === before.index && stepRank(after.step) > stepRank(before.step));
}

function recapFromHistory(row: NonNullable<ReturnType<Store["ratingEvent"]>>, playerId: string): RankedPlayerRecap {
  const after = tierAt(row.points_after);
  const ranked = row.ranked === 1;
  let breakdown: PointBreakdown = {
    finish: 0,
    win: 0,
    second: 0,
    moments: 0,
    momentCount: 0,
    streak: 0,
    streakCount: 0,
    firstWin: 0,
    doubled: false,
    total: row.points_earned,
  };
  try {
    const parsed = JSON.parse(row.breakdown_json) as PointBreakdown;
    if (parsed && typeof parsed.total === "number") breakdown = parsed;
  } catch {
    breakdown = { ...breakdown };
  }
  const beforeTier = TIERS.find((item) => item.id === row.tier_before) ?? TIERS[0]!;
  const afterTier = TIERS.find((item) => item.id === row.tier_after) ?? after;
  return {
    playerId,
    ranked,
    ratingBefore: ranked ? row.rating_before : null,
    ratingAfter: ranked ? row.rating_after : null,
    delta: ranked ? row.delta : null,
    provisional: row.provisional === 1,
    pointsEarned: row.points_earned,
    pointsBefore: row.points_before,
    pointsAfter: row.points_after,
    breakdown,
    tierBeforeId: beforeTier.id,
    tierBeforeName: beforeTier.name,
    tierBeforeStep: row.step_before,
    tierAfterId: afterTier.id,
    tierAfterName: afterTier.name,
    tierAfterStep: row.step_after,
    steppedUp: row.stepped_up === 1,
    stepFloor: after.stepFloor,
    nextAt: after.nextAt,
  };
}
