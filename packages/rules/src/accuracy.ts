import { rankExpertPlays } from "./bot.js";
import {
  applyIntent,
  beginHand,
  createMatch,
  currentPlayerId,
  RULES_VERSION,
  skipTurn,
  type LoggedHand,
  type MatchConfig,
  type MatchPlayer,
  type MatchState,
} from "./engine.js";
import { tileLabel } from "./tiles.js";

/** How many finished games sit in the recent average. */
export const ACCURACY_RECENT_GAMES = 10;

export interface ChoiceGrade {
  matched: boolean;
  awarded: number;
  bestAwarded: number;
  /** Board points the best move awarded above the tile that was played. 0 when the play matched, or when the miss did not give up board points. */
  pointGap: number;
  tileId: string;
}

export interface SeatAccuracy {
  matched: number;
  choices: number;
  /** Largest board-point gap on a play that was not a best move. */
  miss: { tileId: string; points: number } | null;
}

/**
 * Score one play against the expert ranking.
 * Returns null when this turn is not a real choice: fewer than two legal plays.
 * Draws, knocks, and a forced opening lead stay out.
 */
export function gradeChoice(
  match: MatchState,
  playerId: string,
  chosen: { tileId: string; endId: string },
): ChoiceGrade | null {
  const ranked = rankExpertPlays(match, playerId);
  if (ranked.length < 2) return null;
  const bestValue = ranked[0]!.value;
  let bestAwarded = 0;
  for (const play of ranked) {
    if (play.value !== bestValue) break;
    if (play.awarded > bestAwarded) bestAwarded = play.awarded;
  }
  const picked = ranked.find(
    (play) => play.intent.tileId === chosen.tileId && play.intent.endId === chosen.endId,
  );
  if (!picked) return null;
  const matched = picked.value === bestValue;
  const pointGap = matched ? 0 : Math.max(0, bestAwarded - picked.awarded);
  return {
    matched,
    awarded: picked.awarded,
    bestAwarded,
    pointGap,
    tileId: chosen.tileId,
  };
}

/**
 * Replay one game's hands and grade the named seats.
 * Pass only that game's hands, in order. Scores start over each game, so the
 * replay does not need the earlier games. Seats left out of `humanIds` are
 * not scored. A seat with no choice comes back with choices 0.
 */
export function gradeLoggedGame(
  players: MatchPlayer[],
  config: MatchConfig,
  hands: readonly LoggedHand[],
  humanIds: ReadonlySet<string>,
  rulesVersion: number = RULES_VERSION,
): Map<string, SeatAccuracy> {
  const totals = new Map<string, SeatAccuracy>();
  for (const id of humanIds) totals.set(id, { matched: 0, choices: 0, miss: null });
  let match = createMatch(players, config);
  for (const hand of hands) {
    match = beginHand(match, [...hand.deck], rulesVersion);
    for (const action of hand.actions) {
      if (
        humanIds.has(action.playerId) &&
        action.intent.type === "play" &&
        !actionWasBot(action.intent) &&
        currentPlayerId(match) === action.playerId
      ) {
        const grade = gradeChoice(match, action.playerId, action.intent);
        const seat = totals.get(action.playerId);
        if (grade && seat) {
          seat.choices += 1;
          if (grade.matched) seat.matched += 1;
          else if (grade.pointGap > 0 && (!seat.miss || grade.pointGap > seat.miss.points)) {
            seat.miss = { tileId: grade.tileId, points: grade.pointGap };
          }
        }
      }
      const result =
        action.intent.type === "timeout"
          ? skipTurn(match, action.playerId)
          : applyIntent(match, action.playerId, action.intent);
      if (!result.ok) throw new Error(result.error ?? "Replay failed.");
      match = result.match;
    }
  }
  return totals;
}

/** Share of choice-moves that matched a best move, rounded. Null when there was no choice. */
export function accuracyPercent(matched: number, choices: number): number | null {
  if (choices <= 0 || !Number.isFinite(matched) || !Number.isFinite(choices)) return null;
  return Math.round((matched / choices) * 100);
}

export interface AccuracyGame {
  matched: number;
  choices: number;
}

/** Mean of each game's own percent. Each counted game weighs the same. */
export function recentAccuracyPercent(games: readonly AccuracyGame[]): number | null {
  const counted = games.filter((game) => game.choices > 0);
  if (counted.length === 0) return null;
  const mean =
    counted.reduce((sum, game) => sum + (game.matched / game.choices) * 100, 0) / counted.length;
  return Math.round(mean);
}

export function parseAccuracyRecent(raw: string | null | undefined): AccuracyGame[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const games: AccuracyGame[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const matched = (item as { matched?: unknown }).matched;
      const choices = (item as { choices?: unknown }).choices;
      if (typeof matched !== "number" || typeof choices !== "number" || choices <= 0) continue;
      games.push({ matched, choices });
    }
    return games;
  } catch {
    return [];
  }
}

function actionWasBot(intent: LoggedHand["actions"][number]["intent"]): boolean {
  return typeof intent === "object" && intent !== null && "bot" in intent && (intent as { bot?: unknown }).bot === true;
}

/** Names the played tile. Points are board points, not the ranker's private score. */
export function accuracyMissSentence(tileId: string, points: number): string {
  return `The ${tileLabel(tileId)} cost you ~${points} points.`;
}
