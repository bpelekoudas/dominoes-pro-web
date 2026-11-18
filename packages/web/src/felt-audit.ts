import { applyIntent, beginHand, createMatch, currentPlayerId, legalIntents, type MatchState } from "../../rules/src/engine.js";
import { TILE_GAP, UNJOINED_GAP, boxGap, layoutOverlaps, outwardStraight, straightBox, TILE_SHORT, TILE_LONG, type BoardLayout } from "../../rules/src/layout.js";
import { shuffleWithSeed } from "../../rules/src/rng.js";
import {
  boardShift,
  chainBounds,
  cameraEase,
  chainHeldAtHandEnd,
  chainViewShift,
  pictureFrom,
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
  /** A bend while one more straight tile would still sit inside the copper. */
  prematureTurn: number;
  /** A one-tile jog back to the previous direction while that jog was still a tile away from the copper. */
  spiral: number;
  /** Unjoined tiles closer than 30% of the rendered short side. */
  renderedTight: number;
  /** Smallest gap between unjoined tiles, in screen pixels. */
  minGapPx: number;
  /** A chain neighbor that is not the closest tile along that end. */
  unreadChain: number;
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
    endFill: [],
    settledOverlap: 0,
    glideOverlap: 0,
    uiOverlap: 0,
    tiny: 0,
    zoomIn: 0,
    jump: 0,
    ghostCut: 0,
    unjoinedGap: 0,
    spinnerBlind: 0,
    prematureTurn: 0,
    spiral: 0,
    renderedTight: 0,
    minGapPx: Number.POSITIVE_INFINITY,
    unreadChain: 0,
    worst: [],
  };
  const note = (kind: string, seed: number, play: number, detail: string) => {
    if (report.worst.length < 8) report.worst.push({ kind, seed, play, detail });
  };

  for (let seed = seedStart; seed < seedStart + seeds; seed += 1) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(seed, 0);
    const players = [0, 1, 2, 3].slice(0, Math.min(4, Math.max(2, seats))).map((index) => ({ id: `p${index}`, name: `P${index}` }));
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
        const endView = chainViewShift([...endCam.layout.tiles, ...endCam.layout.ends], endCam.scale);
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
      const view = chainViewShift([...boxes, ...cam.layout.ends], cam.scale);
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
          const screenGap = boxGap(left, right) * cam.scale;
          if (screenGap < report.minGapPx) report.minGapPx = screenGap;
          if (screenGap < TILE_SHORT * cam.scale * 0.3 - 0.5) {
            report.renderedTight += 1;
            note("renderedTight", seed, boxes.length, `${left.tileId} ${right.tileId} ${screenGap.toFixed(1)}px`);
            crowded = true;
          }
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
      const byTile = new Map(boxes.map((tile) => [tile.tileId, tile]));
      const fresh = boxes.filter((tile) => !prevPoses.has(tile.tileId) && tile.arm);
      for (const tile of fresh) {
        const armTiles = boardNow.arms[tile.arm!];
        const index = armTiles.findIndex((item) => item.tileId === tile.tileId);
        const parent = index <= 0 ? boxes.find((item) => item.tileId === boardNow.center?.tileId) : byTile.get(armTiles[index - 1]!.tileId);
        const travel = index <= 0 ? tile.arm! : parent?.direction;
        if (!parent || !travel || tile.direction === travel) continue;
        const straight = outwardStraight(parent, travel, tile.tileId.split("-")[0] === tile.tileId.split("-")[1]);
        if (boxGap(straight, parent) > TILE_GAP + 1) continue;
        const hubBox = boxes.find((item) => item.tileId === boardNow.center?.tileId);
        if (hubBox && boxGap(straight, hubBox) < TILE_SHORT) continue;
        const blocked = boxes.some((other) => {
          if (other === parent || other === tile) return false;
          const overlaps = other.x < straight.x + straight.w - 1 && other.x + other.w > straight.x + 1
            && other.y < straight.y + straight.h - 1 && other.y + other.h > straight.y + 1;
          return overlaps || boxGap(other, straight) < UNJOINED_GAP - 0.5;
        });
        if (blocked) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const other of boxes) {
          if (other === tile) continue;
          minX = Math.min(minX, other.x);
          minY = Math.min(minY, other.y);
          maxX = Math.max(maxX, other.x + other.w);
          maxY = Math.max(maxY, other.y + other.h);
        }
        minX = Math.min(minX, straight.x);
        minY = Math.min(minY, straight.y);
        maxX = Math.max(maxX, straight.x + straight.w);
        maxY = Math.max(maxY, straight.y + straight.h);
        const roomW = Math.max(1, felt.w - cam.edge.left - cam.edge.right);
        const roomH = Math.max(1, felt.h - cam.edge.top - cam.edge.bottom);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const decisionScale = previous ?? cam.scale;
        const left = (straight.x - cx) * decisionScale + roomW / 2;
        const top = (straight.y - cy) * decisionScale + roomH / 2;
        const nose = travel === "east"
          ? roomW - (left + straight.w * decisionScale)
          : travel === "west"
            ? left
            : travel === "south"
              ? roomH - (top + straight.h * decisionScale)
              : top;
        const straightFits = left >= -0.8 && top >= -0.8
          && left + straight.w * decisionScale <= roomW + 0.8
          && top + straight.h * decisionScale <= roomH + 0.8
          && nose >= TILE_LONG * decisionScale;
        if (straightFits) {
          report.prematureTurn += 1;
          note("prematureTurn", seed, boxes.length, `${tile.tileId} ${travel}->${tile.direction}`);
        }
      }
      for (const arm of ["west", "east", "north", "south"] as const) {
        const run = boardNow.arms[arm].map((placed) => byTile.get(placed.tileId)).filter((box): box is NonNullable<typeof box> => Boolean(box));
        for (let index = 2; index < run.length; index += 1) {
          const first = run[index - 2]!;
          const corner = run[index - 1]!;
          const resumed = run[index]!;
          if (prevPoses.has(resumed.tileId)) continue;
          if (corner.direction === first.direction || resumed.direction !== first.direction || resumed.direction === corner.direction) continue;
          const rect = renderedTileRect(felt, corner, cam.scale, shift);
          const lead = corner.direction === "west"
            ? rect.left - cam.edge.left
            : corner.direction === "east"
              ? felt.w - cam.edge.right - rect.right
              : corner.direction === "north"
                ? rect.top - cam.edge.top
                : felt.h - cam.edge.bottom - rect.bottom;
          if (lead > TILE_SHORT * cam.scale) {
            report.spiral += 1;
            note("spiral", seed, boxes.length, `${arm} ${first.direction[0]}${corner.direction[0]}${resumed.direction[0]} ${corner.tileId} ${lead.toFixed(0)}px`);
          }
        }
      }
      const centerOf = (box: { x: number; y: number; w: number; h: number }) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
      for (const arm of ["west", "east", "north", "south"] as const) {
        const chain = [boardNow.center?.tileId, ...boardNow.arms[arm].map((tile) => tile.tileId)].filter((id): id is string => Boolean(id));
        for (let index = 0; index < chain.length; index += 1) {
          const tile = byTile.get(chain[index]!);
          if (!tile) continue;
          const neighbors = [chain[index - 1], chain[index + 1]].filter((id): id is string => Boolean(id));
          for (const neighborId of neighbors) {
            const neighbor = byTile.get(neighborId);
            if (!neighbor) continue;
            const from = centerOf(tile);
            const to = centerOf(neighbor);
            const vx = to.x - from.x;
            const vy = to.y - from.y;
            const span = Math.hypot(vx, vy) || 1;
            let nearest = neighborId;
            let nearestAlong = span;
            for (const other of boxes) {
              if (other.tileId === tile.tileId) continue;
              const dx = centerOf(other).x - from.x;
              const dy = centerOf(other).y - from.y;
              const along = (dx * vx + dy * vy) / span;
              const cross = Math.abs(dx * vy - dy * vx) / span;
              if (along <= TILE_GAP || cross > TILE_SHORT) continue;
              if (along < nearestAlong - 1) {
                nearestAlong = along;
                nearest = other.tileId;
              }
            }
            if (nearest !== neighborId) {
              report.unreadChain += 1;
              note("unreadChain", seed, boxes.length, `${tile.tileId} -> ${neighborId} via ${nearest}`);
              break;
            }
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
