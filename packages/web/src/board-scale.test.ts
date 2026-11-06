import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyBoard, placeTile, type BoardState } from "../../rules/src/board.js";
import { applyIntent, beginHand, createMatch, currentPlayerId, legalIntents } from "../../rules/src/engine.js";
import { boxesOverlap, FIT_MARGIN, layoutBoard, TILE_LONG, TILE_SHORT } from "../../rules/src/layout.js";
import { shuffleWithSeed } from "../../rules/src/rng.js";
import { tileById } from "../../rules/src/tiles.js";
import {
  boardShift,
  CAMERA_EDGE,
  cameraScale,
  chainViewShift,
  containScale,
  feltScale,
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
    // The clockwise cross does not fold back into the felt, so a long arm
    // runs past the edge and the fitted tile sits just under nine tenths.
    expect(phone.scale).toBeGreaterThanOrEqual(shrunk.scale * 0.89);
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
    expect(css).toMatch(/data-camera="armed"\] \.board-scaler[\s\S]{0,240}transition:\s*none/);
    let turns = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (const table of tables) {
      for (const seed of [1, 4, 9]) {
        let previous: number | null = null;
        let shift: { x: number; y: number } | null = null;
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
          if (shift) expect(pan).toEqual(shift);
          shift = pan;
          const ring = 2;
          for (const tile of layout.tiles) {
            const left = table.felt.w / 2 + pan.x + tile.x * view.scale;
            const top = table.felt.h / 2 + pan.y + tile.y * view.scale;
            const right = left + tile.w * view.scale;
            const bottom = top + tile.h * view.scale;
            expect(left, `${table.name} ${tile.tileId} left`).toBeGreaterThanOrEqual(insets.left + ring - 0.5);
            expect(top, `${table.name} ${tile.tileId} top`).toBeGreaterThanOrEqual(insets.top + ring - 0.5);
            expect(right, `${table.name} ${tile.tileId} right`).toBeLessThanOrEqual(table.felt.w - insets.right - ring + 0.5);
            expect(bottom, `${table.name} ${tile.tileId} bottom`).toBeLessThanOrEqual(table.felt.h - insets.bottom - ring + 0.5);
          }
          if (previous != null) {
            expect(view.scale).toBeLessThanOrEqual(previous + 1e-9);
            // A frame between the old scale and the fit would paint the new
            // chain too large. The camera publishes the fit immediately.
            if (!contained(layout.tiles, table.felt, insets, pan, previous, ring)) {
              const mid = previous + (view.scale - previous) * 0.5;
              expect(mid).toBeGreaterThan(view.scale);
              expect(contained(layout.tiles, table.felt, insets, pan, view.scale, ring)).toBe(true);
            } else {
              for (const step of [0.25, 0.5, 0.75, 1]) {
                const frame = previous + (view.scale - previous) * step;
                expect(
                  contained(layout.tiles, table.felt, insets, pan, frame, ring),
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
        if (previous != null) expect(fresh.scale).toBeGreaterThanOrEqual(previous - 1e-9);
      }
    }
    expect(turns).toBeGreaterThan(40);
    expect(smallest).toBeGreaterThan(8);
    expect(smallest).toBeLessThan(TILE_LONG);
  }, 40_000);

  it("holds a lopsided arm inside the felt on a phone and a fold", () => {
    let board = emptyBoard();
    const ids = ["6-6", "5-6", "4-5", "3-4", "2-3", "1-2", "0-1", "0-2", "2-4", "4-6", "3-6", "1-3", "1-4", "0-4"];
    board = placeTile(board, "lead", tileById(ids[0]!));
    for (const id of ids.slice(1)) board = placeTile(board, "east", tileById(id));
    for (const felt of [{ w: 412, h: 915 }, { w: 344, h: 882 }, { w: 473, h: 1024 }, { w: 751, h: 832 }]) {
      const zones = seatZones(felt, 4);
      const insets = fitInsets(felt, zones);
      const view = feltScale({ board, felt, screenWidth: felt.w, zones, previous: null, newHand: true });
      const pan = boardShift(insets);
      const layout = layoutBoard(board, view.limits);
      expect(contained(layout.tiles, felt, insets, pan, view.scale, 2), `${felt.w}x${felt.h}`).toBe(true);
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
