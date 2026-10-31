import { bigMomentLevel } from "../../../rules/src/moment.js";
import { motionMs } from "../../../rules/src/motion.js";

/**
 * When the +N appears, when it starts traveling, when it reaches the
 * score, and when it leaves. A routine 10 stays inside the old 460–1100
 * window. A 20+ score already holds the table for the glass, so its
 * flight can finish inside that moment.
 */
export function scorePopWindow(awarded: number): { show: number; fly: number; land: number; hide: number } {
  if (bigMomentLevel(awarded)) return { show: motionMs(720), fly: motionMs(240), land: motionMs(1340), hide: motionMs(1760) };
  return { show: motionMs(460), fly: motionMs(160), land: motionMs(1000), hide: motionMs(1100) };
}

/** How long the number travels once it leaves the tile. */
export const SCORE_FLY_MS = motionMs(380);
