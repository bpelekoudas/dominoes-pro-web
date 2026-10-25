import { handPips, lowestEndKey } from "./tiles.js";

/**
 * Board points count only when the open ends add up to a multiple of 5
 * that is at least 10. A total of 5 scores nothing. Zero scores nothing.
 */
export function boardAward(total: number): number {
  if (total >= 10 && total % 5 === 0) return total;
  return 0;
}

/**
 * Round one pip total to the nearest multiple of 5.
 * Remainder 1 or 2 goes down. Remainder 3 or 4 goes up. An exact multiple stays.
 * 7 becomes 5. 8 becomes 10. 12 becomes 10. 13 becomes 15. 29 becomes 30.
 * The hand award rounds the combined total once. It does not round each hand first.
 *
 * A fraction is cut to a whole number first. The digits after the decimal
 * are dropped, then that whole number uses the remainder rule above.
 * 9.5 becomes 9, remainder 4, and rounds up to 10.
 * 7.5 becomes 7, remainder 2, and rounds down to 5. 7.5 is halfway between
 * 5 and 10. Dropping the half leaves remainder 2, which is the down band,
 * so 7.5 does not round up to 10.
 */
export function roundToFive(pips: number): number {
  if (!Number.isFinite(pips) || pips <= 0) return 0;
  const whole = Math.trunc(pips);
  const remainder = whole % 5;
  if (remainder === 0) return whole;
  if (remainder <= 2) return whole - remainder;
  return whole + (5 - remainder);
}

/**
 * Split the other players' pips evenly, then round each exact share to the
 * nearest 5. The share is pot / ways, fraction included, passed through
 * roundToFive. Two players splitting 19 get 9.5, which rounds to 10 each.
 * Two players splitting 15 get 7.5, which rounds to 5 each.
 */
export function splitShare(pot: number, ways: number): number {
  if (ways <= 0 || pot <= 0) return 0;
  return roundToFive(pot / ways);
}

export function scoreDomino(
  pipCounts: Record<string, number>,
  winnerId: string,
): Record<string, number> {
  const awards: Record<string, number> = {};
  let others = 0;
  for (const [id, pips] of Object.entries(pipCounts)) {
    awards[id] = 0;
    if (id !== winnerId) others += pips;
  }
  awards[winnerId] = roundToFive(others);
  return awards;
}

export interface LockScore {
  winnerIds: string[];
  nextLeaderId: string;
  pipCounts: Record<string, number>;
  awards: Record<string, number>;
}

/**
 * Locked hand: fewest pips wins and collects everyone else's pips,
 * rounded once to the nearest 5. A tie splits only the non-tied
 * players' pips. Each exact share is rounded to the nearest 5.
 * The next leader is the tied player holding the lowest tile-end.
 */
export function scoreLocked(hands: Record<string, readonly string[]>): LockScore {
  const pipCounts: Record<string, number> = {};
  for (const [id, tiles] of Object.entries(hands)) {
    pipCounts[id] = handPips(tiles);
  }
  const lowest = Math.min(...Object.values(pipCounts));
  const winnerIds = Object.keys(pipCounts).filter((id) => pipCounts[id] === lowest);
  const awards: Record<string, number> = {};
  for (const id of Object.keys(pipCounts)) awards[id] = 0;

  if (winnerIds.length === 1) {
    const winnerId = winnerIds[0]!;
    let others = 0;
    for (const [id, pips] of Object.entries(pipCounts)) {
      if (id !== winnerId) others += pips;
    }
    awards[winnerId] = roundToFive(others);
    return { winnerIds, nextLeaderId: winnerId, pipCounts, awards };
  }

  let pot = 0;
  for (const [id, pips] of Object.entries(pipCounts)) {
    if (!winnerIds.includes(id)) pot += pips;
  }
  const share = splitShare(pot, winnerIds.length);
  for (const id of winnerIds) awards[id] = share;

  const nextLeaderId = [...winnerIds].sort((a, b) => {
    const left = lowestEndKey(hands[a] ?? []);
    const right = lowestEndKey(hands[b] ?? []);
    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];
    return left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : 0;
  })[0]!;

  return { winnerIds, nextLeaderId, pipCounts, awards };
}

export interface Placement {
  playerId: string;
  place: number;
  pips: number;
  tied: boolean;
}

/**
 * 1st is the hand winner (went out, lightest hand, or the player who
 * reached the target). Everyone else is ordered by remaining pips,
 * lowest first. Equal pips share a place. The next place skips ahead.
 * No placement points are awarded.
 */
export function finishingOrder(
  pipCounts: Record<string, number>,
  firstIds: readonly string[],
): Placement[] {
  const first = new Set(firstIds);
  const leaders = Object.keys(pipCounts).filter((id) => first.has(id));
  const rest = Object.keys(pipCounts).filter((id) => !first.has(id));
  rest.sort((a, b) => pipCounts[a]! - pipCounts[b]! || (a < b ? -1 : a > b ? 1 : 0));
  const placements: Placement[] = [];
  const leaderTied = leaders.length > 1;
  for (const playerId of leaders) {
    placements.push({ playerId, place: 1, pips: pipCounts[playerId] ?? 0, tied: leaderTied });
  }
  let index = 0;
  while (index < rest.length) {
    let end = index + 1;
    while (end < rest.length && pipCounts[rest[end]!] === pipCounts[rest[index]!]) end += 1;
    const tied = end - index > 1;
    const place = leaders.length + index + 1;
    for (let cursor = index; cursor < end; cursor += 1) {
      const playerId = rest[cursor]!;
      placements.push({ playerId, place, pips: pipCounts[playerId] ?? 0, tied });
    }
    index = end;
  }
  return placements;
}

/** First to `needed` game-wins takes a best-of series. */
export function winsNeeded(seriesLength: number): number {
  return Math.floor(seriesLength / 2) + 1;
}

/**
 * After a hand, the game is won by the single player with the highest
 * score, if that score is at least the target. A tie at the top does
 * not end the game, even when both scores have reached the target.
 */
export function gameWinnerId(scores: Record<string, number>, targetScore: number): string | null {
  let top = -1;
  let leaders: string[] = [];
  for (const [id, score] of Object.entries(scores)) {
    if (score > top) {
      top = score;
      leaders = [id];
    } else if (score === top) {
      leaders.push(id);
    }
  }
  if (top < targetScore || leaders.length !== 1) return null;
  return leaders[0] ?? null;
}
