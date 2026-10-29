/**
 * Visual pace for tile travel, draws, score pops, hand and game reveals,
 * and the pause before the next hand. The 30 second turn clock and the
 * 2 second chat line stay off this.
 */
export const MOTION = 2;

export function motionMs(base: number): number {
  return Math.round(base * MOTION);
}
