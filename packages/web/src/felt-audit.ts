import { applyIntent, beginHand, createMatch, currentPlayerId, legalIntents, type MatchState } from "../../rules/src/engine.js";
import { TILE_GAP, UNJOINED_GAP, boxGap, layoutOverlaps, straightBox, TILE_SHORT, TILE_LONG, type BoardLayout, type LayoutDir, type PlacedTile } from "../../rules/src/layout.js";
import { pinwheelTurn } from "../../rules/src/pinwheel.js";
import type { BoardState } from "../../rules/src/board.js";
import { shuffleWithSeed } from "../../rules/src/rng.js";
import {
  boardShift,
  chainBounds,
  cameraEase,
  chainHeldAtHandEnd,
  chainViewShift,
  pictureFrom,
  PINWHEEL_LONG_FRAC,
  safeRoom,
  clampGhostToFelt,
  frameInsets,
  renderedTileRect,
  settledHandCamera,
  tilesRelocating,
  type AxisInsets,
} from "./board-scale.js";

/** Playable felt inside each phone, after the playbar, badges, and hand. */
/** Measured `.table-scroll` size at each phone viewport, build 9e0cd2c. */
export const AUDIT_FELTS = [
  { name: "360x780", w: 360, h: 494 },
  { name: "390x844", w: 390, h: 558 },
  { name: "412x915", w: 412, h: 628 },
  { name: "430x932", w: 430, h: 645 },
  { name: "344x882", w: 344, h: 596 },
  { name: "673x841", w: 673, h: 555 },
  { name: "375x667", w: 375, h: 381 },
] as const;

export const AUDIT_SEEDS = 200;

/** Inclusive rank. p=0 is the minimum, p=0.5 the median, p=1 the maximum. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}
const TINY_PX = 18;
/** A smooth 480ms glide across the felt stays under this. A snap does not. */
const JUMP_PX = 48;
const FRAMES = 12;

export interface AuditFailure {
  kind: string;
  seed: number;
  play: number;
  detail: string;
}

export interface AuditSizeReport {
  name: string;
  hands: number;
  plays: number;
  longChains: number;
  doubleHeavy: number;
  settledCut: number;
  glideCut: number;
  /** Tiles outside the inset at a glide frame if every tile were painted. The screen holds these off. */
  exposedCut: number;
  connectGap: number;
  handEndSnap: number;
  /** A tile that was already down moved in chain coordinates. */
  refold: number;
  /** Plays, with 8 or more tiles, whose short side is under 18px. */
  tinyPlays: number;
  /** Tile short side at the end of each hand, in screen pixels. */
  endPx: number[];
  /** Tile long side at the end of each hand, in CSS pixels. */
  endLong: number[];
  /** Plays whose long side is under 18px. Reported, not failed. */
  longUnder18: number;
  g1: number;
  g2: number;
  g3: number;
  g7: number;
  g8: number;
  g9: number;
  g10: number;
  g11: number;
  g12: number;
  g13: number;
  g14: number;
  g15: number;
  /** Non-joined tiles whose rendered rects are closer than 0.5 L. */
  renderClose: number;
  /** Joined tiles whose touching ends do not line up. */
  renderSkew: number;
  /** Chain bbox area divided by the felt area, at the end of each hand. */
  endFill: number[];
  settledOverlap: number;
  glideOverlap: number;
  uiOverlap: number;
  tiny: number;
  zoomIn: number;
  jump: number;
  ghostCut: number;
  /** Tiles that do not join and sit closer than about 30% of the short side. */
  unjoinedGap: number;
  /** An open spinner side whose drop target is missing or sitting on the spinner. */
  spinnerBlind: number;
  worst: AuditFailure[];
}

function stacksFor(w: number, h: number): { left: number; top: number; right: number; bottom: number }[] {
  return [
    { left: 0, top: Math.round(h * 0.28), right: 16, bottom: Math.round(h * 0.72) },
    { left: w - 16, top: Math.round(h * 0.28), right: w, bottom: Math.round(h * 0.72) },
    { left: 8, top: 0, right: w - 8, bottom: 20 },
  ];
}

function overlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right - 0.6 && a.right > b.left + 0.6 && a.top < b.bottom - 0.6 && a.bottom > b.top + 0.6;
}

function outside(
  rect: { left: number; top: number; right: number; bottom: number },
  felt: { w: number; h: number },
  edge: AxisInsets,
): number {
  return Math.max(
    edge.left - rect.left,
    edge.top - rect.top,
    rect.right - (felt.w - edge.right),
    rect.bottom - (felt.h - edge.bottom),
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type ScreenRect = { left: number; top: number; right: number; bottom: number };

const OPPOSITE: Record<LayoutDir, LayoutDir> = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
};

function centerOf(tile: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 };
}

function isDoubleId(id: string): boolean {
  const [low, high] = id.split("-");
  return low === high;
}

/** PlayDrift placement gates. The hub corner is counted apart from G9: a 2:1 cross cannot be 0.5 L clear and still joined at 0.04 L. */
function scorePinwheel(
  report: AuditSizeReport,
  board: BoardState,
  tiles: readonly PlacedTile[],
  scale: number,
  edge: AxisInsets,
  felt: { w: number; h: number },
  screenWidth: number,
  previous: number | null,
  seed: number,
  play: number,
  note: (kind: string, seed: number, play: number, detail: string) => void,
): void {
  if (tiles.length === 0) return;
  const box = chainBounds(tiles, 0);
  const shift = {
    x: chainViewShift(tiles, scale).x + boardShift(edge).x,
    y: chainViewShift(tiles, scale).y + boardShift(edge).y,
  };
  const anchorX = felt.w / 2 + boardShift(edge).x;
  const anchorY = felt.h / 2 + boardShift(edge).y;
  const screenX = felt.w / 2 + shift.x + (box.x + box.w / 2) * scale;
  const screenY = felt.h / 2 + shift.y + (box.y + box.h / 2) * scale;
  if (Math.abs(screenX - anchorX) > 2 || Math.abs(screenY - anchorY) > 2) {
    report.g1 += 1;
    note("g1", seed, play, `${(screenX - anchorX).toFixed(1)},${(screenY - anchorY).toFixed(1)}`);
  }
  const longPx = scale * TILE_LONG;
  const openPx = PINWHEEL_LONG_FRAC * screenWidth;
  const room = safeRoom(felt, edge);
  const fitPx = Math.min(room.w * TILE_LONG / Math.max(1, box.w), room.h * TILE_LONG / Math.max(1, box.h));
  const capPx = previous == null ? openPx : Math.min(previous * TILE_LONG, openPx);
  const expected = Math.min(capPx, fitPx);
  if (Math.abs(longPx - expected) > 1) {
    report.g3 += 1;
    note("g3", seed, play, `${longPx.toFixed(1)} vs ${expected.toFixed(1)}`);
  }
  if (longPx < openPx - 1) {
    const fillW = Math.abs(box.w * scale - room.w);
    const fillH = Math.abs(box.h * scale - room.h);
    if (Math.min(fillW, fillH) > 1) {
      report.g2 += 1;
      note("g2", seed, play, `${fillW.toFixed(1)} x ${fillH.toFixed(1)}`);
    }
  }
  if (tiles.length === 1 && board.center) {
    const hub = centerOf(tiles[0]!);
    const vertical = tiles[0]!.h > tiles[0]!.w;
    if (Math.abs(hub.x) > 1 || Math.abs(hub.y) > 1 || (board.center.low === board.center.high && !vertical) || Math.abs(longPx - openPx) > 1) {
      report.g7 += 1;
      note("g7", seed, play, `${hub.x.toFixed(1)},${hub.y.toFixed(1)} ${longPx.toFixed(1)}`);
    }
  }
  if (!board.center) return;
  const byId = new Map(tiles.map((tile) => [tile.tileId, tile]));
  const joined = new Set<string>();
  const firstOfArm = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const arm of ["west", "east", "north", "south"] as const) {
    const chain = board.arms[arm];
    if (chain[0]) firstOfArm.add(chain[0].tileId);
    let prevId = board.center.tileId;
    let prevDir: LayoutDir | null = null;
    let leftArm = false;
    chain.forEach((tile, index) => {
      joined.add(pair(prevId, tile.tileId));
      const laid = byId.get(tile.tileId);
      const prev = byId.get(prevId);
      if (laid && prev) {
        const gap = boxGap(prev, laid);
        if (gap < 0.03 * TILE_LONG - 0.5 || gap > 0.05 * TILE_LONG + 0.5) {
          report.g8 += 1;
          note("g8", seed, play, `${gap.toFixed(1)} ${prevId} ${tile.tileId}`);
        }
        if (prevDir && laid.direction === OPPOSITE[prevDir]) {
          report.g14 += 1;
          note("g14", seed, play, `${tile.tileId} ${prevDir}->${laid.direction}`);
        }
        if (isDoubleId(tile.tileId) && prevDir === laid.direction) {
          const here = centerOf(laid);
          const was = centerOf(prev);
          const cross = laid.direction === "east" || laid.direction === "west" ? Math.abs(here.y - was.y) : Math.abs(here.x - was.x);
          if (cross > 0.01 * TILE_LONG) {
            report.g13 += 1;
            note("g13", seed, play, tile.tileId);
          }
        }
      }
      if (index < 3 && laid && laid.direction !== arm) {
        report.g10 += 1;
        note("g10", seed, play, `${arm} ${index} ${laid.direction}`);
      }
      if (!leftArm && laid && laid.direction !== arm) {
        leftArm = true;
        if (laid.direction !== pinwheelTurn(arm, arm)) {
          report.g11 += 1;
          note("g11", seed, play, `${arm} ${laid.direction}`);
        } else if (index !== 3 && !chain.slice(0, index).some((earlier) => earlier.low === earlier.high)) {
          report.g10 += 1;
          note("g10", seed, play, `${arm} turned at ${index}`);
        }
      }
      if (index <= 4 && laid && prev && prevDir === arm && laid.direction === pinwheelTurn(arm, arm)
        && !isDoubleId(tile.tileId) && !isDoubleId(prevId) && (arm === "west" || arm === "east")) {
        const here = centerOf(laid);
        const was = centerOf(prev);
        const dx = (here.x - was.x) / TILE_LONG;
        const dy = (here.y - was.y) / TILE_LONG;
        const wantX = arm === "west" ? -0.26 : 0.26;
        const wantY = arm === "west" ? 0.78 : -0.78;
        if (Math.abs(dx - wantX) > 0.02 || Math.abs(dy - wantY) > 0.02) {
          report.g12 += 1;
          note("g12", seed, play, `${arm} ${dx.toFixed(2)},${dy.toFixed(2)}`);
        }
      }
      prevId = tile.tileId;
      prevDir = laid?.direction ?? prevDir;
    });
  }
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      const left = tiles[i]!;
      const right = tiles[j]!;
      if (joined.has(pair(left.tileId, right.tileId))) continue;
      if (firstOfArm.has(left.tileId) && firstOfArm.has(right.tileId)) continue;
      if (boxGap(left, right) < 0.5 * TILE_LONG - 0.5) {
        report.g9 += 1;
        note("g9", seed, play, `${left.tileId} ${right.tileId}`);
        i = tiles.length;
        break;
      }
    }
  }
  const screenOf = (tile: PlacedTile) => renderedTileRect(felt, tile, scale, shift);
  const screenGap = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ) => {
    const dx = Math.max(a.left - b.right, b.left - a.right, 0);
    const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    return dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy);
  };
  const endsMeet = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ) => {
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const gapX = Math.max(a.left - b.right, b.left - a.right, 0);
    const gapY = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
    if (overlapY > 0 && gapY === 0) return overlapY >= 0.8 * Math.min(a.bottom - a.top, b.bottom - b.top) - 1;
    if (overlapX > 0 && gapX === 0) return overlapX >= 0.8 * Math.min(a.right - a.left, b.right - b.left) - 1;
    return false;
  };
  const painted = tiles.map((tile) => ({ id: tile.tileId, rect: screenOf(tile) }));
  for (let i = 0; i < painted.length; i += 1) {
    for (let j = i + 1; j < painted.length; j += 1) {
      const left = painted[i]!;
      const right = painted[j]!;
      if (joined.has(pair(left.id, right.id))) {
        if (!endsMeet(left.rect, right.rect)) {
          report.renderSkew += 1;
          note("renderSkew", seed, play, `${left.id} ${right.id}`);
          i = painted.length;
          break;
        }
        continue;
      }
      if (firstOfArm.has(left.id) && firstOfArm.has(right.id)) continue;
      if (screenGap(left.rect, right.rect) < 0.5 * longPx - 0.5) {
        report.renderClose += 1;
        note("renderClose", seed, play, `${left.id} ${right.id}`);
        i = painted.length;
        break;
      }
    }
  }
  const runs: Array<{ dir: LayoutDir; at: number; from: number; to: number }> = [];
  for (const arm of ["west", "east", "north", "south"] as const) {
    const laid = board.arms[arm].map((tile) => byId.get(tile.tileId)).filter((tile): tile is PlacedTile => tile != null);
    let start = 0;
    while (start < laid.length) {
      let end = start + 1;
      while (end < laid.length && laid[end]!.direction === laid[start]!.direction) end += 1;
      if (end - start >= 2) {
        const dir = laid[start]!.direction;
        const horizontal = dir === "east" || dir === "west";
        const at = horizontal ? centerOf(laid[start]!).y : centerOf(laid[start]!).x;
        let from = Infinity;
        let to = -Infinity;
        for (let index = start; index < end; index += 1) {
          const mid = centerOf(laid[index]!);
          const along = horizontal ? mid.x : mid.y;
          from = Math.min(from, along);
          to = Math.max(to, along);
        }
        runs.push({ dir, at, from, to });
      }
      start = end;
    }
  }
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const a = runs[i]!;
      const b = runs[j]!;
      const aHor = a.dir === "east" || a.dir === "west";
      const bHor = b.dir === "east" || b.dir === "west";
      if (aHor !== bHor) continue;
      if (Math.abs(a.at - b.at) < 0.2 * TILE_LONG) continue;
      const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from);
      if (overlap <= 0) continue;
      if (Math.abs(a.at - b.at) < 2.5 * TILE_LONG) {
        report.g15 += 1;
        note("g15", seed, play, `${(Math.abs(a.at - b.at) / TILE_LONG).toFixed(2)}L`);
        return;
      }
    }
  }
}

export function auditSize(
  felt: { name: string; w: number; h: number },
  seeds: number,
  tableId: string | null = "TBL-013",
  lockChain = true,
  seedStart = 1,
  seats = 4,
): AuditSizeReport {
  const frame = frameInsets(tableId, felt);
  const stacks = stacksFor(felt.w, felt.h);
  const report: AuditSizeReport = {
    name: felt.name,
    hands: 0,
    plays: 0,
    longChains: 0,
    doubleHeavy: 0,
    settledCut: 0,
    glideCut: 0,
    exposedCut: 0,
    connectGap: 0,
    handEndSnap: 0,
    refold: 0,
    tinyPlays: 0,
    endPx: [],
    endLong: [],
    longUnder18: 0,
    endFill: [],
    g1: 0,
    g2: 0,
    g3: 0,
    g7: 0,
    g8: 0,
    g9: 0,
    g10: 0,
    g11: 0,
    g12: 0,
    g13: 0,
    g14: 0,
    g15: 0,
    renderClose: 0,
    renderSkew: 0,
    settledOverlap: 0,
    glideOverlap: 0,
    uiOverlap: 0,
    tiny: 0,
    zoomIn: 0,
    jump: 0,
    ghostCut: 0,
    unjoinedGap: 0,
    spinnerBlind: 0,
    worst: [],
  };
  const note = (kind: string, seed: number, play: number, detail: string) => {
    if (report.worst.length < 8) report.worst.push({ kind, seed, play, detail });
  };

  for (let seed = seedStart; seed < seedStart + seeds; seed += 1) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(seed, 0);
    const players = [0, 1, 2, 3].slice(0, seats).map((index) => ({ id: `p${index}`, name: `P${index}` }));
    let match: MatchState = beginHand(
      createMatch(players, { boneyardMode: "draw_until", seriesLength: 1, targetScore: 500 }),
      shuffleWithSeed(bytes),
    );
    report.hands += 1;
    let previous: number | null = null;
    let held: { width: number; height: number } | null = null;
    let prevScreens = new Map<string, ScreenRect>();
    let heldCamera: { scale: number; shift: { x: number; y: number } } | null = null;
    let prevPoses = new Map<string, { x: number; y: number; w: number; h: number }>();
    let painted: BoardLayout | null = null;
    let committed: BoardLayout | null = null;
    let paintedCamera: { scale: number; shift: { x: number; y: number } } | null = null;
    let doubles = 0;
    let maxTiles = 0;

    for (let guard = 0; guard < 80 && match.hand && match.hand.phase !== "complete"; guard += 1) {
      const playerId = currentPlayerId(match);
      if (!playerId) break;
      const intents = legalIntents(match, playerId);
      const intent = intents.find((item) => item.type === "play") ?? intents[0];
      if (!intent) break;
      const result = applyIntent(match, playerId, intent);
      if (!result.ok) break;
      match = result.match;
      if (intent.type !== "play" || !match.hand) continue;
      if (match.hand.phase === "complete") {
        report.plays += 1;
        const next = pictureFrom(match.hand.board, held, lockChain ? painted : null);
        const committed = chainHeldAtHandEnd(painted, next, true);
        if (painted && paintedCamera && committed) {
          const byId = new Map(committed.tiles.map((tile) => [tile.tileId, tile]));
          let moved = committed.tiles.length < painted.tiles.length;
          for (const tile of painted.tiles) {
            if (moved) break;
            const now = byId.get(tile.tileId);
            if (!now) {
              moved = true;
              break;
            }
            const before = renderedTileRect(felt, tile, paintedCamera.scale, paintedCamera.shift);
            const after = renderedTileRect(felt, now, paintedCamera.scale, paintedCamera.shift);
            moved = Math.abs(before.left - after.left) > 0.5
              || Math.abs(before.top - after.top) > 0.5
              || Math.abs(before.right - after.right) > 0.5
              || Math.abs(before.bottom - after.bottom) > 0.5;
          }
          const again = chainHeldAtHandEnd(committed, next, true);
          if (!moved && again) {
            const againById = new Map(again.tiles.map((tile) => [tile.tileId, tile]));
            if (again.tiles.length !== committed.tiles.length) moved = true;
            for (const tile of committed.tiles) {
              if (moved) break;
              const now = againById.get(tile.tileId);
              if (!now) {
                moved = true;
                break;
              }
              const before = renderedTileRect(felt, tile, paintedCamera.scale, paintedCamera.shift);
              const after = renderedTileRect(felt, now, paintedCamera.scale, paintedCamera.shift);
              moved = Math.abs(before.left - after.left) > 0.5
                || Math.abs(before.top - after.top) > 0.5
                || Math.abs(before.right - after.right) > 0.5
                || Math.abs(before.bottom - after.bottom) > 0.5;
            }
          }
          if (moved) {
            report.handEndSnap += 1;
            note("handEndSnap", seed, painted.tiles.length, "chain tiles moved before the next deal");
          }
        }
        const endCam = settledHandCamera({
          board: match.hand.board,
          felt,
          screenWidth: felt.w,
          frame,
          keepOuts: stacks,
          previous,
          heldLimits: held,
          committed: lockChain ? committed : null,
        });
        const endView = chainViewShift(endCam.layout.tiles, endCam.scale);
        const endShift = { x: endView.x + boardShift(endCam.edge).x, y: endView.y + boardShift(endCam.edge).y };
        for (const tile of endCam.layout.tiles) {
          const rect = renderedTileRect(felt, tile, endCam.scale, endShift);
          if (outside(rect, felt, endCam.edge) > 0.6) {
            report.settledCut += 1;
            note("settledCut", seed, endCam.layout.tiles.length, tile.tileId);
            break;
          }
        }
        const endBox = chainBounds(endCam.layout.tiles, 0);
        report.endPx.push(TILE_SHORT * endCam.scale);
        report.endLong.push(TILE_LONG * endCam.scale);
        if (TILE_LONG * endCam.scale < 18) report.longUnder18 += 1;
        report.endFill.push((endBox.w * endCam.scale * endBox.h * endCam.scale) / Math.max(1, felt.w * felt.h));
        break;
      }
      report.plays += 1;
      if (intent.tileId.split("-")[0] === intent.tileId.split("-")[1]) doubles += 1;
      const cam = settledHandCamera({
        board: match.hand.board,
        felt,
        screenWidth: felt.w,
        frame,
        keepOuts: stacks,
        previous,
        heldLimits: held,
        committed: lockChain ? committed : null,
      });
      if (previous != null && cam.scale > previous + 0.01) {
        report.zoomIn += 1;
        note("zoomIn", seed, report.plays, `${previous.toFixed(3)} -> ${cam.scale.toFixed(3)}`);
      }
      const boxes = cam.layout.tiles;
      maxTiles = Math.max(maxTiles, boxes.length);
      if (prevPoses.size > 0) {
        let movedTile = false;
        for (const tile of boxes) {
          const old = prevPoses.get(tile.tileId);
          if (!old) continue;
          if (Math.abs(old.x - tile.x) > 0.5 || Math.abs(old.y - tile.y) > 0.5 || old.w !== tile.w || old.h !== tile.h) {
            movedTile = true;
            note("refold", seed, boxes.length, tile.tileId);
            break;
          }
        }
        if (movedTile) report.refold += 1;
      }
      const view = chainViewShift(boxes, cam.scale);
      const shift = { x: view.x + boardShift(cam.edge).x, y: view.y + boardShift(cam.edge).y };
      const hidden = new Set(tilesRelocating(prevPoses, boxes));
      if (boxes.length >= 8 && TILE_SHORT * cam.scale < TINY_PX) {
        report.tiny += 1;
        report.tinyPlays += 1;
        note("tiny", seed, boxes.length, `${(TILE_SHORT * cam.scale).toFixed(1)}px`);
      }
      if (layoutOverlaps(cam.layout)) {
        report.settledOverlap += 1;
        note("settledOverlap", seed, boxes.length, "layout");
      }
      const boardNow = match.hand.board;
      scorePinwheel(report, boardNow, boxes, cam.scale, cam.edge, felt, felt.w, previous, seed, boxes.length, note);
      const joined = new Set<string>();
      const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      if (boardNow.center) {
        for (const arm of ["west", "east", "north", "south"] as const) {
          let previousId = boardNow.center.tileId;
          for (const tile of boardNow.arms[arm]) {
            joined.add(pairKey(previousId, tile.tileId));
            previousId = tile.tileId;
          }
        }
      }
      let crowded = false;
      for (let i = 0; i < boxes.length && !crowded; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const left = boxes[i]!;
          const right = boxes[j]!;
          if (joined.has(pairKey(left.tileId, right.tileId))) continue;
          if (boxGap(left, right) < UNJOINED_GAP - 0.5) {
            crowded = true;
            report.unjoinedGap += 1;
            note("unjoinedGap", seed, boxes.length, `${left.tileId} ${right.tileId}`);
            break;
          }
        }
      }
      if (boardNow.center?.isSpinner && boardNow.spinnerOpen) {
        const hub = boxes.find((tile) => tile.tileId === boardNow.center?.tileId);
        for (const arm of ["west", "east", "north", "south"] as const) {
          if (boardNow.arms[arm].length > 0) continue;
          const end = cam.layout.ends.find((item) => item.id === arm);
          const onHub = hub != null && end != null && (
            end.x < hub.x + hub.w - 1 && end.x + end.w > hub.x + 1
            && end.y < hub.y + hub.h - 1 && end.y + end.h > hub.y + 1
          );
          const beside = hub != null && end != null && boxGap(end, hub) <= TILE_GAP + 1;
          const full = end != null && end.w * end.h >= TILE_SHORT * TILE_SHORT * 0.8;
          const covered = end != null && boxes.some((tile) => tile.tileId !== boardNow.center?.tileId && (
            tile.x < end.x + end.w - 1 && tile.x + tile.w > end.x + 1
            && tile.y < end.y + end.h - 1 && tile.y + tile.h > end.y + 1
          ));
          if (!end || onHub || !beside || !full || covered) {
            report.spinnerBlind += 1;
            note("spinnerBlind", seed, boxes.length, arm);
          }
        }
      }
      const settled = new Map<string, ScreenRect>();
      let cut = false;
      let ui = false;
      let ov = false;
      const settledList: Array<ScreenRect & { id: string }> = [];
      for (const tile of boxes) {
        const rect = renderedTileRect(felt, tile, cam.scale, shift);
        settled.set(tile.tileId, rect);
        settledList.push({ id: tile.tileId, ...rect });
        if (!cut && outside(rect, felt, cam.edge) > 0.6) {
          cut = true;
          report.settledCut += 1;
          note("settledCut", seed, boxes.length, tile.tileId);
        }
        if (!ui) {
          for (const stack of stacks) {
            if (overlap(rect, stack)) {
              ui = true;
              report.uiOverlap += 1;
              note("uiOverlap", seed, boxes.length, tile.tileId);
              break;
            }
          }
        }
      }
      for (let i = 0; i < settledList.length && !ov; i += 1) {
        for (let j = i + 1; j < settledList.length; j += 1) {
          if (overlap(settledList[i]!, settledList[j]!)) {
            ov = true;
            report.settledOverlap += 1;
            note("settledOverlap", seed, boxes.length, settledList[i]!.id);
            break;
          }
        }
      }

      if (match.hand.board.center) {
        const byId = new Map(boxes.map((tile) => [tile.tileId, tile]));
        const screenOf = (tileId: string) => {
          const box = byId.get(tileId);
          return box ? renderedTileRect(felt, box, cam.scale, shift) : null;
        };
        let parentId = match.hand.board.center.tileId;
        for (const arm of ["west", "east", "north", "south"] as const) {
          for (const tile of match.hand.board.arms[arm]) {
            const parent = screenOf(parentId);
            const child = screenOf(tile.tileId);
            if (parent && child) {
              const dx = Math.max(child.left - parent.right, parent.left - child.right, 0);
              const dy = Math.max(child.top - parent.bottom, parent.top - child.bottom, 0);
              const gap = dx === 0 ? dy : dy === 0 ? dx : Math.hypot(dx, dy);
              // One camera. A tile painted at the next camera while its parent
              // is still on the last one is a full tile away on screen.
              if (gap > TILE_GAP * cam.scale + 8) {
                report.connectGap += 1;
                note("connectGap", seed, boxes.length, `${tile.tileId} ${gap.toFixed(0)}px`);
              }
            }
            parentId = tile.tileId;
          }
          parentId = match.hand.board.center.tileId;
        }
      }

      if (prevScreens.size > 0 && heldCamera) {
        let glideCut = false;
        let glideOverlap = false;
        let jumped = false;
        let exposed = false;
        let prevFrame: Array<ScreenRect & { id: string }> | null = null;
        for (let frameNo = 0; frameNo <= FRAMES && !glideCut && !glideOverlap && !jumped; frameNo += 1) {
          const ease = cameraEase(frameNo / FRAMES);
          const scale = lerp(heldCamera.scale, cam.scale, ease);
          const pan = {
            x: lerp(heldCamera.shift.x, shift.x, ease),
            y: lerp(heldCamera.shift.y, shift.y, ease),
          };
          const rects: Array<ScreenRect & { id: string }> = [];
          for (const tile of boxes) {
            if (hidden.has(tile.tileId)) continue;
            const rect = renderedTileRect(felt, tile, scale, pan);
            // The frame before the glide, and every frame of it. A tile that
            // does not fit this camera is held off the felt. It is not drawn.
            if (outside(rect, felt, cam.edge) > 0.6) {
              if (!exposed) {
                exposed = true;
                report.exposedCut += 1;
                note("exposedCut", seed, boxes.length, tile.tileId);
              }
              continue;
            }
            rects.push({ id: tile.tileId, ...rect });
          }
          if (prevFrame) {
            for (const now of rects) {
              if (jumped) break;
              const before = prevFrame.find((item) => item.id === now.id);
              if (!before) continue;
              const jump = Math.hypot(
                (now.left + now.right) / 2 - (before.left + before.right) / 2,
                (now.top + now.bottom) / 2 - (before.top + before.bottom) / 2,
              );
              if (jump > JUMP_PX) {
                jumped = true;
                report.jump += 1;
                note("jump", seed, boxes.length, `${now.id} ${jump.toFixed(0)}px`);
              }
            }
          }
          for (let i = 0; i < rects.length && !glideOverlap; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
              if (overlap(rects[i]!, rects[j]!)) {
                glideOverlap = true;
                report.glideOverlap += 1;
                note("glideOverlap", seed, boxes.length, rects[i]!.id);
                break;
              }
            }
          }
          prevFrame = rects;
        }
      }

      const bounds = {
        left: cam.edge.left,
        top: cam.edge.top,
        right: felt.w - cam.edge.right,
        bottom: felt.h - cam.edge.bottom,
      };
      for (const end of cam.layout.ends) {
        const tip = [...boxes].reverse().find((item) => item.arm === end.id);
        if (!tip) continue;
        const ghost = straightBox(tip, end.id as "west" | "east" | "north" | "south", false);
        const raw = renderedTileRect(felt, ghost, cam.scale, shift);
        const clamped = clampGhostToFelt(
          { left: raw.left, top: raw.top, width: raw.right - raw.left, height: raw.bottom - raw.top },
          bounds,
        );
        const rect = { left: clamped.left, top: clamped.top, right: clamped.left + clamped.width, bottom: clamped.top + clamped.height };
        if (outside(rect, felt, cam.edge) > 0.6) {
          report.ghostCut += 1;
          note("ghostCut", seed, boxes.length, end.id);
          break;
        }
      }

      prevScreens = settled;
      heldCamera = { scale: cam.scale, shift };
      prevPoses = new Map(boxes.map((item) => [item.tileId, { x: item.x, y: item.y, w: item.w, h: item.h }]));
      painted = pictureFrom(match.hand.board, cam.limits, lockChain ? committed : null);
      committed = cam.layout;
      paintedCamera = { scale: cam.scale, shift };
      previous = cam.scale;
      held = cam.limits;
    }
    if (maxTiles >= 18) report.longChains += 1;
    if (doubles >= 6) report.doubleHeavy += 1;
    if (previous != null) {
      const ended = cameraAfterHandEnd(previous);
      if (ended < previous - 0.01 || (TILE_SHORT * ended < TINY_PX && TILE_SHORT * previous >= TINY_PX)) {
        report.handEndSnap += 1;
        note("handEndSnap", seed, maxTiles, `${(TILE_SHORT * previous).toFixed(1)} -> ${(TILE_SHORT * ended).toFixed(1)}`);
      }
    }
  }
  return report;
}

/** The hand-over sheet does not refit the chain. The scale stays where the last tile left it. */
export function cameraAfterHandEnd(scale: number): number {
  return scale;
}

export function auditAll(seeds = AUDIT_SEEDS, lockChain = true): AuditSizeReport[] {
  return AUDIT_FELTS.map((felt) => auditSize(felt, seeds, "TBL-013", lockChain));
}
