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
  STRAIGHT_CAP,
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
  assertPinwheel(board, layout, label);
  assertJoined(board, layout, label);
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
  for (const arm of ARM_IDS) {
    const placed = board.arms[arm].map((tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 2; j < placed.length; j += 1) {
        expect(
          boxGap(placed[i]!, placed[j]!),
          `${label} ${arm} ${placed[i]!.tileId} runs beside ${placed[j]!.tileId}`,
        ).toBeGreaterThanOrEqual(ARM_GAP);
      }
    }
  }
}

function perpendicular(a: string, b: string): boolean {
  const horizontal = a === "east" || a === "west";
  const otherHorizontal = b === "east" || b === "west";
  return horizontal !== otherHorizontal;
}

/**
 * An arm leaves along its own direction, then turns 90 degrees. Two
 * bends cross the open felt. Later bends wrap away from a collision.
 * It may not reverse into the tile it just left.
 */
function assertPinwheel(board: BoardState, layout: BoardLayout, label: string): void {
  for (const arm of ARM_IDS) {
    const dirs: string[] = [];
    for (const tile of board.arms[arm]) {
      const placed = layout.tiles.find((item) => item.tileId === tile.tileId);
      expect(placed, `${label} missing ${tile.tileId}`).toBeTruthy();
      if (!placed) continue;
      const prev = dirs[dirs.length - 1];
      if (prev !== placed.direction) {
        if (prev) expect(perpendicular(prev, placed.direction), `${label} ${arm} ${prev}>${placed.direction}`).toBe(true);
        dirs.push(placed.direction);
      }
    }
    if (dirs.length === 0) continue;
    expect(dirs[0], `${label} ${arm} left the spinner ${dirs.join(">")}`).toBe(arm);
    expect(dirs.length, `${label} ${arm} bent ${dirs.join(">")}`).toBeLessThanOrEqual(6);
  }
}

/** Each tile meets its parent with a short gap and a real shared edge. */
function assertJoined(board: BoardState, layout: BoardLayout, label: string): void {
  const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
  const center = board.center ? byId.get(board.center.tileId) : undefined;
  for (const arm of ARM_IDS) {
    const chain = board.arms[arm];
    for (let index = 0; index < chain.length; index += 1) {
      const tile = byId.get(chain[index]!.tileId);
      const parent = index === 0 ? center : byId.get(chain[index - 1]!.tileId);
      expect(tile && parent, `${label} ${chain[index]!.tileId} parent`).toBeTruthy();
      if (!tile || !parent) continue;
      const edge = sharedEdge(parent, tile);
      expect(Math.abs(edge.gap - TILE_GAP), `${label} ${parent.tileId}>${tile.tileId} gap ${edge.gap}`).toBeLessThan(0.5);
      expect(edge.along, `${label} ${parent.tileId}>${tile.tileId} along ${edge.along}`).toBeGreaterThanOrEqual(TILE_SHORT * 0.45);
    }
  }
}

function sharedEdge(a: LayoutBox, b: LayoutBox): { gap: number; along: number } {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  if (gapY === 0 && gapX > 0) return { gap: gapX, along: yOverlap };
  if (gapX === 0 && gapY > 0) return { gap: gapY, along: xOverlap };
  return { gap: Math.hypot(gapX, gapY), along: 0 };
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

/**
 * The shape from the owner's phone. The up arm and the left arm are both
 * long, which is where the up arm used to turn back down and land on the
 * left arm's corner.
 */
function ownersCrowdedBoard(): BoardState {
  let board = placeTile(
    { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
    "lead",
    tileById("6-6"),
  );
  board = placeTile(board, "west", tileById("5-6"));
  board = placeTile(board, "east", tileById("3-6"));
  for (const id of ["5-5", "4-5", "3-4", "2-3", "1-2", "0-1", "0-0"]) {
    board = placeTile(board, "west", tileById(id));
  }
  for (const id of ["4-6", "1-4", "1-1", "1-3", "0-3", "0-2", "2-2"]) {
    board = placeTile(board, "north", tileById(id));
  }
  for (const id of ["3-5", "2-5", "2-6"]) {
    board = placeTile(board, "east", tileById(id));
  }
  for (const id of ["0-6", "0-4", "4-4"]) {
    board = placeTile(board, "south", tileById(id));
  }
  return board;
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

  it("snakes a long arm across the felt instead of piling into one corner", () => {
    const boards = [
      ["east", boardFromChain(chainFrom(tileById("0-0"), 12), "east")],
      [
        "west",
        boardFromChain(
          ["6-6", "5-6", "4-5", "3-4", "2-3", "1-2", "0-1", "0-3", "3-5", "2-5", "2-6", "4-6"].map((id) => tileById(id)),
          "west",
        ),
      ],
    ] as const;
    for (const [arm, board] of boards) {
      const layout = layoutBoard(board);
      const placed = layout.tiles.filter((tile) => tile.arm === arm);
      const dirs = new Set(placed.map((tile) => tile.direction));
      expect(dirs.has(arm), arm).toBe(true);
      expect(dirs.size, arm).toBeGreaterThan(1);
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
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      expect(Math.abs(cx), `${arm} centered x`).toBeLessThan(PHONE_WIDTH / 5);
      expect(Math.abs(cy), `${arm} centered y`).toBeLessThan(PHONE_HEIGHT / 3);
      expect(maxX - minX, `${arm} uses the width`).toBeGreaterThan(PHONE_WIDTH * 0.55);
      const reachRight = Math.max(...placed.map((tile) => tile.x + tile.w));
      const reachLeft = Math.min(...placed.map((tile) => tile.x));
      expect(reachRight, `${arm} reaches the right`).toBeGreaterThan(24);
      expect(reachLeft, `${arm} reaches the left`).toBeLessThan(-24);
      assertLaidOut(board, `balanced ${arm}`, false);
    }
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
    assertLaidOut(board, "spinner", false);
    const westDirs = new Set(
      board.arms.west.map((tile) => layoutBoard(board).tiles.find((item) => item.tileId === tile.tileId)!.direction),
    );
    expect(westDirs.has("north")).toBe(true);
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
    assertLaidOut(line, "non-spinner line", false);

    expect(boards).toBeGreaterThan(20);
    expect(sawSpinner).toBe(true);
  });

  it("demands a full tile of clearance, the short side of a domino", () => {
    expect(ARM_GAP).toBe(TILE_SHORT);
    expect(ARM_GAP).toBeGreaterThan(TILE_SHORT / 2);
  });

  /**
   * The owner's phone: the up arm ran up, turned, then came back down
   * until its tip sat against the left arm's corner. That fold is rejected.
   * The up arm may turn right, and only then further up. It may not come
   * back down or across onto the left arm. The left arm may turn up and,
   * when the top is open, back across, but not down beside itself.
   */
  it("does not fold the up arm back down beside the left arm", () => {
    const board = ownersCrowdedBoard();
    expect(board.arms.north.length).toBeGreaterThanOrEqual(4);
    expect(board.arms.west.length).toBeGreaterThanOrEqual(4);
    expect(board.arms.east.length).toBeGreaterThanOrEqual(3);
    expect(board.arms.south.length).toBeGreaterThanOrEqual(3);
    const layout = layoutBoard(board);
    const northDirs = board.arms.north.map(
      (tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction,
    );
    expect(northDirs).not.toContain("south");
    expect(northDirs).not.toContain("west");
    const westDirs = board.arms.west.map(
      (tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction,
    );
    expect(westDirs).not.toContain("south");
    assertLaidOut(board, "up arm beside left arm", false);

    let nearest = Infinity;
    const north = layout.tiles.filter((tile) => tile.arm === "north");
    const west = layout.tiles.filter((tile) => tile.arm === "west");
    const stems = new Set([board.arms.north[0]!.tileId, board.arms.west[0]!.tileId]);
    for (const a of north) {
      for (const b of west) {
        if (stems.has(a.tileId) && stems.has(b.tileId)) continue;
        nearest = Math.min(nearest, boxGap(a, b));
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(ARM_GAP);
  });

  it("keeps a full tile between arms across long four-player games", () => {
    let longBoards = 0;
    let sawEveryArmBend = false;
    for (const mode of ["draw_one", "draw_until"] as const) {
      for (let seed = 0; seed < 12; seed += 1) {
        for (const board of playHand(4, mode, seed + 40)) {
          const lengths = ARM_IDS.map((arm) => board.arms[arm].length);
          if (lengths.some((length) => length < 3)) continue;
          longBoards += 1;
          assertLaidOut(board, `clearance ${mode} ${seed}`, false);
          const layout = layoutBoard(board);
          const bent = ARM_IDS.filter((arm) => {
            const dirs = new Set(
              board.arms[arm].map((tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction),
            );
            return dirs.size > 1;
          });
          if (bent.length === 4) sawEveryArmBend = true;
        }
      }
    }
    expect(longBoards).toBeGreaterThan(15);
    expect(sawEveryArmBend).toBe(true);
  });

  it("chains a horizontal tile onto a crosswise double without overlap", () => {
    let board = placeTile(
      { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false },
      "lead",
      tileById("6-6"),
    );
    for (const id of ["5-6", "5-5", "2-5"]) board = placeTile(board, "east", tileById(id));
    const layout = layoutBoard(board);
    const spinner = layout.tiles.find((tile) => tile.tileId === "6-6")!;
    const five = layout.tiles.find((tile) => tile.tileId === "5-5")!;
    const twoFive = layout.tiles.find((tile) => tile.tileId === "2-5")!;
    expect(spinner.orientation).toBe("vertical");
    expect(five.orientation).toBe("vertical");
    expect(twoFive.orientation).toBe("horizontal");
    expect(five.direction).toBe("east");
    expect(twoFive.direction).toBe("east");
    expect(twoFive.x - (five.x + five.w)).toBe(TILE_GAP);
    expect(boxesOverlap(five, twoFive)).toBe(false);
    expect(boxesOverlap(spinner, layout.tiles.find((tile) => tile.tileId === "5-6")!)).toBe(false);
    assertLaidOut(board, "crosswise double", false);
  });

  it("keeps long games joined, with every arm clear of the others", () => {
    let crowded = 0;
    for (const players of [2, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 40; seed += 1) {
          for (const board of playHand(players, mode, seed)) {
            const layout = layoutBoard(board);
            const label = `long ${players} ${mode} seed ${seed}`;
            assertJoined(board, layout, label);
            for (let i = 0; i < layout.tiles.length; i += 1) {
              for (let j = i + 1; j < layout.tiles.length; j += 1) {
                expect(boxesOverlap(layout.tiles[i]!, layout.tiles[j]!), `${label} overlap`).toBe(false);
              }
            }
            for (const end of layout.ends) {
              const slot = layout.previews[end.id];
              expect(slot, `${label} preview ${end.id}`).toBeTruthy();
              if (!slot) continue;
              for (const tile of layout.tiles) {
                expect(boxesOverlap(slot, tile), `${label} preview ${end.id} on ${tile.tileId}`).toBe(false);
              }
              const tip = [...layout.tiles].reverse().find((tile) => tile.arm === end.id)
                ?? layout.tiles.find((tile) => tile.arm === null);
              expect(tip, `${label} tip ${end.id}`).toBeTruthy();
              if (!tip) continue;
              const edge = sharedEdge(tip, slot);
              expect(Math.abs(edge.gap - TILE_GAP), `${label} preview gap`).toBeLessThan(0.5);
              expect(edge.along, `${label} preview along`).toBeGreaterThanOrEqual(TILE_SHORT * 0.45);
            }
            const count = layout.tiles.length;
            const arms = ARM_IDS.filter((arm) => board.arms[arm].length > 0).length;
            if (count >= 20 && arms === 4) {
              crowded += 1;
              assertLaidOut(board, `${label} n=${count}`, false);
            }
          }
        }
      }
    }
    expect(crowded).toBeGreaterThan(10);
  }, 20_000);

  it("turns a long column into the open side and keeps a larger tile", () => {
    const played = playHand(4, "draw_until", 28);
    const board = played.find(
      (item) =>
        item.arms.west.length === 3
        && item.arms.east.length === 14
        && item.arms.north.length === 4
        && item.arms.south.length === 3,
    );
    expect(board, "column board").toBeTruthy();
    if (!board) return;
    const layout = layoutBoard(board);
    assertLaidOut(board, "long column", false);
    const dirs = board.arms.east.map(
      (tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction,
    );
    // The short neighbours leave the left side open, so the south run turns west.
    expect(dirs).toContain("west");
    let run = 0;
    let prev = "";
    let longest = 0;
    for (const dir of dirs) {
      run = dir === prev ? run + 1 : 1;
      prev = dir;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(STRAIGHT_CAP);
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
    // The previous router kept one south column. On a 390×649 felt, with the
    // 18px sliver inset, that picture scaled to 0.542.
    const feltW = 390 - 18 * 2;
    const feltH = 649 - 18 * 2;
    const scale = Math.min(feltW / (maxX - minX), feltH / (maxY - minY));
    expect(scale).toBeGreaterThan(0.542);

    // While the other arms are still short, there is room to turn, so no
    // straight run grows past the cap.
    for (const seed of [9, 27, 28]) {
      for (const sample of playHand(4, "draw_until", seed)) {
        const sampleLayout = layoutBoard(sample);
        for (const arm of ARM_IDS) {
          const others = ARM_IDS.filter((id) => id !== arm).map((id) => sample.arms[id].length);
          const longestOther = Math.max(...others);
          if (longestOther > 4 || sample.arms[arm].length <= STRAIGHT_CAP) continue;
          const armDirs = sample.arms[arm].map(
            (tile) => sampleLayout.tiles.find((item) => item.tileId === tile.tileId)!.direction,
          );
          let sampleRun = 0;
          let samplePrev = "";
          let sampleLongest = 0;
          for (const dir of armDirs) {
            sampleRun = dir === samplePrev ? sampleRun + 1 : 1;
            samplePrev = dir;
            sampleLongest = Math.max(sampleLongest, sampleRun);
          }
          expect(sampleLongest, `seed ${seed} ${arm}`).toBeLessThanOrEqual(STRAIGHT_CAP);
        }
      }
    }
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
