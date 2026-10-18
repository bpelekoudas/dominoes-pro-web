import { describe, expect, it } from "vitest";
import { openEnds, placeTile, type BoardState } from "./board.js";
import {
  applyIntent,
  beginHand,
  createMatch,
  currentPlayerId,
  legalIntents,
  type MatchState,
} from "./engine.js";
import {
  boxesOverlap,
  FIT_MARGIN,
  insidePhone,
  layoutBoard,
  PHONE_HEIGHT,
  PHONE_WIDTH,
  TILE_GAP,
  TILE_LONG,
  TILE_SHORT,
  type LayoutBox,
} from "./layout.js";
import { shuffleWithSeed } from "./rng.js";
import { allTiles, tileById, type Tile } from "./tiles.js";

const PLAYERS = {
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

function seedBytes(n: number): Buffer {
  const seed = Buffer.alloc(32);
  seed.writeUInt32BE(n + 1, 0);
  seed.writeUInt32BE(0x4c4159, 4);
  return seed;
}

function playHand(players: 2 | 3 | 4, mode: "draw_one" | "draw_until", seed: number): BoardState[] {
  let match = createMatch([...PLAYERS[players]], {
    playerCount: players,
    boneyardMode: mode,
    seriesLength: 3,
    targetScore: 500,
  });
  match = beginHand(match, shuffleWithSeed(seedBytes(seed)));
  const boards: BoardState[] = [];
  for (let guard = 0; guard < 400 && match.hand && match.hand.phase !== "complete"; guard += 1) {
    const playerId = currentPlayerId(match);
    if (!playerId) break;
    const intents = legalIntents(match, playerId);
    if (intents.length === 0) break;
    const intent = intents[(seed + guard) % intents.length]!;
    const result = applyIntent(match, playerId, intent);
    expect(result.ok, result.error).toBe(true);
    match = result.match;
    if (intent.type === "play" && match.hand) boards.push(structuredClone(match.hand.board));
  }
  return boards;
}

function assertLaidOut(board: BoardState, label: string, phone: boolean): void {
  const layout = layoutBoard(board);
  const again = layoutBoard(board);
  expect(again, label).toEqual(layout);

  for (let i = 0; i < layout.tiles.length; i += 1) {
    for (let j = i + 1; j < layout.tiles.length; j += 1) {
      expect(boxesOverlap(layout.tiles[i]!, layout.tiles[j]!), `${label} tiles ${i} ${j}`).toBe(false);
    }
  }
  const boxes = [...layout.tiles, ...layout.ends];
  for (const box of boxes) {
    expect(contains(layout.fit, box), `${label} outside fit`).toBe(true);
    if (phone) expect(insidePhone(box), `${label} outside phone felt`).toBe(true);
  }
  for (const end of layout.ends) {
    const host = layout.tiles.some((tile) => contains(tile, end));
    expect(host, `${label} end ${end.id} is not on a tile`).toBe(true);
  }
  expect(layout.fit.w).toBeLessThanOrEqual(PHONE_WIDTH + FIT_MARGIN * 2 + 4);
  expect(layout.fit.h).toBeLessThanOrEqual(PHONE_HEIGHT + FIT_MARGIN * 2 + 4);
}

function contains(outer: LayoutBox, inner: LayoutBox): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

function chainFrom(start: Tile, limit: number): Tile[] {
  const remaining = allTiles().filter((tile) => tile.id !== start.id);
  const path = [start];
  let open = start.high;
  while (path.length < limit) {
    const index = remaining.findIndex((tile) => tile.low === open || tile.high === open);
    if (index < 0) break;
    const tile = remaining.splice(index, 1)[0]!;
    path.push(tile);
    open = tile.low === open ? tile.high : tile.low;
  }
  return path;
}

function boardFromChain(tiles: Tile[], arm: "east" | "west" | "north" | "south"): BoardState {
  let board = placeTile(
    { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
    "lead",
    tiles[0]!,
  );
  for (const tile of tiles.slice(1)) {
    const ends = openEnds(board).map((end) => end.id);
    const end = ends.includes(arm) ? arm : ends[0]!;
    board = placeTile(board, end, tile);
  }
  return board;
}

describe("board layout", () => {
  it("sets a straight chain almost touching, with doubles crosswise", () => {
    const tiles = chainFrom(tileById("6-6"), 6);
    const board = boardFromChain(tiles, "east");
    const layout = layoutBoard(board);
    const east = layout.tiles.filter((tile) => tile.tileId !== "6-6");
    expect(east.length).toBeGreaterThan(2);
    for (let i = 1; i < east.length; i += 1) {
      const prev = east[i - 1]!;
      const next = east[i]!;
      if (prev.direction === "east" && next.direction === "east") {
        expect(next.x - (prev.x + prev.w)).toBe(TILE_GAP);
      }
    }
    const double = layout.tiles.find((tile) => tile.tileId === "6-6");
    expect(double?.orientation).toBe("vertical");
    expect(double?.w).toBe(TILE_SHORT);
    expect(double?.h).toBe(TILE_LONG);
    const follower = layout.tiles.find((tile) => tile.tileId === tiles[1]!.id);
    expect(follower?.orientation).toBe("horizontal");
    expect(follower?.h).toBe(TILE_SHORT);
    expect(follower?.w).toBe(TILE_LONG);
  });

  it("bends a long arm and keeps every tile inside the phone felt", () => {
    const tiles = chainFrom(tileById("0-0"), 16);
    const board = boardFromChain(tiles, "east");
    const layout = layoutBoard(board);
    const dirs = new Set(layout.tiles.map((tile) => tile.direction));
    expect(dirs.size).toBeGreaterThan(1);
    assertLaidOut(board, "long east", true);
  });

  it("lays out spinner arms without overlaps", () => {
    const used = new Set<string>(["5-5"]);
    let board = placeTile(
      { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
      "lead",
      tileById("5-5"),
    );
    const order: Array<"west" | "east" | "north" | "south"> = ["west", "east", "north", "south"];
    for (let round = 0; round < 5; round += 1) {
      for (const arm of order) {
        const end = openEnds(board).find((candidate) => candidate.id === arm);
        if (!end) continue;
        const tile = allTiles().find(
          (candidate) => !used.has(candidate.id) && (candidate.low === end.match || candidate.high === end.match),
        );
        if (!tile) continue;
        board = placeTile(board, arm, tile);
        used.add(tile.id);
      }
    }
    expect(board.spinnerOpen).toBe(true);
    expect(board.arms.north.length).toBeGreaterThan(0);
    expect(board.arms.south.length).toBeGreaterThan(0);
    assertLaidOut(board, "spinner", true);
  });

  it("keeps simulated hands inside the fit, with and without a spinner", () => {
    const cases: Array<[2 | 3 | 4, "draw_one" | "draw_until", number]> = [];
    for (const players of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 4; seed += 1) cases.push([players, mode, seed + players * 10]);
      }
    }
    let sawSpinner = false;
    let boards = 0;
    for (const [players, mode, seed] of cases) {
      const played = playHand(players, mode, seed);
      expect(played.length, `${players} ${mode} ${seed}`).toBeGreaterThan(0);
      for (const board of played) {
        boards += 1;
        if (board.spinnerOpen) sawSpinner = true;
        assertLaidOut(board, `${players} ${mode} seed ${seed}`, true);
      }
    }
    // A later deal can open on a non-double. The first deal of a series cannot:
    // the leader has to play the highest double. Stop before a double promotes it.
    let line = placeTile(
      { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
      "lead",
      tileById("4-6"),
    );
    for (const id of ["5-6", "3-5", "2-3", "1-2", "0-1", "0-4", "1-4", "2-4", "3-4"]) {
      const end = openEnds(line).find((candidate) => candidate.id === "east") ?? openEnds(line)[0];
      if (!end) break;
      const tile = tileById(id);
      if (tile.low !== end.match && tile.high !== end.match) continue;
      const next = placeTile(line, end.id, tile);
      if (next.center?.isSpinner) break;
      line = next;
    }
    expect(line.center?.isSpinner).toBe(false);
    expect(line.arms.east.length + line.arms.west.length).toBeGreaterThan(3);
    assertLaidOut(line, "non-spinner line", true);

    expect(boards).toBeGreaterThan(20);
    expect(sawSpinner).toBe(true);
  });

  it("reports a fit box with a margin around the tiles", () => {
    const board = boardFromChain(chainFrom(tileById("3-3"), 4), "west");
    const layout = layoutBoard(board);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const tile of layout.tiles) {
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
      maxX = Math.max(maxX, tile.x + tile.w);
      maxY = Math.max(maxY, tile.y + tile.h);
    }
    expect(layout.fit.x).toBeLessThanOrEqual(minX - FIT_MARGIN + 0.5);
    expect(layout.fit.y).toBeLessThanOrEqual(minY - FIT_MARGIN + 0.5);
    expect(layout.fit.x + layout.fit.w).toBeGreaterThanOrEqual(maxX + FIT_MARGIN - 0.5);
    expect(layout.fit.y + layout.fit.h).toBeGreaterThanOrEqual(maxY + FIT_MARGIN - 0.5);
  });
});
