import { describe, expect, it } from "vitest";
import { emptyBoard, openEnds, placeTile, type BoardState } from "../../rules/src/board.js";
import { boxesOverlap, type LayoutBox } from "../../rules/src/layout.js";
import { tileById } from "../../rules/src/tiles.js";
import { fitAroundGhosts, frameInsets, renderedTileRect, settledHandCamera, type FeltSize } from "./board-scale.js";

const PHONES: Array<{ name: string; felt: FeltSize }> = [
  { name: "390x844", felt: { w: 390, h: 844 } },
  { name: "344x882", felt: { w: 344, h: 882 } },
  { name: "904x1000", felt: { w: 904, h: 1000 } },
];

function deal(plays: Array<[string, string]>): BoardState {
  let board = emptyBoard();
  for (const [end, id] of plays) board = placeTile(board, end, tileById(id));
  return board;
}

function boxOf(tile: LayoutBox): LayoutBox {
  return { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
}

function sameBox(a: LayoutBox, b: LayoutBox): boolean {
  return Math.abs(a.x - b.x) < 0.51 && Math.abs(a.y - b.y) < 0.51 && Math.abs(a.w - b.w) < 0.51 && Math.abs(a.h - b.h) < 0.51;
}

function screenHits(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

/**
 * Every open end the tile can legally take. A double matches one number,
 * so two arms ending on that number are two targets.
 */
function targetsFor(board: BoardState, tileId: string): string[] {
  const tile = tileById(tileId);
  return openEnds(board)
    .filter((end) => tile.low === end.match || tile.high === end.match)
    .map((end) => end.id);
}

function expectLanding(board: BoardState, tileId: string, phone: { name: string; felt: FeltSize }) {
  const targets = targetsFor(board, tileId);
  expect(targets.length, `${phone.name} ${tileId} choices`).toBeGreaterThan(1);
  const tile = tileById(tileId);
  const isDouble = tile.low === tile.high;
  const before = settledHandCamera({
    board,
    felt: phone.felt,
    screenWidth: phone.felt.w,
    frame: frameInsets("TBL-013", phone.felt),
    keepOuts: [],
    previous: null,
    heldLimits: null,
    committed: null,
  });
  const ghosts: LayoutBox[] = [];
  for (const endId of targets) {
    const key = endId as "west" | "east" | "north" | "south";
    const slot = isDouble ? before.layout.doublePreviews?.[key] : before.layout.previews[key];
    expect(slot, `${phone.name} ${tileId} ${endId} preview`).toBeTruthy();
    if (!slot) continue;
    ghosts.push(slot);
    for (const placed of before.layout.tiles) {
      expect(boxesOverlap(slot, placed), `${phone.name} ${tileId} ${endId} overlaps ${placed.tileId}`).toBe(false);
    }
    const after = settledHandCamera({
      board: placeTile(board, endId, tile),
      felt: phone.felt,
      screenWidth: phone.felt.w,
      frame: frameInsets("TBL-013", phone.felt),
      keepOuts: [],
      previous: null,
      heldLimits: null,
      committed: null,
    });
    const landed = after.layout.tiles.find((item) => item.tileId === tileId);
    expect(landed, `${phone.name} ${tileId} landed on ${endId}`).toBeTruthy();
    if (!landed) continue;
    expect(sameBox(slot, landed), `${phone.name} ${tileId} on ${endId}`).toBe(true);
    for (const kept of before.layout.tiles) {
      const still = after.layout.tiles.find((item) => item.tileId === kept.tileId);
      expect(still, `${phone.name} ${kept.tileId} stayed`).toBeTruthy();
      if (still) expect(sameBox(kept, still), `${phone.name} ${kept.tileId} moved`).toBe(true);
    }
  }
  const fitted = fitAroundGhosts({
    tiles: before.layout.tiles,
    ghosts,
    felt: phone.felt,
    edge: before.edge,
    scale: before.scale,
  });
  const ghostRects = ghosts.map((ghost) => renderedTileRect(phone.felt, ghost, fitted.scale, fitted.shift));
  const tileRects = before.layout.tiles.map((item) => renderedTileRect(phone.felt, item, fitted.scale, fitted.shift));
  for (const ghost of ghostRects) {
    for (const tile of tileRects) expect(screenHits(ghost, tile), `${phone.name} ${tileId} screen overlap`).toBe(false);
    expect(ghost.left, `${phone.name} ${tileId} left`).toBeGreaterThanOrEqual(before.edge.left - 0.6);
    expect(ghost.top, `${phone.name} ${tileId} top`).toBeGreaterThanOrEqual(before.edge.top - 0.6);
    expect(ghost.right, `${phone.name} ${tileId} right`).toBeLessThanOrEqual(phone.felt.w - before.edge.right + 0.6);
    expect(ghost.bottom, `${phone.name} ${tileId} bottom`).toBeLessThanOrEqual(phone.felt.h - before.edge.bottom + 0.6);
  }
}

describe("drop targets", () => {
  const beforeTurn = deal([
    ["lead", "6-6"],
    ["west", "5-6"],
    ["west", "3-5"],
    ["east", "4-6"],
    ["east", "3-4"],
    ["north", "2-6"],
    ["north", "0-2"],
    ["south", "1-6"],
  ]);
  const afterTurn = deal([
    ["lead", "6-6"],
    ["west", "5-6"],
    ["west", "4-5"],
    ["west", "2-4"],
    ["west", "2-3"],
    ["east", "1-6"],
    ["east", "1-4"],
    ["east", "0-4"],
    ["east", "0-3"],
    ["north", "2-6"],
    ["north", "0-2"],
    ["north", "0-1"],
    ["north", "1-5"],
    ["south", "0-6"],
    ["south", "0-5"],
    ["south", "2-5"],
    ["south", "2-2"],
  ]);
  const spinnerSide = deal([
    ["lead", "6-6"],
    ["west", "4-6"],
    ["west", "2-4"],
    ["east", "1-6"],
  ]);

  const cases: Array<{ label: string; board: BoardState; tiles: string[] }> = [
    { label: "before a turn", board: beforeTurn, tiles: ["3-3", "1-3"] },
    { label: "after a turn", board: afterTurn, tiles: ["3-3", "3-5"] },
    { label: "spinner side", board: spinnerSide, tiles: ["2-6"] },
  ];

  for (const phone of PHONES) {
    for (const item of cases) {
      it(`matches the landing spot ${item.label} at ${phone.name}`, () => {
        for (const tileId of item.tiles) expectLanding(item.board, tileId, phone);
      });
    }
  }
});
