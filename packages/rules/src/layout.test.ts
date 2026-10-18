import { describe, expect, it } from "vitest";
import { ARM_IDS, openEnds, placeTile, type ArmId, type BoardState } from "./board.js";
import {
  applyIntent,
  beginHand,
  createMatch,
  currentPlayerId,
  legalIntents,
  type MatchState,
} from "./engine.js";
import {
  ARM_GAP,
  boxGap,
  boxesOverlap,
  FIT_MARGIN,
  HARD_HEIGHT,
  HARD_WIDTH,
  insideHard,
  insidePhone,
  layoutBoard,
  PHONE_HEIGHT,
  PHONE_WIDTH,
  TILE_GAP,
  TILE_LONG,
  TILE_SHORT,
  type BoardLayout,
  type LayoutBox,
  type PlacedTile,
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
    expect(insideHard(box), `${label} outside the table`).toBe(true);
    if (phone) expect(insidePhone(box), `${label} outside phone felt`).toBe(true);
  }
  for (const end of layout.ends) {
    const host = layout.tiles.some((tile) => contains(tile, end));
    expect(host, `${label} end ${end.id} is not on a tile`).toBe(true);
  }
  const limitW = phone ? PHONE_WIDTH : HARD_WIDTH;
  const limitH = phone ? PHONE_HEIGHT : HARD_HEIGHT;
  expect(layout.fit.w).toBeLessThanOrEqual(limitW + FIT_MARGIN * 2 + 4);
  expect(layout.fit.h).toBeLessThanOrEqual(limitH + FIT_MARGIN * 2 + 4);
  assertArmsSeparated(board, layout, label);
  assertDoublesCentered(board, layout, label);
}

/** First tiles of each arm meet beside the spinner, so the gap rule starts after them. */
function assertArmsSeparated(board: BoardState, layout: BoardLayout, label: string): void {
  const stems = new Set<string>();
  for (const arm of ARM_IDS) {
    const first = board.arms[arm][0];
    if (first) stems.add(first.tileId);
  }
  const center = layout.tiles.find((tile) => tile.arm === null);
  if (center) {
    const pad = TILE_SHORT;
    const region = { x: center.x - pad, y: center.y - pad, w: center.w + pad * 2, h: center.h + pad * 2 };
    for (const tile of layout.tiles) {
      if (tile.arm === null || stems.has(tile.tileId)) continue;
      expect(boxesOverlap(tile, region), `${label} ${tile.tileId} re-enters the centre`).toBe(false);
    }
  }
  for (let i = 0; i < layout.tiles.length; i += 1) {
    for (let j = i + 1; j < layout.tiles.length; j += 1) {
      const a = layout.tiles[i]!;
      const b = layout.tiles[j]!;
      if (!a.arm || !b.arm || a.arm === b.arm) continue;
      if (stems.has(a.tileId) && stems.has(b.tileId)) continue;
      expect(boxGap(a, b), `${label} ${a.tileId} near ${b.tileId}`).toBeGreaterThanOrEqual(ARM_GAP);
    }
  }
}

/**
 * A double sits crosswise. The next tile meets it with a short end, centred,
 * and the chain does not turn on that join.
 */
function assertDoublesCentered(board: BoardState, layout: BoardLayout, label: string): void {
  const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
  if (board.center && board.center.low === board.center.high) {
    const spinner = byId.get(board.center.tileId);
    expect(spinner?.orientation, label).toBe("vertical");
    for (const arm of ["east", "west"] as const) {
      const first = board.arms[arm][0];
      if (!first || !spinner) continue;
      expectJoinedToDouble(spinner, byId.get(first.tileId)!, arm, `${label} spinner ${arm}`);
    }
  }
  for (const arm of ARM_IDS) {
    const chain = board.arms[arm];
    for (let i = 0; i < chain.length; i += 1) {
      const placed = byId.get(chain[i]!.tileId);
      expect(placed, `${label} missing ${chain[i]!.tileId}`).toBeTruthy();
      if (!placed) continue;
      const isDouble = chain[i]!.low === chain[i]!.high;
      if (isDouble) {
        const crosswise = placed.direction === "east" || placed.direction === "west" ? placed.h > placed.w : placed.w > placed.h;
        expect(crosswise, `${label} ${placed.tileId} not crosswise`).toBe(true);
      }
      if (i === 0) continue;
      const prev = chain[i - 1]!;
      const prevPlaced = byId.get(prev.tileId)!;
      const prevDouble = prev.low === prev.high;
      if (prevDouble) expectJoinedToDouble(prevPlaced, placed, prevPlaced.direction, `${label} ${prev.tileId}`);
      if (placed.direction !== prevPlaced.direction) {
        expect(isDouble, `${label} bent on double ${placed.tileId}`).toBe(false);
        expect(prevDouble, `${label} bent off double ${prev.tileId}`).toBe(false);
      }
    }
  }
}

function expectJoinedToDouble(double: PlacedTile, next: PlacedTile, dir: ArmId, label: string): void {
  expect(next.direction, label).toBe(dir);
  const along = dir === "east"
    ? next.x - (double.x + double.w)
    : dir === "west"
      ? double.x - (next.x + next.w)
      : dir === "south"
        ? next.y - (double.y + double.h)
        : double.y - (next.y + next.h);
  expect(along, label).toBe(TILE_GAP);
  if (dir === "east" || dir === "west") {
    expect(next.y + next.h / 2, label).toBeCloseTo(double.y + double.h / 2, 5);
    expect(double.h, label).toBe(TILE_LONG);
    expect(next.h, label).toBeLessThanOrEqual(double.h);
    expect(next.h, label).toBe(TILE_SHORT);
  } else {
    expect(next.x + next.w / 2, label).toBeCloseTo(double.x + double.w / 2, 5);
    expect(double.w, label).toBe(TILE_LONG);
    expect(next.w, label).toBeLessThanOrEqual(double.w);
    expect(next.w, label).toBe(TILE_SHORT);
  }
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
    assertDoublesCentered(board, layout, "straight double");
  });

  it("centres the next tile on a double, in a straight run and at a bend", () => {
    let straight = placeTile(
      { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
      "lead",
      tileById("6-6"),
    );
    for (const [end, id] of [["east", "3-6"], ["east", "3-3"], ["east", "2-3"]] as const) {
      straight = placeTile(straight, end, tileById(id));
    }
    const straightLayout = layoutBoard(straight);
    const double = straightLayout.tiles.find((tile) => tile.tileId === "3-3")!;
    const after = straightLayout.tiles.find((tile) => tile.tileId === "2-3")!;
    expect(double.direction).toBe("east");
    expect(double.orientation).toBe("vertical");
    expectJoinedToDouble(double, after, "east", "mid-chain 3-3");
    assertLaidOut(straight, "mid-chain double", true);

    // The double would fall past the right edge, so the chain turns on the
    // normal tile before it and the follower stays centred on the new line.
    let bent = placeTile(
      { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
      "lead",
      tileById("6-6"),
    );
    for (const id of ["5-6", "4-5", "3-4", "2-3", "2-2", "1-2"]) {
      bent = placeTile(bent, "east", tileById(id));
    }
    const bentLayout = layoutBoard(bent);
    const corner = bentLayout.tiles.find((tile) => tile.tileId === "3-4")!;
    const bentDouble = bentLayout.tiles.find((tile) => tile.tileId === "2-2")!;
    const follower = bentLayout.tiles.find((tile) => tile.tileId === "1-2")!;
    expect(corner.direction).not.toBe("east");
    expect(bentDouble.direction).toBe(corner.direction);
    expect(bentDouble.direction).toBe(follower.direction);
    expectJoinedToDouble(bentDouble, follower, bentDouble.direction, "double at a bend");
    assertLaidOut(bent, "double at a bend", true);
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
        assertLaidOut(board, `${players} ${mode} seed ${seed}`, false);
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
