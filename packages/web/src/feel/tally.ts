/**
 * Honest end-of-hand math. The engine rounds a pot down to a multiple of 5,
 * and a locked tie splits only the other players' pips before that rounding.
 * There is no partnership mode: the award sits on the winning player, or on
 * each tied player when a lock splits.
 */
export interface TallyPart {
  id: string;
  pips: number;
}

export interface HandTally {
  parts: TallyPart[];
  raw: number;
  awarded: number;
  equation: string;
  low: number | null;
  tied: boolean;
  lines: readonly string[];
}

export function handTally(input: {
  reason: "domino" | "locked" | "score";
  pipCounts: Record<string, number>;
  winnerIds: readonly string[];
  awards: Record<string, number>;
}): HandTally {
  const winners = new Set(input.winnerIds);
  const everyone = Object.entries(input.pipCounts)
    .map(([id, pips]) => ({ id, pips }))
    .sort((a, b) => a.pips - b.pips || (a.id < b.id ? -1 : 1));
  const parts = input.reason === "locked" ? everyone : everyone.filter((part) => !winners.has(part.id));
  const pot = input.reason === "locked"
    ? everyone.filter((part) => !winners.has(part.id)).reduce((sum, part) => sum + part.pips, 0)
    : parts.reduce((sum, part) => sum + part.pips, 0);
  const awarded = Object.values(input.awards).reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
  const equation = (input.reason === "locked" ? everyone : parts).map((part) => String(part.pips)).join(" + ");
  const low = input.reason === "locked" ? Math.min(...everyone.map((part) => part.pips)) : null;
  const tied = input.winnerIds.length > 1;
  const lines: string[] = [];
  if (equation) lines.push(equation.replaceAll(" + ", " + "));
  if (input.reason === "locked" && low != null) lines.push(tied ? `${low} TIED` : `${low} LOW HAND`);
  else lines.push(String(pot));
  if (awarded !== pot) lines.push(String(awarded));
  return { parts, raw: pot, awarded, equation, low, tied, lines };
}
