/** A double-six tile. `low` is always less than or equal to `high`. */
export interface Tile {
  id: string;
  low: number;
  high: number;
}

export function allTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let low = 0; low <= 6; low += 1) {
    for (let high = low; high <= 6; high += 1) {
      tiles.push({ id: `${low}-${high}`, low, high });
    }
  }
  return tiles;
}

export function allTileIds(): string[] {
  return allTiles().map((tile) => tile.id);
}

export function tileById(id: string): Tile {
  const parts = id.split("-");
  if (parts.length !== 2) throw new Error(`Unknown tile ${id}.`);
  const low = Number(parts[0]);
  const high = Number(parts[1]);
  if (
    !Number.isInteger(low) ||
    !Number.isInteger(high) ||
    low < 0 ||
    high > 6 ||
    low > high ||
    id !== `${low}-${high}`
  ) {
    throw new Error(`Unknown tile ${id}.`);
  }
  return { id, low, high };
}

export function isTileId(id: string): boolean {
  try {
    tileById(id);
    return true;
  } catch {
    return false;
  }
}

export function tilePips(id: string): number {
  const tile = tileById(id);
  return tile.low + tile.high;
}

export function isDouble(id: string): boolean {
  const tile = tileById(id);
  return tile.low === tile.high;
}

/** Spoken form, higher pip first: "6–4". */
export function tileLabel(id: string): string {
  const tile = tileById(id);
  return `${tile.high}–${tile.low}`;
}

export function handPips(tileIds: readonly string[]): number {
  return tileIds.reduce((sum, id) => sum + tilePips(id), 0);
}

/**
 * The tile in a hand with the lowest end.
 * Key is [lowest pip, the other pip, tile id]. Tiles are unique, so this
 * never ties between two players who hold different tiles.
 */
export function lowestEndKey(tileIds: readonly string[]): [number, number, string] {
  let best: [number, number, string] | null = null;
  for (const id of tileIds) {
    const tile = tileById(id);
    const key: [number, number, string] = [tile.low, tile.high, id];
    if (
      !best ||
      key[0] < best[0] ||
      (key[0] === best[0] && key[1] < best[1]) ||
      (key[0] === best[0] && key[1] === best[1] && key[2] < best[2])
    ) {
      best = key;
    }
  }
  if (!best) throw new Error("Cannot compare an empty hand.");
  return best;
}
