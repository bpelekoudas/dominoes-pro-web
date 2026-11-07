import type { ArmId, BoardState, CenterTile, OrientedTile } from "./board.js";
import { ARM_IDS, openEnds } from "./board.js";

/**
 * Phone-portrait layout for a straight-domino board.
 *
 * Coordinates are design pixels. The spinner sits at the origin. Every
 * client uses this same function, so a hand looks the same on every phone.
 * The view stays centred on the spinner. A hand opens close up and eases
 * outward as the chain grows. It does not pan, and it does not zoom back in.
 *
 * Each arm owns one region and snakes inside it, the way a domino table
 * does. On a wide felt, west takes the left side and the top-left corner,
 * north the top and the top-right, east the right and the bottom-right,
 * south the bottom and the bottom-left. On a tall phone the same turn
 * direction is used, but the regions change: north keeps the centre column
 * above the spinner, south the centre column below it, and west and east
 * turn after one or two tiles and run the full height of the left and right
 * thirds. West runs up, east runs down, so they do not meet in one corner.
 *
 * An arm runs straight out from the spinner. When it meets the felt it
 * makes one corner, always the same way (west turns up, north turns
 * right, east turns down, south turns left). It does not turn back
 * toward the spinner. On a tall phone the side arms make that corner
 * only after at least two full tiles have gone straight out, then run
 * their third of the felt. A corner
 * is one ordinary tile. A double stays on the straight run, crosswise
 * and centred, and the tiles on either side meet it at its middle.
 */

export const TILE_SHORT = 36;
export const TILE_LONG = 72;
export const TILE_GAP = 2;
/** Clear space between different chains, and between separate runs of one chain. */
export const ARM_GAP = TILE_SHORT;
export const END_CAP = 44;
export const FIT_MARGIN = 14;

/**
 * Felt the bends try to stay inside. Tall, like the board on a 412×915
 * phone after the slim header and the hand.
 */
export const PHONE_WIDTH = 416;
export const PHONE_HEIGHT = 700;
/**
 * Longest straight run before the chain turns into open felt.
 * About the shorter phone side: 416 / (72 + 2) is a little over five tiles.
 */
export const STRAIGHT_CAP = 6;
/**
 * A double and the centred tile after it cannot turn, so a run of
 * double, tile, double, tile may pass the bend edge. It still has to
 * stay on the table. The view scales that wider picture down.
 */
export const HARD_WIDTH = 4000;
export const HARD_HEIGHT = 4000;

export type LayoutDir = ArmId;

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedTile extends LayoutBox {
  tileId: string;
  orientation: "horizontal" | "vertical";
  /** Pip in the left half, or the top half when the tile is vertical. */
  a: number;
  b: number;
  spinner: boolean;
  direction: LayoutDir;
  arm: ArmId | null;
}

export interface PlacedEnd extends LayoutBox {
  id: ArmId;
  match: number;
  scorePips: number;
}

export interface BoardLayout {
  tiles: PlacedTile[];
  ends: PlacedEnd[];
  /** Box the view scales. Every tile and end cap sits inside it. */
  fit: LayoutBox;
  /**
   * Where the next ordinary tile on an open arm would sit.
   * Not part of the fit, so a ghost slot does not shrink the chain.
   */
  previews: Partial<Record<ArmId, LayoutBox>>;
}

interface Occupant {
  box: LayoutBox;
  arm: ArmId | null;
  /** Kept open for the tile that has to follow a double. */
  reserved?: boolean;
}

interface Cursor {
  box: LayoutBox;
  dir: LayoutDir;
  prevDouble: boolean;
  bends: number;
  /** Tiles already placed in `dir`, including this one. */
  run: number;
}

/**
 * Design-pixel box the chain should turn to stay inside.
 * Omit it and the chain uses the phone felt. A narrow table passes a
 * smaller box so arms fold into open felt before the picture has to shrink
 * past a readable tile.
 */
export interface LayoutLimits {
  width: number;
  height: number;
  /**
   * Local boxes in the same design space as the tiles. An arm runs straight
   * toward the felt edge and turns when the next tile would enter one of
   * these. They do not shrink the felt rectangle.
   */
  obstacles?: readonly LayoutBox[];
}

const DEFAULT_LIMIT: LayoutLimits = { width: PHONE_WIDTH, height: PHONE_HEIGHT };
let activeLimit: LayoutLimits = DEFAULT_LIMIT;

function hitsObstacle(box: LayoutBox): boolean {
  const obstacles = activeLimit.obstacles;
  if (!obstacles || obstacles.length === 0) return false;
  for (const obstacle of obstacles) {
    if (boxesOverlap(box, obstacle)) return true;
  }
  return false;
}

function insideActive(box: LayoutBox): boolean {
  return insideRect(box, activeLimit.width, activeLimit.height);
}

function withLimit<T>(limit: LayoutLimits, run: () => T): T {
  const previous = activeLimit;
  activeLimit = limit;
  try {
    return run();
  } finally {
    activeLimit = previous;
  }
}

function usableLimit(limits?: LayoutLimits): LayoutLimits {
  if (!limits || !Number.isFinite(limits.width) || !Number.isFinite(limits.height) || limits.width < 72 || limits.height < 72) {
    return DEFAULT_LIMIT;
  }
  return limits;
}

export function layoutBoard(board: BoardState, limits?: LayoutLimits): BoardLayout {
  // The caller's rectangle is the felt at the current tile size. Arms run
  // out to that edge. If a tile would cover another, fold the same chain
  // into a smaller rectangle so the arms turn while there is still room.
  let width = usableLimit(limits).width;
  let height = usableLimit(limits).height;
  let last: BoardLayout | null = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const layout = withLimit({ width, height, obstacles: limits?.obstacles }, () => layoutBoardNow(board));
    if (!layoutOverlaps(layout)) return layout;
    const repaired = repairLayout(board, layout);
    if (repaired) return repaired;
    last = layout;
    const nextWidth = Math.max(TILE_LONG * 2, width * 0.78);
    const nextHeight = Math.max(TILE_LONG * 3, height * 0.78);
    if (nextWidth === width && nextHeight === height) break;
    width = nextWidth;
    height = nextHeight;
  }
  return rebalanceLayout(board, last!);
}

/** True when two faces share area. Touching edges do not count. */
export function layoutOverlaps(layout: BoardLayout): boolean {
  const tiles = layout.tiles;
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (boxesOverlap(tiles[i]!, tiles[j]!)) return true;
    }
  }
  return false;
}

interface SnakeCursor {
  box: LayoutBox;
  dir: LayoutDir;
  row: number;
  /** Across-axis centre of this row (y for west/east, x for north/south). */
  line: number;
  /** Tiles already placed in this row, including the latest. */
  run: number;
  /** The tile just placed is the corner. The next tile opens the next row. */
  opening: boolean;
  /** Full-length tiles already laid straight out from the spinner on this arm. */
  full: number;
  /** A double was just centred on the corner's end. The next tile runs back from its middle. */
  fromDouble: boolean;
  /** The run is continuing off that double, perpendicular to the arm's rows. */
  column: boolean;
}

/** A tall felt splits into a center column and two side lanes. A wide felt keeps the cross. */
function isPortrait(): boolean {
  // A fold opened flat is only a little taller than it is wide. It still
  // has a long vertical arm to fold. Landscape (wider than tall) keeps the
  // wide snake.
  return activeLimit.height >= activeLimit.width * 1.05;
}

function portraitSide(arm: ArmId): boolean {
  return isPortrait() && (arm === "west" || arm === "east");
}

/**
 * Inner edge of a side lane. The center column holds a crosswise double
 * plus a gap, so the lanes never touch the north or south arm.
 */
function laneInner(): number {
  // Clear of a crosswise double on the center column, plus a little felt.
  return TILE_LONG / 2 + TILE_SHORT / 2;
}

function shiftDir(arm: ArmId): LayoutDir {
  if (arm === "west") return "north";
  if (arm === "north") return "east";
  if (arm === "east") return "south";
  return "west";
}

function travelDir(arm: ArmId, row: number): LayoutDir {
  if (portraitSide(arm)) {
    if (row <= 0) return arm;
    const vertical = shiftDir(arm);
    return row % 2 === 1 ? vertical : opposite(vertical);
  }
  return row % 2 === 0 ? arm : opposite(arm);
}

function rowsHorizontal(arm: ArmId): boolean {
  return arm === "west" || arm === "east";
}

function isDoubleTile(tile: OrientedTile): boolean {
  return tile.low === tile.high;
}

function overlapsPlaced(box: LayoutBox, placed: readonly LayoutBox[]): boolean {
  return placed.some((other) => boxesOverlap(box, other));
}

/**
 * West stays left of the spinner. Its return rows stay in the top-left.
 * North stays above, and its return rows stay in the top-right. East stays
 * right, returns in the bottom-right. South stays below, returns in the
 * bottom-left. The outward row may lie on the spinner's axis.
 */
function inCenterColumn(box: LayoutBox): boolean {
  const half = laneInner();
  return box.x >= -half - 0.5 && box.x + box.w <= half + 0.5;
}

function inArmRegion(box: LayoutBox, arm: ArmId, row: number, center: LayoutBox): boolean {
  const midX = center.x + center.w / 2;
  const midY = center.y + center.h / 2;
  if (isPortrait()) {
    // West keeps the left third, east the right third. North and south keep
    // the centre column on the way out, then may fold back beside it.
    if (arm === "west") {
      if (row <= 0) return box.x + box.w <= center.x - TILE_GAP + 0.5;
      return box.x + box.w / 2 <= -TILE_LONG / 2 + 0.5;
    }
    if (arm === "east") {
      if (row <= 0) return box.x >= center.x + center.w + TILE_GAP - 0.5;
      return box.x + box.w / 2 >= TILE_LONG / 2 - 0.5;
    }
    if (arm === "north") {
      if (box.y + box.h > center.y - TILE_GAP + 0.5) return false;
      return row <= 0 ? inCenterColumn(box) : true;
    }
    if (box.y < center.y + center.h + TILE_GAP - 0.5) return false;
    return row <= 0 ? inCenterColumn(box) : true;
  }
  if (arm === "west") {
    if (box.x + box.w > center.x - TILE_GAP + 0.5) return false;
    if (row > 0 && box.y + box.h > midY - TILE_SHORT / 2 + 0.5) return false;
    return true;
  }
  if (arm === "east") {
    if (box.x < center.x + center.w + TILE_GAP - 0.5) return false;
    if (row > 0 && box.y < midY + TILE_SHORT / 2 - 0.5) return false;
    return true;
  }
  if (arm === "north") {
    if (box.y + box.h > center.y - TILE_GAP + 0.5) return false;
    if (row > 0 && box.x < midX + TILE_SHORT / 2 - 0.5) return false;
    return true;
  }
  if (box.y < center.y + center.h + TILE_GAP - 0.5) return false;
  if (row > 0 && box.x + box.w > midX - TILE_SHORT / 2 + 0.5) return false;
  return true;
}

/**
 * One ordinary tile, turned clockwise off the open end.
 * The new tile's matching half is flush with the leader's outer half.
 */
function placeCorner(prev: LayoutBox, arm: ArmId, row: number, from: LayoutDir): LayoutBox {
  if (portraitSide(arm) && row >= 1) {
    return bendBox(prev, travelDir(arm, row), arm, false);
  }
  return bendBox(prev, from, clockwise(from), false);
}

function acrossCenter(box: LayoutBox, arm: ArmId): number {
  return rowsHorizontal(arm) ? box.y + box.h / 2 : box.x + box.w / 2;
}

/** First tile of a row, centred on that row and butted against the corner. */
function placeOnRow(corner: LayoutBox, arm: ArmId, row: number, isDouble: boolean, line: number): LayoutBox {
  const dir = travelDir(arm, row);
  const { along, across } = extents(isDouble);
  const horizontal = dir === "east" || dir === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  if (dir === "east") return { x: corner.x + corner.w + TILE_GAP, y: line - h / 2, w, h };
  if (dir === "west") return { x: corner.x - TILE_GAP - w, y: line - h / 2, w, h };
  if (dir === "south") return { x: line - w / 2, y: corner.y + corner.h + TILE_GAP, w, h };
  return { x: line - w / 2, y: corner.y - TILE_GAP - h, w, h };
}

/**
 * The arm's half of the table. The outward row may touch the spinner.
 * Later rows and the corners that start them stay clear of a crosswise
 * double on the neighbouring arm, which reaches half a long side past centre.
 */
function staysOnSide(box: LayoutBox, arm: ArmId, center: LayoutBox, tight: boolean): boolean {
  const spine = TILE_LONG / 2 + TILE_GAP;
  if (isPortrait() && tight) {
    if (arm === "west") return box.x + box.w / 2 <= -TILE_LONG / 2 + 0.5;
    if (arm === "east") return box.x + box.w / 2 >= TILE_LONG / 2 - 0.5;
    if (arm === "north") return box.y + box.h <= -spine + 0.5;
    return box.y >= spine - 0.5;
  }
  if (arm === "west") {
    const edge = tight ? -spine : center.x - TILE_GAP;
    return box.x + box.w <= edge + 0.5;
  }
  if (arm === "east") {
    const edge = tight ? spine : center.x + center.w + TILE_GAP;
    return box.x >= edge - 0.5;
  }
  if (arm === "north") {
    const edge = tight ? -spine : center.y - TILE_GAP;
    return box.y + box.h <= edge + 0.5;
  }
  const edge = tight ? spine : center.y + center.h + TILE_GAP;
  return box.y >= edge - 0.5;
}

function runInside(box: LayoutBox, _dir: LayoutDir): boolean {
  return insideActive(box);
}

function straightFits(
  prev: LayoutBox,
  dir: LayoutDir,
  isDouble: boolean,
  upcoming: readonly OrientedTile[],
  arm: ArmId,
  row: number,
  line: number,
  run: number,
  center: LayoutBox,
  placed: readonly LayoutBox[],
): boolean {
  const box = straightBox(prev, dir, isDouble);
  const tight = row > 0;
  // On a tall phone the side stem is one or two tiles. Turn before the vertical
  // lane would sit so close to the felt edge that a crosswise double falls off.
  if (portraitSide(arm) && row === 0 && !isDouble) {
    const ahead = straightBox(prev, dir, false);
    // The vertical lane's crosswise double has to stay on the felt, so the
    // stem stops once another horizontal tile would push that double off.
    const outer = TILE_GAP + TILE_SHORT + TILE_LONG / 2;
    const doubleOuter = arm === "east" ? ahead.x + ahead.w + outer : ahead.x - outer;
    const half = activeLimit.width / 2;
    if (run >= 1 && Math.abs(doubleOuter) > half + 0.5) return false;
    const leavingDouble = (dir === "east" || dir === "west") ? prev.h > prev.w : prev.w > prev.h;
    if (run >= 2 && !leavingDouble) return false;
  }
  const centreIn = () => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return Math.abs(cx) <= activeLimit.width / 2 && Math.abs(cy) <= activeLimit.height / 2;
  };
  // The second stem tile may reach the side lane with its outer half past the edge.
  const inside = portraitSide(arm) && row === 0 ? centreIn() : runInside(box, dir);
  if (!staysOnSide(box, arm, center, tight) || overlapsPlaced(box, placed) || !inside) return false;
  if (!isDouble && !inArmRegion(box, arm, row, center)) return false;
  const next = upcoming[1];
  if (!isDouble && next && isDoubleTile(next)) {
    const doubled = straightBox(box, dir, true);
    const cx = doubled.x + doubled.w / 2;
    const cy = doubled.y + doubled.h / 2;
    const centreIn = Math.abs(cx) <= activeLimit.width / 2 && Math.abs(cy) <= activeLimit.height / 2;
    const doubleInside = portraitSide(arm) && row > 0 ? centreIn : runInside(doubled, dir);
    if (!staysOnSide(doubled, arm, center, tight) || overlapsPlaced(doubled, placed) || boxesOverlap(doubled, box) || !doubleInside) {
      return false;
    }
  }
  // A vertical lane runs to the felt edge. A snake along the edge is only a
  // tile or two, then it turns down the next column. The sideways corner is
  // not required to fit before the straight tile does. The stem checks above
  // already turn a side arm after one or two tiles.
  if (isPortrait() && !portraitSide(arm)) {
    const horizontal = dir === "east" || dir === "west";
    if (horizontal && !isDouble && run >= 1) return false;
    return true;
  }
  if (portraitSide(arm) && row === 0) return true;
  if (portraitSide(arm) && row > 0) {
    const horizontal = dir === "east" || dir === "west";
    const leavingDouble = horizontal ? prev.h > prev.w : prev.w > prev.h;
    if (horizontal && !isDouble && run >= 1 && !leavingDouble) return false;
    // The vertical lane runs until the tile itself leaves the felt. Turning
    // earlier is what hooked the west arm back into the centre column.
    return true;
  }
  if (!isDouble) {
    const corner = placeCorner(box, arm, row, dir);
    if (!staysOnSide(corner, arm, center, true) || overlapsPlaced(corner, placed) || boxesOverlap(corner, box)) return false;
  }
  return true;
}

interface StepResult {
  box: LayoutBox;
  dir: LayoutDir;
  row: number;
  line: number;
  run: number;
  opening: boolean;
  fromDouble: boolean;
  column: boolean;
}

/**
 * The straight run has met the felt. Turn along the edge and, a tile or two
 * later, back down the open column. West and north never turn west-ward into
 * each other; east and south never turn east-ward into each other.
 */
function portraitFold(
  cursor: SnakeCursor,
  arm: ArmId,
  center: LayoutBox,
  placed: readonly LayoutBox[],
): StepResult | null {
  if (!portraitSide(arm) || cursor.row === 0) return null;
  const from = cursor.dir;
  // A side lane snakes away from the centre column, never back into it.
  // West going up turns further left; east going down turns further right.
  const order: LayoutDir[] = portraitSide(arm) && (from === "north" || from === "south")
    ? [arm]
    : from === "north"
      ? ["east", "west"]
      : from === "south"
        ? ["west", "east"]
        : from === "east"
          ? ["south", "north"]
          : ["north", "south"];
  const holds = (box: LayoutBox) => {
    if (overlapsPlaced(box, placed) || boxesOverlap(box, cursor.box) || !insideActive(box)) return false;
    if (arm === "west") return box.x + box.w <= -laneInner() + 0.5;
    if (arm === "east") return box.x >= laneInner() - 0.5;
    if (arm === "north") return box.y + box.h <= center.y - TILE_GAP + 0.5;
    return box.y >= center.y + center.h + TILE_GAP - 0.5;
  };
  const turnBoxes = (to: LayoutDir): LayoutBox[] => [bendBox(cursor.box, from, to, false)];
  for (const to of order) {
    if (arm === "north" && to === "west") continue;
    if (arm === "south" && to === "east") continue;
    if (to === from || to === opposite(from)) continue;
    const box = turnBoxes(to).find(holds);
    if (!box) continue;
    const horizontal = to === "east" || to === "west";
    return {
      box,
      dir: to,
      row: cursor.row + 1,
      line: horizontal ? box.y + box.h / 2 : box.x + box.w / 2,
      run: 1,
      opening: false,
      fromDouble: false,
      column: false,
    };
  }
  return null;
}

/**
 * Where a side column sits so a crosswise double fits in that third and
 * stays clear of the centre double.
 */
function portraitLaneX(arm: ArmId): number {
  if (arm === "north" || arm === "south") return 0;
  const sign = arm === "west" ? -1 : 1;
  const half = activeLimit.width / 2;
  // 1/6 and 5/6, and also just inside the felt edge when the felt is wide
  // enough for the arm to keep going. Never closer than a double past the spinner.
  const sixth = activeLimit.width / 3;
  const nearEdge = half - TILE_SHORT;
  const inner = TILE_LONG / 2 + TILE_GAP + TILE_LONG / 2;
  return sign * Math.max(inner, sixth, nearEdge);
}

/** True when `dir` does not walk the tile back toward the spinner. */
function headsOut(box: LayoutBox, dir: LayoutDir): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = dir === "east" ? 1 : dir === "west" ? -1 : 0;
  const dy = dir === "south" ? 1 : dir === "north" ? -1 : 0;
  return cx * dx + cy * dy >= -TILE_SHORT;
}

function portraitOwns(box: LayoutBox, arm: ArmId): boolean {
  const edge = Math.abs(portraitLaneX("east")) - TILE_LONG / 2 - TILE_GAP;
  if (arm === "west") return box.x + box.w <= -TILE_LONG / 2 - TILE_GAP + 0.5;
  if (arm === "east") return box.x >= TILE_LONG / 2 + TILE_GAP - 0.5;
  return box.x >= -edge - 0.5 && box.x + box.w <= edge + 0.5;
}

/** Centre of the outer half, where the corner column will sit. */
function outerHalfCenter(box: LayoutBox, arm: "west" | "east"): number {
  return arm === "east" ? box.x + box.w - TILE_SHORT / 2 : box.x + TILE_SHORT / 2;
}

/** The stem has arrived when its corner would sit on the side lane. */
function stemReachedLane(box: LayoutBox, arm: "west" | "east"): boolean {
  const lane = portraitLaneX(arm);
  const center = outerHalfCenter(box, arm);
  return arm === "east" ? center >= lane - 0.5 : center <= lane + 0.5;
}

/**
 * A crosswise double on the corner of `stem` stays on the felt.
 * That is the badge clearance: the lane itself is already inset by half a long side.
 */
function columnDoubleFits(stem: LayoutBox, arm: "west" | "east"): boolean {
  const center = outerHalfCenter(stem, arm);
  const outer = arm === "east" ? center + TILE_LONG / 2 : center - TILE_LONG / 2;
  // Tiles step by a long side, so the column can land a few pixels past the
  // lane. Half a short side still clears the seat badges.
  return Math.abs(outer) <= activeLimit.width / 2 + TILE_LONG / 2 + TILE_SHORT;
}

/**
 * A long centre arm used to run off the felt in one line. The camera fits
 * that line into half the table, so the tiles shrink and the other half
 * stays empty. The arm now fills one column, steps into the open side, and
 * comes back, so the chain stays inside the felt at a readable size.
 * South steps west. North steps east. One tile makes each step.
 */
function centerColumnStep(
  tile: OrientedTile,
  cursor: SnakeCursor,
  arm: "north" | "south",
  upcoming: readonly OrientedTile[],
  placed: readonly LayoutBox[],
  fromCenter: boolean,
): StepResult {
  const double = isDoubleTile(tile);
  const outward: LayoutDir = arm;
  const back = opposite(outward);
  const side: LayoutDir = arm === "south" ? "west" : "east";
  const free = (box: LayoutBox) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const inSideStem = Math.abs(cy) < TILE_LONG + TILE_SHORT && Math.abs(cx) > TILE_LONG;
    return !overlapsPlaced(box, placed) && !boxesOverlap(box, cursor.box) && !inSideStem;
  };
  const park = (box: LayoutBox, dir: LayoutDir, row: number, run: number, line = cursor.line): StepResult => ({
    box,
    dir,
    row,
    line,
    run,
    opening: false,
    fromDouble: false,
    column: false,
  });
  if (fromCenter) {
    const box = straightBox(cursor.box, outward, double);
    return park(box, outward, 0, 1, 0);
  }
  const crossesHome = (box: LayoutBox) =>
    arm === "south" ? box.y < -TILE_GAP : box.y + box.h > TILE_GAP;
  const onColumn = cursor.dir === outward || cursor.dir === back;
  if (onColumn) {
    // A double stays on this column, crosswise and centred. It never makes the step.
    const aligned = (dir: LayoutDir, isDouble: boolean) => {
      const raw = straightBox(cursor.box, dir, isDouble);
      if (cursor.row === 0) return raw;
      return { ...raw, x: cursor.line - raw.w / 2 };
    };
    if (double) {
      const box = aligned(cursor.dir, true);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const intoStem = cursor.dir === back && Math.abs(cy) < TILE_LONG + TILE_SHORT && Math.abs(cx) > TILE_LONG;
      if (intoStem) {
        const away = aligned(outward, true);
        if (!overlapsPlaced(away, placed) && !boxesOverlap(away, cursor.box)) {
          return park(away, outward, cursor.row, cursor.run + 1);
        }
      }
      return park(box, cursor.dir, cursor.row, cursor.run + 1);
    }
    const next = aligned(cursor.dir, false);
    const follower = upcoming[1] && isDoubleTile(upcoming[1])
      ? { ...straightBox(next, cursor.dir, true), ...(cursor.row === 0 ? {} : { x: cursor.line - TILE_LONG / 2 }) }
      : null;
    const entersSide = (box: LayoutBox) => {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      return Math.abs(cy) < TILE_LONG + TILE_SHORT && Math.abs(cx) > TILE_LONG;
    };
    const leaving = cursor.dir === outward
      ? !insideActive(next) || !free(next)
      : crossesHome(next) || entersSide(next) || entersSide(straightBox(next, cursor.dir, false)) || !insideActive(next) || !free(next);
    const followerLeaves = follower != null && (cursor.dir === outward
      ? !insideActive(follower) || !free(follower)
      : crossesHome(follower) || !insideActive(follower) || !free(follower));
    if (!leaving && !followerLeaves && free(next) && insideActive(next)) {
      return park(next, cursor.dir, cursor.row, cursor.run + 1);
    }
    const turn = bendBox(cursor.box, cursor.dir, side, false);
    if (free(turn) && insideActive(turn)) return park(turn, side, cursor.row + 1, 1, turn.x + turn.w / 2);
    if (free(next)) return park(next, cursor.dir, cursor.row, cursor.run + 1);
    if (free(turn)) return park(turn, side, cursor.row + 1, 1, turn.x + turn.w / 2);
    for (const way of [outward, side, back] as const) {
      const alt = way === cursor.dir ? straightBox(cursor.box, way, false) : bendBox(cursor.box, cursor.dir, way, false);
      if (free(alt) || (!entersSide(alt) && !overlapsPlaced(alt, placed) && !boxesOverlap(alt, cursor.box))) {
        return park(alt, way, cursor.row + 1, 1, alt.x + alt.w / 2);
      }
    }
    if (entersSide(next)) {
      const aside = bendBox(cursor.box, cursor.dir, side, false);
      return park(aside, side, cursor.row + 1, 1, aside.x + aside.w / 2);
    }
    return park(next, cursor.dir, cursor.row, cursor.run + 1);
  }
  // A double on the step stays crosswise on that step. The ordinary tile opens the next column.
  if (double) {
    const box = straightBox(cursor.box, side, true);
    if (free(box)) return park(box, side, cursor.row, cursor.run + 1, box.y + box.h / 2);
  }
  const nextDir: LayoutDir = cursor.row % 2 === 1 ? back : outward;
  const box = bendBox(cursor.box, cursor.dir, nextDir, false);
  if (free(box) && insideActive(box)) return park(box, nextDir, cursor.row, 1, box.x + box.w / 2);
  const stuck = straightBox(cursor.box, side, double);
  if (free(stuck)) return park(stuck, side, cursor.row, cursor.run + 1);
  if (free(box)) return park(box, nextDir, cursor.row, 1, box.x + box.w / 2);
  for (const way of ["west", "east", "north", "south"] as const) {
    const alt = bendBox(cursor.box, cursor.dir, way, false);
    if (free(alt) && !boxesOverlap(alt, cursor.box)) return park(alt, way, cursor.row + 1, 1, alt.x + alt.w / 2);
  }
  return park(stuck, side, cursor.row, cursor.run + 1);
}

/**
 * Parallel runs stay far enough apart that a crosswise double on one
 * column does not touch the next column. Half a tile is the minimum air.
 */
const LANE_PITCH = TILE_LONG + TILE_SHORT / 2;

/** True when `box` is at least half a tile from every tile except the one it joins. */
function laneClear(box: LayoutBox, cursor: LayoutBox, placed: readonly LayoutBox[]): boolean {
  if (boxesOverlap(box, cursor)) return false;
  const air = TILE_SHORT / 2 - 0.5;
  return placed.every((other) => other === cursor || boxGap(box, other) >= air);
}

/**
 * A readable snake. The first column runs down the side the arm opened on.
 * It then crosses the open felt in a straight run long enough that the next
 * column sits on the other side of the spinner, with a clear lane between
 * them. The chain uses both halves, so a spinner-centred camera looks balanced.
 */
function sideLaneStep(
  tile: OrientedTile,
  cursor: SnakeCursor,
  arm: "west" | "east",
  upcoming: readonly OrientedTile[],
  placed: readonly LayoutBox[],
): StepResult {
  const double = isDoubleTile(tile);
  const laneDir: LayoutDir = arm === "west" ? "north" : "south";
  const back: LayoutDir = opposite(laneDir);
  const park = (box: LayoutBox, dir: LayoutDir, row: number, run: number, line: number): StepResult => ({
    box, dir, row, line, run, opening: false, fromDouble: false, column: false,
  });
  const blocksOtherStem = (box: LayoutBox) => {
    const cy = box.y + box.h / 2;
    if (Math.abs(cy) > TILE_LONG) return false;
    if (arm === "west") return box.x + box.w > TILE_GAP;
    return box.x < -TILE_GAP;
  };
  const separated = (box: LayoutBox) => !overlapsPlaced(box, placed) && laneClear(box, cursor.box, placed) && !blocksOtherStem(box);
  const hasExit = (box: LayoutBox) => (["north", "south", "east", "west"] as const).some((way) => {
    const step = straightBox(box, way, false);
    return !overlapsPlaced(step, placed) && !boxesOverlap(step, box) && !boxesOverlap(step, cursor.box);
  });
  const canContinue = (box: LayoutBox) => {
    const exits = (["north", "south", "east", "west"] as const)
      .map((way) => straightBox(box, way, false))
      .filter((step) => !overlapsPlaced(step, placed) && !boxesOverlap(step, box) && !boxesOverlap(step, cursor.box));
    if (exits.length >= 2) return true;
    return exits.some((step) => (["north", "south", "east", "west"] as const).some((way) => {
      const next = straightBox(step, way, false);
      return !overlapsPlaced(next, placed) && !boxesOverlap(next, step) && !boxesOverlap(next, box);
    }));
  };
  const onColumn = cursor.dir === laneDir || cursor.dir === back;
  const legalDouble = (item: LayoutBox) => !overlapsPlaced(item, placed)
    && !boxesOverlap(item, cursor.box)
    && !blocksOtherStem(item)
    && laneClear(item, cursor.box, placed);
  // A double stays on the run it is already on, centred. If that cell is
  // taken, turn only onto a side where the next tile also fits. The first
  // clear side can be a pocket, and the tile after the double is then drawn
  // through the column beside it.
  const successorFits = (step: LayoutBox, way: LayoutDir) => {
    if (!upcoming[1]) return canContinue(step);
    const next = straightBox(step, way, isDoubleTile(upcoming[1]));
    return !overlapsPlaced(next, placed) && !boxesOverlap(next, step) && !boxesOverlap(next, cursor.box);
  };
  if (double) {
    const raw = straightBox(cursor.box, cursor.dir, true);
    const box = onColumn ? { ...raw, x: cursor.line - raw.w / 2 } : raw;
    if (legalDouble(box) && successorFits(box, cursor.dir) && (upcoming.length > 1 || canContinue(box))) {
      return park(box, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
    }
    const clearDoubles = (["west", "east", "north", "south"] as const).flatMap((way) => {
      const step = way === cursor.dir ? box : straightBox(cursor.box, way, true);
      if (overlapsPlaced(step, placed) || boxesOverlap(step, cursor.box) || blocksOtherStem(step)) return [];
      const stepCx = step.x + step.w / 2;
      const pitched = way === cursor.dir || !onColumn || Math.abs(stepCx - cursor.line) >= LANE_PITCH - 0.5;
      return [{ step, way, pitched }];
    });
    const choice = clearDoubles.find((item) => item.pitched && successorFits(item.step, item.way) && canContinue(item.step))
      ?? clearDoubles.find((item) => successorFits(item.step, item.way))
      ?? clearDoubles[0];
    if (choice) {
      const same = choice.way === cursor.dir;
      return park(choice.step, choice.way, cursor.row + (same ? 0 : 1), same ? cursor.run + 1 : 1, same ? cursor.line : choice.step.x + choice.step.w / 2);
    }
    return park(box, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
  }
  const nextVertical: LayoutDir = cursor.row % 4 === 2 ? back : laneDir;

  if (onColumn) {
    const aligned = (dir: LayoutDir, isDouble: boolean) => {
      const raw = straightBox(cursor.box, dir, isDouble);
      return { ...raw, x: cursor.line - raw.w / 2 };
    };
    if (double) {
      const box = aligned(cursor.dir, true);
      if (separated(box)) return park(box, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
    } else {
      const next = aligned(cursor.dir, false);
      const follower = upcoming[1] && isDoubleTile(upcoming[1])
        ? { ...straightBox(next, cursor.dir, true), x: cursor.line - TILE_LONG / 2 }
        : null;
      const exitPast = (follow: LayoutBox, parent: LayoutBox) => (["north", "south", "east", "west"] as const).some((way) => {
        const step = straightBox(follow, way, false);
        return !overlapsPlaced(step, placed) && !boxesOverlap(step, follow) && !boxesOverlap(step, parent) && !boxesOverlap(step, cursor.box);
      });
      const followerOk = follower == null || (separated(follower) && exitPast(follower, next));
      const later = upcoming[2];
      const mid = upcoming[1] == null
        ? null
        : isDoubleTile(upcoming[1])
          ? { ...straightBox(next, cursor.dir, true), x: cursor.line - TILE_LONG / 2 }
          : straightBox(next, cursor.dir, false);
      const laterBox = later == null || mid == null
        ? null
        : isDoubleTile(later)
          ? { ...straightBox(mid, cursor.dir, true), x: cursor.line - TILE_LONG / 2 }
          : straightBox(mid, cursor.dir, false);
      const laterOk = laterBox == null || mid == null
        || (!overlapsPlaced(laterBox, placed) && !boxesOverlap(laterBox, mid) && exitPast(laterBox, mid));
      const halfH = activeLimit.height / 2;
      const withinHeight = next.y >= -halfH - 0.5 && next.y + next.h <= halfH + 0.5;
      // The corner may already sit on the badge line. The column keeps that
      // x and only has to stay inside the felt vertically.
      const sameColumn = Math.abs(next.x - cursor.box.x) < 1 && Math.abs(next.w - cursor.box.w) < 1;
      const roomy = separated(next) && followerOk && (insideActive(next) || (sameColumn && withinHeight));
      const after = straightBox(next, cursor.dir, false);
      const afterOk = separated(after) || (["west", "east"] as const).some((way) => separated(bendBox(next, cursor.dir, way, false)));
      const nextHasExit = (["north", "south", "east", "west"] as const).some((way) => {
        const step = straightBox(next, way, false);
        return !overlapsPlaced(step, placed) && !boxesOverlap(step, next) && !boxesOverlap(step, cursor.box);
      });
      // Run the column to the edge of the felt. A half-height cap turned
      // early and folded the arm into a maze.
      const keepRunning = roomy && afterOk && nextHasExit && laterOk;
      if (keepRunning) return park(next, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
      // Cross toward the emptier half. One tile starts the bridge.
      const cx = cursor.box.x + cursor.box.w / 2;
      const toward: LayoutDir = cx >= 0 ? "west" : "east";
      const away: LayoutDir = opposite(toward);
      const centreInside = (box: LayoutBox) => {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        return Math.abs(cx) <= activeLimit.width / 2 + 0.5 && Math.abs(cy) <= activeLimit.height / 2 + 0.5;
      };
      for (const way of [toward, away] as const) {
        const turn = bendBox(cursor.box, cursor.dir, way, false);
        const follow = upcoming[1] && isDoubleTile(upcoming[1]) ? straightBox(turn, way, true) : null;
        const followOk = follow == null
          || (!overlapsPlaced(follow, placed) && !boxesOverlap(follow, turn) && laneClear(follow, turn, placed) && !blocksOtherStem(follow));
        if (separated(turn) && centreInside(turn) && followOk && canContinue(turn)) return park(turn, way, cursor.row + 1, 1, cursor.line);
      }
      if (separated(next) && withinHeight && followerOk && laterOk) return park(next, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
    }
  } else {
    // Straight bridge. Open the next column only once it clears this one
    // by a full double plus half a tile, and sits across the spinner.
    if (!double) {
      const column = bendBox(cursor.box, cursor.dir, nextVertical, false);
      const columnCx = column.x + column.w / 2;
      const pitch = Math.abs(columnCx - cursor.line) >= LANE_PITCH - 0.5;
      const across = cursor.line >= 0 ? columnCx <= -TILE_SHORT : columnCx >= TILE_SHORT;
      const cursorCx = cursor.box.x + cursor.box.w / 2;
      const cursorCy = cursor.box.y + cursor.box.h / 2;
      const foreign = placed.some((box) => {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const near = Math.abs(cx - cursorCx) < TILE_LONG * 2 && Math.abs(cy - cursorCy) < TILE_LONG;
        if (near) return false;
        if (Math.abs(cy) < TILE_LONG && Math.abs(cx) < Math.abs(cursor.line)) return false;
        return Math.abs(cx - cursor.line) > TILE_LONG;
      });
      const sideOk = foreign
        ? (cursor.line >= 0 ? columnCx > TILE_SHORT : columnCx < -TILE_SHORT)
        : across;
      const mirror = -cursor.line;
      const further = straightBox(cursor.box, cursor.dir, false);
      const furtherCx = bendBox(further, cursor.dir, nextVertical, false).x + TILE_SHORT / 2;
      const closer = !foreign && Math.abs(furtherCx - mirror) + 1 < Math.abs(columnCx - mirror);
      const centreIn = (box: LayoutBox) => Math.abs(box.x + box.w / 2) <= activeLimit.width / 2 + 0.5
        && Math.abs(box.y + box.h / 2) <= activeLimit.height / 2 + 0.5;
      const canStep = separated(further) && centreIn(further) && cursor.run < 6;
      const tallEnough = upcoming.length >= 3 || cursor.run >= 4;
      if (!canStep || !closer) {
        const columnNext = straightBox(column, nextVertical, false);
        const columnCanGrow = separated(columnNext);
        if (cursor.run >= 2 && pitch && sideOk && tallEnough && separated(column) && centreIn(column) && columnCanGrow && canContinue(column)) {
          return park(column, nextVertical, cursor.row + 1, 1, columnCx);
        }
      }
    }
    const ahead = straightBox(cursor.box, cursor.dir, double);
    const aheadDouble = upcoming[1] && isDoubleTile(upcoming[1]) ? straightBox(ahead, cursor.dir, true) : null;
    const aheadDoubleOk = aheadDouble == null || (!overlapsPlaced(aheadDouble, placed) && !boxesOverlap(aheadDouble, ahead));
    if (separated(ahead) && aheadDoubleOk && (insideActive(ahead) || cursor.run < 3)) {
      return park(ahead, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
    }
    if (!double) {
      const column = bendBox(cursor.box, cursor.dir, nextVertical, false);
      const columnNext = straightBox(column, nextVertical, false);
      const pitched = Math.abs(column.x + column.w / 2 - cursor.line) >= LANE_PITCH - 0.5;
      const follow = upcoming[1] && isDoubleTile(upcoming[1]) ? straightBox(column, nextVertical, true) : null;
      const followOk = follow == null
        || (!overlapsPlaced(follow, placed) && !boxesOverlap(follow, column) && laneClear(follow, column, placed));
      const afterColumn = upcoming[2] ? straightBox(columnNext, nextVertical, isDoubleTile(upcoming[2])) : null;
      const columnFuture = afterColumn == null || (
        !overlapsPlaced(afterColumn, placed)
        && !boxesOverlap(afterColumn, columnNext)
        && (["north", "south", "east", "west"] as const).some((exit) => {
          const beyond = straightBox(afterColumn, exit, false);
          return !overlapsPlaced(beyond, placed) && !boxesOverlap(beyond, afterColumn) && !boxesOverlap(beyond, columnNext);
        })
      );
      if (pitched && separated(column) && separated(columnNext) && hasExit(column) && followOk && columnFuture) {
        return park(column, nextVertical, cursor.row + 1, 1, column.x + column.w / 2);
      }
    }
    if (separated(ahead)) return park(ahead, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
  }
  const fallback = straightBox(cursor.box, cursor.dir, double);
  // clearOf used to ignore the other arm's exit from the spinner. That arm
  // is drawn later, so a column could sit on its opening and the two tiles
  // covered each other.
  const clearOf = (box: LayoutBox) => !overlapsPlaced(box, placed) && !boxesOverlap(box, cursor.box) && !blocksOtherStem(box);
  const hasFuture = (box: LayoutBox, way: LayoutDir) => {
    if (upcoming.length <= 2) return true;
    const step = straightBox(box, way, isDoubleTile(upcoming[1]!));
    if (overlapsPlaced(step, placed) || boxesOverlap(step, box) || boxesOverlap(step, cursor.box)) return false;
    const after = upcoming[2];
    if (!after) return true;
    const afterBox = straightBox(step, way, isDoubleTile(after));
    if (overlapsPlaced(afterBox, placed) || boxesOverlap(afterBox, step) || boxesOverlap(afterBox, box)) return false;
    return (["north", "south", "east", "west"] as const).some((exit) => {
      const beyond = straightBox(afterBox, exit, false);
      return !overlapsPlaced(beyond, placed) && !boxesOverlap(beyond, afterBox) && !boxesOverlap(beyond, step) && !boxesOverlap(beyond, box);
    });
  };
  const followFits = (box: LayoutBox, way: LayoutDir) => {
    if (double || !upcoming[1] || !isDoubleTile(upcoming[1])) return true;
    const follow = straightBox(box, way, true);
    if (overlapsPlaced(follow, placed) || boxesOverlap(follow, box) || !laneClear(follow, box, placed) || blocksOtherStem(follow)) return false;
    return (["north", "south", "east", "west"] as const).some((exit) => {
      const step = straightBox(follow, exit, false);
      return !overlapsPlaced(step, placed) && !boxesOverlap(step, follow) && !boxesOverlap(step, box) && !boxesOverlap(step, cursor.box);
    });
  };
  const options: Array<{ box: LayoutBox; way: LayoutDir }> = [
    { box: fallback, way: cursor.dir },
    ...(["west", "east", "north", "south"] as const)
      .filter((way) => way !== cursor.dir)
      .map((way) => ({ box: bendBox(cursor.box, cursor.dir, way, double), way })),
  ];
  const straightFirst = clearOf(fallback) && canContinue(fallback) && followFits(fallback, cursor.dir) && hasFuture(fallback, cursor.dir)
    ? { box: fallback, way: cursor.dir }
    : undefined;
  const openOption = straightFirst
    ?? options.find((item) => separated(item.box) && canContinue(item.box) && followFits(item.box, item.way) && hasFuture(item.box, item.way) && successorFits(item.box, item.way))
    ?? options.find((item) => clearOf(item.box) && canContinue(item.box) && followFits(item.box, item.way) && hasFuture(item.box, item.way) && successorFits(item.box, item.way))
    ?? options.find((item) => clearOf(item.box) && followFits(item.box, item.way) && hasFuture(item.box, item.way) && successorFits(item.box, item.way))
    ?? options.find((item) => clearOf(item.box) && successorFits(item.box, item.way))
    ?? options.find((item) => clearOf(item.box) && canContinue(item.box) && hasFuture(item.box, item.way))
    ?? options.find((item) => clearOf(item.box) && item.way === cursor.dir)
    ?? options.find((item) => clearOf(item.box));
  if (openOption) {
    return park(openOption.box, openOption.way, cursor.row + (openOption.way === cursor.dir ? 0 : 1), 1, openOption.box.x + openOption.box.w / 2);
  }
  const uncovered = options.find((item) => clearOf(item.box));
  if (uncovered) {
    return park(uncovered.box, uncovered.way, cursor.row + (uncovered.way === cursor.dir ? 0 : 1), 1, uncovered.box.x + uncovered.box.w / 2);
  }
  return park(fallback, cursor.dir, cursor.row, cursor.run + 1, cursor.line);
}

/**
 * Tall felt. North and south run the centre column, then snake into the
 * open side instead of growing one line off the felt. West and east travel
 * out at least two tiles, then turn into a wide lane across the open felt.
 */
function portraitSnakeStep(
  tile: OrientedTile,
  cursor: SnakeCursor,
  arm: ArmId,
  _center: LayoutBox,
  upcoming: readonly OrientedTile[],
  placed: readonly LayoutBox[],
  fromCenter: boolean,
): StepResult {
  const double = isDoubleTile(tile);
  const laneDir: LayoutDir = arm === "west" || arm === "north" ? "north" : "south";
  const edgeDir: LayoutDir = arm === "west" || arm === "south" ? "west" : "east";
  const free = (box: LayoutBox) => !overlapsPlaced(box, placed) && !boxesOverlap(box, cursor.box);
  const kept = (dir: LayoutDir, row: number, run: number, line = cursor.line): StepResult => {
    const box = straightBox(cursor.box, dir, double);
    return { box, dir, row, line, run, opening: false, fromDouble: false, column: false };
  };

  if (fromCenter) {
    const box = straightBox(cursor.box, arm, double);
    return { box, dir: arm, row: 0, line: portraitLaneX(arm), run: 1, opening: false, fromDouble: false, column: false };
  }

  if (arm === "north" || arm === "south") {
    const side = arm === "south" ? "west" : "east";
    const sideTaken = placed.some((box) => {
      const cy = box.y + box.h / 2;
      if (Math.abs(cy) > TILE_LONG) return false;
      const cx = box.x + box.w / 2;
      if (Math.abs(cx - cursor.line) < TILE_LONG) return false;
      return side === "west" ? cx < -TILE_SHORT : cx > TILE_SHORT;
    });
    if (!sideTaken) {
      const snaked = centerColumnStep(tile, cursor, arm, upcoming, placed, fromCenter);
      const hits = overlapsPlaced(snaked.box, placed) || boxesOverlap(snaked.box, cursor.box);
      if (!hits) return snaked;
    }
  }

  if ((arm === "west" || arm === "east") && cursor.row === 0 && cursor.dir === arm) {
    // A double stays crosswise on the stem. It never makes the corner, and it
    // does not count as one of the two full tiles the arm has to lay first.
    const stem = straightBox(cursor.box, arm, double);
    const blocked = hitsObstacle(stem);
    if (double && !blocked) return kept(arm, 0, cursor.run + 1);
    // Run straight while the next tile still lands inside the felt. Turn at
    // the edge when that turn keeps a half-tile gap. Only run past the edge
    // when the turn itself would crowd another tile.
    const parentDouble = cursor.box.h > cursor.box.w;
    const corner = parentDouble ? straightBox(cursor.box, laneDir, false) : bendBox(cursor.box, arm, laneDir, false);
    const cornerOk = free(corner) && laneClear(corner, cursor.box, placed);
    // A badge, token, or side hand is not the felt edge. Turn before it,
    // the other way when the usual corner is itself blocked.
    if (!double && blocked) {
      const otherDir = opposite(laneDir);
      const other = parentDouble ? straightBox(cursor.box, otherDir, false) : bendBox(cursor.box, arm, otherDir, false);
      const otherOk = free(other) && laneClear(other, cursor.box, placed) && !hitsObstacle(other);
      const turn = cornerOk && !hitsObstacle(corner) ? { box: corner, dir: laneDir } : otherOk ? { box: other, dir: otherDir } : null;
      if (turn) {
        return {
          box: turn.box,
          dir: turn.dir,
          row: 1,
          line: turn.box.x + turn.box.w / 2,
          run: 1,
          opening: false,
          fromDouble: false,
          column: false,
        };
      }
    }
    if (!blocked && free(stem) && (insideActive(stem) || (cursor.full < 2 && !cornerOk))) return kept(arm, 0, cursor.run + 1);
    if (cornerOk && !hitsObstacle(corner)) {
      return {
        box: corner,
        dir: laneDir,
        row: 1,
        line: corner.x + corner.w / 2,
        run: 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
    if (!blocked && free(stem)) return kept(arm, 0, cursor.run + 1);
    return kept(arm, 0, cursor.run + 1);
  }

  if ((arm === "west" || arm === "east") && cursor.row >= 1) {
    return sideLaneStep(tile, cursor, arm, upcoming, placed);
  }

  const dir = cursor.dir;
  const straight = straightBox(cursor.box, dir, double);
  const follower = !double && upcoming[1] && isDoubleTile(upcoming[1]) ? straightBox(straight, dir, true) : null;
  const followerOk = !follower || (free(follower) && insideActive(follower) && portraitOwns(follower, arm));
  const onLine = free(straight) && portraitOwns(straight, arm) && headsOut(cursor.box, dir);
  if (double || (onLine && insideActive(straight) && followerOk)) return kept(dir, cursor.row, cursor.run + 1);

  // One corner at the far end of the lane. A double that merely hangs past
  // the side is not that end: turning there runs a tail across the felt.
  const turnedOnce = arm === "west" || arm === "east" ? cursor.row >= 2 : cursor.row >= 1;
  const halfH = activeLimit.height / 2;
  const halfW = activeLimit.width / 2;
  const pastEnd = dir === "north" ? straight.y < -halfH
    : dir === "south" ? straight.y + straight.h > halfH
    : dir === "west" ? straight.x < -halfW
    : straight.x + straight.w > halfW;
  if (!double && !turnedOnce && pastEnd && headsOut(cursor.box, edgeDir)) {
    const turn = bendBox(cursor.box, dir, edgeDir, false);
    if (free(turn) && insideActive(turn)) {
      return { box: turn, dir: edgeDir, row: cursor.row + 1, line: cursor.line, run: 1, opening: false, fromDouble: false, column: false };
    }
  }
  // The clockwise turn is one tile along the seat line. Another tile that
  // way would run across the felt and shrink the picture, so the rest of
  // the arm keeps going out, away from the spinner.
  if (turnedOnce && dir !== laneDir && !double) {
    const along = free(straight) && insideActive(straight) && portraitOwns(straight, arm) && headsOut(cursor.box, dir);
    if (along) return kept(dir, cursor.row, cursor.run + 1);
    const outward = bendBox(cursor.box, dir, laneDir, false);
    if (free(outward) && headsOut(cursor.box, laneDir)) {
      return { box: outward, dir: laneDir, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
  }
  if ((arm === "west" || arm === "east") && cursor.row >= 1 && (overlapsPlaced(straight, placed) || boxesOverlap(straight, cursor.box))) {
    const home = (box: LayoutBox) => arm === "east" ? box.x >= TILE_LONG / 2 - 0.5 : box.x + box.w <= -TILE_LONG / 2 + 0.5;
    for (const way of ["east", "west", "north", "south"] as const) {
      if (way === dir) continue;
      const step = bendBox(cursor.box, dir, way, double);
      if (!home(step) || overlapsPlaced(step, placed) || boxesOverlap(step, cursor.box)) continue;
      return { box: step, dir: way, row: cursor.row + 1, line: step.x + step.w / 2, run: 1, opening: false, fromDouble: false, column: false };
    }
  }
  if ((arm === "west" || arm === "east") && (overlapsPlaced(straight, placed) || boxesOverlap(straight, cursor.box))) {
    for (const way of [laneDir, edgeDir, opposite(laneDir), opposite(edgeDir)] as const) {
      const away = way === dir ? straight : bendBox(cursor.box, dir, way, double);
      if (overlapsPlaced(away, placed) || boxesOverlap(away, cursor.box)) continue;
      return { box: away, dir: way, row: cursor.row + (way === dir ? 0 : 1), line: away.x + away.w / 2, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
  }
  const parked = kept(dir, cursor.row, cursor.run + 1);
  const blocksStem = (box: LayoutBox) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return (arm === "north" || arm === "south") && Math.abs(cy) < TILE_LONG + TILE_SHORT && Math.abs(cx) > TILE_LONG;
  };
  if (!blocksStem(parked.box) && !overlapsPlaced(parked.box, placed) && !boxesOverlap(parked.box, cursor.box)) return parked;
  for (const way of ["north", "south", "east", "west"] as const) {
    const step = way === dir ? straightBox(cursor.box, way, double) : bendBox(cursor.box, dir, way, double);
    if (blocksStem(step) || overlapsPlaced(step, placed) || boxesOverlap(step, cursor.box)) continue;
    return { box: step, dir: way, row: cursor.row + 1, line: step.x + step.w / 2, run: 1, opening: false, fromDouble: false, column: false };
  }
  return parked;
}

function snakeStep(
  tile: OrientedTile,
  cursor: SnakeCursor,
  arm: ArmId,
  center: LayoutBox,
  upcoming: readonly OrientedTile[],
  placed: readonly LayoutBox[],
  fromCenter: boolean,
): StepResult {
  const foldSide = isPortrait() || arm === "west" || arm === "east";
  if (foldSide) return portraitSnakeStep(tile, cursor, arm, center, upcoming, placed, fromCenter);
  const double = isDoubleTile(tile);
  const clear = (box: LayoutBox, dir: LayoutDir, tight: boolean) =>
    !overlapsPlaced(box, placed)
    && !boxesOverlap(box, cursor.box)
    && staysOnSide(box, arm, center, tight)
    && runInside(box, dir)
    && (double || inArmRegion(box, arm, cursor.row, center));
  if (fromCenter) {
    const box = straightBox(cursor.box, arm, double);
    return { box, dir: arm, row: 0, line: acrossCenter(box, arm), run: 1, opening: false, fromDouble: false, column: false };
  }
  if (cursor.column) {
    const ahead = straightBox(cursor.box, cursor.dir, double);
    if (clear(ahead, cursor.dir, true)) {
      return { box: ahead, dir: cursor.dir, row: cursor.row, line: acrossCenter(ahead, arm), run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    const back = travelDir(arm, cursor.row);
    const home = bendBox(cursor.box, cursor.dir, back, false);
    const awayDir = opposite(back);
    const away = bendBox(cursor.box, cursor.dir, awayDir, false);
    const turned = clear(home, back, true) ? { box: home, dir: back } : clear(away, awayDir, true) ? { box: away, dir: awayDir } : null;
    if (turned) {
      const row = turned.dir === arm ? cursor.row - (cursor.row % 2) : cursor.row + (cursor.row % 2 === 0 ? 1 : 0);
      return {
        box: turned.box,
        dir: turned.dir,
        row,
        line: acrossCenter(turned.box, arm),
        run: 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
    // The column has met the felt. Step back onto the row when that stays in this arm.
    const along = straightBox(cursor.box, back, double);
    if (staysOnSide(along, arm, center, true) && !overlapsPlaced(along, placed) && !boxesOverlap(along, cursor.box)) {
      return { box: along, dir: back, row: cursor.row, line: acrossCenter(along, arm), run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    return { box: ahead, dir: cursor.dir, row: cursor.row, line: acrossCenter(ahead, arm), run: cursor.run + 1, opening: false, fromDouble: false, column: false };
  }
  if (cursor.fromDouble) {
    const back = travelDir(arm, cursor.row);
    const along = straightBox(cursor.box, back, double);
    // Run back on the new row when that stays in this arm. Otherwise keep
    // going off the double's far end so the tile does not cross the spine.
    if (clear(along, back, true)) {
      return { box: along, dir: back, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    const onward = straightBox(cursor.box, cursor.dir, double);
    if (clear(onward, cursor.dir, true)) {
      return {
        box: onward,
        dir: cursor.dir,
        row: cursor.row,
        line: acrossCenter(onward, arm),
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: true,
      };
    }
    // The way back would cross the spinner into another arm. Keep this arm's side.
    if (staysOnSide(onward, arm, center, true) && !overlapsPlaced(onward, placed)) {
      return {
        box: onward,
        dir: cursor.dir,
        row: cursor.row,
        line: acrossCenter(onward, arm),
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
    return { box: along, dir: back, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
  }
  if (cursor.opening && double) {
    // Crosswise, centred on the corner's end. The column meets the middle of the double.
    let anchor = cursor.box;
    if (portraitSide(arm) && cursor.row > 0) {
      anchor = { x: cursor.line - TILE_SHORT / 2, y: cursor.box.y, w: TILE_SHORT, h: cursor.box.h };
    }
    const box = straightBox(anchor, cursor.dir, true);
    return {
      box,
      dir: cursor.dir,
      row: cursor.row,
      line: portraitSide(arm) && cursor.row > 0 ? cursor.line : acrossCenter(box, arm),
      run: cursor.run + 1,
      opening: false,
      fromDouble: true,
      column: false,
    };
  }
  if (cursor.opening) {
    const dir = travelDir(arm, cursor.row);
    const box = placeOnRow(cursor.box, arm, cursor.row, false, cursor.line);
    if (staysOnSide(box, arm, center, true) && !overlapsPlaced(box, placed) && inArmRegion(box, arm, cursor.row, center)) {
      return { box, dir, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    const onward = straightBox(cursor.box, cursor.dir, false);
    return {
      box: onward,
      dir: cursor.dir,
      row: cursor.row,
      line: acrossCenter(onward, arm),
      run: cursor.run + 1,
      opening: false,
      fromDouble: false,
      column: false,
    };
  }
  const dir = cursor.dir;
  // Wide felts too: a side arm lays two full tiles before it may turn.
  if (
    !double
    && ((arm as ArmId) === "west" || (arm as ArmId) === "east")
    && cursor.row === 0
    && cursor.dir === arm
    && cursor.full < 2
  ) {
    const stem = straightBox(cursor.box, arm, false);
    if (!overlapsPlaced(stem, placed) && !boxesOverlap(stem, cursor.box) && insideActive(stem)) {
      return {
        box: stem,
        dir: arm,
        row: 0,
        line: acrossCenter(stem, arm),
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
  }
  // A double never makes the corner. It stays crosswise on this row.
  if (straightFits(cursor.box, dir, double, upcoming, arm, cursor.row, cursor.line, cursor.run, center, placed)) {
    const box = straightBox(cursor.box, dir, double);
    // A run in the turn direction moves the row. Keep the line on the tile just placed.
    const line = dir === shiftDir(arm) && !portraitSide(arm) ? acrossCenter(box, arm) : cursor.line;
    return { box, dir, row: cursor.row, line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
  }
  if (double) {
    // Still on this line, centred on the tile it follows. Never parked on its side.
    const box = straightBox(cursor.box, dir, true);
    const onSide = (candidate: LayoutBox, tight: boolean) =>
      staysOnSide(candidate, arm, center, tight) && !overlapsPlaced(candidate, placed) && !boxesOverlap(candidate, cursor.box);
    if (onSide(box, cursor.row > 0) && (!isPortrait() || runInside(box, dir))) {
      const line = dir === shiftDir(arm) && !portraitSide(arm) ? acrossCenter(box, arm) : cursor.line;
      return { box, dir, row: cursor.row, line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    const cap = straightBox(cursor.box, shiftDir(arm), true);
    if (!isPortrait() && !overlapsPlaced(cap, placed) && !boxesOverlap(cap, cursor.box) && (onSide(cap, true) || staysOnSide(cap, arm, center, true))) {
      return {
        box: cap,
        dir: shiftDir(arm),
        row: cursor.row,
        line: acrossCenter(cap, arm),
        run: cursor.run + 1,
        opening: false,
        fromDouble: true,
        column: false,
      };
    }
    // A double stays on the tile's axis, even when that hangs off the felt.
    // Parking it to one side is the 56px miss and the overlapping return.
    return { box, dir, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
  }
  if (dir !== travelDir(arm, cursor.row) && !isPortrait()) {
    // Already on the turn. Another corner here would sit against the long side.
    const stuck = straightBox(cursor.box, dir, false);
    return { box: stuck, dir, row: cursor.row, line: acrossCenter(stuck, arm), run: cursor.run + 1, opening: false, fromDouble: false, column: false };
  }
  const onDouble = (dir === "east" || dir === "west") ? cursor.box.h > cursor.box.w : cursor.box.w > cursor.box.h;
  const centreInside = (box: LayoutBox) => {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return Math.abs(cx) <= activeLimit.width / 2 + 0.5 && Math.abs(cy) <= activeLimit.height / 2 + 0.5;
  };
  // A double at the edge of a tall felt. Leave across its middle, back down
  // the open side, instead of carrying the line off the table.
  if (onDouble && isPortrait() && !runInside(straightBox(cursor.box, dir, false), dir)) {
    const back: LayoutDir = portraitSide(arm) ? shiftDir(arm) : arm;
    const turned = straightBox(cursor.box, back, false);
    const clearTurn = !overlapsPlaced(turned, placed) && !boxesOverlap(turned, cursor.box) && centreInside(turned);
    if (clearTurn) {
      return {
        box: turned,
        dir: back,
        row: cursor.row,
        line: acrossCenter(turned, arm),
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
  }
  const centered = straightBox(cursor.box, shiftDir(arm), false);
  // In a vertical lane the turn direction is the lane itself, so leaving a double stays on that line.
  if (onDouble && shiftDir(arm) === dir) {
    const onSide = staysOnSide(centered, arm, center, cursor.row > 0)
      && !overlapsPlaced(centered, placed)
      && !boxesOverlap(centered, cursor.box);
    if (onSide && (runInside(centered, dir) || centreInside(centered))) {
      return {
        box: centered,
        dir,
        row: cursor.row,
        line: cursor.line,
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
  }
  const ended = placeCorner(cursor.box, arm, cursor.row, dir);
  // On a narrow felt the far end of the stem is past the edge. The lane then
  // starts at the near end, one double clear of the centre column.
  const near = portraitSide(arm) && cursor.row === 0 ? bendBox(cursor.box, dir, shiftDir(arm), false) : null;
  const inBand = (candidate: LayoutBox) => {
    if (!isPortrait()) return true;
    if (arm === "north" || arm === "south") return inCenterColumn(candidate);
    return inArmRegion(candidate, arm, cursor.row + 1, center);
  };
  const legal = (candidate: LayoutBox) =>
    staysOnSide(candidate, arm, center, true)
    && !overlapsPlaced(candidate, placed)
    && inBand(candidate)
    && runInside(candidate, arm);
  // Off a double, leave from its middle when that stays in the arm's side.
  // On a tall phone the center arms stay in their column instead of stepping into a side lane.
  const centreArm = arm === "north" || arm === "south";
  const onAxisBox = isPortrait()
    && onDouble
    && !overlapsPlaced(centered, placed)
    && !boxesOverlap(centered, cursor.box)
    && centreInside(centered)
    && !(centreArm && shiftDir(arm) !== dir && !inCenterColumn(centered));
  const chosen = onAxisBox ? centered : legal(ended) ? ended : near && legal(near) ? near : null;
  if (onAxisBox) {
    const turning = shiftDir(arm) !== dir;
    return {
      box: centered,
      dir: shiftDir(arm),
      row: turning && portraitSide(arm) ? cursor.row + 1 : cursor.row,
      line: portraitSide(arm) ? centered.x + centered.w / 2 : acrossCenter(centered, arm),
      run: turning ? 1 : cursor.run + 1,
      opening: false,
      fromDouble: false,
      column: false,
    };
  }
  if (!chosen && isPortrait()) {
    if (!onDouble) {
      const folded = portraitFold(cursor, arm, center, placed);
      if (folded) return folded;
    }
    // Stay on this line, on the same axis. Leaving the felt zooms out.
    // Turning toward the centre, or relabeling this step, is what overlapped.
    const stuck = straightBox(cursor.box, dir, false);
    if (!overlapsPlaced(stuck, placed) && !boxesOverlap(stuck, cursor.box)) {
      return { box: stuck, dir, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
    const rescue: LayoutDir[] = [arm, opposite(arm), shiftDir(arm), opposite(shiftDir(arm))];
    for (const way of rescue) {
      const alt = straightBox(cursor.box, way, false);
      if (overlapsPlaced(alt, placed) || boxesOverlap(alt, cursor.box)) continue;
      if (arm === "north" && alt.y + alt.h > center.y - TILE_GAP) continue;
      if (arm === "south" && alt.y < center.y + center.h + TILE_GAP) continue;
      if ((arm as ArmId) === "west" && alt.x + alt.w > -laneInner()) continue;
      if ((arm as ArmId) === "east" && alt.x < laneInner()) continue;
      return { box: alt, dir: way, row: cursor.row, line: acrossCenter(alt, arm), run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
  }
  const box = chosen ?? centered;
  const nextRow = cursor.row + 1;
  let nextDir = shiftDir(arm);
  let nextLine = acrossCenter(box, arm);
  // Continue in the clockwise turn. A return row is the hook back toward the spinner.
  let opening = false;
  if (portraitSide(arm)) {
    if (cursor.row === 0) {
      // The corner is the first tile of the vertical lane. The run continues straight up or down it.
      nextDir = shiftDir(arm);
      nextLine = box.x + box.w / 2;
      opening = false;
    } else {
      nextDir = arm;
      nextLine = (arm as ArmId) === "west" ? box.x + TILE_SHORT / 2 : box.x + box.w - TILE_SHORT / 2;
      opening = true;
    }
  } else if (isPortrait()) {
    // North and south stay in the centre column. A return row would run into a side lane.
    nextDir = arm;
    nextLine = acrossCenter(box, arm);
    opening = false;
  }
  if (isPortrait() && !runInside(box, nextDir)) {
    const straight = straightBox(cursor.box, dir, false);
    if (!overlapsPlaced(straight, placed) && !boxesOverlap(straight, cursor.box) && runInside(straight, dir)) {
      return {
        box: straight,
        dir,
        row: cursor.row,
        line: cursor.line,
        run: cursor.run + 1,
        opening: false,
        fromDouble: false,
        column: false,
      };
    }
  }
  if (isPortrait() && (overlapsPlaced(box, placed) || boxesOverlap(box, cursor.box))) {
    const straight = straightBox(cursor.box, dir, false);
    if (!overlapsPlaced(straight, placed) && !boxesOverlap(straight, cursor.box)) {
      return { box: straight, dir, row: cursor.row, line: cursor.line, run: cursor.run + 1, opening: false, fromDouble: false, column: false };
    }
  }
  return {
    box,
    dir: nextDir,
    row: nextRow,
    line: nextLine,
    run: 1,
    opening,
    fromDouble: false,
    column: false,
  };
}

const LAY_ORDER = ["north", "south", "west", "east"] as const;

function stepHits(box: LayoutBox, parent: LayoutBox, blockers: readonly LayoutBox[]): boolean {
  if (boxesOverlap(box, parent)) return true;
  return blockers.some((other) => boxesOverlap(box, other));
}

/** Across-axis centre. Vertical runs share an x; horizontal runs share a y. */
function axisLine(box: LayoutBox, dir: LayoutDir): number {
  return dir === "north" || dir === "south" ? box.x + box.w / 2 : box.y + box.h / 2;
}

/**
 * The cell the first tile of an arm needs, including an arm that has not
 * been drawn yet. Later tiles must not sit on it.
 */
function openingBox(center: LayoutBox, arm: ArmId, first: OrientedTile): LayoutBox {
  return straightBox(center, arm, isDoubleTile(first));
}

function candidateSteps(parent: LayoutBox, dir: LayoutDir, isDouble: boolean): Array<{ box: LayoutBox; way: LayoutDir }> {
  const ways: LayoutDir[] = [];
  const add = (way: LayoutDir) => {
    if (!ways.includes(way)) ways.push(way);
  };
  add(dir);
  add("north");
  add("south");
  add("east");
  add("west");
  const steps: Array<{ box: LayoutBox; way: LayoutDir }> = [];
  for (const way of ways) {
    const box = isDouble || way === dir ? straightBox(parent, way, isDouble) : bendBox(parent, dir, way, false);
    steps.push({ box, way });
    if (isDouble) continue;
    for (const delta of [-18, -12, -6, 6, 12, 18]) {
      const slid = way === "east" || way === "west" ? { ...box, y: box.y + delta } : { ...box, x: box.x + delta };
      const across = way === "east" || way === "west"
        ? Math.min(parent.y + parent.h, slid.y + slid.h) - Math.max(parent.y, slid.y)
        : Math.min(parent.x + parent.w, slid.x + slid.w) - Math.max(parent.x, slid.x);
      if (across >= TILE_SHORT * 0.45) steps.push({ box: slid, way });
    }
  }
  return steps;
}

/** Keep the proposed cell when it is free. Otherwise take the next join that is. */
function adopt(proposed: StepResult, step: { box: LayoutBox; way: LayoutDir }): StepResult {
  const turned = step.way !== proposed.dir;
  return {
    ...proposed,
    box: step.box,
    dir: step.way,
    row: proposed.row + (turned ? 1 : 0),
    run: turned ? 1 : Math.max(1, proposed.run),
    line: axisLine(step.box, step.way),
    opening: false,
    fromDouble: false,
  };
}

function clearStep(proposed: StepResult, parent: LayoutBox, isDouble: boolean, blockers: readonly LayoutBox[]): StepResult {
  if (!stepHits(proposed.box, parent, blockers)) return proposed;
  for (const step of candidateSteps(parent, proposed.dir, isDouble)) {
    if (stepHits(step.box, parent, blockers)) continue;
    return adopt(proposed, step);
  }
  return proposed;
}

/**
 * Place every tile again, joined to its parent, on a cell that does not
 * cover a tile or an opening another arm still needs. Used only when
 * folding tighter still left two faces on top of each other.
 */
function joinedTo(parent: LayoutBox, box: LayoutBox): boolean {
  const xOverlap = Math.min(parent.x + parent.w, box.x + box.w) - Math.max(parent.x, box.x);
  const yOverlap = Math.min(parent.y + parent.h, box.y + box.h) - Math.max(parent.y, box.y);
  const gapX = Math.max(parent.x - (box.x + box.w), box.x - (parent.x + parent.w), 0);
  const gapY = Math.max(parent.y - (box.y + box.h), box.y - (parent.y + parent.h), 0);
  if (gapY <= 0.5 && gapX > 0) return Math.abs(gapX - TILE_GAP) < 0.5 && yOverlap >= TILE_SHORT * 0.45;
  if (gapX <= 0.5 && gapY > 0) return Math.abs(gapY - TILE_GAP) < 0.5 && xOverlap >= TILE_SHORT * 0.45;
  return false;
}

/**
 * Keep the snake. Move only a tile that covers another one, onto the next
 * free join. Returns null when some tile has no free join left.
 */
function repairLayout(board: BoardState, snake: BoardLayout): BoardLayout | null {
  if (!board.center) return null;
  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const placed: LayoutBox[] = [center];
  const reserved = new Map<ArmId, LayoutBox>();
  for (const arm of LAY_ORDER) {
    const first = board.arms[arm][0];
    if (first) reserved.set(arm, openingBox(center, arm, first));
  }
  for (const arm of LAY_ORDER) {
    reserved.delete(arm);
    let parent: LayoutBox = center;
    let dir: LayoutDir = arm;
    let parentTile: OrientedTile | null = null;
    for (const tile of board.arms[arm]) {
      const drawn = snake.tiles.find((item) => item.tileId === tile.tileId);
      const double = isDoubleTile(tile);
      const blockers = () => [...placed, ...reserved.values()];
      const propose = (from: LayoutBox, fromDir: LayoutDir, isDouble: boolean, extra: LayoutBox | null) => {
        const blocked = extra ? [...blockers(), extra] : blockers();
        return clearStep(
          {
            box: straightBox(from, fromDir, isDouble),
            dir: fromDir,
            row: 0,
            line: axisLine(from, fromDir),
            run: 1,
            opening: false,
            fromDouble: false,
            column: false,
          },
          from,
          isDouble,
          blocked,
        );
      };
      let box: LayoutBox | null = drawn && joinedTo(parent, drawn) && !stepHits(drawn, parent, blockers()) ? drawn : null;
      let way: LayoutDir = drawn?.direction ?? dir;
      if (!box) {
        const stepped = propose(parent, drawn?.direction ?? dir, double, null);
        if (!stepHits(stepped.box, parent, blockers()) && joinedTo(parent, stepped.box)) {
          box = stepped.box;
          way = stepped.dir;
        }
      }
      // The parent is boxed in. Slide that one tile, then seat this one beside it.
      if (!box && parentTile && tiles.length >= 2) {
        const grand = tiles[tiles.length - 2]!;
        const held = tiles.pop()!;
        placed.pop();
        const parentDouble = isDoubleTile(parentTile);
        for (const option of candidateSteps(grand, held.direction, parentDouble)) {
          if (stepHits(option.box, grand, blockers()) || !joinedTo(grand, option.box)) continue;
          const child = propose(option.box, option.way, double, option.box);
          if (stepHits(child.box, option.box, [...blockers(), option.box]) || !joinedTo(option.box, child.box)) continue;
          const moved = toTile(parentTile, option.box, option.way, arm);
          tiles.push(moved);
          placed.push(moved);
          parent = moved;
          box = child.box;
          way = child.dir;
          break;
        }
        if (!box) {
          tiles.push(held);
          placed.push(held);
          return null;
        }
      }
      if (!box) return null;
      const laid = toTile(tile, box, way, arm);
      tiles.push(laid);
      placed.push(laid);
      parent = laid;
      dir = way;
      parentTile = tile;
    }
  }
  const ends = snake.ends.map((end) => ({ ...end }));
  const layout = { tiles, ends, fit: fitAround([...tiles, ...ends]), previews: snake.previews };
  return layoutOverlaps(layout) ? null : layout;
}

function rebalanceLayout(board: BoardState, failed: BoardLayout): BoardLayout {
  if (!board.center) return failed;
  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const placed: LayoutBox[] = [center];
  const reserved = new Map<ArmId, LayoutBox>();
  for (const arm of LAY_ORDER) {
    const first = board.arms[arm][0];
    if (first) reserved.set(arm, openingBox(center, arm, first));
  }
  const cursors = new Map<ArmId, SnakeCursor>();
  for (const arm of LAY_ORDER) {
    reserved.delete(arm);
    const chain = board.arms[arm];
    if (chain.length === 0) continue;
    let parent = center;
    let dir: LayoutDir = arm;
    let row = 0;
    let run = 0;
    for (const tile of chain) {
      const double = isDoubleTile(tile);
      const blockers = [...placed, ...reserved.values()];
      const proposed = clearStep(
        { box: straightBox(parent, dir, double), dir, row, line: axisLine(parent, dir), run, opening: false, fromDouble: false, column: false },
        parent,
        double,
        blockers,
      );
      const laid = toTile(tile, proposed.box, proposed.dir, arm);
      tiles.push(laid);
      placed.push(laid);
      dir = proposed.dir;
      row = proposed.row;
      run = proposed.run;
      parent = laid;
    }
    const last = tiles[tiles.length - 1]!;
    cursors.set(arm, {
      box: last,
      dir,
      row,
      line: axisLine(last, dir),
      run,
      opening: false,
      fromDouble: false,
      column: false,
      full: 0,
    });
  }
  if (layoutOverlaps({ tiles, ends: [], fit: center, previews: {} })) return failed;
  const ends: PlacedEnd[] = [];
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const cursor = cursors.get(end.id);
    const cap = cursor ? { ...cursor.box } : capOnCenter(center, end.id);
    ends.push({ ...cap, id: end.id, match: end.match, scorePips: end.scorePips });
  }
  return { tiles, ends, fit: fitAround([...tiles, ...ends]), previews: {} };
}

function layoutBoardNow(board: BoardState): BoardLayout {
  if (!board.center) {
    return { tiles: [], ends: [], fit: { x: -40, y: -40, w: 80, h: 80 }, previews: {} };
  }

  const center = centerBox(board.center);
  const tiles: PlacedTile[] = [centerTile(board.center, center)];
  const placed: LayoutBox[] = [center];
  const cursors = new Map<ArmId, SnakeCursor>();
  // Openings of arms not drawn yet. A column must not sit on one.
  const reserved = new Map<ArmId, LayoutBox>();
  for (const arm of LAY_ORDER) {
    const first = board.arms[arm][0];
    if (first) reserved.set(arm, openingBox(center, arm, first));
  }

  // Centre arms first, so a side snake can cross the open felt without
  // laying a bridge through a column that has not been placed yet.
  for (const arm of LAY_ORDER) {
    const chain = board.arms[arm];
    const first = chain[0];
    if (!first) continue;
    reserved.delete(arm);
    const blockers = () => [...placed, ...reserved.values()];
    const opening = clearStep(
      snakeStep(
        first,
        { box: center, dir: arm, row: 0, line: 0, run: 0, opening: false, fromDouble: false, column: false, full: 0 },
        arm,
        center,
        chain,
        placed,
        true,
      ),
      center,
      isDoubleTile(first),
      blockers(),
    );
    const laid = toTile(first, opening.box, opening.dir, arm);
    tiles.push(laid);
    placed.push(laid);
    let cursor: SnakeCursor = {
      box: laid,
      dir: opening.dir,
      row: opening.row,
      line: opening.line,
      run: opening.run,
      opening: opening.opening,
      fromDouble: opening.fromDouble,
      column: opening.column,
      full: opening.row === 0 && opening.dir === arm && !isDoubleTile(first) ? 1 : 0,
    };
    for (let index = 1; index < chain.length; index += 1) {
      const tile = chain[index]!;
      const choice = clearStep(
        snakeStep(tile, cursor, arm, center, chain.slice(index), placed, false),
        cursor.box,
        isDoubleTile(tile),
        blockers(),
      );
      const next = toTile(tile, choice.box, choice.dir, arm);
      tiles.push(next);
      placed.push(next);
      cursor = {
        box: next,
        dir: choice.dir,
        row: choice.row,
        line: choice.line,
        run: choice.run,
        opening: choice.opening,
        fromDouble: choice.fromDouble,
        column: choice.column,
        full: cursor.row === 0 && choice.row === 0 && choice.dir === arm && !isDoubleTile(tile)
          ? cursor.full + 1
          : cursor.full,
      };
    }
    cursors.set(arm, cursor);
  }

  const ends: PlacedEnd[] = [];
  for (const end of openEnds(board)) {
    if (end.id !== "west" && end.id !== "east" && end.id !== "north" && end.id !== "south") continue;
    const cursor = cursors.get(end.id);
    const cap = cursor ? { ...cursor.box } : capOnCenter(center, end.id);
    ends.push({ ...cap, id: end.id, match: end.match, scorePips: end.scorePips });
  }

  const previews: Partial<Record<ArmId, LayoutBox>> = {};
  for (const end of ends) {
    const cursor = cursors.get(end.id);
    if (!cursor) {
      previews[end.id] = straightBox(center, end.id, false);
      continue;
    }
    let preview = snakeStep(PREVIEW_TILE, cursor, end.id, center, [PREVIEW_TILE], placed, false).box;
    if (overlapsPlaced(preview, placed) || boxesOverlap(preview, cursor.box)) {
      for (const way of ["north", "south", "east", "west"] as const) {
        const step = way === cursor.dir ? straightBox(cursor.box, way, false) : bendBox(cursor.box, cursor.dir, way, false);
        if (overlapsPlaced(step, placed) || boxesOverlap(step, cursor.box)) continue;
        preview = step;
        break;
      }
    }
    previews[end.id] = preview;
  }

  return { tiles, ends, fit: fitAround([...tiles, ...ends]), previews };
}

/**
 * One tile of imbalance. The outward bend wins a tie. The other way
 * wins when it pulls the chain's box clearly closer to the spinner.
 */
const TURN_BIAS = 72;

/**
 * Go straight while the run is short and the next tile fits on the phone.
 * At the straight-run cap, or once the straight step leaves the felt, turn
 * into the side whose snake keeps the board larger on screen. A double,
 * and the tile centred on it, never bend.
 */
function chooseStep(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } {
  const isDouble = tile.low === tile.high;
  const lock = cursor.prevDouble || isDouble;
  const straight = straightBox(cursor.box, cursor.dir, isDouble);
  const keep = { box: straight, dir: cursor.dir, bends: cursor.bends };

  if (lock) return keep;

  const mustTurn = cursor.run >= STRAIGHT_CAP;
  const straightOk = fits(straight, home, occupants, centre, true, cursor.box)
    && roomForDouble(upcoming, cursor.dir, straight, home, occupants, centre, true);
  if (straightOk && !mustTurn) return keep;

  // The straight run has hit the cap. Turn into open felt, picking the
  // side whose snake leaves the bigger tile on screen. A blocked side
  // stays straight and the edge bend below can still fire.
  if (mustTurn) {
    const turned = bestOpenTurn(tile, upcoming, cursor, home, occupants, centre);
    if (turned) return { box: turned.box, dir: turned.dir, bends: turned.bends };
  }

  // First bend: clockwise, or the other way when that side is open.
  // Second bend: further outward, or back across the empty felt.
  // A third bend is not chosen here. The two-bend search assumes the
  // arm is still on its first corner, and a later turn is handled below.
  if (cursor.bends < 2) {
    const preferred: LayoutDir = cursor.dir === home ? clockwise(home) : home;
    const alternate = opposite(preferred);
    const secondBend = cursor.bends >= 1;
    let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
    for (const turn of [preferred, alternate]) {
      const pinwheel = turn === preferred;
      const choices = bendChoices(cursor.box, cursor.dir, turn, isDouble);
      for (let slide = 0; slide < choices.length; slide += 1) {
        const box = choices[slide]!;
        // The outward turn stays in the arm's quadrant. The turn toward
        // open felt may cross the midline, but not another chain.
        if (!fits(box, home, occupants, centre, true, cursor.box, pinwheel)) continue;
        if (secondBend && pinwheel && !pointsAway(box, turn)) continue;
        if (secondBend && !laneFitsDouble(turn, box, home, occupants, centre, pinwheel)) continue;
        if (!roomForDouble(upcoming, turn, box, home, occupants, centre, false, pinwheel)) continue;
        const score = projectedImbalance(box, turn, upcoming, occupants, centre)
          - (pinwheel ? TURN_BIAS : 0)
          + slide * 4;
        if (!best || score < best.score) best = { box, dir: turn, score };
      }
    }
    if (best) return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
  }

  // No open side. A clear straight step is allowed to leave the phone,
  // and the view scales down. Wrapping is only for a real collision.
  if (isClear(straight, occupants, centre, cursor.box) && runFits(upcoming, cursor.dir, straight, home, occupants, centre)) {
    return keep;
  }

  const escaped = escapeStep(tile, upcoming, cursor, home, occupants, centre);
  if (escaped) return escaped;
  // The rest of the arm may not fit, but this tile still needs an open square.
  // Dropping it on another face is what made a crowded hand look broken.
  const loose = looseStep(tile, cursor, home, occupants, centre);
  if (loose) return loose;
  const parked = nudgeClear(straight, cursor.dir, occupants, centre, cursor.box);
  return { box: parked, dir: cursor.dir, bends: cursor.bends };
}

/**
 * Any clear corner, without reserving the rest of the arm.
 * Used only after the planned bends have nowhere to go.
 */
function looseStep(
  tile: OrientedTile,
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  const isDouble = tile.low === tile.high;
  const turns = [...sideTurns(cursor.dir), opposite(cursor.dir)];
  for (const turn of turns) {
    const choices = bendCandidates(cursor.box, cursor.dir, turn, isDouble);
    for (const box of choices) {
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      return { box, dir: turn, bends: cursor.bends + 1 };
    }
  }
  return null;
}

/** Walk the tile out along the open directions until it misses every face. */
function nudgeClear(
  box: LayoutBox,
  dir: LayoutDir,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  prev: LayoutBox,
): LayoutBox {
  if (isClear(box, occupants, centre, prev)) return box;
  const step = TILE_SHORT + TILE_GAP;
  const ways: LayoutDir[] = [dir, ...sideTurns(dir), opposite(dir)];
  for (let distance = 1; distance <= 60; distance += 1) {
    for (const way of ways) {
      const moved = shiftBox(box, way, distance * step);
      if (isClear(moved, occupants, centre, prev)) return moved;
    }
  }
  return box;
}

function shiftBox(box: LayoutBox, dir: LayoutDir, distance: number): LayoutBox {
  if (dir === "east") return { ...box, x: box.x + distance };
  if (dir === "west") return { ...box, x: box.x - distance };
  if (dir === "south") return { ...box, y: box.y + distance };
  return { ...box, y: box.y - distance };
}

/**
 * Both perpendiculars, scored by the scale of the snake that would follow.
 * A near tie stays in the arm's quadrant so a short arm does not fold back
 * across a neighbour.
 */
function bestOpenTurn(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number; scale: number } | null {
  const isDouble = tile.low === tile.high;
  const options: Array<{ box: LayoutBox; dir: LayoutDir; scale: number; quadrant: boolean }> = [];
  for (const turn of sideTurns(cursor.dir)) {
    for (const box of bendChoices(cursor.box, cursor.dir, turn, isDouble)) {
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      if (!roomForDouble(upcoming, turn, box, home, occupants, centre, false, false)) continue;
      options.push({
        box,
        dir: turn,
        scale: snakeScale(box, turn, 1, upcoming, occupants, centre, home),
        quadrant: inQuadrant(box, home),
      });
      break;
    }
  }
  if (options.length === 0) return null;
  let picked = options[0]!;
  for (const option of options) {
    if (option.scale > picked.scale + 1e-6) picked = option;
  }
  const homeSide = options.find((option) => option.quadrant);
  if (homeSide && homeSide !== picked && homeSide.scale >= picked.scale * 0.96) picked = homeSide;
  return { box: picked.box, dir: picked.dir, bends: cursor.bends + 1, scale: picked.scale };
}

/** Scale of the board if the rest of the arm snakes from this tile, turning at the cap. */
function snakeScale(
  start: LayoutBox,
  dir: LayoutDir,
  initialRun: number,
  upcoming: readonly OrientedTile[],
  occupants: readonly Occupant[],
  centre: LayoutBox,
  home: ArmId,
): number {
  const owned: Occupant[] = occupants.map((item) => ({ ...item }));
  owned.push({ box: start, arm: home });
  let prev = start;
  let dirNow = dir;
  let run = initialRun;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const nextTile = upcoming[index]!;
    const nextDouble = nextTile.low === nextTile.high;
    const locked = prevDouble || nextDouble;
    let nextDir = dirNow;
    if (!locked && run >= STRAIGHT_CAP) nextDir = towardCenter(prev, dirNow);
    let box = nextDir === dirNow
      ? straightBox(prev, dirNow, nextDouble)
      : bendBox(prev, dirNow, nextDir, nextDouble);
    if (!isClear(box, owned, centre, prev)) {
      if (nextDir === dirNow) break;
      box = straightBox(prev, dirNow, nextDouble);
      nextDir = dirNow;
      if (!isClear(box, owned, centre, prev)) break;
    }
    owned.push({ box, arm: home });
    prev = box;
    run = nextDir === dirNow ? run + 1 : 1;
    dirNow = nextDir;
    prevDouble = nextDouble;
  }
  return layoutScale(owned.map((item) => item.box));
}

/** Perpendicular that heads back toward the spinner. */
function towardCenter(box: LayoutBox, dir: LayoutDir): LayoutDir {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [clockwiseTurn, other] = sideTurns(dir);
  const pull = (turn: LayoutDir) => {
    if (turn === "west") return cx;
    if (turn === "east") return -cx;
    if (turn === "north") return cy;
    return -cy;
  };
  const clockwisePull = pull(clockwiseTurn);
  const otherPull = pull(other);
  if (otherPull > clockwisePull) return other;
  return clockwiseTurn;
}

function layoutScale(boxes: readonly LayoutBox[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return Math.min(activeLimit.width / Math.max(1, maxX - minX), activeLimit.height / Math.max(1, maxY - minY));
}

/**
 * The straight step would land on another arm. Turn to either side,
 * including a third bend, and take the first clear spot. Leaving the
 * phone is cheaper than crossing a chain: the felt zooms out.
 */
function escapeStep(
  tile: OrientedTile,
  upcoming: readonly OrientedTile[],
  cursor: Cursor,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): { box: LayoutBox; dir: LayoutDir; bends: number } | null {
  const isDouble = tile.low === tile.high;
  const turns = sideTurns(cursor.dir);
  let best: { box: LayoutBox; dir: LayoutDir; score: number } | null = null;
  for (const turn of turns) {
    const choices = bendCandidates(cursor.box, cursor.dir, turn, isDouble);
    for (let slide = 0; slide < choices.length; slide += 1) {
      const box = choices[slide]!;
      if (!isClear(box, occupants, centre, cursor.box)) continue;
      if (!runFits(upcoming, turn, box, home, occupants, centre)) continue;
      const score = (insideActive(box) ? 0 : 80_000)
        + (inQuadrant(box, home) ? 0 : 8_000)
        + (pointsAway(box, turn) ? 0 : 2_000)
        + (turn === turns[0] ? 0 : 400)
        + slide * 4
        + projectedImbalance(box, turn, upcoming, occupants, centre);
      if (!best || score < best.score) best = { box, dir: turn, score };
    }
  }
  if (!best) return null;
  return { box: best.box, dir: best.dir, bends: cursor.bends + 1 };
}

/** A placement that touches its parent and misses every other tile. */
function isClear(
  box: LayoutBox,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  prev: LayoutBox,
): boolean {
  if (!insideHard(box)) return false;
  if (overlapsAny(box, placedBoxes(occupants))) return false;
  if (hitsHold(box, occupants)) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, prev)) continue;
    if (boxGap(box, other.box) < ARM_GAP) return false;
  }
  return true;
}

const PREVIEW_TILE: OrientedTile = { tileId: "preview", low: 0, high: 1, inward: 0, outward: 1 };

function holdAhead(arm: ArmId, cursor: Cursor, occupants: Occupant[], centre: LayoutBox): void {
  releaseHold(arm, occupants);
  if (cursor.prevDouble) {
    const follower = straightBox(cursor.box, cursor.dir, false);
    if (!isClear(follower, occupants, centre, cursor.box)) return;
    occupants.push({ box: follower, arm, reserved: true });
    const beyond: Cursor = { box: follower, dir: cursor.dir, prevDouble: false, bends: cursor.bends, run: cursor.run + 1 };
    const exit = chooseStep(PREVIEW_TILE, [PREVIEW_TILE], beyond, arm, occupants, centre).box;
    if (isClear(exit, occupants, centre, follower)) occupants.push({ box: exit, arm, reserved: true });
    return;
  }
  const exit = chooseStep(PREVIEW_TILE, [PREVIEW_TILE], cursor, arm, occupants, centre).box;
  if (isClear(exit, occupants, centre, cursor.box)) occupants.push({ box: exit, arm, reserved: true });
}

function releaseHold(arm: ArmId, occupants: Occupant[]): void {
  for (let index = occupants.length - 1; index >= 0; index -= 1) {
    const item = occupants[index]!;
    if (item.reserved && item.arm === arm) occupants.splice(index, 1);
  }
}

/**
 * Tiles that cannot turn (a double, and the tile centred on it) have to
 * fit straight ahead. A normal tile after that run can bend later.
 */
function runFits(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
): boolean {
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  let prev = box;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const next = upcoming[index]!;
    const nextDouble = next.low === next.high;
    if (!prevDouble && !nextDouble) return true;
    const nextBox = straightBox(prev, dir, nextDouble);
    if (!isClear(nextBox, owned, centre, prev)) return false;
    owned.push({ box: nextBox, arm: home });
    prev = nextBox;
    prevDouble = nextDouble;
  }
  if (prevDouble) {
    const follower = straightBox(prev, dir, false);
    if (!isClear(follower, owned, centre, prev)) return false;
    owned.push({ box: follower, arm: home });
    prev = follower;
  }
  if (upcoming[0]?.tileId === "preview") return true;
  return hasExit(prev, dir, owned, centre);
}

function sideTurns(dir: LayoutDir): [LayoutDir, LayoutDir] {
  const clock = clockwise(dir);
  return [clock, opposite(clock)];
}

/** The tile just placed still has a clear next step, straight or around a corner. */
function hasExit(box: LayoutBox, dir: LayoutDir, occupants: readonly Occupant[], centre: LayoutBox): boolean {
  const straight = straightBox(box, dir, false);
  if (isClear(straight, occupants, centre, box)) return true;
  for (const turn of sideTurns(dir)) {
    for (const candidate of bendCandidates(box, dir, turn, false)) {
      if (isClear(candidate, occupants, centre, box)) return true;
    }
  }
  return false;
}

/** How far the chain's box sits from the spinner after a short run this way. */
function projectedImbalance(
  start: LayoutBox,
  dir: LayoutDir,
  upcoming: readonly OrientedTile[],
  occupants: readonly Occupant[],
  centre: LayoutBox,
): number {
  const boxes: LayoutBox[] = occupants.map((item) => item.box);
  boxes.push(start);
  let prev = start;
  const limit = Math.min(upcoming.length, 7);
  for (let index = 1; index < limit; index += 1) {
    const nextTile = upcoming[index]!;
    const next = straightBox(prev, dir, nextTile.low === nextTile.high);
    if (!insideActive(next) || overlapsAny(next, boxes) || intersectsBox(next, centre)) break;
    let crowded = false;
    for (const other of boxes) {
      if (sameBox(other, prev)) continue;
      if (boxGap(next, other) < ARM_GAP) {
        crowded = true;
        break;
      }
    }
    if (crowded) break;
    boxes.push(next);
    prev = next;
  }
  return bboxImbalance(boxes);
}

function bboxImbalance(boxes: readonly LayoutBox[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return Math.abs((minX + maxX) / 2) + Math.abs((minY + maxY) / 2);
}

function bendChoices(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox[] {
  const all = bendCandidates(prev, from, to, isDouble);
  const picked = [all[0], all[Math.min(9, all.length - 1)], all[all.length - 1]];
  return picked.filter((box, index): box is LayoutBox => Boolean(box) && picked.findIndex((other) => other && other.x === box.x && other.y === box.y) === index);
}

/** The direction moves away from the spinner, not back toward its row or column. */
function pointsAway(box: LayoutBox, dir: LayoutDir): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (dir === "east") return cx >= 0;
  if (dir === "west") return cx <= 0;
  if (dir === "north") return cy <= 0;
  return cy >= 0;
}

function roomForDouble(
  upcoming: readonly OrientedTile[],
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  phone: boolean,
  quadrant = true,
): boolean {
  const owned: Occupant[] = [...occupants, { box, arm: home }];
  let prev = box;
  let prevDouble = upcoming[0]!.low === upcoming[0]!.high;
  for (let index = 1; index < upcoming.length; index += 1) {
    const next = upcoming[index]!;
    const nextDouble = next.low === next.high;
    if (!prevDouble && !nextDouble) return true;
    const nextBox = straightBox(prev, dir, nextDouble);
    if (!fits(nextBox, home, owned, centre, phone, prev, quadrant)) return false;
    owned.push({ box: nextBox, arm: home });
    prev = nextBox;
    prevDouble = nextDouble;
  }
  if (prevDouble) {
    const follower = straightBox(prev, dir, false);
    if (!fits(follower, home, owned, centre, phone, prev, quadrant)) return false;
    owned.push({ box: follower, arm: home });
    prev = follower;
  }
  if (upcoming[0]?.tileId === "preview") return true;
  return hasExit(prev, dir, owned, centre);
}

/**
 * A double centred on the line that leaves `box` must keep a full tile
 * of clearance. Used before a second bend, which runs parallel to the
 * arm's first leg.
 */
function laneFitsDouble(
  dir: LayoutDir,
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  quadrant = true,
): boolean {
  const doubleBox = straightBox(box, dir, true);
  if ((quadrant && !inQuadrant(doubleBox, home)) || !insideHard(doubleBox)) return false;
  if (overlapsAny(doubleBox, placedBoxes(occupants))) return false;
  if (hitsHold(doubleBox, occupants)) return false;
  if (intersectsBox(doubleBox, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, box)) continue;
    if (boxGap(doubleBox, other.box) < ARM_GAP) return false;
  }
  return true;
}

/** Tuck against the leading corner, then slide inward along that tile so a wider double still fits. */
function bendCandidates(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox[] {
  const base = bendBox(prev, from, to, isDouble);
  const { along, across } = extents(isDouble);
  const horizontal = to === "east" || to === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  const boxes = [base];
  const alongEdge = from === "east" || from === "west";
  const max = Math.max(0, (alongEdge ? prev.w : prev.h) - (alongEdge ? w : h));
  const step = inwardStep(from);
  for (let slide = 2; slide <= max; slide += 2) {
    boxes.push({ x: base.x + step.x * slide, y: base.y + step.y * slide, w, h });
  }
  return boxes;
}

function inwardStep(from: LayoutDir): { x: number; y: number } {
  if (from === "east") return { x: -1, y: 0 };
  if (from === "west") return { x: 1, y: 0 };
  if (from === "south") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function fits(
  box: LayoutBox,
  home: ArmId,
  occupants: readonly Occupant[],
  centre: LayoutBox,
  phone: boolean,
  prev: LayoutBox,
  quadrant = true,
): boolean {
  if (!insideHard(box) || (quadrant && !inQuadrant(box, home))) return false;
  if (phone && !insideActive(box)) return false;
  if (overlapsAny(box, placedBoxes(occupants))) return false;
  if (hitsHold(box, occupants)) return false;
  if (intersectsBox(box, centre)) return false;
  for (const other of occupants) {
    if (other.reserved || other.arm === null || sameBox(other.box, prev)) continue;
    if (boxGap(box, other.box) < ARM_GAP) return false;
  }
  return true;
}

function sameBox(a: LayoutBox, b: LayoutBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function extents(isDouble: boolean): { along: number; across: number } {
  return isDouble
    ? { along: TILE_SHORT, across: TILE_LONG }
    : { along: TILE_LONG, across: TILE_SHORT };
}

/** Continue in `dir`, centred on the previous tile. */
export function straightBox(prev: LayoutBox, dir: LayoutDir, isDouble: boolean): LayoutBox {
  const { along, across } = extents(isDouble);
  const cx = prev.x + prev.w / 2;
  const cy = prev.y + prev.h / 2;
  if (dir === "east") return { x: prev.x + prev.w + TILE_GAP, y: cy - across / 2, w: along, h: across };
  if (dir === "west") return { x: prev.x - TILE_GAP - along, y: cy - across / 2, w: along, h: across };
  if (dir === "south") return { x: cx - across / 2, y: prev.y + prev.h + TILE_GAP, w: across, h: along };
  return { x: cx - across / 2, y: prev.y - TILE_GAP - along, w: across, h: along };
}

/**
 * Turn onto `to`. The new tile stays against the leading end of the
 * previous tile and extends in the new direction, so a normal corner
 * does not step past the edge the chain just hit.
 */
export function bendBox(prev: LayoutBox, from: LayoutDir, to: LayoutDir, isDouble: boolean): LayoutBox {
  const { along, across } = extents(isDouble);
  const horizontal = to === "east" || to === "west";
  const w = horizontal ? along : across;
  const h = horizontal ? across : along;
  if (from === "east" && to === "south") return { x: prev.x + prev.w - w, y: prev.y + prev.h + TILE_GAP, w, h };
  if (from === "east" && to === "north") return { x: prev.x + prev.w - w, y: prev.y - TILE_GAP - h, w, h };
  if (from === "west" && to === "north") return { x: prev.x, y: prev.y - TILE_GAP - h, w, h };
  if (from === "west" && to === "south") return { x: prev.x, y: prev.y + prev.h + TILE_GAP, w, h };
  if (from === "south" && to === "west") return { x: prev.x - TILE_GAP - w, y: prev.y + prev.h - h, w, h };
  if (from === "south" && to === "east") return { x: prev.x + prev.w + TILE_GAP, y: prev.y + prev.h - h, w, h };
  if (from === "north" && to === "east") return { x: prev.x + prev.w + TILE_GAP, y: prev.y, w, h };
  if (from === "north" && to === "west") return { x: prev.x - TILE_GAP - w, y: prev.y, w, h };
  return straightBox(prev, to, isDouble);
}

/**
 * Clockwise corner for each arm, including the outgoing axis.
 * East keeps the bottom-right, south the bottom-left, west the top-left,
 * north the top-right. The four regions meet only on the axes.
 */
function inQuadrant(box: LayoutBox, home: ArmId): boolean {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (home === "east") return cx > 0 && cy >= 0;
  if (home === "south") return cx <= 0 && cy > 0;
  if (home === "west") return cx < 0 && cy <= 0;
  return cx >= 0 && cy < 0;
}

function centreRegion(center: LayoutBox): LayoutBox {
  const pad = TILE_SHORT;
  return { x: center.x - pad, y: center.y - pad, w: center.w + pad * 2, h: center.h + pad * 2 };
}

function capOnCenter(center: LayoutBox, dir: LayoutDir): LayoutBox {
  if (dir === "west") return { x: center.x, y: center.y, w: center.w / 2, h: center.h };
  if (dir === "east") return { x: center.x + center.w / 2, y: center.y, w: center.w / 2, h: center.h };
  if (dir === "north") return { x: center.x, y: center.y, w: center.w, h: center.h / 2 };
  return { x: center.x, y: center.y + center.h / 2, w: center.w, h: center.h / 2 };
}

function centerBox(center: CenterTile): LayoutBox {
  const spinner = center.low === center.high;
  const w = spinner ? TILE_SHORT : TILE_LONG;
  const h = spinner ? TILE_LONG : TILE_SHORT;
  return { x: -w / 2, y: -h / 2, w, h };
}

function centerTile(center: CenterTile, box: LayoutBox): PlacedTile {
  const spinner = center.low === center.high;
  return {
    ...box,
    tileId: center.tileId,
    orientation: spinner ? "vertical" : "horizontal",
    a: center.westValue,
    b: center.eastValue,
    spinner: center.isSpinner,
    direction: "east",
    arm: null,
  };
}

function toTile(tile: OrientedTile, box: LayoutBox, direction: LayoutDir, arm: ArmId): PlacedTile {
  const halves = direction === "east" || direction === "south"
    ? { a: tile.inward, b: tile.outward }
    : { a: tile.outward, b: tile.inward };
  return {
    ...box,
    tileId: tile.tileId,
    orientation: box.w >= box.h ? "horizontal" : "vertical",
    a: halves.a,
    b: halves.b,
    spinner: false,
    direction,
    arm,
  };
}

function clockwise(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "south";
  if (dir === "south") return "west";
  if (dir === "west") return "north";
  return "east";
}

function opposite(dir: LayoutDir): LayoutDir {
  if (dir === "east") return "west";
  if (dir === "west") return "east";
  if (dir === "north") return "south";
  return "north";
}

export function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5;
}

export function intersectsBox(a: LayoutBox, b: LayoutBox): boolean {
  return boxesOverlap(a, b);
}

/** Distance between two boxes. Zero when they overlap. Diagonal when they only meet at a corner. */
export function boxGap(a: LayoutBox, b: LayoutBox): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.hypot(dx, dy);
}

function overlapsAny(box: LayoutBox, others: readonly LayoutBox[]): boolean {
  return others.some((other) => boxesOverlap(box, other));
}

function placedBoxes(occupants: readonly Occupant[]): LayoutBox[] {
  return occupants.filter((item) => !item.reserved).map((item) => item.box);
}

/** A held follower cell may be taken only by that exact follower. */
function hitsHold(box: LayoutBox, occupants: readonly Occupant[]): boolean {
  for (const other of occupants) {
    if (!other.reserved || sameBox(other.box, box)) continue;
    if (boxesOverlap(box, other.box) || boxGap(box, other.box) < ARM_GAP) return true;
  }
  return false;
}

function fitAround(boxes: LayoutBox[]): LayoutBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return {
    x: minX - FIT_MARGIN,
    y: minY - FIT_MARGIN,
    w: maxX - minX + FIT_MARGIN * 2,
    h: maxY - minY + FIT_MARGIN * 2,
  };
}

export function insidePhone(box: LayoutBox): boolean {
  return insideRect(box, PHONE_WIDTH, PHONE_HEIGHT);
}

export function insideHard(box: LayoutBox): boolean {
  return insideRect(box, HARD_WIDTH, HARD_HEIGHT);
}

function insideRect(box: LayoutBox, width: number, height: number): boolean {
  return (
    box.x >= -width / 2 &&
    box.y >= -height / 2 &&
    box.x + box.w <= width / 2 &&
    box.y + box.h <= height / 2
  );
}
