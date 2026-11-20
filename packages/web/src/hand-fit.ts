/**
 * Size the hand so every tile fits beside the boneyard.
 * Past 10 tiles the row scrolls, at the same size as a full row of 10.
 */
export function handFit(
  width: number,
  count: number,
  natural = 44,
): { tile: number; gap: number; scroll: boolean } {
  if (count <= 0 || width < 8) return { tile: natural, gap: 8, scroll: false };
  const scroll = count > 10;
  const fitCount = Math.min(count, 10);
  const gap = fitCount >= 8 ? 2 : fitCount >= 7 ? 4 : 8;
  // One spare pixel so rounding cannot tuck the last tile under the boneyard.
  const room = width - gap * (fitCount - 1) - 1;
  const tile = Math.floor(Math.min(natural, room / fitCount) * 10) / 10;
  return { tile: Math.max(1, tile), gap, scroll };
}
