/**
 * The number a score popup, chip count, or fly-in is allowed to show.
 * A real 20 stays 20. Nothing below 10 scores, and nothing here invents a 20.
 */
export function scoreDeltaLabel(awarded: number): number | null {
  if (!Number.isFinite(awarded) || awarded < 10) return null;
  return awarded;
}

/**
 * The floating "+N". It is the server award for this play, or nothing.
 * A count-up step (the +20 on the way through a 25) is not a popup.
 */
export function scorePopupText(awarded: number): string | null {
  const label = scoreDeltaLabel(awarded);
  if (label == null) return null;
  return `+${label}`;
}

/**
 * Popup for the play on the table now. A stale "+20" or "+25" from an
 * earlier play is dropped, and a 0 award shows nothing.
 */
export function scorePopupForPlay(
  play: { seq: number; awarded: number } | null,
  shown: { seq: number; awarded: number } | null,
): { seq: number; awarded: number; text: string } | null {
  if (!play || !shown) return null;
  if (shown.seq !== play.seq || shown.awarded !== play.awarded) return null;
  const text = scorePopupText(play.awarded);
  if (text == null) return null;
  return { seq: play.seq, awarded: play.awarded, text };
}

/**
 * Identity of the play that may animate. Empty during a hand break, a
 * finished match, or a play that scored nothing, so a previous count
 * cannot keep painting.
 */
export function scoreChaseKey(input: {
  gameNumber: number;
  handNumber: number;
  seq: number;
  awarded: number;
  betweenHands: boolean;
  phase: string;
}): string {
  if (input.betweenHands || input.phase === "between" || input.phase === "over") return "";
  const label = scoreDeltaLabel(input.awarded);
  if (label == null) return "";
  return `${input.gameNumber}:${input.handNumber}:${input.seq}:${label}`;
}

/**
 * Count by fives from the score before the play to the score after it.
 * The last frame is the real total. A 25 passes through from+20 on the
 * way; that step is not an award and must leave with this play.
 */
export function scoreChaseFrames(from: number, to: number, awarded: number): number[] {
  if (scoreDeltaLabel(awarded) == null || to <= from) return [];
  const steps = Math.max(1, Math.round(awarded / 5));
  const frames = [from];
  for (let step = 1; step <= steps; step += 1) {
    frames.push(step === steps ? to : from + step * 5);
  }
  return frames;
}

/** Celebration wins. A count applies only while it still belongs to this play. */
export function chipScore(input: {
  score: number;
  chaseKey: string;
  chase: { key: string; shown: number; pulse: boolean } | null;
  celebration: { score: number; pulse: boolean; hot: boolean } | null;
}): { score: number; pulse: boolean; hot: boolean } {
  if (input.celebration) return input.celebration;
  if (input.chase && input.chase.key && input.chase.key === input.chaseKey) {
    return { score: input.chase.shown, pulse: input.chase.pulse, hot: false };
  }
  return { score: input.score, pulse: false, hot: false };
}
