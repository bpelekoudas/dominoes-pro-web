import { emptyBoard, openEnds, openScore, placeTile, tileFits, tilesOnBoard, type BoardState } from "./board.js";
import {
  legalIntents,
  publicBoneyardSize,
  publicHandSize,
  type Intent,
  type MatchState,
  type PublicEvent,
} from "./engine.js";
import { roundToFive } from "./score.js";
import { allTileIds, tileById, tilePips } from "./tiles.js";

export type BotDifficulty = "easy" | "medium" | "hard" | "expert";

/**
 * Pick a legal intent for a computer seat.
 *
 * Easy plays a random legal tile. Medium prefers a score, then a board
 * fewer outside tiles can score on, then a heavier tile, then a hand that
 * still holds more suits. Hard also blocks suits an opponent has knocked
 * on and avoids leaving a score. Expert adds a one-step look at how likely
 * the next player is to score, using only the public log, the board, and
 * tile counts. It never reads a hidden hand or the boneyard faces.
 */
export function chooseBotIntent(
  match: MatchState,
  playerId: string,
  difficulty: BotDifficulty,
  rng: () => number,
): Intent | null {
  const intents = legalIntents(match, playerId);
  if (intents.length === 0) return null;
  const plays = intents.filter((intent) => intent.type === "play");
  if (plays.length === 0) return intents[0] ?? null;
  if (difficulty === "easy") {
    const index = Math.min(plays.length - 1, Math.floor(clamp01(rng()) * plays.length));
    return plays[index] ?? null;
  }
  // Sharper levels stick to the plan. Medium still takes every score in a
  // forced choice; a rare looser tile is what separates the levels in a long run.
  const wobble = difficulty === "medium" ? 0.2 : difficulty === "hard" ? 0.08 : 0;
  if (wobble > 0 && rng() < wobble) {
    const index = Math.min(plays.length - 1, Math.floor(clamp01(rng()) * plays.length));
    return plays[index] ?? null;
  }

  const owned = match.hand?.hands[playerId] ?? [];
  const board = match.hand?.board;
  if (!board) return plays[0] ?? null;
    const blocked = blockedSuits(match);
  const nextId = nextPlayerId(match, playerId);
  const myScore = match.scores[playerId] ?? 0;
  const bestScore = Math.max(0, ...match.players.map((player) => match.scores[player.id] ?? 0));
  const behind = bestScore - myScore;

  const ranked = plays.map((intent) => {
    const next = placeTile(board, intent.endId, tileById(intent.tileId));
    const remaining = owned.filter((id) => id !== intent.tileId);
    const awarded = openScore(next).awarded;
    const replies = scoringReplies(next, new Set(remaining));
    const held = new Set(remaining);
    const block = blockBonus(next, blocked.get(nextId ?? "") ?? new Set());
    const pips = tilePips(intent.tileId);
    const suits = suitCount(remaining);
    const out = remaining.length === 0 ? 1 : 0;
    // Medium keeps the old Normal order: a score, then fewer replies, then a
    // heavier tile, then more suits. Hard and Expert keep that order and add
    // public plans underneath it, so a higher score is never passed up.
    let value = out * 1_000_000 + awarded * 1_000 - replies * 100 + pips * 5 + suits;
    if (difficulty === "hard" || difficulty === "expert") {
      const locked = sealedEnds(next, held);
      const stranded = remaining.length > 0 && coveredEnds(next, held) === 0 ? 1 : 0;
      value += locked * 20 + block * 0.4 + controlBonus(remaining, next) * 0.5 - stranded * 35;
      if (behind >= 20) value += pips * 4;
    }
    if (difficulty === "expert" && nextId) {
      const remainPips = remaining.reduce((sum, id) => sum + tilePips(id), 0);
      const known = countedHand(match, playerId, nextId);
      if (known) {
        const threat = bestSwing(next, known, remainPips);
        const canAnswer = known.some((id) =>
          openEnds(next).some((end) => end.id !== "lead" && tileFits(tileById(id), end.match)),
        );
        // A counted hand is worth denying, but never by giving up a higher score.
        // Eight points of threat sits under one scoring reply (100) and over a pip (5).
        value -= Math.min(threat * 8, 90);
        if (!canAnswer) value += Math.min(followUpAward(remaining, next) * 8, 90);
      } else {
        const threat = expectedReply(match, playerId, nextId, next, blocked.get(nextId) ?? new Set());
        value -= Math.min((Number.isFinite(threat) ? threat : 0) * 3, 40);
      }
    }
    return { intent, value, roll: rng() };
  });

  ranked.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.roll - b.roll;
  });
  return ranked[0]?.intent ?? null;
}

function nextPlayerId(match: MatchState, playerId: string): string | null {
  const index = match.players.findIndex((player) => player.id === playerId);
  if (index < 0) return null;
  return match.players[(index + 1) % match.players.length]?.id ?? null;
}

/** Suits an opponent showed they could not play, from the public log only. */
function blockedSuits(match: MatchState): Map<string, Set<number>> {
  const blocked = new Map<string, Set<number>>();
  let board = emptyBoard();
  for (const event of match.log ?? []) {
    if (event.kind === "play" && event.tileId && event.endId) {
      const tile = tileById(event.tileId);
      blocked.get(event.playerId)?.delete(tile.low);
      blocked.get(event.playerId)?.delete(tile.high);
      try {
        board = placeTile(board, event.endId, tile);
      } catch {
        // A bad log entry is ignored. The live board is still the source of legal plays.
      }
    } else if (event.kind === "draw") {
      blocked.delete(event.playerId);
    } else if (event.kind === "knock") {
      const suits = new Set<number>();
      if (board.center) {
        for (const end of openEnds(board)) {
          if (end.match >= 0) suits.add(end.match);
        }
      }
      blocked.set(event.playerId, suits);
    }
  }
  return blocked;
}

function blockBonus(board: BoardState, blocked: ReadonlySet<number>): number {
  if (!board.center || blocked.size === 0) return 0;
  let bonus = 0;
  for (const end of openEnds(board)) {
    if (end.id === "lead") continue;
    if (blocked.has(end.match)) bonus += 18;
  }
  return bonus;
}

/** The one hidden hand a player could name by counting, or null. */
function countedHand(match: MatchState, playerId: string, opponentId: string): string[] | null {
  if (publicBoneyardSize(match) > 0) return null;
  const holders = match.players.filter(
    (player) => player.id !== playerId && publicHandSize(match, player.id) > 0,
  );
  if (holders.length !== 1 || holders[0]?.id !== opponentId) return null;
  return unseenTileIds(match, playerId);
}

/**
 * Highest score this counted hand can take on its next play.
 * A last tile goes out and collects this seat's remaining pips as one pot,
 * rounded with roundToFive. That is a single winner, so it is not a tied
 * split. A tie would use splitShare on the other players' pips, and this
 * seat cannot see those hands.
 */
function bestSwing(board: BoardState, hand: readonly string[], myRemainPips: number): number {
  if (!board.center || hand.length === 0) return 0;
  let best = 0;
  for (const id of hand) {
    const tile = tileById(id);
    for (const end of openEnds(board)) {
      if (end.id === "lead" || !tileFits(tile, end.match)) continue;
      let swing = openScore(placeTile(board, end.id, tile)).awarded;
      if (hand.length === 1) swing += roundToFive(myRemainPips);
      if (swing > best) best = swing;
    }
  }
  return best;
}

/**
 * Rough points the next player scores on their turn. Uses how many tiles
 * they hold, not which ones, and the suits they have already knocked on.
 */
function expectedReply(
  match: MatchState,
  playerId: string,
  nextId: string,
  board: BoardState,
  blocked: ReadonlySet<number>,
): number {
  if (!board.center) return 0;
  const mine = new Set(match.hand?.hands[playerId] ?? []);
  const down = new Set(tilesOnBoard(board));
  const unseen = allTileIds().filter((id) => !mine.has(id) && !down.has(id));
  const ends = openEnds(board).filter((end) => end.id !== "lead");
  const scoring: number[] = [];
  for (const id of unseen) {
    const tile = tileById(id);
    if (blocked.has(tile.low) || blocked.has(tile.high)) continue;
    for (const end of ends) {
      if (!tileFits(tile, end.match)) continue;
      const award = openScore(placeTile(board, end.id, tile)).awarded;
      if (award > 0) {
        scoring.push(award);
        break;
      }
    }
  }
  const held = publicHandSize(match, nextId);
  const slots = unseen.length;
  const chance = chanceOfOne(slots, held, scoring.length);
  if (scoring.length === 0) return 0;
  const average = scoring.reduce((sum, value) => sum + value, 0) / scoring.length;
  return chance * average;
}

function chanceOfOne(pool: number, held: number, hits: number): number {
  if (hits <= 0 || held <= 0 || pool <= 0) return 0;
  if (held > pool) return 0;
  if (pool - hits < held) return 1;
  let miss = 1;
  for (let index = 0; index < held; index += 1) {
    miss *= (pool - hits - index) / (pool - index);
  }
  return 1 - miss;
}

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
      if (openScore(placeTile(board, end.id, tile)).awarded > 0) {
        replies += 1;
        break;
      }
    }
  }
  return replies;
}

/** Ends no tile outside this hand can match. Opponents have to draw or pass. */
function sealedEnds(board: BoardState, held: ReadonlySet<string>): number {
  if (!board.center) return 0;
  const down = new Set(tilesOnBoard(board));
  const unseen = allTileIds().filter((id) => !held.has(id) && !down.has(id));
  let sealed = 0;
  for (const end of openEnds(board)) {
    if (end.id === "lead") continue;
    const open = unseen.some((id) => tileFits(tileById(id), end.match));
    if (!open) sealed += 1;
  }
  return sealed;
}

function coveredEnds(board: BoardState, held: ReadonlySet<string>): number {
  if (!board.center) return 0;
  let covered = 0;
  for (const end of openEnds(board)) {
    if (end.id === "lead") continue;
    for (const id of held) {
      if (tileFits(tileById(id), end.match)) {
        covered += 1;
        break;
      }
    }
  }
  return covered;
}

/** Best board score still sitting in this hand, so a play can set the next one up. */
function followUpAward(remaining: readonly string[], board: BoardState): number {
  if (!board.center || remaining.length === 0) return 0;
  let best = 0;
  for (const id of remaining) {
    const tile = tileById(id);
    for (const end of openEnds(board)) {
      if (end.id === "lead" || !tileFits(tile, end.match)) continue;
      const awarded = openScore(placeTile(board, end.id, tile)).awarded;
      if (awarded > best) best = awarded;
    }
  }
  return best;
}

/**
 * Extra for keeping the suit an end needs when most of that suit is already
 * accounted for in this hand. Uses the hand and the board only.
 */
function controlBonus(remaining: readonly string[], board: BoardState): number {
  if (!board.center || remaining.length === 0) return 0;
  const mine = new Map<number, number>();
  for (const id of remaining) {
    const tile = tileById(id);
    mine.set(tile.low, (mine.get(tile.low) ?? 0) + 1);
    if (tile.high !== tile.low) mine.set(tile.high, (mine.get(tile.high) ?? 0) + 1);
  }
  let bonus = 0;
  for (const end of openEnds(board)) {
    if (end.id === "lead") continue;
    const held = mine.get(end.match) ?? 0;
    if (held >= 2) bonus += 6;
    else if (held === 1) bonus += 2;
  }
  return bonus;
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

export function unseenTileIds(match: MatchState, playerId: string): string[] {
  const mine = new Set(match.hand?.hands[playerId] ?? []);
  const down = new Set(match.hand ? tilesOnBoard(match.hand.board) : []);
  return allTileIds().filter((id) => !mine.has(id) && !down.has(id));
}

/** Boneyard size is public. The faces are not. */
export function yardSize(match: MatchState): number {
  return publicBoneyardSize(match);
}

export type { PublicEvent };
