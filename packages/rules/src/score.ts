import { handPips, lowestEndKey } from "./tiles.js";

/**
 * Board points count only when the open ends add up to a multiple of 5
 * that is at least 10. A total of 5 scores nothing. Zero scores nothing.
 */
export function boardAward(total: number): number {
  if (total >= 10 && total % 5 === 0) return total;
  return 0;
}

/** Round a pip total down to the nearest multiple of 5. 5 stays 5. 4 becomes 0. */
export function roundDownToFive(pips: number): number {
  if (pips <= 0) return 0;
  return Math.floor(pips / 5) * 5;
}

/**
 * Split a pot evenly across `ways` players, then round each share down
 * to a multiple of 5. Equivalent to floor(pot / (ways * 5)) * 5.
 */
export function splitShare(pot: number, ways: number): number {
  if (ways <= 0 || pot <= 0) return 0;
  return Math.floor(pot / (ways * 5)) * 5;
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
  awards[winnerId] = roundDownToFive(others);
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
 * rounded down to a multiple of 5. A tie splits only the non-tied
 * players' pips. Each share is rounded down. The next leader is the
 * tied player holding the lowest tile-end.
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
    awards[winnerId] = roundDownToFive(others);
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
