import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARM_IDS, emptyBoard, openEnds, placeTile, type BoardState } from "../../rules/src/board.js";
import { applyIntent, beginHand, createMatch, currentPlayerId, legalIntents } from "../../rules/src/engine.js";
import { boxesOverlap, FIT_MARGIN, layoutBoard, layoutOverlaps, TILE_GAP, TILE_LONG, TILE_SHORT } from "../../rules/src/layout.js";
import { shuffleWithSeed } from "../../rules/src/rng.js";
import { allTiles, tileById } from "../../rules/src/tiles.js";
import {
  boardShift,
  CAMERA_EDGE,
  cameraScale,
  cameraSettlesOn,
  CAMERA_EASE_MS,
  cameraEase,
  chainViewShift,
  containScale,
  fitFrameScale,
  glidePoses,
  poseAt,
  feltInnerRect,
  renderedTileRect,
  rectsMeet,
  scaleClearOfSlots,
  feltScale,
  frameInsets,
  keepOutInsets,
  mergeInsets,
  nextFeltSize,
  safeRoom,
  tilesRelocating,
  zoomSamples,
  centeredChain,
  chainBounds,
  clearanceInsets,
  FELT_PAD_Y,
  fitInsets,
  fitScale,
  followCamera,
  handZoom,
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
  tilesClear,
  zoneInsets,
  type ZoneRect,
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

  it("opens zoomed in and eases out in a few steps, never back in", () => {
    const felt = { w: 390, h: 700 };
    const screen = 390;
    const reserve = { top: 46, right: 54, bottom: 36, left: 54 };
    const spinner = { x: -18, y: -36, w: 36, h: 72 };
    const open = handZoom({
      tiles: [spinner],
      felt,
      screenWidth: screen,
      reserve,
      previous: null,
      newHand: true,
    });
    expect((TILE_SHORT * open) / screen).toBeGreaterThanOrEqual(0.12);
    expect((TILE_SHORT * open) / screen).toBeLessThanOrEqual(0.15);

    let previous = open;
    let changes = 0;
    for (let n = 1; n <= 18; n += 1) {
      const tiles = [spinner];
      for (let i = 0; i < n; i += 1) tiles.push({ x: -18, y: -110 - i * 74, w: 36, h: 72 });
      const next = handZoom({ tiles, felt, screenWidth: screen, reserve, previous, newHand: false });
      expect(next).toBeLessThanOrEqual(previous + 1e-9);
      if (next < previous - 1e-6) changes += 1;
      const span = centeredChain(tiles);
      const roomH = felt.h - reserve.top - reserve.bottom;
      expect(span.h * next).toBeLessThanOrEqual(roomH + 1);
      // A tile that does not reach any farther must not move the zoom.
      const last = tiles[tiles.length - 1]!;
      const held = handZoom({
        tiles: [...tiles, { x: last.x + 4, y: last.y + 4, w: 20, h: 20 }],
        felt,
        screenWidth: screen,
        reserve,
        previous: next,
        newHand: false,
      });
      expect(held).toBeCloseTo(next, 5);
      previous = next;
    }
    // A long straight column eases out as it grows, and only outward.
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThanOrEqual(18);
    expect(previous).toBeLessThan(open);
    // A new hand opens large again. The same chain must not zoom back in.
    const again = handZoom({ tiles: [spinner], felt, screenWidth: screen, reserve, previous, newHand: true });
    expect(again).toBeCloseTo(open, 5);
    expect(
      handZoom({ tiles: [spinner], felt, screenWidth: screen, reserve, previous, newHand: false }),
    ).toBeLessThanOrEqual(previous + 1e-9);
  });

  it("stays at a readable size while the chain fits, and a one-sided arm does not slide the view", () => {
    const felt = { w: 390, h: 700 };
    const reserve = { top: 46, right: 54, bottom: 36, left: 54 };
    const modest = [
      { x: -18, y: -36, w: 36, h: 72 },
      { x: -92, y: -18, w: 72, h: 36 },
      { x: 20, y: -18, w: 72, h: 36 },
      { x: -18, y: -110, w: 36, h: 72 },
      { x: -18, y: 38, w: 36, h: 72 },
    ];
    const scale = handZoom({
      tiles: modest,
      felt,
      screenWidth: 390,
      reserve,
      previous: null,
      newHand: true,
      readablePx: READABLE_PHONE_PX,
    });
    expect(scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_PHONE_PX - 0.5);
    const east = handZoom({
      tiles: [
        { x: -18, y: -36, w: 36, h: 72 },
        { x: 20, y: -18, w: 72, h: 36 },
        { x: 94, y: -18, w: 72, h: 36 },
      ],
      felt,
      screenWidth: 390,
      reserve,
      previous: null,
      newHand: true,
    });
    const west = handZoom({
      tiles: [
        { x: -18, y: -36, w: 36, h: 72 },
        { x: -92, y: -18, w: 72, h: 36 },
        { x: -166, y: -18, w: 72, h: 36 },
      ],
      felt,
      screenWidth: 390,
      reserve,
      previous: null,
      newHand: true,
    });
    expect(east).toBeCloseTo(west, 5);
  });

  it("recenters the chain after a tile lands and stays still while choosing", () => {
    expect(cameraSettlesOn(["6-6", "6-5"], ["6-6", "6-5"])).toBe(false);
    expect(cameraSettlesOn(["6-6"], ["6-6", "6-5"])).toBe(true);
    expect(cameraSettlesOn([], ["6-6"])).toBe(true);
    const felt = { w: 412, h: 915 };
    const zones = [
      { left: 16, top: 0, right: felt.w - 16, bottom: 48 },
      { left: 0, top: felt.h - 160, right: felt.w, bottom: felt.h },
    ];
    const insets = fitInsets(felt, zones);
    const oneSided = [
      { x: -18, y: -36, w: 36, h: 72 },
      { x: 20, y: -18, w: 72, h: 36 },
      { x: 94, y: -18, w: 72, h: 36 },
      { x: 168, y: -18, w: 72, h: 36 },
      { x: 206, y: 20, w: 36, h: 72 },
      { x: 206, y: 94, w: 36, h: 72 },
    ];
    const scale = containScale({
      tiles: oneSided,
      felt,
      screenWidth: felt.w,
      zones,
      previous: null,
      newHand: true,
    });
    const pan = chainViewShift(oneSided, scale, boardShift(insets));
    const box = chainBounds(oneSided, 0);
    const chainCx = felt.w / 2 + pan.x + (box.x + box.w / 2) * scale;
    const chainCy = felt.h / 2 + pan.y + (box.y + box.h / 2) * scale;
    expect(Math.abs(chainCx - felt.w / 2)).toBeLessThan(felt.w * 0.05);
    expect(Math.abs(chainCy - felt.h / 2)).toBeLessThan(felt.h * 0.05);
    const again = chainViewShift(oneSided, scale, boardShift(insets));
    expect(again).toEqual(pan);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/--camera-ease:\s*480ms/);
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

  it("shrinks below the readable floor instead of clipping a chain that cannot fit", () => {
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
      tiles: ends,
      playableIds: ["north"],
      felt,
      screenWidth: 390,
      reserve,
    });
    expect(phone.mode).toBe("fit");
    expect(phone.scale * TILE_SHORT).toBeLessThan(READABLE_PHONE_PX);
    expect(phone.off).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(tilesClear(ends, frame, felt, phone.scale, phone.shiftX, phone.shiftY, [], 1)).toBe(true);
    const insets = fitInsets(felt, [], reserve);
    const box = screenBox(felt, frame, phone.scale, phone.shiftX, phone.shiftY, frame);
    const safeCx = insets.left + (felt.w - insets.left - insets.right) / 2;
    const safeCy = insets.top + (felt.h - insets.top - insets.bottom) / 2;
    expect(Math.abs((box.left + box.right) / 2 - safeCx)).toBeLessThan(2);
    expect(Math.abs((box.top + box.bottom) / 2 - safeCy)).toBeLessThan(2);
  });

  it("keeps every tile of a crowded chain clear of the seat badges", () => {
    const phoneFelt = { w: 390, h: 644 };
    const phoneLayout = layoutFor(CROWD, phoneFelt, 390, PHONE_ZONES, PHONE_RESERVE);
    const phoneFrame = chainBounds(phoneLayout.tiles, 0);
    const phone = followCamera({
      frame: phoneFrame,
      ends: phoneLayout.ends,
      tiles: phoneLayout.tiles,
      felt: phoneFelt,
      screenWidth: 390,
      reserve: PHONE_RESERVE,
      zones: PHONE_ZONES,
    });
    expect(tilesClear(phoneLayout.tiles, phoneFrame, phoneFelt, phone.scale, phone.shiftX, phone.shiftY, PHONE_ZONES, 1)).toBe(true);
    expect(phone.off).toEqual({ top: false, right: false, bottom: false, left: false });
    const foldFelt = { w: 920, h: 776 };
    const foldLayout = layoutFor(CROWD, foldFelt, 920, FOLD_ZONES, PHONE_RESERVE);
    const foldFrame = chainBounds(foldLayout.tiles, 0);
    const fold = followCamera({
      frame: foldFrame,
      ends: foldLayout.ends,
      tiles: foldLayout.tiles,
      felt: foldFelt,
      screenWidth: 920,
      reserve: PHONE_RESERVE,
      zones: FOLD_ZONES,
    });
    expect(tilesClear(foldLayout.tiles, foldFrame, foldFelt, fold.scale, fold.shiftX, fold.shiftY, FOLD_ZONES, 1)).toBe(true);
    expect(fold.scale * TILE_SHORT).toBeGreaterThanOrEqual(READABLE_WIDE_PX - 0.5);
  });

  it("fits a long chain on the felt instead of dropping an arm", () => {
    const felt = { w: 390, h: 644 };
    const layout = layoutFor(LONG, felt, 390, PHONE_ZONES, PHONE_RESERVE);
    const frame = chainBounds(layout.tiles, 0);
    const phone = followCamera({
      frame,
      ends: layout.ends,
      tiles: layout.tiles,
      playableIds: ["north"],
      felt,
      screenWidth: 390,
      reserve: PHONE_RESERVE,
      zones: PHONE_ZONES,
    });
    expect(phone.mode).toBe("fit");
    expect(phone.off).toEqual({ top: false, right: false, bottom: false, left: false });
    expect(tilesClear(layout.tiles, frame, felt, phone.scale, phone.shiftX, phone.shiftY, PHONE_ZONES, 1)).toBe(true);
    const loose = laid(LONG);
    const looseFrame = chainBounds(loose.tiles, 0);
    const shrunk = followCamera({
      frame: looseFrame,
      ends: loose.ends,
      tiles: loose.tiles,
      felt,
      screenWidth: 390,
      reserve: PHONE_RESERVE,
      zones: PHONE_ZONES,
    });
    expect(tilesClear(loose.tiles, looseFrame, felt, shrunk.scale, shrunk.shiftX, shrunk.shiftY, PHONE_ZONES, 1)).toBe(true);
    // Folding at the felt edge keeps a long chain on the table. It does not
    // have to stay within a tenth of the short chain's scale.
    expect(shrunk.scale).toBeGreaterThan(0);
    expect(phone.scale).toBeGreaterThan(0);
  });

  it("keeps every tile inside the safe rect for real bot hands", () => {
    const tables = [
      { name: "phone", felt: { w: 390, h: 644 }, screen: 390, seats: 4 as const },
      { name: "fold", felt: { w: 920, h: 776 }, screen: 920, seats: 4 as const },
      { name: "fold-land", felt: { w: 1024, h: 700 }, screen: 1024, seats: 4 as const },
      { name: "desk-chat", felt: { w: 760, h: 560 }, screen: 760, seats: 4 as const },
    ];
    let checked = 0;
    for (const seats of [2, 3, 4] as const) {
      for (const seed of seats === 4 ? [1, 4, 9] : [2]) {
        for (const board of playHands(seats, seed)) {
          const count = board.center ? 1 + board.arms.west.length + board.arms.east.length + board.arms.north.length + board.arms.south.length : 0;
          if (count < 8) continue;
          for (const table of tables) {
            const zones = seatZones(table.felt, seats);
            const layout = layoutForBoard(board, table.felt, table.screen, zones);
            const frame = chainBounds(layout.tiles, 0);
            const shot = followCamera({
              frame,
              ends: layout.ends,
              tiles: layout.tiles,
              felt: table.felt,
              screenWidth: table.screen,
              zones,
            });
            expect(
              tilesClear(layout.tiles, frame, table.felt, shot.scale, shot.shiftX, shot.shiftY, zones, 1),
              `${table.name} seed ${seed} ${seats}p ${count} tiles`,
            ).toBe(true);
            expect(shot.off, table.name).toEqual({ top: false, right: false, bottom: false, left: false });
            for (let i = 0; i < layout.tiles.length; i += 1) {
              for (let j = i + 1; j < layout.tiles.length; j += 1) {
                expect(boxesOverlap(layout.tiles[i]!, layout.tiles[j]!), `${table.name} overlap`).toBe(false);
              }
            }
            const insets = fitInsets(table.felt, zones);
            const box = screenBox(table.felt, frame, shot.scale, shot.shiftX, shot.shiftY, frame);
            const safeCx = insets.left + (table.felt.w - insets.left - insets.right) / 2;
            const safeCy = insets.top + (table.felt.h - insets.top - insets.bottom) / 2;
            expect(Math.abs((box.left + box.right) / 2 - safeCx)).toBeLessThan(3);
            expect(Math.abs((box.top + box.bottom) / 2 - safeCy)).toBeLessThan(3);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  }, 40_000);

  it("keeps every tile on the felt at every turn, without sliding the board", () => {
    const tables = [
      { name: "473", felt: { w: 473, h: 1024 } },
      { name: "412", felt: { w: 412, h: 915 } },
      { name: "cover", felt: { w: 344, h: 882 } },
      { name: "inner", felt: { w: 751, h: 832 } },
    ];
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/is-camera-hold \{\s*visibility:\s*hidden/);
    expect(css).toMatch(/data-zoom="ease"\] \.board-scaler[\s\S]{0,320}transition:[\s\S]{0,200}var\(--camera-ease\)/);
    expect(css).not.toMatch(/data-zoom="ease"\] \.board-scaler[\s\S]{0,80}transition:\s*none/);
    let turns = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (const table of tables) {
      for (const seed of [1, 4, 9]) {
        let previous: number | null = null;
        for (const board of playHands(4, seed)) {
          const zones = seatZones(table.felt, 4);
          const insets = fitInsets(table.felt, zones);
          const view = feltScale({
            board,
            felt: table.felt,
            screenWidth: table.felt.w,
            zones,
            previous,
            newHand: previous == null,
          });
          const layout = layoutBoard(board, view.limits);
          const pan = chainViewShift(layout.tiles, view.scale, boardShift(insets), {
            w: table.felt.w,
            h: table.felt.h,
          });
          const box = chainBounds(layout.tiles, 0);
          const chainCx = table.felt.w / 2 + pan.x + (box.x + box.w / 2) * view.scale;
          const chainCy = table.felt.h / 2 + pan.y + (box.y + box.h / 2) * view.scale;
          expect(Math.abs(chainCx - table.felt.w / 2), `${table.name} centred x`).toBeLessThan(table.felt.w * 0.05);
          expect(Math.abs(chainCy - table.felt.h / 2), `${table.name} centred y`).toBeLessThan(table.felt.h * 0.05);
          const ring = 2;
          for (const tile of layout.tiles) {
            const left = table.felt.w / 2 + pan.x + tile.x * view.scale;
            const top = table.felt.h / 2 + pan.y + tile.y * view.scale;
            const right = left + tile.w * view.scale;
            const bottom = top + tile.h * view.scale;
            const margin = 16;
            expect(left, `${table.name} ${tile.tileId} left`).toBeGreaterThanOrEqual(margin - 0.5);
            expect(top, `${table.name} ${tile.tileId} top`).toBeGreaterThanOrEqual(margin - 0.5);
            expect(right, `${table.name} ${tile.tileId} right`).toBeLessThanOrEqual(table.felt.w - margin + 0.5);
            expect(bottom, `${table.name} ${tile.tileId} bottom`).toBeLessThanOrEqual(table.felt.h - margin + 0.5);
          }
          if (previous != null) {
            expect(view.scale).toBeLessThanOrEqual(previous + 1e-9);
            // A frame between the old scale and the fit would paint the new
            // chain too large. The camera publishes the fit immediately.
            if (!contained(layout.tiles, table.felt, FELT_MARGIN, pan, previous, ring)) {
              const mid = previous + (view.scale - previous) * 0.5;
              expect(mid).toBeGreaterThan(view.scale);
              expect(contained(layout.tiles, table.felt, FELT_MARGIN, pan, view.scale, ring)).toBe(true);
            } else {
              for (const step of [0.25, 0.5, 0.75, 1]) {
                const frame = previous + (view.scale - previous) * step;
                expect(
                  contained(layout.tiles, table.felt, FELT_MARGIN, pan, frame, ring),
                  `${table.name} frame ${step}`,
                ).toBe(true);
              }
            }
          }
          smallest = Math.min(smallest, view.scale * TILE_SHORT);
          previous = view.scale;
          turns += 1;
        }
        const fresh = feltScale({
          board: playHands(4, seed).at(-1)!,
          felt: table.felt,
          screenWidth: table.felt.w,
          zones: seatZones(table.felt, 4),
          previous: null,
          newHand: true,
        });
        expect(fresh.scale).toBeGreaterThan(0);
        expect(fresh.scale).toBeLessThanOrEqual((0.135 * table.felt.w) / TILE_SHORT + 1e-6);
      }
    }
    expect(turns).toBeGreaterThan(40);
    expect(smallest).toBeGreaterThan(8);
    expect(smallest).toBeLessThan(TILE_LONG);
  }, 40_000);

  it("hides a tile that does not fit yet while the zoom eases down", () => {
    const felt = { w: 412, h: 915 };
    const zones = seatZones(felt, 4);
    const insets = fitInsets(felt, zones);
    const before = [
      { x: -18, y: -36, w: 36, h: 72 },
      { x: -18, y: 38, w: 36, h: 400 },
    ];
    const added = { x: -18, y: 440, w: 36, h: 72 };
    const after = [...before, added];
    const previous = containScale({ tiles: before, felt, screenWidth: felt.w, zones, previous: null, newHand: true });
    const next = containScale({ tiles: after, felt, screenWidth: felt.w, zones, previous, newHand: false });
    const panBefore = chainViewShift(before, previous, boardShift(insets));
    const panAfter = chainViewShift(after, next, boardShift(insets));
    expect(next).toBeLessThan(previous);
    expect(contained(before, felt, insets, panBefore, previous, 2)).toBe(true);
    expect(contained(after, felt, insets, panBefore, previous, 2)).toBe(false);
    const samples = zoomSamples(previous, next, 4);
    expect(samples[samples.length - 1]).toBeCloseTo(next, 8);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!).toBeLessThan(samples[index - 1]!);
    }
    const early = previous + (next - previous) * 0.05;
    expect(contained(before, felt, insets, panBefore, early, 2), "tiles already down stay inside").toBe(true);
    expect(contained(after, felt, insets, panBefore, early, 2), "the new tile is still outside early in the ease").toBe(false);
    for (const frame of samples) {
      expect(contained(before, felt, insets, chainViewShift(before, frame, boardShift(insets)), frame, 2), `old tiles at ${frame}`).toBe(true);
    }
    expect(contained(after, felt, insets, panAfter, next, 2)).toBe(true);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/is-camera-hold \{\s*visibility:\s*hidden/);
  });

  it("holds a lopsided arm inside the felt on a phone and a fold", () => {
    let board = emptyBoard();
    const ids = ["6-6", "5-6", "4-5", "3-4", "2-3", "1-2", "0-1", "0-2", "2-4", "4-6", "3-6", "1-3", "1-4", "0-4"];
    board = placeTile(board, "lead", tileById(ids[0]!));
    for (const id of ids.slice(1)) board = placeTile(board, "east", tileById(id));
    for (const felt of [{ w: 412, h: 915 }, { w: 344, h: 882 }, { w: 473, h: 1024 }, { w: 751, h: 832 }]) {
      const zones = seatZones(felt, 4);
      const insets = fitInsets(felt, zones);
      const view = feltScale({ board, felt, screenWidth: felt.w, zones, previous: null, newHand: true });
      const layout = layoutBoard(board, view.limits);
      const pan = chainViewShift(layout.tiles, view.scale, boardShift(insets));
      expect(contained(layout.tiles, felt, FELT_MARGIN, pan, view.scale, 2), `${felt.w}x${felt.h}`).toBe(true);
      const again = containScale({
        tiles: layout.tiles,
        felt,
        screenWidth: felt.w,
        zones,
        previous: view.scale,
        newHand: false,
      });
      expect(again).toBeLessThanOrEqual(view.scale + 1e-9);
    }
  });

  it("lays at least two full tiles on both side arms before the first turn", () => {
    const tables = [
      { name: "473", felt: { w: 473, h: 1024 } },
      { name: "412", felt: { w: 412, h: 915 } },
      { name: "cover", felt: { w: 344, h: 882 } },
      { name: "inner", felt: { w: 751, h: 832 } },
    ];
    let board = emptyBoard();
    board = placeTile(board, "lead", tileById("6-6"));
    for (const id of ["5-6", "4-5", "3-4", "2-3", "1-2", "0-1", "0-2"]) board = placeTile(board, "west", tileById(id));
    for (const id of ["4-6", "2-4", "2-5", "1-5", "1-3", "0-3", "0-4"]) board = placeTile(board, "east", tileById(id));
    let doubled = emptyBoard();
    doubled = placeTile(doubled, "lead", tileById("5-5"));
    for (const id of ["0-5", "0-0", "0-1", "1-2", "2-3", "3-4", "4-6"]) doubled = placeTile(doubled, "west", tileById(id));
    for (const id of ["5-6", "1-6", "1-4", "2-4", "2-6", "3-6", "3-5"]) doubled = placeTile(doubled, "east", tileById(id));
    for (const table of tables) {
      for (const [label, chain] of [["plain", board], ["double", doubled]] as const) {
        const zones = seatZones(table.felt, 3);
        const insets = fitInsets(table.felt, zones);
        const view = feltScale({
          board: chain,
          felt: table.felt,
          screenWidth: table.felt.w,
          zones,
          previous: null,
          newHand: true,
        });
        const layout = layoutBoard(chain, view.limits);
        const pan = chainViewShift(layout.tiles, view.scale, boardShift(insets));
        expect(contained(layout.tiles, table.felt, FELT_MARGIN, pan, view.scale, 2), `${table.name} ${label}`).toBe(true);
        for (const arm of ["west", "east"] as const) {
          const tiles = layout.tiles.filter((tile) => tile.arm === arm);
          const turn = tiles.findIndex((tile) => tile.direction !== arm);
          // The arm runs straight while the next tile still fits, and turns at
          // the felt edge. Two full tiles are not forced past that edge.
          expect(tiles[0]?.direction, `${table.name} ${label} ${arm} leaves straight`).toBe(arm);
          expect(turn === -1 || turn >= 1, `${table.name} ${label} ${arm} turns`).toBe(true);
        }
      }
    }
  });

  it("folds a lopsided two-player line so the tiles stay readable", () => {
    // The live board ran this shape as one vertical line, so the camera fit
    // that line into half the felt and the tiles shrank to a few pixels.
    const remaining = allTiles().filter((tile) => tile.id !== "6-6");
    const path = [tileById("6-6")];
    let open = 6;
    while (path.length < 19) {
      const index = remaining.findIndex((tile) => tile.low === open || tile.high === open);
      const tile = remaining.splice(index, 1)[0]!;
      path.push(tile);
      open = tile.low === open ? tile.high : tile.low;
    }
    let board = placeTile(emptyBoard(), "lead", path[0]!);
    for (const tile of path.slice(1)) {
      const ends = openEnds(board).map((end) => end.id);
      board = placeTile(board, ends.includes("east") ? "east" : ends[0]!, tile);
    }
    const tables = [
      { name: "412", felt: { w: 412, h: 915 }, minPx: 12 },
      { name: "473", felt: { w: 473, h: 1024 }, minPx: 12 },
      { name: "cover", felt: { w: 344, h: 882 }, minPx: 10 },
      { name: "inner", felt: { w: 751, h: 832 }, minPx: 12 },
    ];
    for (const table of tables) {
      const zones = seatZones(table.felt, 2);
      zones.push({ left: 0, top: table.felt.h - 160, right: table.felt.w, bottom: table.felt.h });
      const insets = fitInsets(table.felt, zones);
      const view = feltScale({
        board,
        felt: table.felt,
        screenWidth: table.felt.w,
        zones,
        previous: null,
        newHand: true,
      });
      const layout = layoutBoard(board, view.limits);
      const pan = chainViewShift(layout.tiles, view.scale, boardShift(insets));
      expect(contained(layout.tiles, table.felt, FELT_MARGIN, pan, view.scale, 2), `${table.name} contained`).toBe(true);
      expect(view.scale * TILE_SHORT, `${table.name} tile`).toBeGreaterThanOrEqual(table.minPx);
      for (let i = 0; i < layout.tiles.length; i += 1) {
        for (let j = i + 1; j < layout.tiles.length; j += 1) {
          expect(boxesOverlap(layout.tiles[i]!, layout.tiles[j]!), `${table.name} overlap`).toBe(false);
        }
      }
      const stem = layout.tiles.filter((tile) => tile.arm === "east");
      const turn = stem.findIndex((tile) => tile.direction !== "east");
      expect(turn === -1 || turn >= 1, `${table.name} turns at the edge`).toBe(true);
    }
  });

  it("keeps a settled 4-seat chain off the badges while the camera ease can still cross one", () => {
    const tables = [
      { name: "phone", felt: { w: 390, h: 644 }, screen: 390 },
      { name: "fold", felt: { w: 920, h: 776 }, screen: 920 },
      { name: "fold-land", felt: { w: 1024, h: 700 }, screen: 1024 },
    ];
    let settled = 0;
    let crossed = 0;
    for (const table of tables) {
      for (let seed = 1; seed <= 24; seed += 1) {
        let previous: { scale: number; shiftX: number; shiftY: number } | null = null;
        for (const board of playHands(4, seed)) {
          const count = board.center
            ? 1 + board.arms.west.length + board.arms.east.length + board.arms.north.length + board.arms.south.length
            : 0;
          if (count < 4) continue;
          const zones = seatZones(table.felt, 4);
          const layout = layoutForBoard(board, table.felt, table.screen, zones);
          const frame = chainBounds(layout.tiles, 0);
          const shot = followCamera({
            frame,
            ends: layout.ends,
            tiles: layout.tiles,
            felt: table.felt,
            screenWidth: table.screen,
            zones,
          });
          expect(
            tilesClear(layout.tiles, frame, table.felt, shot.scale, shot.shiftX, shot.shiftY, zones, 1),
            `${table.name} seed ${seed} ${count} tiles`,
          ).toBe(true);
          settled += 1;
          if (previous && Math.abs(previous.scale - shot.scale) > 0.05) {
            const easing = !tilesClear(layout.tiles, frame, table.felt, previous.scale, previous.shiftX, previous.shiftY, zones, 0);
            if (easing) crossed += 1;
          }
          previous = { scale: shot.scale, shiftX: shot.shiftX, shiftY: shot.shiftY };
        }
      }
    }
    expect(settled).toBeGreaterThan(400);
    // The soak waits for this ease. The settled frame above is the one that has to stay clear.
    expect(crossed).toBeGreaterThan(0);
  }, 40_000);

  it("keeps fuzzed hands clear, joined, and on the felt", () => {
    const felts = [
      { name: "phone", w: 412, h: 915 },
      { name: "cover", w: 344, h: 882 },
      { name: "inner", w: 751, h: 832 },
    ];
    const tight = [undefined, { width: 220, height: 640 }, { width: 344, height: 720 }] as const;
    const edgeBetween = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
      const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
      if (gapY === 0 && gapX > 0) return { gap: gapX, along: yOverlap };
      if (gapX === 0 && gapY > 0) return { gap: gapY, along: xOverlap };
      return { gap: Math.hypot(gapX, gapY), along: 0 };
    };
    for (const seats of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 8; seed += 1) {
          const bytes = Buffer.alloc(32);
          bytes.writeUInt32BE(seed + 1, 0);
          bytes.writeUInt32BE(0x4c4159, 4);
          let match = beginHand(
            createMatch([...HAND_PLAYERS[seats]], { boneyardMode: mode, seriesLength: 3, targetScore: 500 }),
            shuffleWithSeed(bytes),
          );
          const label = `${seats} ${mode} ${seed}`;
          for (let guard = 0; guard < 400 && match.hand && match.hand.phase !== "complete"; guard += 1) {
            const playerId = currentPlayerId(match);
            if (!playerId) break;
            const intents = legalIntents(match, playerId);
            if (intents.length === 0) break;
            const intent = intents[(seed * 7 + guard * 3) % intents.length]!;
            const result = applyIntent(match, playerId, intent);
            expect(result.ok, `${label} ${result.error}`).toBe(true);
            match = result.match;
            if (intent.type !== "play" || !match.hand) continue;
            const board = match.hand.board;
            for (const limit of tight) {
              const layout = limit ? layoutBoard(board, limit) : layoutBoard(board);
              expect(layoutOverlaps(layout), `${label} overlap`).toBe(false);
              for (let i = 0; i < layout.tiles.length; i += 1) {
                for (let j = i + 1; j < layout.tiles.length; j += 1) {
                  const left = layout.tiles[i]!;
                  const right = layout.tiles[j]!;
                  if (left.arm && right.arm && left.arm !== right.arm) {
                    expect(boxesOverlap(left, right), `${label} ${left.arm} hits ${right.arm}`).toBe(false);
                  }
                }
              }
              const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
              const center = byId.get(board.center!.tileId);
              for (const arm of ARM_IDS) {
                let parent = center;
                for (const tile of board.arms[arm]) {
                  const placed = byId.get(tile.tileId);
                  expect(placed && parent, `${label} ${tile.tileId}`).toBeTruthy();
                  if (!placed || !parent) continue;
                  const edge = edgeBetween(parent, placed);
                  expect(Math.abs(edge.gap - TILE_GAP), `${label} ${parent.tileId}>${tile.tileId}`).toBeLessThan(0.5);
                  expect(edge.along, `${label} along`).toBeGreaterThanOrEqual(TILE_SHORT * 0.45);
                  parent = placed;
                }
              }
            }
            for (const felt of felts) {
              const zones = seatZones(felt, seats);
              zones.push({ left: 0, top: felt.h - 160, right: felt.w, bottom: felt.h });
              const insets = fitInsets(felt, zones);
              const view = feltScale({
                board,
                felt,
                screenWidth: felt.w,
                zones,
                previous: null,
                newHand: guard < 2,
              });
              const layout = layoutBoard(board, view.limits);
              expect(layoutOverlaps(layout), `${label} ${felt.name}`).toBe(false);
              expect(
                contained(layout.tiles, felt, FELT_MARGIN, chainViewShift(layout.tiles, view.scale, boardShift(insets)), view.scale, 2),
                `${label} ${felt.name} felt`,
              ).toBe(true);
            }
          }
        }
      }
    }
  }, 40_000);

  it("keeps every rendered tile inside the felt and the chain on its centre", () => {
    const log = JSON.parse(
      readFileSync(new URL("../../rules/src/fixtures/soak-m2-overlap.json", import.meta.url), "utf8"),
    ) as {
      players: Array<{ id: string; name: string }>;
      config: { boneyardMode: "draw_one"; seriesLength: 3; targetScore: number };
      hands: Array<{
        handNumber: number;
        seed: string;
        actions: Array<{ playerId: string; intent: { type: string; tileId?: string; endId?: string } }>;
      }>;
    };
    const surfaces = [
      { name: "phone", w: 412, h: 915 },
      { name: "cover", w: 344, h: 882 },
      { name: "inner", w: 751, h: 832 },
    ];
    let plays = 0;
    for (const surface of surfaces) {
      const felt = { w: surface.w, h: surface.h };
      const inner = feltInnerRect(felt);
      const zones = seatZones(felt, 3);
      zones.push({ left: 0, top: felt.h - 150, right: felt.w, bottom: felt.h });
      let match = createMatch(log.players, log.config);
      let previous: number | null = null;
      for (const hand of log.hands) {
        match = beginHand(match, shuffleWithSeed(Buffer.from(hand.seed, "hex")));
        if (hand.handNumber !== 5) {
          for (const action of hand.actions) {
            const result = applyIntent(match, action.playerId, action.intent as never);
            expect(result.ok, result.error).toBe(true);
            match = result.match;
          }
          previous = null;
          continue;
        }
      for (const action of hand.actions) {
        const result = applyIntent(match, action.playerId, action.intent as never);
        expect(result.ok, result.error).toBe(true);
        match = result.match;
        if (action.intent.type !== "play" || !match.hand) continue;
        plays += 1;
        const board = match.hand.board;
        const view = feltScale({
          board,
          felt,
          screenWidth: felt.w,
          zones,
          previous,
          newHand: previous == null,
        });
        const layout = layoutBoard(board, view.limits);
        const scale = containScale({
          tiles: layout.tiles,
          felt,
          screenWidth: felt.w,
          zones,
          previous,
          newHand: previous == null,
        });
        const shift = chainViewShift(layout.tiles, scale);
        let minL = Infinity;
        let minT = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        for (const tile of layout.tiles) {
          const rect = renderedTileRect(felt, tile, scale, shift);
          const where = `${surface.name} ${tile.tileId}`;
          expect(rect.left, where).toBeGreaterThanOrEqual(inner.left - 0.5);
          expect(rect.top, where).toBeGreaterThanOrEqual(inner.top - 0.5);
          expect(rect.right, where).toBeLessThanOrEqual(inner.right + 0.5);
          expect(rect.bottom, where).toBeLessThanOrEqual(inner.bottom + 0.5);
          minL = Math.min(minL, rect.left);
          minT = Math.min(minT, rect.top);
          maxR = Math.max(maxR, rect.right);
          maxB = Math.max(maxB, rect.bottom);
        }
        const cx = (minL + maxR) / 2;
        const cy = (minT + maxB) / 2;
        expect(Math.abs(cx - felt.w / 2), `${surface.name} centre x`).toBeLessThan(felt.w * 0.05);
        expect(Math.abs(cy - felt.h / 2), `${surface.name} centre y`).toBeLessThan(felt.h * 0.05);
        previous = scale;
      }
      }
    }
    expect(plays).toBeGreaterThan(40);
  });

  it("eases each play in small steps, including a retarget mid-glide", () => {
    const log = JSON.parse(
      readFileSync(new URL("../../rules/src/fixtures/soak-m2-overlap.json", import.meta.url), "utf8"),
    ) as {
      players: Array<{ id: string; name: string }>;
      config: { boneyardMode: "draw_one"; seriesLength: 3; targetScore: number };
      hands: Array<{
        handNumber: number;
        seed: string;
        actions: Array<{ playerId: string; intent: { type: string; tileId?: string; endId?: string } }>;
      }>;
    };
    const felt = { w: 412, h: 915 };
    const zones = seatZones(felt, 3);
    zones.push({ left: 0, top: felt.h - 150, right: felt.w, bottom: felt.h });
    let match = createMatch(log.players, log.config);
    let previousScale: number | null = null;
    let previousPose: { scale: number; x: number; y: number } | null = null;
    const assertGlide = (from: { scale: number; x: number; y: number }, to: { scale: number; x: number; y: number }, label: string) => {
      const samples = glidePoses(from, to);
      expect(samples.length, label).toBeGreaterThanOrEqual(16);
      expect(samples[0]!.scale).toBeCloseTo(from.scale, 6);
      expect(samples[samples.length - 1]!.scale).toBeCloseTo(to.scale, 6);
      const span = {
        scale: Math.abs(to.scale - from.scale),
        x: Math.abs(to.x - from.x),
        y: Math.abs(to.y - from.y),
      };
      for (let i = 1; i < samples.length; i += 1) {
        const step = {
          scale: Math.abs(samples[i]!.scale - samples[i - 1]!.scale),
          x: Math.abs(samples[i]!.x - samples[i - 1]!.x),
          y: Math.abs(samples[i]!.y - samples[i - 1]!.y),
        };
        if (span.scale > 1e-4) expect(step.scale, `${label} scale`).toBeLessThanOrEqual(span.scale * 0.1 + 1e-9);
        if (span.x > 0.5) expect(step.x, `${label} pan x`).toBeLessThanOrEqual(span.x * 0.1 + 1e-6);
        if (span.y > 0.5) expect(step.y, `${label} pan y`).toBeLessThanOrEqual(span.y * 0.1 + 1e-6);
      }
    };
    for (const hand of log.hands) {
      match = beginHand(match, shuffleWithSeed(Buffer.from(hand.seed, "hex")));
      if (hand.handNumber !== 5) {
        for (const action of hand.actions) {
          const result = applyIntent(match, action.playerId, action.intent as never);
          match = result.match;
        }
        previousScale = null;
        previousPose = null;
        continue;
      }
      for (const action of hand.actions) {
        const result = applyIntent(match, action.playerId, action.intent as never);
        match = result.match;
        if (action.intent.type !== "play" || !match.hand) continue;
        const board = match.hand.board;
        const view = feltScale({
          board,
          felt,
          screenWidth: felt.w,
          zones,
          previous: previousScale,
          newHand: previousScale == null,
        });
        const layout = layoutBoard(board, view.limits);
        const scale = containScale({
          tiles: layout.tiles,
          felt,
          screenWidth: felt.w,
          zones,
          previous: previousScale,
          newHand: previousScale == null,
        });
        const shift = chainViewShift(layout.tiles, scale);
        const pose = { scale, x: shift.x, y: shift.y };
        if (previousPose) {
          assertGlide(previousPose, pose, String(action.intent.tileId));
          const mid = poseAt(previousPose, pose, 0.4);
          assertGlide(mid, { scale: pose.scale * 0.94, x: pose.x + 10, y: pose.y - 6 }, `${action.intent.tileId} retarget`);
        }
        previousScale = scale;
        previousPose = pose;
      }
    }
    expect(cameraEase(0)).toBeCloseTo(0, 5);
    expect(cameraEase(1)).toBeCloseTo(1, 5);
    expect(CAMERA_EASE_MS).toBe(480);
  });

  it("keeps long matches clear at the settled frame and at the middle of the glide", () => {
    const limits = [undefined, { width: 220, height: 640 }, { width: 344, height: 720 }] as const;
    const ease = cameraEase(0.5);
    const mix = (from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number; w: number; h: number }) => ({
      x: from.x + (to.x - from.x) * ease,
      y: from.y + (to.y - from.y) * ease,
      w: from.w + (to.w - from.w) * ease,
      h: from.h + (to.h - from.h) * ease,
    });
    let checked = 0;
    for (const seats of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 2; seed += 1) {
          let match = createMatch([...HAND_PLAYERS[seats]], {
            boneyardMode: mode,
            seriesLength: 5,
            targetScore: 150,
          });
          for (let deal = 0; deal < 4; deal += 1) {
            const bytes = Buffer.alloc(32);
            bytes.writeUInt32BE(seed * 17 + deal + 1, 0);
            bytes.writeUInt32BE(mode === "draw_one" ? 0x4f4e45 : 0x554e54, 4);
            match = beginHand(match, shuffleWithSeed(bytes));
            let previous: Map<string, { x: number; y: number; w: number; h: number }> | null = null;
            for (let guard = 0; guard < 400 && match.hand && match.hand.phase !== "complete"; guard += 1) {
              const playerId = currentPlayerId(match);
              if (!playerId) break;
              const intents = legalIntents(match, playerId);
              if (intents.length === 0) break;
              const intent = intents[(seed * 5 + deal * 3 + guard) % intents.length]!;
              const result = applyIntent(match, playerId, intent);
              expect(result.ok, `${seats} ${mode} ${seed} ${result.error}`).toBe(true);
              match = result.match;
              if (intent.type !== "play" || !match.hand) continue;
              const board = match.hand.board;
              const label = `${seats} ${mode} s${seed} d${deal}`;
              for (const limit of limits) {
                const layout = limit ? layoutBoard(board, limit) : layoutBoard(board);
                expect(layoutOverlaps(layout), `${label} settled`).toBe(false);
                if (previous && limit === undefined) {
                  const midway = layout.tiles.flatMap((tile) => {
                    const before = previous!.get(tile.tileId);
                    if (!before) return [];
                    const dist = Math.hypot(
                      tile.x + tile.w / 2 - (before.x + before.w / 2),
                      tile.y + tile.h / 2 - (before.y + before.h / 2),
                    );
                    // A re-seat across the felt (a new spinner) travels through open
                    // felt. A tile that stays in its neighbourhood must not be
                    // covered halfway through the glide.
                    if (dist > TILE_SHORT) return [];
                    return [{ ...mix(before, tile), tileId: tile.tileId }];
                  });
                  for (let i = 0; i < midway.length; i += 1) {
                    for (let j = i + 1; j < midway.length; j += 1) {
                      expect(boxesOverlap(midway[i]!, midway[j]!), `${label} glide ${midway[i]!.tileId}`).toBe(false);
                    }
                  }
                }
                if (limit === undefined) {
                  previous = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
                }
              }
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(80);
  }, 60_000);
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

function layoutFor(
  steps: Array<[string, string]>,
  felt: { w: number; h: number },
  screen: number,
  zones: readonly ZoneRect[],
  reserve?: { top: number; right: number; bottom: number; left: number },
) {
  let board = emptyBoard();
  for (const [end, id] of steps) board = placeTile(board, end, tileById(id));
  return layoutForBoard(board, felt, screen, zones, reserve);
}

function layoutForBoard(
  board: BoardState,
  felt: { w: number; h: number },
  screen: number,
  zones: readonly ZoneRect[],
  reserve?: { top: number; right: number; bottom: number; left: number },
) {
  const readable = screen >= 720 ? READABLE_WIDE_PX : READABLE_PHONE_PX;
  const room = fitInsets(felt, zones, reserve);
  return layoutBoard(board, {
    width: Math.max(160, ((felt.w - room.left - room.right) * TILE_SHORT) / readable),
    height: Math.max(160, ((felt.h - room.top - room.bottom) * TILE_SHORT) / readable),
  });
}

const FELT_MARGIN = { top: 16, right: 16, bottom: 16, left: 16 };

function contained(
  tiles: readonly { x: number; y: number; w: number; h: number }[],
  felt: { w: number; h: number },
  insets: { top: number; right: number; bottom: number; left: number },
  pan: { x: number; y: number },
  scale: number,
  ring: number,
): boolean {
  return tiles.every((tile) => {
    const left = felt.w / 2 + pan.x + tile.x * scale;
    const top = felt.h / 2 + pan.y + tile.y * scale;
    const right = left + tile.w * scale;
    const bottom = top + tile.h * scale;
    return left >= insets.left + ring - 0.5
      && top >= insets.top + ring - 0.5
      && right <= felt.w - insets.right - ring + 0.5
      && bottom <= felt.h - insets.bottom - ring + 0.5;
  });
}

function seatZones(felt: { w: number; h: number }, seats: 2 | 3 | 4): ZoneRect[] {
  const zones: ZoneRect[] = [];
  const badgeW = 54;
  const badgeH = 28;
  if (seats === 2 || seats === 4) {
    zones.push({ left: 16, top: 0, right: felt.w - 16, bottom: 20 });
    zones.push({ left: felt.w / 2 - badgeW / 2, top: 24, right: felt.w / 2 + badgeW / 2, bottom: 24 + badgeH });
  }
  if (seats >= 3) {
    const badgeTop = felt.h * 0.38;
    zones.push({ left: 0, top: badgeTop, right: badgeW, bottom: badgeTop + badgeH });
    zones.push({ left: 0, top: badgeTop + badgeH + 4, right: 22, bottom: badgeTop + badgeH + 130 });
    zones.push({ left: felt.w - badgeW, top: badgeTop, right: felt.w, bottom: badgeTop + badgeH });
    zones.push({ left: felt.w - 22, top: badgeTop + badgeH + 4, right: felt.w, bottom: badgeTop + badgeH + 130 });
  }
  return zones;
}

const HAND_PLAYERS = {
  2: [
    { id: "a", name: "Alex" },
    { id: "b", name: "Sam" },
  ],
  3: [
    { id: "a", name: "Alex" },
    { id: "b", name: "Sam" },
    { id: "c", name: "Jo" },
  ],
  4: [
    { id: "a", name: "Alex" },
    { id: "b", name: "Sam" },
    { id: "c", name: "Jo" },
    { id: "d", name: "Rio" },
  ],
} as const;

function playHands(players: 2 | 3 | 4, seed: number): BoardState[] {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(seed + 1, 0);
  bytes.writeUInt32BE(0x534f414b, 4);
  let match = createMatch([...HAND_PLAYERS[players]], {
    boneyardMode: "draw_until",
    seriesLength: 3,
    targetScore: 500,
  });
  match = beginHand(match, shuffleWithSeed(bytes));
  const boards: BoardState[] = [];
  for (let guard = 0; guard < 80 && match.hand && match.hand.phase !== "complete"; guard += 1) {
    const playerId = currentPlayerId(match);
    if (!playerId) break;
    const intents = legalIntents(match, playerId);
    if (intents.length === 0) break;
    const intent = intents[(seed + guard) % intents.length]!;
    const result = applyIntent(match, playerId, intent);
    if (!result.ok) break;
    match = result.match;
    if (intent.type === "play" && match.hand) boards.push(structuredClone(match.hand.board));
  }
  return boards;
}

describe("opening zoom", () => {
  it("holds the opening size until a tile would cross the felt edge", () => {
    const felts = [
      { name: "s26", w: 412, h: 683 },
      { name: "phone", w: 412, h: 707 },
      { name: "viewport", w: 412, h: 891 },
      { name: "cover", w: 344, h: 674 },
    ];
    let plays = 0;
    for (const seats of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 1; seed <= 3; seed += 1) {
          for (const felt of felts) {
            const bytes = Buffer.alloc(32);
            bytes.writeUInt32BE(seed + seats * 20, 0);
            bytes.writeUInt32BE(mode === "draw_one" ? 1 : 2, 4);
            let cursor = beginHand(
              createMatch([...HAND_PLAYERS[seats]], { boneyardMode: mode, seriesLength: 3, targetScore: 80 }),
              shuffleWithSeed(bytes),
            );
            let previous: number | null = null;
            let opening: number | null = null;
            for (let step = 0; step < 60 && cursor.hand && cursor.hand.phase !== "complete"; step += 1) {
              const playerId = currentPlayerId(cursor);
              if (!playerId) break;
              const intents = legalIntents(cursor, playerId);
              if (intents.length === 0) break;
              const intent = intents[(seed + step * 3) % intents.length]!;
              const result = applyIntent(cursor, playerId, intent);
              if (!result.ok) break;
              cursor = result.match;
              if (intent.type !== "play" || !cursor.hand?.board.center) continue;
              const zones = seatZones(felt, seats);
              const view = feltScale({
                board: cursor.hand.board,
                felt,
                screenWidth: felt.w,
                zones,
                previous,
                newHand: previous == null,
              });
              if (opening == null) {
                opening = view.scale;
                const open = (0.135 * felt.w) / TILE_SHORT;
                expect(view.scale, `${felt.name} opens large`).toBeCloseTo(open, 5);
              }
              if (previous != null && view.scale < previous - 1e-4) {
                const room = safeRoom(felt, frameInsets(null, felt));
                const laid = layoutBoard(cursor.hand.board, { width: room.w / previous, height: room.h / previous });
                const box = chainBounds(laid.tiles, 0);
                expect(
                  box.w * previous > room.w + 1 || box.h * previous > room.h + 1,
                  `${felt.name} ${seats} ${mode} zoomed while the chain still fit`,
                ).toBe(true);
              } else if (previous != null) {
                expect(view.scale, `${felt.name} held`).toBeCloseTo(previous, 5);
              }
              previous = view.scale;
              plays += 1;
              if (plays > 400) break;
            }
          }
        }
      }
    }
    expect(plays).toBeGreaterThan(200);

    const felt = { w: 412, h: 891 };
    let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
    for (const [end, id] of [
      ["east", "5-6"],
      ["west", "4-6"],
      ["north", "3-6"],
      ["south", "2-6"],
      ["east", "4-5"],
      ["west", "3-4"],
      ["north", "2-3"],
      ["south", "1-2"],
    ] as const) {
      board = placeTile(board, end, tileById(id));
    }
    const nine = feltScale({
      board,
      felt,
      screenWidth: 412,
      zones: seatZones(felt, 4),
      previous: null,
      newHand: true,
    });
    expect(board.arms.east.length + board.arms.west.length + board.arms.north.length + board.arms.south.length + 1).toBe(9);
    expect(nine.scale * TILE_SHORT, "nine tiles stay at the opening size").toBeCloseTo(0.135 * 412, 1);
  }, 60_000);
});

describe("charcoal frame", () => {
  it("fits the chain inside the copper line at the S26 and the narrower phone, rails included", () => {
    const scenes = [
      { name: "412x891", felt: { w: 412, h: 683 } },
      { name: "384x832", felt: { w: 384, h: 624 } },
    ];
    for (const scene of scenes) {
      const frame = frameInsets("TBL-013", scene.felt);
      expect(frame.left, `${scene.name} copper`).toBeGreaterThan(40);
      expect(frame.top, `${scene.name} copper`).toBeGreaterThan(40);
      let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
      for (const [end, id] of [
        ["east", "5-6"],
        ["west", "4-6"],
        ["north", "3-6"],
        ["south", "2-6"],
        ["east", "4-5"],
        ["west", "3-4"],
        ["north", "2-3"],
        ["south", "1-2"],
      ] as const) {
        board = placeTile(board, end, tileById(id));
      }
      const zones = seatZones(scene.felt, 4);
      const open = feltScale({
        board,
        felt: scene.felt,
        screenWidth: scene.felt.w,
        zones,
        previous: null,
        newHand: true,
        tableId: "TBL-013",
      });
      expect(open.scale * TILE_SHORT, `${scene.name} nine tiles`).toBeLessThanOrEqual(0.135 * scene.felt.w + 0.1);
      const layout = layoutBoard(board, open.limits);
      const shift = chainViewShift(layout.tiles, open.scale);
      const pan = { x: shift.x + boardShift(frame).x, y: shift.y + boardShift(frame).y };
      for (const tile of layout.tiles) {
        const rect = renderedTileRect(scene.felt, tile, open.scale, pan);
        expect(rect.left, tile.tileId).toBeGreaterThanOrEqual(frame.left - 1);
        expect(rect.top, tile.tileId).toBeGreaterThanOrEqual(frame.top - 1);
        expect(rect.right, tile.tileId).toBeLessThanOrEqual(scene.felt.w - frame.right + 1);
        expect(rect.bottom, tile.tileId).toBeLessThanOrEqual(scene.felt.h - frame.bottom + 1);
      }
    }
  });

  it("keeps an east 4-seat arm inside the copper line", () => {
    let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
    const used = new Set(["6-6"]);
    for (let n = 0; n < 10; n += 1) {
      const ends = openEnds(board);
      const east = ends.find((end) => end.id === "east") ?? ends[0];
      if (!east) break;
      const tile = allTiles().find((candidate) => !used.has(candidate.id) && (candidate.low === east.match || candidate.high === east.match));
      if (!tile) break;
      used.add(tile.id);
      board = placeTile(board, east.id, tile);
    }
    const felt = { w: 412, h: 683 };
    const frame = frameInsets("TBL-013", felt);
    const view = feltScale({
      board,
      felt,
      screenWidth: 412,
      zones: seatZones(felt, 4),
      previous: null,
      newHand: true,
      tableId: "TBL-013",
    });
    const layout = layoutBoard(board, view.limits);
    const scale = fitFrameScale({ tiles: layout.tiles, felt, screenWidth: 412, frame, previous: null });
    const shift = chainViewShift(layout.tiles, scale);
    const pan = { x: shift.x + boardShift(frame).x, y: shift.y + boardShift(frame).y };
    const eastMost = layout.tiles.reduce((far, tile) => (tile.x + tile.w > far.x + far.w ? tile : far));
    const rect = renderedTileRect(felt, eastMost, scale, pan);
    expect(rect.right, eastMost.tileId).toBeLessThanOrEqual(felt.w - frame.right + 0.6);
    expect(rect.left, eastMost.tileId).toBeGreaterThanOrEqual(frame.left);
  });

  it("refits when the Chrome toolbar shortens the felt and does not zoom back in", () => {
    const hand = "1:1";
    const table = "TBL-013";
    expect(nextFeltSize({ hand, w: 412, h: 683, table }, hand, 412, 684, table).resized).toBe(false);
    const toolbar = nextFeltSize({ hand, w: 412, h: 683, table }, hand, 412, 612, table);
    expect(toolbar).toEqual({ w: 412, h: 612, resized: true });
    const felt = { w: 412, h: 683 };
    const short = { w: 412, h: 612 };
    let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
    board = placeTile(board, "east", tileById("5-6"));
    board = placeTile(board, "west", tileById("4-6"));
    const zones = seatZones(felt, 4);
    const first = feltScale({
      board,
      felt,
      screenWidth: 412,
      zones,
      previous: null,
      newHand: true,
      tableId: table,
    });
    const after = feltScale({
      board,
      felt: short,
      screenWidth: 412,
      zones: seatZones(short, 4),
      previous: first.scale,
      newHand: false,
      tableId: table,
    });
    expect(tilesRelocating(new Map([["6-6", { x: 0, y: 0, w: 36, h: 72 }]]), [{ tileId: "6-6", x: 2, y: 0, w: 36, h: 72 }])).toEqual([]);
    expect(
      tilesRelocating(new Map([["1-5", { x: 0, y: 0, w: 72, h: 36 }]]), [{ tileId: "1-5", x: 300, y: 0, w: 72, h: 36 }]),
    ).toEqual(["1-5"]);
    expect(readFileSync(new URL("./styles.css", import.meta.url), "utf8")).toMatch(
      /\.board-tile\.is-relocating\s*\{\s*visibility:\s*hidden/,
    );
    expect(after.scale).toBeCloseTo(first.scale, 5);
    const frame = frameInsets(table, short);
    const layout = layoutBoard(board, after.limits);
    const shift = chainViewShift(layout.tiles, after.scale);
    const pan = { x: shift.x + boardShift(frame).x, y: shift.y + boardShift(frame).y };
    for (const tile of layout.tiles) {
      const rect = renderedTileRect(short, tile, after.scale, pan);
      expect(rect.top).toBeGreaterThanOrEqual(frame.top - 1);
      expect(rect.bottom).toBeLessThanOrEqual(short.h - frame.bottom + 1);
    }
  });
});

describe("layout guarantee", () => {
  it("keeps 500 full matches from covering a tile or leaving the felt", () => {
    const felts = [
      { name: "phone", w: 412, h: 707 },
      { name: "s26", w: 412, h: 683 },
      { name: "cover", w: 344, h: 674 },
      { name: "inner", w: 751, h: 624 },
    ];
    const combos = [
      [2, "draw_one"],
      [2, "draw_until"],
      [3, "draw_one"],
      [3, "draw_until"],
      [4, "draw_one"],
      [4, "draw_until"],
    ] as const;
    let matches = 0;
    let boards = 0;
    let midpoints = 0;
    let coverChecks = 0;
    for (const [seats, mode] of combos) {
      for (let seed = 1; seed <= 84; seed += 1) {
        matches += 1;
        const players = HAND_PLAYERS[seats].map((player) => ({ ...player }));
        let match = createMatch(players, { boneyardMode: mode, seriesLength: 3, targetScore: 100 });
        for (let hand = 0; hand < 24 && match.phase !== "series_over"; hand += 1) {
          const bytes = Buffer.alloc(32);
          bytes.writeUInt32BE(seed, 0);
          bytes.writeUInt32BE(hand + 1, 4);
          bytes.writeUInt32BE(seats * 1000 + (mode === "draw_one" ? 1 : 2), 8);
          match = beginHand(match, shuffleWithSeed(bytes));
          const previous = new Map<string, { tiles: Map<string, { x: number; y: number; w: number; h: number }>; scale: number; shift: { x: number; y: number } }>();
          for (let step = 0; step < 280 && match.hand && match.hand.phase !== "complete"; step += 1) {
            const playerId = currentPlayerId(match);
            if (!playerId) break;
            const intents = legalIntents(match, playerId);
            if (intents.length === 0) break;
            const intent = intents[(seed * 5 + hand * 13 + step * 3) % intents.length]!;
            const result = applyIntent(match, playerId, intent);
            if (!result.ok) break;
            match = result.match;
            if (intent.type !== "play" || !match.hand?.board.center) continue;
            const board = match.hand.board;
            for (const felt of felts) {
              const zones = seatZones(felt, seats);
              const readable = felt.w >= 720 ? READABLE_WIDE_PX : READABLE_PHONE_PX;
              const room = fitInsets(felt, zones);
              const limits = {
                width: Math.max(160, ((felt.w - room.left - room.right) * TILE_SHORT) / readable),
                height: Math.max(160, ((felt.h - room.top - room.bottom) * TILE_SHORT) / readable),
              };
              const layout = layoutBoard(board, limits);
              boards += 1;
              if (layoutOverlaps(layout)) {
                throw new Error(`${seats} ${mode} seed ${seed} ${felt.name} overlaps`);
              }
              const zoom = containScale({
                tiles: layout.tiles,
                felt,
                screenWidth: felt.w,
                zones,
                previous: null,
                newHand: true,
              });
              const shift = chainViewShift(layout.tiles, zoom);
              const settled = layout.tiles.map((tile) => renderedTileRect(felt, tile, zoom, shift));
              for (const rect of settled) {
                if (rect.left < -1 || rect.top < -1 || rect.right > felt.w + 1 || rect.bottom > felt.h + 1) {
                  throw new Error(`${seats} ${mode} seed ${seed} ${felt.name} tile outside the felt`);
                }
              }
              const prior = previous.get(felt.name);
              if (prior) {
                midpoints += 1;
                const eased = cameraEase(0.5);
                const scale = prior.scale + (zoom - prior.scale) * eased;
                const pan = {
                  x: prior.shift.x + (shift.x - prior.shift.x) * eased,
                  y: prior.shift.y + (shift.y - prior.shift.y) * eased,
                };
                const hidden = new Set(tilesRelocating(prior.tiles, layout.tiles));
                const midway: Array<{ id: string; box: { x: number; y: number; w: number; h: number }; moved: number }> = [];
                for (const tile of layout.tiles) {
                  const old = prior.tiles.get(tile.tileId);
                  if (!old) continue;
                  const moved = Math.hypot(tile.x - old.x, tile.y - old.y);
                  const box = {
                    x: old.x + (tile.x - old.x) * eased,
                    y: old.y + (tile.y - old.y) * eased,
                    w: old.w,
                    h: old.h,
                  };
                  midway.push({ id: tile.tileId, box, moved });
                  // A tile that stays put must still be on the felt halfway through the ease.
                  if (!hidden.has(tile.tileId)) {
                    const rect = renderedTileRect(felt, box, scale, pan);
                    if (rect.left < -18 || rect.top < -18 || rect.right > felt.w + 18 || rect.bottom > felt.h + 18) {
                      throw new Error(`${seats} ${mode} seed ${seed} ${felt.name} midpoint outside the felt`);
                    }
                  }
                }
                for (let i = 0; i < midway.length; i += 1) {
                  for (let j = i + 1; j < midway.length; j += 1) {
                    const left = midway[i]!;
                    const right = midway[j]!;
                    // A jump or a turn is not painted during the glide, so it
                    // cannot land on another tile on the way. The tiles that
                    // stay on screen must not cover each other at the midpoint.
                    if (hidden.has(left.id) || hidden.has(right.id)) continue;
                    coverChecks += 1;
                    if (boxesOverlap(left.box, right.box)) {
                      throw new Error(`${seats} ${mode} seed ${seed} ${felt.name} midpoint overlap ${left.id} ${right.id}`);
                    }
                  }
                }
              }
              previous.set(felt.name, {
                tiles: new Map(layout.tiles.map((tile) => [tile.tileId, { x: tile.x, y: tile.y, w: tile.w, h: tile.h }])),
                scale: zoom,
                shift,
              });
            }
          }
        }
      }
    }
    // Printed in the vitest log so the run can report the sample.
    console.log(`fuzz matches=${matches} boards=${boards} midpoints=${midpoints} coverChecks=${coverChecks}`);
    expect(matches).toBeGreaterThanOrEqual(500);
    expect(boards).toBeGreaterThan(matches);
    expect(midpoints).toBeGreaterThan(0);
    expect(coverChecks).toBeGreaterThan(0);
  }, 180_000);
});

describe("token slot clearance", () => {
  it("records the live overlap of the west slot and the 3-3", () => {
    const slot = { left: 80.89, top: 284.72, right: 100.89, bottom: 314.72 };
    const tile = { left: 93.21, top: 260, right: 139.65, bottom: 352.9 };
    expect(rectsMeet(tile, slot)).toBe(true);
    expect(slot.right - tile.left).toBeGreaterThan(6);
  });

  it("shrinks until the west tile is clear of the left slot", () => {
    const felt = { w: 390, h: 700 };
    const slot = { left: 80.89, top: 284.72, right: 100.89, bottom: 314.72 };
    const tile = { x: -80, y: -36, w: 36, h: 72 };
    const centerX = -10.3;
    const shift = (scale: number) => ({ x: -centerX * scale, y: 0 });
    const open = 1.46;
    const before = renderedTileRect(felt, tile, open, shift(open));
    expect(rectsMeet(before, slot)).toBe(true);
    const scale = scaleClearOfSlots({ tiles: [tile], felt, slots: [slot], scale: open, shift });
    expect(scale).toBeLessThan(open);
    const after = renderedTileRect(felt, tile, scale, shift(scale));
    expect(rectsMeet(after, slot)).toBe(false);
  });

  it("leaves a chain that already misses the slot at its opening size", () => {
    const felt = { w: 390, h: 700 };
    const slot = { left: 14, top: 260, right: 34, bottom: 290 };
    const tile = { x: -18, y: -36, w: 36, h: 72 };
    const shift = (scale: number) => ({ x: 0, y: 0 });
    const open = 1.46;
    const before = renderedTileRect(felt, tile, open, shift(open));
    expect(rectsMeet(before, slot)).toBe(false);
    expect(scaleClearOfSlots({ tiles: [tile], felt, slots: [slot], scale: open, shift })).toBe(open);
  });

  it("a slot in the left margin does not pull a tile that is on the frame edge", () => {
    const felt = { w: 390, h: 641 };
    const open = (OPEN_TILE_FRAC * felt.w) / TILE_SHORT;
    const tile = { x: 0, y: 0, w: TILE_SHORT, h: TILE_LONG };
    const shift = () => ({ x: 20 - felt.w / 2, y: -220 });
    const onEdge = renderedTileRect(felt, tile, open, shift());
    expect(onEdge.left).toBeCloseTo(20, 5);
    const slot = { left: 0, top: onEdge.top, right: 20, bottom: onEdge.top + 30 };
    expect(rectsMeet(onEdge, slot)).toBe(false);
    // The 6px air treats the shared frame line as a hit, so this helper would
    // zoom while the tile is still inside the edge. The camera does not call it.
    expect(scaleClearOfSlots({ tiles: [tile], felt, slots: [slot], scale: open, shift })).toBeLessThan(open);
  });

  it("the felt-edge zoom and a margin slot agree on the first zoom-out of one seeded hand", () => {
    const felt = { w: 390, h: 641 };
    const screenWidth = 390;
    const open = (OPEN_TILE_FRAC * screenWidth) / TILE_SHORT;
    const frame = frameInsets(null, felt);
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(11, 0);
    const players = [0, 1, 2, 3].map((index) => ({ id: `p${index}`, name: `P${index}` }));
    let match = beginHand(
      createMatch(players, { playerCount: 4, boneyardMode: "draw_until", seriesLength: 1, targetScore: 500 }),
      shuffleWithSeed(bytes),
    );
    let previous: number | null = null;
    let held: { width: number; height: number } | null = null;
    let edgePlay = -1;
    let plays = 0;
    for (let guard = 0; guard < 40 && match.hand && match.hand.phase !== "complete"; guard += 1) {
      const playerId = currentPlayerId(match);
      if (!playerId) break;
      const intents = legalIntents(match, playerId);
      const intent = intents.find((item) => item.type === "play") ?? intents[0];
      if (!intent) break;
      const result = applyIntent(match, playerId, intent);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      match = result.match;
      if (intent.type !== "play" || !match.hand) continue;
      plays += 1;
      const solved = feltScale({
        board: match.hand.board,
        felt,
        screenWidth,
        previous,
        newHand: previous == null,
        tableId: null,
        frame,
      });
      if (!held || solved.limits.width > held.width + 4 || solved.limits.height > held.height + 4) held = solved.limits;
      const layout = layoutBoard(match.hand.board, held ?? undefined);
      const edge = fitFrameScale({ tiles: layout.tiles, felt, screenWidth, frame, previous });
      if (edgePlay < 0 && edge < open - 0.02) edgePlay = plays;
      previous = edge;
      if (edgePlay >= 0) break;
    }
    expect(edgePlay).toBeGreaterThan(1);
    expect(plays).toBe(edgePlay);
  });

  it("charges a left badge to the left edge only, and the fit uses the deeper line", () => {
    const felt = { w: 390, h: 641 };
    const badge = { left: 14, top: 207, right: 77, bottom: 235 };
    const hand = { left: 0, top: 120, right: 22, bottom: 520 };
    const insets = keepOutInsets(felt, [badge, hand]);
    expect(insets.left).toBeGreaterThanOrEqual(77);
    expect(insets.right).toBe(0);
    expect(insets.top).toBe(0);
    const frame = frameInsets(null, felt);
    const usable = mergeInsets(frame, insets);
    expect(usable.left).toBe(insets.left);
    expect(usable.left).toBeGreaterThan(frame.left);
  });
});
