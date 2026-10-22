import { describe, expect, it } from "vitest";
import { FIT_MARGIN } from "../../rules/src/layout.js";
import { TILE_SHORT } from "../../rules/src/layout.js";
import {
  CAMERA_EDGE,
  cameraScale,
  chainBounds,
  FELT_PAD_Y,
  fitScale,
  handOverPlacement,
  MIN_TILE_FRAC,
  nextBoardScale,
  OPEN_TILE_FRAC,
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

  it("keeps a hand-over chain inside the felt and lowers the sheet when the last tile needs room", () => {
    const open = scaleForTiles(tiles, felt, PHONE_SCALE_CAP);
    expect(scaleForTiles(tiles, felt, PHONE_SCALE_CAP)).toBe(open);

    expect(handOverPlacement({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: null,
      chainHeight: 247,
      lastTile: { top: 180, height: 40 },
    }).lift).toBe(0);
    expect(handOverPlacement({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 800,
      chainHeight: 247,
      lastTile: null,
    })).toEqual({ lift: 0, sheetTop: null });

    // Felt 100–706, sheet at 422. Shift only until the last tile clears it.
    const fitted = handOverPlacement({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 422,
      chainHeight: 247,
      lastTile: { top: 200, height: 36 },
    });
    const naturalTop = 100 + (606 - 247) / 2;
    const chainTop = naturalTop + fitted.lift;
    expect(chainTop).toBeGreaterThanOrEqual(100 + FELT_PAD_Y);
    expect(chainTop + 200 + 36).toBeLessThanOrEqual(422 - 28);
    expect(chainTop + 247).toBeLessThanOrEqual(706 - FELT_PAD_Y);
    expect(fitted.sheetTop).toBeNull();
    expect(handOverPlacement({
      feltTop: 100,
      feltHeight: 606,
      sheetTop: 422,
      chainHeight: 247,
      lastTile: { top: 200, height: 36 },
    })).toEqual(fitted);

    // A 20-tile chain is taller than the gap above a 54dvh sheet. The top
    // stops at the rail inset, and the sheet is told to start lower.
    const lastTile = { top: 405, height: 28 };
    const tall = handOverPlacement({
      feltTop: 100,
      feltHeight: 622,
      sheetTop: 421,
      chainHeight: 433,
      lastTile,
    });
    const tallNatural = 100 + (622 - 433) / 2;
    const tallTop = tallNatural + tall.lift;
    const tileBottom = tallTop + lastTile.top + lastTile.height;
    expect(tallTop).toBeCloseTo(100 + FELT_PAD_Y, 5);
    expect(tileBottom).toBeGreaterThan(421);
    expect(tall.sheetTop).not.toBeNull();
    expect(tall.sheetTop!).toBeGreaterThanOrEqual(tileBottom + 28);
    expect(handOverPlacement({
      feltTop: 100,
      feltHeight: 622,
      sheetTop: 421,
      chainHeight: 433,
      lastTile,
    })).toEqual(tall);
  });

  it("starts large, zooms out only near the edge, and stays on the felt", () => {
    const screen = 390;
    const felt = { w: 390, h: 580 };
    const one = chainBounds([{ x: 0, y: 0, w: TILE_SHORT, h: TILE_SHORT * 2 }], 0);
    const open = cameraScale({ bounds: one, felt, screenWidth: screen, previous: null, newHand: true });
    expect((TILE_SHORT * open) / screen).toBeGreaterThanOrEqual(0.12);
    expect((TILE_SHORT * open) / screen).toBeLessThanOrEqual(0.15);
    expect(OPEN_TILE_FRAC).toBeGreaterThanOrEqual(0.12);
    expect(OPEN_TILE_FRAC).toBeLessThanOrEqual(0.15);

    let scale = open;
    let zoomed = false;
    for (let n = 2; n <= 14; n += 1) {
      const tiles = Array.from({ length: n }, (_, index) => ({
        x: index * 74,
        y: 0,
        w: 72,
        h: 36,
      }));
      const bounds = chainBounds(tiles, 0);
      const next = cameraScale({ bounds, felt, screenWidth: screen, previous: scale, newHand: false });
      expect(next).toBeLessThanOrEqual(scale + 1e-9);
      if (next < scale - 1e-6) zoomed = true;
      const onFelt = Math.min((felt.w - CAMERA_EDGE * 2) / bounds.w, (felt.h - CAMERA_EDGE * 2) / bounds.h);
      if (onFelt + 1e-9 >= MIN_TILE_FRAC * screen / TILE_SHORT) {
        expect(next).toBeGreaterThanOrEqual(MIN_TILE_FRAC * screen / TILE_SHORT - 1e-6);
      }
      expect(bounds.w * next).toBeLessThanOrEqual(felt.w - CAMERA_EDGE * 2 + 0.6);
      expect(bounds.h * next).toBeLessThanOrEqual(felt.h - CAMERA_EDGE * 2 + 0.6);
      // A few extra pixels inside the air band must not zoom again.
      const nudge = chainBounds([{ x: 0, y: 0, w: bounds.w + 6, h: bounds.h }], 0);
      const held = cameraScale({ bounds: nudge, felt, screenWidth: screen, previous: next, newHand: false });
      expect(held).toBeLessThanOrEqual(next + 1e-9);
      scale = next;
    }
    expect(zoomed).toBe(true);

    // A chain that has already turned inside the phone picture stays readable.
    const wrapped = { w: 416, h: 620 };
    const wrappedScale = cameraScale({
      bounds: wrapped,
      felt,
      screenWidth: screen,
      previous: open,
      newHand: false,
    });
    expect(wrapped.w * wrappedScale).toBeLessThanOrEqual(felt.w - CAMERA_EDGE * 2 + 0.6);
    expect(wrapped.h * wrappedScale).toBeLessThanOrEqual(felt.h - CAMERA_EDGE * 2 + 0.6);
    expect((TILE_SHORT * wrappedScale) / screen).toBeGreaterThanOrEqual(MIN_TILE_FRAC - 0.001);

    const again = cameraScale({ bounds: one, felt, screenWidth: screen, previous: scale, newHand: true });
    expect(again).toBeCloseTo(open, 5);
    expect(cameraScale({ bounds: one, felt, screenWidth: screen, previous: scale, newHand: false })).toBeLessThanOrEqual(scale);
  });

  it("pads the chain and ignores an empty board", () => {
    const bounds = chainBounds(tiles);
    expect(bounds.x).toBeLessThanOrEqual(tiles[0]!.x - FIT_MARGIN);
    expect(bounds.y).toBeLessThanOrEqual(-36 - FIT_MARGIN);
    expect(chainBounds([]).w).toBe(80);
  });
});
