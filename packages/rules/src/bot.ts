import { openEnds, openTotal, placeTile, tileFits, tilesOnBoard, type BoardState } from "./board.js";
import { legalIntents, type Intent, type MatchState } from "./engine.js";
import { boardAward } from "./score.js";
import { allTileIds, tileById, tilePips } from "./tiles.js";

export type BotDifficulty = "easy" | "normal";

/**
 * Pick a legal intent for a computer seat.
 *
 * Easy plays any legal intent. Normal prefers a score, then a board that
 * fewer outside tiles can score on immediately, then a heavier tile, then
 * a hand that still holds more suits. `rng` returns a number in [0, 1)
 * and only breaks ties, so a seeded caller stays repeatable.
 */
export function chooseBotIntent(
  match: MatchState,
  playerId: string,
  difficulty: BotDifficulty,
  rng: () => number,
): Intent | null {
  const intents = legalIntents(match, playerId);
  if (intents.length === 0) return null;
  const only = intents[0];
  if (difficulty === "easy" || intents.length === 1 || !only || only.type !== "play") {
    const index = Math.min(intents.length - 1, Math.floor(clamp01(rng()) * intents.length));
    return intents[index] ?? null;
  }

  const owned = match.hand?.hands[playerId] ?? [];
  const board = match.hand?.board;
  if (!board) return only;

  const ranked = intents.map((intent) => {
    if (intent.type !== "play") {
      return { intent, awarded: -1, replies: Number.POSITIVE_INFINITY, pips: 0, suits: 0, roll: rng() };
    }
    const next = placeTile(board, intent.endId, tileById(intent.tileId));
    const remaining = owned.filter((id) => id !== intent.tileId);
    return {
      intent,
      awarded: boardAward(openTotal(next)),
      replies: scoringReplies(next, new Set(remaining)),
      pips: tilePips(intent.tileId),
      suits: suitCount(remaining),
      roll: rng(),
    };
  });

  ranked.sort((a, b) => {
    if (b.awarded !== a.awarded) return b.awarded - a.awarded;
    if (a.replies !== b.replies) return a.replies - b.replies;
    if (b.pips !== a.pips) return b.pips - a.pips;
    if (b.suits !== a.suits) return b.suits - a.suits;
    return a.roll - b.roll;
  });
  return ranked[0]?.intent ?? null;
}

/** Tiles still out there (other hands and the boneyard) that could score on the next turn. */
function scoringReplies(board: BoardState, held: ReadonlySet<string>): number {
  if (!board.center) return 0;
  const ends = openEnds(board).filter((end) => end.id !== "lead");
  const down = new Set(tilesOnBoard(board));
  let replies = 0;
  for (const id of allTileIds()) {
    if (held.has(id) || down.has(id)) continue;
    const tile = tileById(id);
    for (const end of ends) {
      if (!tileFits(tile, end.match)) continue;
      const next = placeTile(board, end.id, tile);
      if (boardAward(openTotal(next)) > 0) {
        replies += 1;
        break;
      }
    }
  }
  return replies;
}

function suitCount(tileIds: readonly string[]): number {
  const suits = new Set<number>();
  for (const id of tileIds) {
    const tile = tileById(id);
    suits.add(tile.low);
    suits.add(tile.high);
  }
  return suits.size;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 0.999999) return 0.999999;
  return value;
}
