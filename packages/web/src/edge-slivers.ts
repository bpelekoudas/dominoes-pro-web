/**
 * Space between an opponent's edge slivers.
 * A short stack keeps a small gap. A long one overlaps so it stays in `span`.
 */
export function sliverGap(count: number, span: number, tile: number, gap = 3): number {
  if (count <= 1 || span <= tile) return gap;
  const natural = count * tile + (count - 1) * gap;
  if (natural <= span) return gap;
  return (span - tile) / (count - 1) - tile;
}
