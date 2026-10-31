/**
 * Visual pace for tile travel, draws, score pops, hand and game reveals,
 * and the pause before the next hand. The 30 second turn clock and the
 * 2 second chat line stay off this.
 */
/** 1.6 is a fifth faster than the doubled pace. */
export const MOTION = 1.6;

export function motionMs(base: number): number {
  return Math.round(base * MOTION);
}
