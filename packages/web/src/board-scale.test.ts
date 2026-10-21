import { describe, expect, it } from "vitest";
import { FIT_MARGIN } from "../../rules/src/layout.js";
import {
  chainBounds,
  fitScale,
  handOverShift,
  nextBoardScale,
  PHONE_SCALE_CAP,
  scaleForTiles,
} from "./board-scale.js";

const felt = { w: 412, h: 560 };
const tiles = [
  { x: -18, y: -36, w: 36, h: 72 },
  { x: 20, y: -18, w: 72, h: 36 },
  { x: 94, y: -18, w: 72, h: 36 },
  { x: 168, y: -18, w: 72, h: 36 },
  { x: 168, y: 20, w: 36, h: 72 },
];

describe("board scale", () => {
  it("is identical across turn changes for the same tile set", () => {
    const yourTurn = scaleForTiles(tiles, felt, PHONE_SCALE_CAP);
    // The computer's turn used to shrink the felt: a two-line status, or the
    // hand-over sheet, was inside the measured box. Those are not inputs.
    const computerTurn = scaleForTiles(tiles, felt, PHONE_SCALE_CAP);
    expect(computerTurn).toBe(yourTurn);
    expect(yourTurn).toBeGreaterThan(0.4);

    const ghost = { x: -280, y: -18, w: 72, h: 36 };
    const withDropTarget = fitScale(chainBounds([...tiles, ghost]), felt, PHONE_SCALE_CAP);
    expect(withDropTarget).toBeLessThan(yourTurn);
    expect(chainBounds(tiles).w).toBeLessThan(chainBounds([...tiles, ghost]).w);
  });

  it("shrinks only when the chain grows, and grows again on a new hand", () => {
    const open = scaleForTiles(tiles.slice(0, 2), felt, PHONE_SCALE_CAP);
    const longer = scaleForTiles(tiles, felt, PHONE_SCALE_CAP);
    expect(longer).toBeLessThan(open);
    expect(nextBoardScale(open, longer, false)).toBe(longer);
    // A turn change that reports a larger computed scale must not zoom back in.
    expect(nextBoardScale(longer, open, false)).toBe(longer);
    expect(nextBoardScale(longer, open, true)).toBe(open);
  });

  it("lifts the frozen chain above the hand-over sheet without changing scale", () => {
    const open = scaleForTiles(tiles, felt, PHONE_SCALE_CAP);
    expect(scaleForTiles(tiles, felt, PHONE_SCALE_CAP)).toBe(open);

    expect(handOverShift({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: null,
      chainHeight: 247,
      lastTile: { top: 180, height: 40 },
    })).toBe(0);
    expect(handOverShift({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 800,
      chainHeight: 247,
      lastTile: null,
    })).toBe(0);

    // Felt 100–706, sheet at 422. The 247px chain fits in the band, so the
    // whole chain — including the last tile — moves above the sheet.
    const fitted = handOverShift({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 422,
      chainHeight: 247,
      lastTile: { top: 200, height: 36 },
    });
    const fittedTop = 100 + (606 - 247) / 2 + fitted;
    expect(fittedTop).toBeGreaterThanOrEqual(108);
    expect(fittedTop + 247).toBeLessThanOrEqual(422 - 28);
    expect(handOverShift({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 422,
      chainHeight: 247,
      lastTile: { top: 200, height: 36 },
    })).toBe(fitted);

    // A chain taller than the band keeps its scale. The last tile sits in the
    // band, and the chain covers that band instead of leaving a gap under it.
    const lastTile = { top: 360, height: 48 };
    const tall = handOverShift({
      feltTop: 100,
      feltHeight: 535,
      sheetTop: 390,
      chainHeight: 419,
      lastTile,
    });
    const naturalTop = 100 + (535 - 419) / 2;
    const chainTop = naturalTop + tall;
    const tileTop = chainTop + lastTile.top;
    const tileBottom = tileTop + lastTile.height;
    expect(tileTop).toBeGreaterThanOrEqual(108);
    expect(tileBottom).toBeLessThanOrEqual(390 - 28);
    expect(chainTop).toBeLessThanOrEqual(108);
    expect(chainTop + 419).toBeGreaterThanOrEqual(390 - 28);
    expect(handOverShift({
      feltTop: 100,
      feltHeight: 535,
      sheetTop: 390,
      chainHeight: 419,
      lastTile,
    })).toBe(tall);
  });

  it("pads the chain and ignores an empty board", () => {
    const bounds = chainBounds(tiles);
    expect(bounds.x).toBeLessThanOrEqual(tiles[0]!.x - FIT_MARGIN);
    expect(bounds.y).toBeLessThanOrEqual(-36 - FIT_MARGIN);
    expect(chainBounds([]).w).toBe(80);
  });
});
