import { createHmac, randomBytes } from "node:crypto";
import { allTileIds } from "./tiles.js";

/**
 * 32-byte seed from the operating system's CSPRNG.
 * The seed is stored with the hand. It is never sent to players.
 */
export function randomSeed(): Buffer {
  return randomBytes(32);
}

/**
 * HMAC-SHA256 counter stream. Same seed always yields the same bytes.
 * This is the auditable shuffle: replay the seed and you get the same deck.
 */
export function uint32Stream(seed: Buffer): () => number {
  let counter = 0;
  let pool = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset + 4 > pool.length) {
      pool = createHmac("sha256", seed).update(`uhoh-dominoes-v1:${counter}`).digest();
      counter += 1;
      offset = 0;
    }
    const value = pool.readUInt32BE(offset);
    offset += 4;
    return value;
  };
}

/** Unbiased integer in [0, exclusiveMax). Rejects values that would bias modulo. */
export function randomBelow(next: () => number, exclusiveMax: number): number {
  if (exclusiveMax <= 1) return 0;
  const max = 0x1_0000_0000;
  const limit = max - (max % exclusiveMax);
  let value = next();
  while (value >= limit) value = next();
  return value % exclusiveMax;
}

/** Fisher-Yates shuffle of a fresh double-six deck. */
export function shuffleWithSeed(seed: Buffer): string[] {
  const tiles = allTileIds();
  const next = uint32Stream(seed);
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = randomBelow(next, i + 1);
    const swap = tiles[i];
    tiles[i] = tiles[j]!;
    tiles[j] = swap!;
  }
  return tiles;
}

export function deckMatchesSeed(seed: Buffer, deck: readonly string[]): boolean {
  const again = shuffleWithSeed(seed);
  return again.length === deck.length && again.every((tile, index) => tile === deck[index]);
}
