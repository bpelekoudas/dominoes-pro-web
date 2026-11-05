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
  boxesOverlap,
  FIT_MARGIN,
  HARD_HEIGHT,
  HARD_WIDTH,
  insideHard,
  insidePhone,
  layoutBoard,
  layoutOverlaps,
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
  assertPinwheel(board, layout, label);
  assertJoined(board, layout, label);
  assertCornerHalves(board, layout, label);
}

/** First tiles of each arm meet beside the spinner, so the gap rule starts after them. */
function assertArmsSeparated(board: BoardState, layout: BoardLayout, label: string): void {
  const stems = new Set<string>();
  for (const arm of ARM_IDS) {
    const first = board.arms[arm][0];
    if (first) stems.add(first.tileId);
  }
  for (let i = 0; i < layout.tiles.length; i += 1) {
    for (let j = i + 1; j < layout.tiles.length; j += 1) {
      const a = layout.tiles[i]!;
      const b = layout.tiles[j]!;
      if (!a.arm || !b.arm || a.arm === b.arm) continue;
      if (stems.has(a.tileId) && stems.has(b.tileId)) continue;
      expect(boxesOverlap(a, b), `${label} ${a.tileId} covers ${b.tileId}`).toBe(false);
    }
  }
  for (const arm of ARM_IDS) {
    const placed = board.arms[arm].map((tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 2; j < placed.length; j += 1) {
        expect(
          boxesOverlap(placed[i]!, placed[j]!),
          `${label} ${arm} ${placed[i]!.tileId} covers ${placed[j]!.tileId}`,
        ).toBe(false);
      }
    }
  }
}

function perpendicular(a: string, b: string): boolean {
  const horizontal = a === "east" || a === "west";
  const otherHorizontal = b === "east" || b === "west";
  return horizontal !== otherHorizontal;
}

/** Clockwise into the arm's own quadrant. The return run is the opposite way. */
function shiftOf(arm: string): string {
  if (arm === "west") return "north";
  if (arm === "north") return "east";
  if (arm === "east") return "south";
  return "west";
}

function oppositeOf(arm: string): string {
  if (arm === "west") return "east";
  if (arm === "east") return "west";
  if (arm === "north") return "south";
  return "north";
}

/**
 * An end meets an end, or an end meets the middle of a double's long side.
 * Two long sides never lie against each other.
 */
function assertEndToEnd(board: BoardState, layout: BoardLayout, label: string): void {
  const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
  const center = board.center ? byId.get(board.center.tileId) : undefined;
  const onAxis = (host: LayoutBox, point: { x: number; y: number }) => {
    if (host.h >= host.w) return Math.abs(point.x - (host.x + host.w / 2)) < 1.5;
    return Math.abs(point.y - (host.y + host.h / 2)) < 1.5;
  };
  const longAxis = (box: LayoutBox) => (box.w > box.h ? "y" : "x");
  const centerOf = (box: LayoutBox) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  for (const arm of ARM_IDS) {
    const chain = board.arms[arm];
    for (let index = 0; index < chain.length; index += 1) {
      const tile = chain[index]!;
      const placed = byId.get(tile.tileId);
      const parent = index === 0 ? center : byId.get(chain[index - 1]!.tileId);
      expect(placed && parent, `${label} ${tile.tileId}`).toBeTruthy();
      if (!placed || !parent) continue;
      const join = sharedEdge(parent, placed);
      expect(Math.abs(join.gap - TILE_GAP), `${label} ${parent.tileId}>${tile.tileId} gap ${join.gap}`).toBeLessThan(0.5);
      expect(join.along, `${label} ${parent.tileId}>${tile.tileId} along ${join.along}`).toBeGreaterThanOrEqual(TILE_SHORT * 0.45);
      const gapX = Math.max(parent.x - (placed.x + placed.w), placed.x - (parent.x + parent.w), 0);
      const gapY = Math.max(parent.y - (placed.y + placed.h), placed.y - (parent.y + parent.h), 0);
      const joinAxis = gapY === 0 && gapX > 0 ? "x" : gapX === 0 && gapY > 0 ? "y" : "none";
      const parentDouble = index > 0 && chain[index - 1]!.low === chain[index - 1]!.high;
      const tileDouble = tile.low === tile.high;
      if (tileDouble) expect(onAxis(parent, centerOf(placed)), `${label} ${tile.tileId} off ${parent.tileId}`).toBe(true);
      if (parentDouble) expect(onAxis(placed, centerOf(parent)), `${label} ${parent.tileId} off ${tile.tileId}`).toBe(true);
      if (!parentDouble && !tileDouble && joinAxis === longAxis(parent) && joinAxis === longAxis(placed)) {
        throw new Error(`${label} ${parent.tileId}>${tile.tileId} side to side`);
      }
    }
  }
}

/** West left, north up, east right, south down. Corners are a single tile. */
function assertRegionSnake(board: BoardState, layout: BoardLayout, label: string): void {
  const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
  const spine = TILE_LONG / 2;
  for (const arm of ARM_IDS) {
    const shift = shiftOf(arm);
    let cornerRun = 0;
    const chain = board.arms[arm];
    for (let index = 0; index < chain.length; index += 1) {
      const tile = chain[index]!;
      const placed = byId.get(tile.tileId);
      expect(placed, `${label} ${tile.tileId}`).toBeTruthy();
      if (!placed) continue;
      const cx = placed.x + placed.w / 2;
      const cy = placed.y + placed.h / 2;
      if (arm === "west") {
        expect(placed.x + placed.w, `${label} west ${tile.tileId}`).toBeLessThanOrEqual(TILE_GAP);
        if (placed.direction === "east") expect(cy, `${label} west return`).toBeLessThan(-spine + TILE_SHORT);
        if (placed.direction === "north" || placed.direction === "south" || placed.direction === "east") {
          expect(cx, `${label} west lane ${tile.tileId}`).toBeLessThan(-TILE_LONG / 2);
        }
      } else if (arm === "east") {
        expect(placed.x, `${label} east ${tile.tileId}`).toBeGreaterThanOrEqual(-TILE_GAP);
        if (placed.direction === "north" || placed.direction === "south" || placed.direction === "west") {
          expect(cx, `${label} east lane ${tile.tileId}`).toBeGreaterThan(TILE_LONG / 2);
        }
      } else if (arm === "north") {
        expect(placed.y + placed.h, `${label} north ${tile.tileId}`).toBeLessThanOrEqual(TILE_GAP);
        if (placed.direction === "south") expect(cx, `${label} north return`).toBeGreaterThan(spine - TILE_SHORT);
        expect(placed.direction, `${label} north turn`).not.toBe("west");
      } else {
        expect(placed.y, `${label} south ${tile.tileId}`).toBeGreaterThanOrEqual(-TILE_GAP);
        if (placed.direction === "north") expect(cx, `${label} south return`).toBeLessThan(-spine + TILE_SHORT);
        expect(placed.direction, `${label} south turn`).not.toBe("east");
      }
      if (tile.low === tile.high) {
        const crosswise = placed.direction === "east" || placed.direction === "west" ? placed.h > placed.w : placed.w > placed.h;
        expect(crosswise, `${label} ${tile.tileId} crosswise`).toBe(true);
        const prev = index > 0 ? byId.get(chain[index - 1]!.tileId) : undefined;
        if (prev && prev.direction === placed.direction) {
          const horizontal = placed.direction === "east" || placed.direction === "west";
          const center = horizontal ? placed.y + placed.h / 2 : placed.x + placed.w / 2;
          const prevCenter = horizontal ? prev.y + prev.h / 2 : prev.x + prev.w / 2;
          expect(center, `${label} ${tile.tileId} centred`).toBeCloseTo(prevCenter, 5);
        }
      }
      const previous = index > 0 ? byId.get(chain[index - 1]!.tileId) : undefined;
      const colinear = previous
        && previous.direction === placed.direction
        && (placed.w > placed.h
          ? Math.abs(previous.y + previous.h / 2 - (placed.y + placed.h / 2)) < 1.5
          : Math.abs(previous.x + previous.w / 2 - (placed.x + placed.w / 2)) < 1.5);
      if (tile.low === tile.high || colinear) {
        // A double on the corner, or the straight run off it, is not a second corner.
        if (tile.low === tile.high) cornerRun = 0;
      } else if (placed.direction === shift) {
        cornerRun += 1;
        expect(cornerRun, `${label} ${arm} stacked corners`).toBe(1);
      } else {
        cornerRun = 0;
      }
      if (index === 0) continue;
      const parent = byId.get(chain[index - 1]!.tileId)!;
      const edge = sharedEdge(parent, placed);
      expect(Math.abs(edge.gap - TILE_GAP), `${label} ${parent.tileId}>${tile.tileId}`).toBeLessThan(0.5);
      expect(edge.along, `${label} join ${tile.tileId}`).toBeGreaterThanOrEqual(TILE_SHORT * 0.45);
    }
  }
}

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
    const allowed = arm === "west"
      ? new Set(["west", "north", "south", "east"])
      : arm === "east"
        ? new Set(["east", "south", "north", "west"])
        : new Set([arm, shiftOf(arm), oppositeOf(arm)]);
    for (const dir of dirs) {
      expect(allowed.has(dir), `${label} ${arm} turned ${dir} in ${dirs.join(">")}`).toBe(true);
    }
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

/**
 * The half that carries `which` pips. West and north draw the outward pips
 * in `a` (left or top). East and south draw them in `b` (right or bottom).
 */
function halfBox(tile: PlacedTile, which: "outward" | "inward"): LayoutBox {
  const outwardAtStart = tile.direction === "west" || tile.direction === "north";
  const atStart = which === "outward" ? outwardAtStart : !outwardAtStart;
  const horizontal = tile.w >= tile.h;
  if (horizontal) {
    return {
      x: atStart ? tile.x : tile.x + tile.w - TILE_SHORT,
      y: tile.y,
      w: Math.min(TILE_SHORT, tile.w),
      h: tile.h,
    };
  }
  return {
    x: tile.x,
    y: atStart ? tile.y : tile.y + tile.h - TILE_SHORT,
    w: tile.w,
    h: Math.min(TILE_SHORT, tile.h),
  };
}

/**
 * A corner joins pip to pip. The follower's matching half sits on the
 * leader's matching half, flush with the open end. A corner centred on
 * the divider overlaps that half by only half a short side and fails.
 * Doubles stay crosswise and centred, so they are not corners.
 */
function assertCornerHalves(board: BoardState, layout: BoardLayout, label: string): number {
  const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
  let corners = 0;
  for (const arm of ARM_IDS) {
    const chain = board.arms[arm];
    for (let index = 1; index < chain.length; index += 1) {
      const tile = chain[index]!;
      const prev = chain[index - 1]!;
      if (tile.low === tile.high || prev.low === prev.high) continue;
      const follower = byId.get(tile.tileId);
      const leader = byId.get(prev.tileId);
      if (!follower || !leader) continue;
      if (!perpendicular(leader.direction, follower.direction)) continue;
      corners += 1;
      const leadHalf = halfBox(leader, "outward");
      const followHalf = halfBox(follower, "inward");
      const edge = sharedEdge(leadHalf, followHalf);
      const name = `${label} ${arm} ${leader.tileId}>${follower.tileId}`;
      expect(Math.abs(edge.gap - TILE_GAP), `${name} half gap ${edge.gap}`).toBeLessThan(0.5);
      expect(edge.along, `${name} half overlap ${edge.along}`).toBeGreaterThanOrEqual(TILE_SHORT - 0.5);
      const leaderPips = leader.direction === "west" || leader.direction === "north" ? leader.a : leader.b;
      const followerPips = follower.direction === "west" || follower.direction === "north" ? follower.b : follower.a;
      expect(followerPips, `${name} pips`).toBe(leaderPips);
      if (leader.direction === "west") expect(follower.x, `${name} flush`).toBeCloseTo(leader.x, 5);
      if (leader.direction === "east") expect(follower.x + follower.w, `${name} flush`).toBeCloseTo(leader.x + leader.w, 5);
      if (leader.direction === "north") expect(follower.y, `${name} flush`).toBeCloseTo(leader.y, 5);
      if (leader.direction === "south") expect(follower.y + follower.h, `${name} flush`).toBeCloseTo(leader.y + leader.h, 5);
    }
  }
  return corners;
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
      if (prevDouble && placed.direction === prevPlaced.direction) {
        expectJoinedToDouble(prevPlaced, placed, prevPlaced.direction, `${label} ${prev.tileId}`);
      }
      if (placed.direction !== prevPlaced.direction) {
        expect(perpendicular(prevPlaced.direction, placed.direction), `${label} ${prev.tileId}>${placed.tileId}`).toBe(true);
        if (prevDouble) {
          // The corner is the tile after the double, and it stays centred on it.
          expect(isDouble, `${label} bent on double ${placed.tileId}`).toBe(false);
          const horizontal = prevPlaced.direction === "east" || prevPlaced.direction === "west";
          if (horizontal) {
            expect(placed.x + placed.w / 2, `${label} ${prev.tileId}`).toBeCloseTo(prevPlaced.x + prevPlaced.w / 2, 5);
          } else {
            expect(placed.y + placed.h / 2, `${label} ${prev.tileId}`).toBeCloseTo(prevPlaced.y + prevPlaced.h / 2, 5);
          }
        }
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
    // The lane is still ahead and the next tile fits, so it stays on the stem, centred on the double.
    expect(after.direction).toBe("east");
    expect(after.y + after.h / 2).toBeCloseTo(double.y + double.h / 2, 5);
    expect(after.x - (double.x + double.w)).toBeCloseTo(TILE_GAP, 5);
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
    // The stem turns down the right lane. The double lies across that column.
    expect(corner.direction).toBe("south");
    expect(bentDouble.direction).toBe("south");
    expect(bentDouble.w).toBeGreaterThan(bentDouble.h);
    expect(follower.x + follower.w / 2).toBeCloseTo(bentDouble.x + bentDouble.w / 2, 5);
    assertLaidOut(bent, "double at a bend", true);
  });

  it("seats every corner on the matching half, on a phone and on a wide felt", () => {
    const empty = { center: null, arms: { west: [], east: [], north: [], south: [] }, spinnerOpen: false };
    let west = placeTile(empty, "lead", tileById("1-1"));
    west = placeTile(west, "west", tileById("1-6"));
    west = placeTile(west, "west", tileById("4-6"));
    const westLayout = layoutBoard(west, { width: 200, height: 640 });
    const stem = westLayout.tiles.find((tile) => tile.tileId === "1-6")!;
    const turn = westLayout.tiles.find((tile) => tile.tileId === "4-6")!;
    expect(stem.direction).toBe("west");
    expect(turn.direction).toBe("north");
    expect(stem.a).toBe(6);
    expect(turn.b).toBe(6);
    expect(turn.x).toBeCloseTo(stem.x, 5);
    expect(turn.x + turn.w).toBeCloseTo(stem.x + TILE_SHORT, 5);
    expect(stem.y - (turn.y + turn.h)).toBeCloseTo(TILE_GAP, 5);

    let east = placeTile(empty, "lead", tileById("2-2"));
    east = placeTile(east, "east", tileById("2-6"));
    east = placeTile(east, "east", tileById("4-6"));
    const eastLayout = layoutBoard(east, { width: 200, height: 640 });
    const eastStem = eastLayout.tiles.find((tile) => tile.tileId === "2-6")!;
    const eastTurn = eastLayout.tiles.find((tile) => tile.tileId === "4-6")!;
    expect(eastStem.direction).toBe("east");
    expect(eastTurn.direction).toBe("south");
    expect(eastStem.b).toBe(6);
    expect(eastTurn.a).toBe(6);
    expect(eastTurn.x + eastTurn.w).toBeCloseTo(eastStem.x + eastStem.w, 5);
    expect(eastTurn.x).toBeCloseTo(eastStem.x + eastStem.w - TILE_SHORT, 5);
    expect(eastTurn.y - (eastStem.y + eastStem.h)).toBeCloseTo(TILE_GAP, 5);

    const limits = [
      undefined,
      { width: 200, height: 640 },
      { width: 288, height: 672 },
      { width: 220, height: 640 },
      { width: 344, height: 720 },
      { width: 504, height: 428 },
      { width: 520, height: 440 },
      { width: 640, height: 400 },
    ] as const;
    let corners = 0;
    for (const players of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 6; seed += 1) {
          for (const board of playHand(players, mode, seed + 40)) {
            for (const limit of limits) {
              const layout = limit ? layoutBoard(board, limit) : layoutBoard(board);
              corners += assertCornerHalves(board, layout, `corner ${players} ${mode} ${seed}`);
              expect(layoutOverlaps(layout), `overlap ${players} ${mode} ${seed}`).toBe(false);
            }
          }
        }
      }
    }
    expect(corners).toBeGreaterThan(20);
  });

  it("runs a side arm out to its lane before the first turn when space allows", () => {
    const laneOf = (arm: "west" | "east", width: number) => {
      const half = width / 2;
      const sign = arm === "west" ? -1 : 1;
      const clear = half - TILE_LONG / 2;
      const inner = TILE_LONG / 2 + TILE_GAP + TILE_LONG / 2;
      return sign * Math.max(inner, clear);
    };
    const outerCenter = (tile: PlacedTile, arm: "west" | "east") =>
      arm === "east" ? tile.x + tile.w - TILE_SHORT / 2 : tile.x + TILE_SHORT / 2;
    const limits = [
      { width: PHONE_WIDTH, height: PHONE_HEIGHT },
      { width: 360, height: 780 },
      { width: 416, height: 900 },
    ];
    const outward = ["6-6", "5-6", "4-5", "3-4", "2-3", "1-2", "0-1", "0-2", "2-4", "4-6", "3-6", "1-3", "1-4", "0-4"].map((id) => tileById(id));
    for (const limit of limits) {
      for (const arm of ["west", "east"] as const) {
        const board = boardFromChain(outward, arm);
        const layout = layoutBoard(board, limit);
        const placed = board.arms[arm].map(
          (tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!,
        );
        const turn = placed.findIndex((tile, index) => index > 0 && tile.direction !== arm);
        expect(turn, `${arm} ${limit.width} turns`).toBeGreaterThan(0);
        const stem = placed[turn - 1]!;
        const lane = laneOf(arm, limit.width);
        const center = outerCenter(stem, arm);
        const laneDir = arm === "west" ? "north" : "south";
        expect(placed[turn]!.direction, `${arm} turns clockwise`).toBe(laneDir);
        // The corner sits on the stem's outer half, at the lane or one tile short of it
        // when the next tile's double would leave the felt.
        const shortfall = arm === "east" ? lane - center : center - lane;
        expect(Math.abs(shortfall), `${arm} ${limit.width} reaches ${center.toFixed(0)} vs lane ${lane.toFixed(0)}`).toBeLessThanOrEqual(TILE_LONG / 2 + TILE_GAP);
        expect(Math.abs(center), `${arm} leaves the centre line`).toBeGreaterThan(limit.width / 4);
        assertCornerHalves(board, layout, `${arm} lane ${limit.width}`);
        expect(layoutOverlaps(layout), `${arm} ${limit.width}`).toBe(false);
      }
    }
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
      const vertical = arm === "west" ? "north" : arm === "east" ? "south" : arm;
      expect(dirs.has(vertical), `${arm} runs its lane`).toBe(true);
      expect(dirs.has(oppositeOf(arm)), `${arm} curls back`).toBe(false);
      expect(dirs.size, arm).toBeGreaterThan(1);
      const reach = arm === "west" || arm === "north"
        ? Math.min(...placed.map((tile) => arm === "west" ? tile.x : tile.y))
        : Math.max(...placed.map((tile) => arm === "east" ? tile.x + tile.w : tile.y + tile.h));
      const edge = arm === "west" || arm === "north" ? -PHONE_WIDTH * 0.35 : PHONE_WIDTH * 0.35;
      if (arm === "west" || arm === "north") expect(reach, `${arm} reaches its edge`).toBeLessThan(edge);
      else expect(reach, `${arm} reaches its edge`).toBeGreaterThan(edge);
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
    // The up arm may come back down on the right. It does not cross to the left.
    expect(northDirs).not.toContain("west");
    expect(northDirs[0]).toBe("north");
    const westDirs = board.arms.west.map(
      (tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction,
    );
    expect(westDirs.filter((dir) => dir === "south").length).toBeGreaterThanOrEqual(0);
    expect(westDirs[0]).toBe("west");
    assertLaidOut(board, "up arm beside left arm", false);

    const north = layout.tiles.filter((tile) => tile.arm === "north");
    const west = layout.tiles.filter((tile) => tile.arm === "west");
    for (const tile of north) {
      if (tile.direction === "south") expect(tile.x + tile.w / 2, "north return").toBeGreaterThan(0);
    }
    for (const tile of west) {
      if (tile.direction === "south" || tile.direction === "north") {
        expect(tile.x + tile.w / 2, "west lane").toBeLessThan(-TILE_LONG / 2);
      }
    }
    for (const a of north) {
      for (const b of west) {
        expect(boxesOverlap(a, b), `${a.tileId} covers ${b.tileId}`).toBe(false);
      }
    }
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
          const bent = (["west", "east"] as const).filter((arm) => {
            const dirs = new Set(
              board.arms[arm].map((tile) => layout.tiles.find((item) => item.tileId === tile.tileId)!.direction),
            );
            return dirs.size > 1;
          });
          if (bent.length === 2) sawEveryArmBend = true;
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
    expect(five.direction).toBe("east");
    expect(twoFive.direction).toBe("east");
    expect(twoFive.orientation).toBe("horizontal");
    expect(twoFive.x - (five.x + five.w)).toBe(TILE_GAP);
    expect(twoFive.y + twoFive.h / 2).toBeCloseTo(five.y + five.h / 2, 5);
    expect(boxesOverlap(five, twoFive)).toBe(false);
    expect(boxesOverlap(spinner, layout.tiles.find((tile) => tile.tileId === "5-6")!)).toBe(false);
    assertLaidOut(board, "crosswise double", false);
  });

  it("fills most of the felt on a long hand at a readable size", () => {
    const phones = [
      // Felt at the target tile size, inset by one short side so a corner
      // past the straight run still lands on the felt.
      // A double centred on a corner sticks out by half a short side, so the
      // chain is a little wider than the straight snake. 28px still fills the felt.
      { name: "tall phone", limits: { width: 288, height: 672 }, felt: { w: 360, h: 744 }, safe: { w: 360, h: 744 }, tile: 23 },
      { name: "fold", limits: { width: 504, height: 428 }, felt: { w: 576, h: 500 }, safe: { w: 640, h: 556 }, tile: 28 },
    ];
    for (const phone of phones) {
      let best = 0;
      let bestTile = 0;
      for (let seed = 0; seed < 6; seed += 1) {
        for (const board of playHand(4, "draw_until", seed + 300)) {
          const count = ARM_IDS.reduce((sum, arm) => sum + board.arms[arm].length, board.center ? 1 : 0);
          if (count < 20) continue;
          const layout = layoutBoard(board, phone.limits);
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
          const spanW = maxX - minX;
          const spanH = maxY - minY;
          const cover = Math.max(spanW / phone.felt.w, spanH / phone.felt.h);
          const fit = Math.min(phone.safe.w / spanW, phone.safe.h / spanH);
          best = Math.max(best, cover);
          bestTile = Math.max(bestTile, fit * TILE_SHORT);
          expect(cover, `${phone.name} seed ${seed} covers ${cover.toFixed(2)}`).toBeGreaterThanOrEqual(0.6);
          expect(fit * TILE_SHORT, `${phone.name} seed ${seed} tile ${ (fit * TILE_SHORT).toFixed(1) }`).toBeGreaterThanOrEqual(phone.tile);
        }
      }
      expect(best, phone.name).toBeGreaterThanOrEqual(0.6);
      expect(bestTile, phone.name).toBeGreaterThanOrEqual(phone.tile);
    }
  });

  it("keeps each arm in its own region and doubles crosswise", () => {
    let checked = 0;
    for (const players of [2, 4] as const) {
      for (let seed = 0; seed < 8; seed += 1) {
        for (const board of playHand(players, "draw_until", seed + 300)) {
          const count = ARM_IDS.reduce((sum, arm) => sum + board.arms[arm].length, board.center ? 1 : 0);
          if (count < 16) continue;
          const layout = layoutBoard(board);
          assertRegionSnake(board, layout, `region ${players} ${seed}`);
          assertEndToEnd(board, layout, `join ${players} ${seed}`);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(4);
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
    // A long east arm runs down the right lane and stays on that side of the table.
    expect(dirs).toContain("south");
    expect(dirs[0]).toBe("east");
    const eastTiles = layout.tiles.filter((tile) => tile.arm === "east");
    for (const tile of eastTiles) {
      expect(tile.x + tile.w / 2, tile.tileId).toBeGreaterThan(-TILE_SHORT);
    }
  });

  it("never covers a tile, including on a narrow fold", () => {
    const limits = [undefined, { width: 220, height: 640 }, { width: 280, height: 500 }, { width: 344, height: 720 }] as const;
    let checked = 0;
    for (const players of [2, 3, 4] as const) {
      for (const mode of ["draw_one", "draw_until"] as const) {
        for (let seed = 0; seed < 6; seed += 1) {
          for (const board of playHand(players, mode, seed + 180)) {
            const count = ARM_IDS.reduce((sum, arm) => sum + board.arms[arm].length, board.center ? 1 : 0);
            if (count < 8) continue;
            for (const limit of limits) {
              const layout = limit ? layoutBoard(board, limit) : layoutBoard(board);
              checked += 1;
              expect(layoutOverlaps(layout), `${players} ${mode} seed ${seed} ${count} tiles`).toBe(false);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("turns each corner away from the spinner and keeps lanes apart", () => {
    const limits = [undefined, { width: 233, height: 666 }, { width: 520, height: 440 }] as const;
    const step = (dir: string) => ({
      x: dir === "east" ? 1 : dir === "west" ? -1 : 0,
      y: dir === "south" ? 1 : dir === "north" ? -1 : 0,
    });
    let corners = 0;
    for (const players of [2, 4] as const) {
      for (let seed = 0; seed < 6; seed += 1) {
        for (const board of playHand(players, "draw_until", seed + 300)) {
          const count = ARM_IDS.reduce((sum, arm) => sum + board.arms[arm].length, board.center ? 1 : 0);
          if (count < 12) continue;
          for (const limit of limits) {
            const layout = limit ? layoutBoard(board, limit) : layoutBoard(board);
            const byId = new Map(layout.tiles.map((tile) => [tile.tileId, tile]));
            const lanes: Array<{ arm: string; box: LayoutBox }> = [];
            for (const arm of ARM_IDS) {
              const chain = board.arms[arm];
              let minX = Infinity;
              let minY = Infinity;
              let maxX = -Infinity;
              let maxY = -Infinity;
              let laneTiles = 0;
              let seenLane = false;
              for (let index = 0; index < chain.length; index += 1) {
                const placed = byId.get(chain[index]!.tileId)!;
                const parent = index === 0 ? byId.get(board.center!.tileId)! : byId.get(chain[index - 1]!.tileId)!;
                if (placed.direction !== parent.direction || index === 0) {
                  const cx = parent.x + parent.w / 2;
                  const cy = parent.y + parent.h / 2;
                  const { x, y } = step(placed.direction);
                  const outward = cx * x + cy * y;
                  const halfW = (limit?.width ?? PHONE_WIDTH) / 2;
                  const halfH = (limit?.height ?? PHONE_HEIGHT) / 2;
                  const alongEdge = Math.abs(Math.abs(cx) - halfW) <= TILE_LONG || Math.abs(Math.abs(cy) - halfH) <= TILE_LONG;
                  expect(outward >= -TILE_SHORT || alongEdge, `${arm} ${placed.tileId} heads ${placed.direction}`).toBe(true);
                  if (index > 0 && placed.direction !== parent.direction) corners += 1;
                }
                const laneDir = arm === "west" || arm === "north" ? "north" : "south";
                if (arm === "west" || arm === "east") {
                  if (placed.direction === laneDir) seenLane = true;
                  if (!seenLane) continue;
                }
                laneTiles += 1;
                minX = Math.min(minX, placed.x);
                minY = Math.min(minY, placed.y);
                maxX = Math.max(maxX, placed.x + placed.w);
                maxY = Math.max(maxY, placed.y + placed.h);
              }
              if (laneTiles > 0) lanes.push({ arm, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } });
            }
            for (let i = 0; i < lanes.length; i += 1) {
              for (let j = i + 1; j < lanes.length; j += 1) {
                expect(
                  boxesOverlap(lanes[i]!.box, lanes[j]!.box),
                  `${lanes[i]!.arm} lane meets ${lanes[j]!.arm}`,
                ).toBe(false);
              }
            }
          }
        }
      }
    }
    expect(corners).toBeGreaterThan(4);
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
