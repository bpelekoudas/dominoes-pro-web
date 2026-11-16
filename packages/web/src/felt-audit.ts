import { applyIntent, beginHand, createMatch, currentPlayerId, legalIntents, type MatchState } from "../../rules/src/engine.js";
import { TILE_GAP, layoutOverlaps, straightBox, TILE_SHORT } from "../../rules/src/layout.js";
import { shuffleWithSeed } from "../../rules/src/rng.js";
import {
  boardShift,
  cameraEase,
  chainViewShift,
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
  settledOverlap: number;
  glideOverlap: number;
  uiOverlap: number;
  tiny: number;
  zoomIn: number;
  jump: number;
  ghostCut: number;
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
    settledOverlap: 0,
    glideOverlap: 0,
    uiOverlap: 0,
    tiny: 0,
    zoomIn: 0,
    jump: 0,
    ghostCut: 0,
    worst: [],
  };
  const note = (kind: string, seed: number, play: number, detail: string) => {
    if (report.worst.length < 8) report.worst.push({ kind, seed, play, detail });
  };

  for (let seed = 1; seed <= seeds; seed += 1) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(seed, 0);
    const players = [0, 1, 2, 3].map((index) => ({ id: `p${index}`, name: `P${index}` }));
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
      });
      if (previous != null && cam.scale > previous + 0.01) {
        report.zoomIn += 1;
        note("zoomIn", seed, report.plays, `${previous.toFixed(3)} -> ${cam.scale.toFixed(3)}`);
      }
      const boxes = cam.layout.tiles;
      maxTiles = Math.max(maxTiles, boxes.length);
      const view = chainViewShift([...boxes, ...cam.layout.ends], cam.scale);
      const shift = { x: view.x + boardShift(cam.edge).x, y: view.y + boardShift(cam.edge).y };
      const hidden = new Set(tilesRelocating(prevPoses, boxes));
      if (boxes.length >= 8 && TILE_SHORT * cam.scale < TINY_PX) {
        report.tiny += 1;
        note("tiny", seed, boxes.length, `${(TILE_SHORT * cam.scale).toFixed(1)}px`);
      }
      if (layoutOverlaps(cam.layout)) {
        report.settledOverlap += 1;
        note("settledOverlap", seed, boxes.length, "layout");
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

export function auditAll(seeds = AUDIT_SEEDS): AuditSizeReport[] {
  return AUDIT_FELTS.map((felt) => auditSize(felt, seeds));
}
