import { FIT_MARGIN, type LayoutBox } from "../../rules/src/layout.js";

/** Inset from the wooden rails. The turn banner does not change this. */
export const FELT_PAD_X = 22;
export const FELT_PAD_Y = 48;
export const PHONE_SCALE_CAP = 2.2;
export const DESK_SCALE_CAP = 2.4;

export interface FeltSize {
  w: number;
  h: number;
}

/** Tight box around played tiles only. End caps and drop previews are not part of it. */
export function chainBounds(tiles: readonly LayoutBox[], margin = FIT_MARGIN): LayoutBox {
  if (tiles.length === 0) return { x: -40, y: -40, w: 80, h: 80 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const tile of tiles) {
    minX = Math.min(minX, tile.x);
    minY = Math.min(minY, tile.y);
    maxX = Math.max(maxX, tile.x + tile.w);
    maxY = Math.max(maxY, tile.y + tile.h);
  }
  return {
    x: minX - margin,
    y: minY - margin,
    w: Math.max(1, maxX - minX + margin * 2),
    h: Math.max(1, maxY - minY + margin * 2),
  };
}

/** Fit the chain's own box into a felt rect. The felt size must not include turn chrome. */
export function fitScale(bounds: FeltSize, felt: FeltSize, cap: number): number {
  const roomW = Math.max(48, felt.w - FELT_PAD_X * 2);
  const roomH = Math.max(48, felt.h - FELT_PAD_Y * 2);
  return Math.min(roomW / Math.max(1, bounds.w), roomH / Math.max(1, bounds.h), cap);
}

export function scaleForTiles(tiles: readonly LayoutBox[], felt: FeltSize, cap: number): number {
  return fitScale(chainBounds(tiles), felt, cap);
}

/**
 * Within a hand the picture only shrinks, and only when the chain needs
 * more room. A new hand may grow again. Turn changes pass the same tiles
 * and the same felt, so they come back unchanged.
 */
export function nextBoardScale(previous: number | null, computed: number, newHand: boolean): number {
  if (newHand || previous == null || !Number.isFinite(previous)) return computed;
  return Math.min(previous, computed);
}

/** Clearance inside the felt, above the hand-over sheet. The gold ring sits in this gap. */
export const HAND_OVER_BAND_TOP = 8;
export const HAND_OVER_BAND_GAP = 28;

export interface HandOverShiftInput {
  /** Felt top, in the same coordinate space as `sheetTop`. */
  feltTop: number;
  feltHeight: number;
  /** Top of the hand-over sheet. Null when that sheet is not on screen. */
  sheetTop: number | null;
  /** Visual height of the chain box. Scale is not changed to produce this. */
  chainHeight: number;
  /** Last tile's top and height inside the chain, in visual pixels. */
  lastTile: { top: number; height: number } | null;
}

/**
 * Vertical shift that keeps the frozen chain readable above the hand-over sheet.
 * Pass the chain's natural, felt-centered position — not a rect that already
 * includes this shift — so measuring twice does not walk the board upward.
 * Scale is not an input. A chain that fits in the visible band is centered
 * there. A taller chain keeps its scale and slides the least amount that
 * leaves the last tile inside the band and covers that band.
 */
export function handOverShift(input: HandOverShiftInput): number {
  const feltBottom = input.feltTop + input.feltHeight;
  if (input.sheetTop == null || input.sheetTop >= feltBottom - 4) return 0;
  const bandTop = input.feltTop + HAND_OVER_BAND_TOP;
  const bandBottom = Math.min(feltBottom, input.sheetTop) - HAND_OVER_BAND_GAP;
  if (bandBottom <= bandTop) return 0;
  const bandHeight = bandBottom - bandTop;
  const naturalTop = input.feltTop + (input.feltHeight - input.chainHeight) / 2;

  if (input.chainHeight <= bandHeight) {
    return bandTop + (bandHeight - input.chainHeight) / 2 - naturalTop;
  }

  const tile = input.lastTile ?? {
    top: Math.max(0, input.chainHeight - Math.min(bandHeight, 48)),
    height: Math.min(bandHeight, 48),
  };
  const tileLo = bandTop - tile.top;
  const tileHi = bandBottom - tile.height - tile.top;
  const coverLo = bandBottom - input.chainHeight;
  const coverHi = bandTop;
  let lo = tileLo;
  let hi = tileHi;
  if (tileLo <= tileHi && coverLo <= coverHi) {
    const overlapLo = Math.max(tileLo, coverLo);
    const overlapHi = Math.min(tileHi, coverHi);
    if (overlapLo <= overlapHi) {
      lo = overlapLo;
      hi = overlapHi;
    }
  }
  if (lo > hi) {
    const bandCenter = (bandTop + bandBottom) / 2;
    return bandCenter - (tile.top + tile.height / 2) - naturalTop;
  }
  return Math.min(hi, Math.max(lo, naturalTop)) - naturalTop;
}
