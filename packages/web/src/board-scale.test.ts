import { describe, expect, it } from "vitest";
import { emptyBoard, placeTile } from "../../rules/src/board.js";
import { FIT_MARGIN, layoutBoard, TILE_SHORT } from "../../rules/src/layout.js";
import { tileById } from "../../rules/src/tiles.js";
import {
  boardShift,
  CAMERA_EDGE,
  cameraScale,
  chainBounds,
  clearanceInsets,
  FELT_PAD_Y,
  fitScale,
  followCamera,
  handOverPlacement,
  landedTileBox,
  MIN_TILE_FRAC,
  READABLE_PHONE_PX,
  READABLE_WIDE_PX,
  nextBoardScale,
  OPEN_TILE_FRAC,
  PHONE_SCALE_CAP,
  scaleForTiles,
  screenBox,
  zoneInsets,
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

  it("fits a tall chain under a top badge and clear of the side racks", () => {
    const felt = { w: 920, h: 700 };
    const bounds = { w: 220, h: 640 };
    const reserve = { top: 72, right: 86, bottom: 0, left: 86 };
    const scale = cameraScale({ bounds, felt, screenWidth: 920, previous: null, newHand: true, reserve });
    const clearance = clearanceInsets(reserve);
    const shift = boardShift(clearance);
    const chainW = bounds.w * scale;
    const chainH = bounds.h * scale;
    const top = (felt.h - chainH) / 2 + shift.y;
    const left = (felt.w - chainW) / 2 + shift.x;
    expect(top).toBeGreaterThanOrEqual(clearance.top - 0.6);
    expect(left).toBeGreaterThanOrEqual(clearance.left - 0.6);
    expect(top + chainH).toBeLessThanOrEqual(felt.h - clearance.bottom + 0.6);
    expect(left + chainW).toBeLessThanOrEqual(felt.w - clearance.right + 0.6);
    expect(shift.y).toBeGreaterThan(0);
  });

  it("reserves the side a badge actually overlaps, plus a gap", () => {
    const felt = { left: 0, top: 40, right: 390, bottom: 640 };
    const insets = zoneInsets(felt, [
      { left: 150, top: 40, right: 240, bottom: 96 },
      { left: 0, top: 180, right: 74, bottom: 230 },
    ]);
    expect(insets.top).toBeGreaterThanOrEqual(56);
    expect(insets.left).toBeGreaterThanOrEqual(74);
    expect(insets.right).toBe(0);
    expect(insets.bottom).toBe(0);
  });

  it("lands a turned horizontal tile on its own center, not the scorer's seat", () => {
    const felt = { left: 0, top: 80, width: 390, height: 520 };
    const frame = { x: -40, y: -220, w: 280, h: 360 };
    const tile = { x: 150, y: -180, w: 72, h: 36 };
    const scale = 1.4;
    const shiftY = 18;
    const hit = landedTileBox(felt, frame, scale, 0, shiftY, tile);
    const scalerW = frame.w * scale;
    const scalerH = frame.h * scale;
    const left = felt.left + (felt.width - scalerW) / 2 + (tile.x - frame.x) * scale;
    const top = felt.top + (felt.height - scalerH) / 2 + shiftY + (tile.y - frame.y) * scale;
    expect(hit.x).toBeCloseTo(left + (tile.w * scale) / 2, 5);
    expect(hit.y).toBeCloseTo(top + (tile.h * scale) / 2, 5);
    expect(hit.w).toBeCloseTo(tile.w * scale, 5);
    expect(hit.h).toBeCloseTo(tile.h * scale, 5);
    expect(hit.y).toBeLessThan(felt.top + felt.height - 40);
  });

  it("pads the chain and ignores an empty board", () => {
    const bounds = chainBounds(tiles);
    expect(bounds.x).toBeLessThanOrEqual(tiles[0]!.x - FIT_MARGIN);
    expect(bounds.y).toBeLessThanOrEqual(-36 - FIT_MARGIN);
    expect(chainBounds([]).w).toBe(80);
  });

  it("keeps every open end on screen down to the readable floor", () => {
    const ends = [
      { id: "west", x: -150, y: -18, w: 72, h: 36 },
      { id: "east", x: 76, y: -18, w: 72, h: 36 },
      { id: "north", x: -18, y: -250, w: 36, h: 72 },
      { id: "south", x: -18, y: 200, w: 36, h: 72 },
    ];
    const frame = chainBounds(ends, 0);
    const felt = { w: 390, h: 640 };
    const reserve = { top: 70, right: 40, bottom: 30, left: 40 };
    const phone = followCamera({ frame, ends, felt, screenWidth: 390, reserve });
    const insets = clearanceInsets(reserve);
    expect(phone.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_PHONE_PX - 0.5);
    expect(phone.scale * TILE_SHORT).toBeLessThan(52);
    for (const end of ends) {
      const seen = screenBox(felt, frame, phone.scale, phone.shiftX, phone.shiftY, end);
      expect(seen.left).toBeGreaterThanOrEqual(insets.left - 0.5);
      expect(seen.top).toBeGreaterThanOrEqual(insets.top - 0.5);
      expect(seen.right).toBeLessThanOrEqual(felt.w - insets.right + 0.5);
      expect(seen.bottom).toBeLessThanOrEqual(felt.h - insets.bottom + 0.5);
    }
    const wide = followCamera({ frame, ends, felt: { w: 920, h: 780 }, screenWidth: 920, reserve });
    expect(wide.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_WIDE_PX - 0.5);
    const wideInsets = clearanceInsets(reserve);
    for (const end of ends) {
      const seen = screenBox({ w: 920, h: 780 }, frame, wide.scale, wide.shiftX, wide.shiftY, end);
      expect(seen.left).toBeGreaterThanOrEqual(wideInsets.left - 0.5);
      expect(seen.right).toBeLessThanOrEqual(920 - wideInsets.right + 0.5);
    }
  });

  it("drops interior tiles once the open ends no longer fit at the floor, and keeps a playable end", () => {
    const ends = [
      { id: "north", x: -18, y: -900, w: 36, h: 72 },
      { id: "south", x: -18, y: 860, w: 36, h: 72 },
      { id: "east", x: 80, y: -18, w: 72, h: 36 },
      { id: "west", x: -140, y: -18, w: 72, h: 36 },
    ];
    const frame = chainBounds(ends, 0);
    const felt = { w: 390, h: 640 };
    const reserve = { top: 70, right: 40, bottom: 30, left: 40 };
    const phone = followCamera({
      frame,
      ends,
      playableIds: ["north"],
      felt,
      screenWidth: 390,
      reserve,
    });
    expect(phone.mode).toBe("follow");
    expect(phone.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_PHONE_PX - 0.5);
    expect(phone.scale * TILE_SHORT).toBeLessThanOrEqual(READABLE_PHONE_PX + 0.5);
    const insets = clearanceInsets(reserve);
    const north = screenBox(felt, frame, phone.scale, phone.shiftX, phone.shiftY, ends[0]!);
    expect(north.top).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect(north.bottom).toBeLessThanOrEqual(felt.h - insets.bottom + 0.5);
    const south = screenBox(felt, frame, phone.scale, phone.shiftX, phone.shiftY, ends[1]!);
    const southInside = south.top >= insets.top - 0.5 && south.bottom <= felt.h - insets.bottom + 0.5;
    expect(southInside).toBe(false);
    expect(phone.off.top || phone.off.bottom || phone.off.left || phone.off.right).toBe(true);
  });

  it("frames every open end of the 17-tile chain clear of the seat badges", () => {
    const layout = laid(CROWD);
    const frame = chainBounds(layout.tiles, 0);
    const phone = followCamera({
      frame,
      ends: layout.ends,
      felt: { w: 390, h: 644 },
      screenWidth: 390,
      reserve: PHONE_RESERVE,
      zones: PHONE_ZONES,
    });
    expect(phone.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_PHONE_PX - 0.5);
    expect(phone.scale * TILE_SHORT).toBeLessThan(52);
    expect(endsClear(layout.ends, frame, phone, { w: 390, h: 644 }, PHONE_ZONES)).toBe(true);
    const fold = followCamera({
      frame,
      ends: layout.ends,
      felt: { w: 920, h: 776 },
      screenWidth: 920,
      reserve: PHONE_RESERVE,
      zones: FOLD_ZONES,
    });
    expect(fold.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_WIDE_PX - 0.5);
    expect(fold.scale * TILE_SHORT).toBeLessThan(60);
    expect(endsClear(layout.ends, frame, fold, { w: 920, h: 776 }, FOLD_ZONES)).toBe(true);
  });

  it("drops an arm of a chain whose ends cannot fit at the floor and keeps the playable end", () => {
    const layout = laid(LONG);
    const frame = chainBounds(layout.tiles, 0);
    const phone = followCamera({
      frame,
      ends: layout.ends,
      playableIds: ["north"],
      felt: { w: 390, h: 644 },
      screenWidth: 390,
      reserve: PHONE_RESERVE,
      zones: PHONE_ZONES,
    });
    expect(phone.mode).toBe("follow");
    expect(phone.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_PHONE_PX - 0.5);
    expect(phone.scale * TILE_SHORT).toBeLessThanOrEqual(READABLE_PHONE_PX + 0.5);
    const north = layout.ends.find((end) => end.id === "north")!;
    const seen = screenBox({ w: 390, h: 644 }, frame, phone.scale, phone.shiftX, phone.shiftY, north);
    const insets = clearanceInsets(PHONE_RESERVE);
    expect(seen.top).toBeGreaterThanOrEqual(insets.top - 0.5);
    expect(seen.bottom).toBeLessThanOrEqual(644 - insets.bottom + 0.5);
    expect(seen.left).toBeGreaterThanOrEqual(insets.left - 0.5);
    expect(seen.right).toBeLessThanOrEqual(390 - insets.right + 0.5);
    const outside = layout.ends.some((end) => {
      const box = screenBox({ w: 390, h: 644 }, frame, phone.scale, phone.shiftX, phone.shiftY, end);
      return box.top < -1 || box.bottom > 645 || box.left < -1 || box.right > 391;
    });
    expect(outside).toBe(true);
    expect(phone.off.top || phone.off.bottom || phone.off.left || phone.off.right).toBe(true);
  });
});

const PHONE_RESERVE = { top: 62, right: 63, bottom: 30, left: 63 };

const PHONE_ZONES = [
  { left: 0, top: 258.4, right: 53.4, bottom: 286.4 },
  { left: 0, top: 290.4, right: 22, bottom: 411.4 },
  { left: 16, top: 0, right: 374, bottom: 20 },
  { left: 168.3, top: 24, right: 221.7, bottom: 52 },
  { left: 336.6, top: 258.4, right: 390, bottom: 286.4 },
  { left: 368, top: 290.4, right: 390, bottom: 411.4 },
];

const FOLD_ZONES = [
  { left: 0, top: 327, right: 53.4, bottom: 355 },
  { left: 0, top: 359, right: 22, bottom: 480 },
  { left: 16, top: 0, right: 904, bottom: 20 },
  { left: 433.3, top: 24, right: 486.7, bottom: 52 },
  { left: 866.6, top: 327, right: 920, bottom: 355 },
  { left: 898, top: 359, right: 920, bottom: 480 },
];

const CROWD: Array<[string, string]> = [
  ["lead", "6-6"],
  ["west", "0-6"],
  ["east", "1-6"],
  ["north", "2-6"],
  ["east", "0-1"],
  ["west", "0-0"],
  ["south", "3-6"],
  ["north", "0-2"],
  ["east", "0-3"],
  ["west", "0-4"],
  ["south", "1-3"],
  ["north", "0-5"],
  ["east", "2-3"],
  ["west", "1-4"],
  ["south", "1-1"],
  ["north", "1-5"],
  ["east", "1-2"],
];

const LONG: Array<[string, string]> = [
  ["lead", "6-6"],
  ["west", "1-6"],
  ["east", "2-6"],
  ["north", "3-6"],
  ["south", "4-6"],
  ["north", "0-3"],
  ["north", "0-1"],
  ["north", "1-2"],
  ["south", "0-4"],
  ["south", "0-2"],
  ["south", "2-3"],
  ["north", "2-4"],
  ["north", "4-4"],
  ["east", "2-2"],
  ["south", "1-3"],
  ["south", "1-1"],
  ["west", "1-4"],
  ["west", "3-4"],
  ["west", "3-5"],
  ["west", "0-5"],
  ["west", "0-6"],
  ["west", "5-6"],
  ["west", "1-5"],
];

function laid(steps: Array<[string, string]>) {
  let board = emptyBoard();
  for (const [end, id] of steps) board = placeTile(board, end, tileById(id));
  return layoutBoard(board);
}

function endsClear(
  ends: readonly { x: number; y: number; w: number; h: number; id: string }[],
  frame: { x: number; y: number; w: number; h: number },
  shot: { scale: number; shiftX: number; shiftY: number },
  felt: { w: number; h: number },
  zones: readonly { left: number; top: number; right: number; bottom: number }[],
): boolean {
  return ends.every((end) => {
    const box = screenBox(felt, frame, shot.scale, shot.shiftX, shot.shiftY, end);
    if (box.left < 3 || box.top < 3 || box.right > felt.w - 3 || box.bottom > felt.h - 3) return false;
    return zones.every((zone) => box.right <= zone.left + 1 || box.left >= zone.right - 1 || box.bottom <= zone.top + 1 || box.top >= zone.bottom - 1);
  });
}
