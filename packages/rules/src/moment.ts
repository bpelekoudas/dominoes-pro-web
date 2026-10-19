/**
 * A single board score at or above this is the UH-OH moment.
 * 10 and 15 stay the small gold popup. 5 never scores.
 */
export const BIG_MOMENT_SCORE = 20;

/**
 * How long the moment runs. The next human's turn clock gets this
 * added so the animation does not eat their 30 seconds.
 * Long enough for the glass to clear and the words to be read.
 */
export const BIG_MOMENT_MS = 2000;

export type BigMomentLevel = "small" | "medium" | "big";

/** 20 is a small shake, 25–30 medium, 35 and up a big one. */
export function bigMomentLevel(awarded: number): BigMomentLevel | null {
  if (!Number.isFinite(awarded) || awarded < BIG_MOMENT_SCORE) return null;
  if (awarded >= 35) return "big";
  if (awarded >= 25) return "medium";
  return "small";
}

export function turnHoldMs(awarded: number): number {
  return bigMomentLevel(awarded) ? BIG_MOMENT_MS : 0;
}
