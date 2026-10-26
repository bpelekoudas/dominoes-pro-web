/** Won games over the series target, clamped so a seat never shows more than first-to-N. */
export function gameCountLabel(won: number, needed: number): string {
  const slots = Math.max(1, Math.min(7, Math.floor(needed) || 1));
  const filled = Math.max(0, Math.min(slots, Math.floor(won)));
  return `${filled}/${slots}`;
}

/** Seat order, so "1-0-0" is the same list the score chips show. */
export function gameTallyText(counts: readonly number[]): string {
  return counts.map((count) => Math.max(0, Math.floor(count))).join("-");
}
