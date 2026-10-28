import {
  gradeLoggedGame,
  type LoggedHand,
  type MatchConfig,
  type MatchPlayer,
} from "@uhoh/rules";
import type { Store } from "./db.js";

export interface SeatAccuracyView {
  matched: number;
  choices: number;
  missTileId: string | null;
  missPoints: number;
}

/**
 * Grade a finished game from the saved hands and remember each human seat.
 * Safe to call again: a saved seat is not replayed into the totals twice.
 * Bot seats stay out of `humans`. A game with no choice is stored and does
 * not change the profile averages.
 */
export function gradeAndStore(
  store: Store,
  input: {
    roomId: string;
    seriesId: string;
    gameNumber: number;
    players: MatchPlayer[];
    config: MatchConfig;
    hands: readonly LoggedHand[];
    humans: ReadonlyArray<{ playerId: string; userId: string }>;
    rulesVersion: number;
    now: string;
  },
): Map<string, SeatAccuracyView> {
  const existing = store.playAccuracyForGame(input.roomId, input.seriesId, input.gameNumber);
  const saved = new Set(existing.map((row) => row.player_id));
  const missing = input.humans.filter((seat) => !saved.has(seat.playerId));
  if (missing.length > 0) {
    const graded = gradeLoggedGame(
      input.players,
      input.config,
      input.hands,
      new Set(missing.map((seat) => seat.playerId)),
      input.rulesVersion,
    );
    for (const seat of missing) {
      const grade = graded.get(seat.playerId) ?? { matched: 0, choices: 0, miss: null };
      store.savePlayAccuracy({
        userId: seat.userId,
        roomId: input.roomId,
        seriesId: input.seriesId,
        gameNumber: input.gameNumber,
        playerId: seat.playerId,
        matched: grade.matched,
        choices: grade.choices,
        missTile: grade.miss?.tileId ?? null,
        missPoints: grade.miss?.points ?? 0,
        createdAt: input.now,
      });
    }
  }
  const rows = missing.length > 0 ? store.playAccuracyForGame(input.roomId, input.seriesId, input.gameNumber) : existing;
  const views = new Map<string, SeatAccuracyView>();
  for (const row of rows) {
    views.set(row.player_id, {
      matched: row.matched,
      choices: row.choices,
      missTileId: row.miss_tile,
      missPoints: row.miss_points ?? 0,
    });
  }
  return views;
}
