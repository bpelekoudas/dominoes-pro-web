import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PlayerView } from "@uhoh/rules";
import { layoutBoard, straightBox, type BoardLayout, type LayoutBox, type PlacedEnd } from "../../rules/src/layout.js";
import { SCORE_FLY_MS, scorePopWindow } from "./feel/score-time.js";
import { cameraScale, chainBounds, handOverPlacement } from "./board-scale.js";
import { handFit } from "./hand-fit.js";
import { FeelRipple, useLiveFeel } from "./feel/live";
import { scoreTier } from "./feel/ladder";
import { bigMomentLevel, type BigMomentLevel } from "../../rules/src/moment.js";
import { normalizeFx, type FxId } from "./fx.js";
import { demoAward, MomentLayer, type HitBox } from "./moment.js";
import {
  chooseDropEnd,
  type DropBox,
  ghostAimPoint,
  ghostTopLeft,
  GHOST_HEIGHT,
  GHOST_WIDTH,
} from "./drop.js";

const NO_SLOTS: Array<LayoutBox & { id: string }> = [];

const PIPS: Record<number, number[]> = {
  0: [],
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

export function Domino({
  a,
  b,
  orientation,
  spinner = false,
  faceDown = false,
}: {
  a: number;
  b: number;
  orientation: "horizontal" | "vertical";
  spinner?: boolean;
  faceDown?: boolean;
}) {
  return (
    <span className={`domino ${orientation}${spinner ? " spinner" : ""}${faceDown ? " face-down" : ""}`}>
      {faceDown ? null : (
        <>
          <Half value={a} />
          <span className="domino-split" />
          <Half value={b} />
        </>
      )}
    </span>
  );
}

function Half({ value }: { value: number }) {
  return (
    <span className="half" aria-hidden="true">
      {(PIPS[value] ?? []).map((pos) => (
        <i key={pos} data-pos={pos} />
      ))}
    </span>
  );
}

export function Table({
  view,
  selectedTile,
  dragTileId,
  aimEndId,
  onPlay,
  onSelect,
  replayToken = 0,
  tableArt = null,
}: {
  view: PlayerView;
  selectedTile: string | null;
  dragTileId: string | null;
  aimEndId: string | null;
  onPlay: (tileId: string, endId: string) => void;
  onSelect: (tileId: string | null) => void;
  tableArt?: string | null;
  replayToken?: number;
}) {
  const board = view.board;
  const layout = useMemo(() => (board?.center ? layoutBoard(board) : null), [board]);
  const frame = useMemo(() => (layout ? chainBounds(layout.tiles, 0) : null), [layout]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [lift, setLift] = useState(0);
  const [cameraArmed, setCameraArmed] = useState(false);
  const armOnce = useRef(false);
  const held = useRef<{ hand: string; scale: number } | null>(null);
  const feltLock = useRef<{ hand: string; w: number; h: number } | null>(null);
  const frozen = useRef(false);
  const handKey = `${view.gameNumber}:${view.handNumber}`;
  const handOver = view.phase === "between" || view.phase === "over";
  const lastTileId = view.lastPlay?.tileId ?? null;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const measure = () => {
      // Hand over keeps the last scale. The sheet must not zoom the chain.
      if (frozen.current && held.current?.hand === handKey) return;
      let width = viewport.clientWidth;
      let height = viewport.clientHeight;
      if (width < 8 || height < 8) return;
      // The first felt size of the hand is the one that fits the chain.
      // A later hint, banner, or sheet must not zoom it. A real resize
      // changes the width and takes a fresh measurement.
      const locked = feltLock.current;
      if (locked?.hand === handKey && Math.abs(width - locked.w) < 32) {
        width = locked.w;
        height = locked.h;
      } else {
        feltLock.current = { hand: handKey, w: width, h: height };
      }
      const bounds = chainBounds(layout.tiles, 0);
      const column = viewport.closest(".felt-column");
      const screenWidth = column instanceof HTMLElement ? column.clientWidth : width;
      const newHand = held.current?.hand !== handKey;
      const next = cameraScale({
        bounds,
        felt: { w: width, h: height },
        screenWidth,
        previous: newHand ? null : (held.current?.scale ?? null),
        newHand,
      });
      held.current = { hand: handKey, scale: next };
      frozen.current = handOver;
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
      if (!armOnce.current) {
        armOnce.current = true;
        requestAnimationFrame(() => setCameraArmed(true));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout, handOver, handKey]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = viewportRef.current;
    if (!handOver || !viewport || !frame) {
      setLift((current) => (current === 0 ? current : 0));
      root.style.removeProperty("--hand-sheet-max");
      return;
    }
    const measure = () => {
      const felt = viewport.getBoundingClientRect();
      const sheet = document.querySelector(".hand-summary");
      let sheetTop: number | null = null;
      if (sheet) {
        const cap = window.innerHeight * 0.54;
        const naturalMax = Math.min(cap, sheet.scrollHeight);
        sheetTop = window.innerHeight - naturalMax;
      }
      const last = lastTileId && layout ? layout.tiles.find((tile) => tile.tileId === lastTileId) : undefined;
      const local = last ? place(last, frame) : null;
      const placement = handOverPlacement({
        feltTop: felt.top,
        feltHeight: felt.height,
        sheetTop,
        chainHeight: frame.h * scale,
        lastTile: local ? { top: local.top * scale, height: local.height * scale } : null,
      });
      const next = Math.round(placement.lift);
      setLift((current) => (current === next ? current : next));
      if (placement.sheetTop == null) root.style.removeProperty("--hand-sheet-max");
      else root.style.setProperty("--hand-sheet-max", `${Math.max(120, Math.round(window.innerHeight - placement.sheetTop))}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const sheet = document.querySelector(".hand-summary");
    if (sheet) observer.observe(sheet);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--hand-sheet-max");
    };
  }, [handOver, frame, scale, layout, lastTileId]);

  const focusTile = dragTileId ?? selectedTile;
  const focusPlays = focusTile ? view.legalPlays.filter((play) => play.tileId === focusTile) : [];
  // A drag shows every legal end. A tap shows them only when the tile fits more than one.
  const armed = dragTileId !== null || focusPlays.length > 1;
  const hotEnds = new Set(armed ? focusPlays.map((play) => play.endId) : []);
  const dropLead = dragTileId !== null && hotEnds.has("lead");
  const slotKey = armed ? [...hotEnds].sort().join(",") : "";
  const previewDouble = Boolean(focusTile && focusTile.split("-")[0] === focusTile.split("-")[1]);
  const slotBoxes = useMemo(() => {
    if (!layout || !slotKey) return NO_SLOTS;
    const ids = new Set(slotKey.split(","));
    return layout.ends.filter((end) => ids.has(end.id)).map((end) => ({ ...nextSlotBox(layout, end, previewDouble), id: end.id }));
  }, [layout, slotKey, previewDouble]);
  const ghostFaces = useMemo(() => {
    const faces = new Map<string, { a: number; b: number; orientation: "horizontal" | "vertical" }>();
    if (!layout || !focusTile) return faces;
    for (const box of slotBoxes) {
      const end = layout.ends.find((item) => item.id === box.id);
      if (!end) continue;
      faces.set(box.id, ghostFace(focusTile, box, end));
    }
    return faces;
  }, [layout, focusTile, slotBoxes]);
  const slots = useScreenBoxes(stageRef, frame, scale, slotBoxes);
  const feel = useLiveFeel(view);
  const pop = useScorePop(view.lastPlay);
  const popAt = useAnchor(stageRef, layout, frame, scale, pop?.tileId ?? null, pop?.endId ?? null);
  const { moment, dismissMoment } = useBigMoment(view.lastPlay, view.players, replayToken);
  const [shake, setShake] = useState<BigMomentLevel | null>(null);
  const [slamming, setSlamming] = useState(false);
  const anchor = useHitBox(stageRef, moment?.tileId ?? null, moment?.key ?? "", layout, scale);
  const placed = moment?.tileId ? layout?.tiles.find((tile) => tile.tileId === moment.tileId) : undefined;

  return (
    <div
      className={`table-scroll${dropLead ? " drop-ready" : ""}${shake ? " shaking" : ""}${handOver && lastTileId ? " hand-over" : ""}`}
      data-last-tile={lastTileId ?? ""}
      data-shake={shake ?? "off"}
      ref={viewportRef}
      data-open-total={view.openTotal}
      data-knock-streak={view.knockStreak}
      data-table-id={view.tableId}
      data-board-scale={scale.toFixed(2)}
      data-board-lift={String(lift)}
      data-board-frozen={handOver ? "true" : "false"}
      data-win-board="true"
      data-camera={cameraArmed ? "armed" : "hold"}
      data-drop-ready={dropLead ? "true" : "false"}
      style={tableArt ? { backgroundImage: `url(${tableArt})` } : undefined}
    >
      {layout && frame ? (
        <div
          className="board-scaler"
          style={{ width: frame.w * scale, height: frame.h * scale, transform: `translateY(${lift}px)` }}
        >
          <div
            className="board-stage"
            ref={stageRef}
            style={{ width: frame.w, height: frame.h, transform: `scale(${scale})` }}
          >
            {layout.tiles.map((tile) => (
              <div
                key={tile.tileId}
                className={`board-tile${tile.tileId === lastTileId ? " last-move" : ""}${slamming && !handOver && tile.tileId === moment?.tileId ? " is-slamming" : ""}`}
                data-feel={tile.tileId === lastTileId ? feel.tier : undefined}
                style={place(tile, frame)}
                data-board-tile={tile.tileId}
              >
                <Domino a={tile.a} b={tile.b} orientation={tile.orientation} spinner={tile.spinner} />
              </div>
            ))}
            {layout.ends.map((end) => {
              const hot = hotEnds.has(end.id);
              const aim = aimEndId === end.id;
              return (
                <button
                  key={end.id}
                  type="button"
                  className={`end-cap${hot ? " hot" : ""}${aim ? " aim" : ""}${feel.scoring ? " is-scoring" : ""}`}
                  style={place(end, frame)}
                  data-end-id={end.id}
                  data-hot={hot ? "true" : "false"}
                  onClick={() => chooseEnd(end.id)}
                  aria-label={`Open ${end.id} end, match ${end.match}`}
                />
              );
            })}
          </div>
        </div>
      ) : null}
      {moment ? (
        <MomentLayer
          token={moment.key}
          awarded={moment.awarded}
          tileId={moment.tileId}
          tile={{
            a: placed?.a ?? faceOf(moment.tileId).a,
            b: placed?.b ?? faceOf(moment.tileId).b,
            orientation: placed?.orientation ?? "vertical",
            spinner: placed?.spinner,
          }}
          anchor={anchor}
          effect={moment.effect}
          cry={feel.cry}
          onShake={setShake}
          onPhase={(phase) => setSlamming(phase === "impact" && !prefersReducedMotion())}
          onDone={() => {
            setSlamming(false);
            dismissMoment();
          }}
        />
      ) : null}
      {slots.map((slot) => {
        const face = ghostFaces.get(slot.id) ?? null;
        return createPortal(
          <div
            key={slot.id}
            className="ghost-slot"
            data-end-id={slot.id}
            style={{ left: slot.left, top: slot.top, width: slot.width, height: slot.height }}
          >
            {face ? <Domino a={face.a} b={face.b} orientation={face.orientation} /> : null}
          </div>,
          document.body,
        );
      })}
      <Arrival lastPlay={view.lastPlay} yourId={view.yourId} layout={layout} />
      <FeelRipple knock={feel.knock} />
      {pop && popAt ? (
        <FlyingScore pop={pop} at={popAt} />
      ) : null}
    </div>
  );

  function chooseEnd(endId: string) {
    if (!selectedTile || !hotEnds.has(endId)) return;
    onPlay(selectedTile, endId);
    onSelect(null);
  }
}

function ghostFace(
  tileId: string,
  box: LayoutBox,
  end: PlacedEnd,
): { a: number; b: number; orientation: "horizontal" | "vertical" } {
  const parts = tileId.split("-").map((part) => Number(part));
  const low = Number.isFinite(parts[0]) ? parts[0]! : 0;
  const high = Number.isFinite(parts[1]) ? parts[1]! : low;
  const orientation = box.w >= box.h ? "horizontal" : "vertical";
  const match = low === end.match || high === end.match ? end.match : low;
  const other = match === low ? high : low;
  const dx = box.x + box.w / 2 - (end.x + end.w / 2);
  const dy = box.y + box.h / 2 - (end.y + end.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { a: match, b: other, orientation } : { a: other, b: match, orientation };
  }
  return dy >= 0 ? { a: match, b: other, orientation } : { a: other, b: match, orientation };
}

function Arrival({
  lastPlay,
  yourId,
  layout,
}: {
  lastPlay: PlayerView["lastPlay"];
  yourId: string;
  layout: BoardLayout | null;
}) {
  const seq = lastPlay?.seq ?? -1;
  const tileId = lastPlay?.tileId ?? null;
  const playerId = lastPlay?.playerId ?? null;
  const awarded = lastPlay?.awarded ?? 0;
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [face, setFace] = useState<{ a: number; b: number; orientation: "horizontal" | "vertical" } | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const skip = playerId === yourId || !tileId || bigMomentLevel(awarded) !== null || prefersReducedMotion();

  useLayoutEffect(() => {
    if (skip || !tileId || !playerId) {
      setBox(null);
      return;
    }
    let tile: HTMLElement | null = null;
    let frame = 0;
    let timer = 0;
    let cancelled = false;
    const start = () => {
      tile = document.querySelector<HTMLElement>(`[data-board-tile="${CSS.escape(tileId)}"]`);
      const seat = document.querySelector<HTMLElement>(`.rail[data-player-id="${CSS.escape(playerId)}"] .avatar`);
      if (!tile || !seat) return false;
      const to = tile.getBoundingClientRect();
      if (to.width < 2 || to.height < 2) return false;
      const from = seat.getBoundingClientRect();
      const placed = layoutRef.current?.tiles.find((item) => item.tileId === tileId);
      tile.classList.add("is-arriving");
      setFace(
        placed
          ? { a: placed.a, b: placed.b, orientation: placed.orientation }
          : { a: 0, b: 0, orientation: to.width >= to.height ? "horizontal" : "vertical" },
      );
      setBox({ left: from.left, top: from.top, width: Math.max(18, from.width), height: Math.max(18, from.height) });
      timer = window.setTimeout(() => {
        tile?.classList.remove("is-arriving");
        if (!cancelled) setBox(null);
      }, 420);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (cancelled || !tile) return;
          const landed = tile.getBoundingClientRect();
          setBox({ left: landed.left, top: landed.top, width: landed.width, height: landed.height });
        });
      });
      return true;
    };
    if (!start()) frame = window.requestAnimationFrame(() => {
      if (!cancelled) start();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      tile?.classList.remove("is-arriving");
      setBox(null);
    };
  }, [seq, tileId, playerId, skip]);

  if (!box || !face) return null;
  return createPortal(
    <div className="arrive-tile" data-arrive={tileId ?? ""} style={box}>
      <Domino a={face.a} b={face.b} orientation={face.orientation} />
    </div>,
    document.body,
  );
}

function nextSlotBox(layout: BoardLayout, end: PlacedEnd, isDouble: boolean): LayoutBox {
  const tip = [...layout.tiles].reverse().find((tile) => tile.arm === end.id);
  if (!tip) {
    const center = layout.tiles[0];
    if (!center) return end;
    return straightBox(center, end.id, isDouble);
  }
  // A double, and the tile played on a double, stay on the current line.
  const tipIsDouble = tip.direction === "north" || tip.direction === "south" ? tip.w > tip.h : tip.h > tip.w;
  if (isDouble || tipIsDouble) return straightBox(tip, tip.direction, isDouble);
  return layout.previews[end.id] ?? straightBox(tip, tip.direction, false);
}

interface ScreenBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function useScreenBoxes(
  stageRef: { current: HTMLDivElement | null },
  fit: LayoutBox | null,
  scale: number,
  boxes: Array<LayoutBox & { id: string }>,
): ScreenBox[] {
  const [placed, setPlaced] = useState<ScreenBox[]>([]);
  const key = boxes.map((box) => `${box.id}:${box.x}:${box.y}:${box.w}:${box.h}`).join("|");
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !fit || boxes.length === 0) {
      setPlaced([]);
      return;
    }
    const origin = stage.getBoundingClientRect();
    setPlaced(
      boxes.map((box) => {
        const local = place(box, fit);
        return {
          id: box.id,
          left: origin.left + local.left * scale,
          top: origin.top + local.top * scale,
          width: local.width * scale,
          height: local.height * scale,
        };
      }),
    );
  }, [stageRef, fit, scale, key, boxes]);
  return placed;
}

function useBigMoment(
  lastPlay: PlayerView["lastPlay"],
  players: PlayerView["players"],
  replayToken: number,
): {
  moment: { key: string; awarded: number; tileId: string | null; effect: FxId } | null;
  dismissMoment: () => void;
} {
  const liveKey = lastPlay && bigMomentLevel(lastPlay.awarded) ? `play-${lastPlay.seq}` : "";
  const skip = useRef(liveKey);
  const playersRef = useRef(players);
  playersRef.current = players;
  const [moment, setMoment] = useState<{ key: string; awarded: number; tileId: string | null; effect: FxId } | null>(null);
  const dismiss = () => setMoment(null);
  useEffect(() => {
    if (liveKey === skip.current) return;
    skip.current = liveKey;
    if (!liveKey || !lastPlay) return;
    const scorer = playersRef.current.find((player) => player.id === lastPlay.playerId);
    setMoment({ key: liveKey, awarded: lastPlay.awarded, tileId: lastPlay.tileId, effect: normalizeFx(scorer?.effectId) });
  }, [liveKey, lastPlay]);
  const tileRef = useRef(lastPlay?.tileId ?? null);
  tileRef.current = lastPlay?.tileId ?? null;
  useEffect(() => {
    if (replayToken <= 0) return;
    setMoment({ key: `demo-${replayToken}`, awarded: demoAward(), tileId: tileRef.current, effect: "glass" });
  }, [replayToken]);
  return { moment, dismissMoment: dismiss };
}

function useHitBox(
  stageRef: { current: HTMLDivElement | null },
  tileId: string | null,
  key: string,
  layout: BoardLayout | null,
  scale: number,
): HitBox | null {
  const [box, setBox] = useState<HitBox | null>(null);
  useLayoutEffect(() => {
    if (!key) return;
    const stage = stageRef.current;
    const el = tileId ? stage?.querySelector<HTMLElement>(`[data-board-tile="${CSS.escape(tileId)}"]`) : null;
    const rect = (el ?? stage)?.getBoundingClientRect();
    if (!rect) return;
    if (el) {
      setBox({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height });
      return;
    }
    setBox({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: 44, h: 88 });
  }, [stageRef, tileId, key, layout, scale]);
  return box;
}

function faceOf(tileId: string | null): { a: number; b: number } {
  const [low, high] = (tileId ?? "6-6").split("-").map((part) => Number(part));
  return { a: Number.isFinite(low) ? low! : 6, b: Number.isFinite(high) ? high! : 6 };
}

function useScorePop(lastPlay: PlayerView["lastPlay"]): { seq: number; awarded: number; tileId: string; endId: string; playerId: string } | null {
  const awarded = lastPlay?.awarded ?? 0;
  const seq = lastPlay && awarded >= 10 ? lastPlay.seq : -1;
  const tileId = lastPlay?.tileId ?? "";
  const endId = lastPlay?.endId ?? "";
  const playerId = lastPlay?.playerId ?? "";
  const [pop, setPop] = useState<{ seq: number; awarded: number; tileId: string; endId: string; playerId: string } | null>(null);
  useEffect(() => {
    if (seq < 0 || awarded < 10) {
      setPop(null);
      return;
    }
    // A routine award still appears at 460ms and leaves at 1100ms.
    // The flight into the chip happens inside that window.
    const timing = scorePopWindow(awarded);
    const show = window.setTimeout(() => setPop({ seq, awarded, tileId, endId, playerId }), timing.show);
    const hide = window.setTimeout(() => setPop(null), timing.hide);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [seq, awarded, tileId, endId, playerId]);
  return pop;
}

function FlyingScore({
  pop,
  at,
}: {
  pop: { seq: number; awarded: number; playerId: string };
  at: { left: number; top: number; place: "above" | "beside" };
}) {
  const [spot, setSpot] = useState(at);
  const [fly, setFly] = useState(false);
  useLayoutEffect(() => {
    setSpot(at);
    setFly(false);
    let frame = 0;
    const wait = scorePopWindow(pop.awarded).fly;
    const timer = window.setTimeout(() => {
      const chip = document.querySelector<HTMLElement>(`[data-win-score="${CSS.escape(pop.playerId)}"]`);
      const rect = chip?.getBoundingClientRect();
      if (!rect || rect.width < 1) return;
      frame = window.requestAnimationFrame(() => {
        setFly(true);
        setSpot({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2, place: "above" });
      });
    }, wait);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [pop.seq, pop.awarded, pop.playerId, at.left, at.top, at.place]);
  return createPortal(
    <p
      className="score-pop"
      style={{ left: spot.left, top: spot.top, transitionDuration: fly ? `${SCORE_FLY_MS}ms` : "0ms" }}
      data-awarded={pop.awarded}
      data-tier={scoreTier(pop.awarded)}
      data-place={fly ? "fly" : at.place}
      data-fly={fly ? "1" : "0"}
    >
      +{pop.awarded}
    </p>,
    document.body,
  );
}

function useAnchor(
  stageRef: { current: HTMLDivElement | null },
  layout: BoardLayout | null,
  fit: LayoutBox | null,
  scale: number,
  tileId: string | null,
  endId: string | null,
): { left: number; top: number; place: "above" | "beside" } | null {
  const [at, setAt] = useState<{ left: number; top: number; place: "above" | "beside" } | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !layout || !fit || !tileId) {
      setAt(null);
      return;
    }
    const tile = layout.tiles.find((item) => item.tileId === tileId);
    const end = layout.ends.find((item) => item.id === endId);
    const box = tile ?? end;
    if (!box) {
      setAt(null);
      return;
    }
    const felt = stage.closest(".table-scroll")?.getBoundingClientRect() ?? stage.getBoundingClientRect();
    const origin = stage.getBoundingClientRect();
    const local = place(box, fit);
    const node = stage.querySelector<HTMLElement>(`[data-board-tile="${CSS.escape(tileId)}"]`);
    const rect = node?.getBoundingClientRect();
    const width = rect && rect.width > 1 ? rect.width : local.width * scale;
    const tileLeft = rect && rect.width > 1 ? rect.left : origin.left + local.left * scale;
    const tileTop = rect && rect.height > 1 ? rect.top : origin.top + local.top * scale;
    // The award sits fully above the tile, or just outside it. The top edge
    // is already clear of the tile, so a fade cannot slide the number onto it.
    if (tileTop - 46 >= felt.top + 2) {
      setAt({ left: tileLeft + width / 2, top: tileTop - 46, place: "above" });
      return;
    }
    const roomRight = felt.right - (tileLeft + width);
    const roomLeft = tileLeft - felt.left;
    const beside = roomRight >= roomLeft ? tileLeft + width + 10 : Math.max(felt.left + 2, tileLeft - 58);
    setAt({ left: beside, top: Math.max(felt.top + 2, tileTop), place: "beside" });
  }, [stageRef, layout, fit, scale, tileId, endId]);
  return at;
}

function place(box: LayoutBox, fit: LayoutBox): { left: number; top: number; width: number; height: number } {
  return {
    left: box.x - fit.x,
    top: box.y - fit.y,
    width: box.w,
    height: box.h,
  };
}

type Ghost = {
  tileId: string;
  high: number;
  low: number;
  left: number;
  top: number;
  spring: boolean;
};

type Session = {
  pointerId: number;
  tileId: string;
  high: number;
  low: number;
  originX: number;
  originY: number;
  active: boolean;
};

export function Hand({
  view,
  selectedTile,
  onSelect,
  onPlay,
  onDragTile,
}: {
  view: PlayerView;
  selectedTile: string | null;
  onSelect: (tileId: string | null) => void;
  onPlay: (tileId: string, endId: string) => void;
  onDragTile: (tileId: string | null, aimEndId: string | null) => void;
}) {
  const mine = view.turnPlayerId === view.yourId;
  const session = useRef<Session | null>(null);
  const dragged = useRef(false);
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const motion = useRef(0);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onDragRef = useRef(onDragTile);
  onDragRef.current = onDragTile;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handRef = useRef<HTMLDivElement>(null);
  const count = view.you.hand.length;

  useLayoutEffect(() => {
    const el = handRef.current;
    const frame = el?.parentElement;
    if (!el || !frame) return;
    const natural = () =>
      window.matchMedia("(min-width: 880px) and (min-height: 640px)").matches
        ? 68
        : window.matchMedia("(min-width: 720px)").matches
          ? 58
          : 44;
    const apply = () => {
      const next = handFit(el.clientWidth, count, natural());
      el.style.setProperty("--hand-tile", `${next.tile}px`);
      el.style.setProperty("--hand-gap", `${next.gap}px`);
      el.dataset.scroll = next.scroll ? "true" : "false";
      const hidden = el.scrollWidth - el.clientWidth - el.scrollLeft;
      frame.dataset.fadeStart = next.scroll && el.scrollLeft > 4 ? "true" : "false";
      frame.dataset.fadeEnd = next.scroll && hidden > 4 ? "true" : "false";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    el.addEventListener("scroll", apply, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", apply);
    };
  }, [count]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    if (!liftedId) return;
    const blockScroll = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", blockScroll, { passive: false });
    document.body.classList.add("is-dragging");
    return () => {
      document.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("is-dragging");
    };
  }, [liftedId]);

  return (
    <div className="hand-frame">
    <div className="hand" role="list" ref={handRef} data-count={count} data-scroll="false">
      {view.you.hand.map((tile) => {
        const plays = view.legalPlays.filter((play) => play.tileId === tile.id);
        const playable = mine && plays.length > 0;
        const selected = selectedTile === tile.id;
        const lifted = liftedId === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            role="listitem"
            className={`hand-tile${playable ? " playable" : ""}${selected ? " selected" : ""}${lifted ? " lifted" : ""}`}
            data-tile-id={tile.id}
            data-playable={playable ? "true" : "false"}
            aria-label={`${tile.high} ${tile.low}${playable ? ", playable" : ""}`}
            aria-grabbed={lifted}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!playable || event.button !== 0) return;
              cancelMotion();
              dragged.current = false;
              session.current = {
                pointerId: event.pointerId,
                tileId: tile.id,
                high: tile.high,
                low: tile.low,
                originX: event.clientX,
                originY: event.clientY,
                active: false,
              };
            }}
            onPointerMove={(event) => moveDrag(event)}
            onPointerUp={(event) => finishDrag(event)}
            onPointerCancel={(event) => finishDrag(event, true)}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              if (!playable) return;
              if (plays.length === 1 && plays[0]) {
                onPlay(tile.id, plays[0].endId);
                onSelect(null);
                return;
              }
              onSelect(selected ? null : tile.id);
            }}
          >
            <Domino a={tile.high} b={tile.low} orientation="vertical" />
          </button>
        );
      })}
      {ghost
        ? createPortal(
            <div
              className={`drag-ghost${ghost.spring ? " spring" : ""}`}
              style={{ left: ghost.left, top: ghost.top, width: GHOST_WIDTH, height: GHOST_HEIGHT }}
            >
              <Domino a={ghost.high} b={ghost.low} orientation="vertical" />
            </div>,
            document.body,
          )
        : null}
    </div>
    </div>
  );

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.originX;
    const dy = event.clientY - current.originY;
    if (!current.active) {
      if (Math.hypot(dx, dy) < 12) return;
      // A sideways slide still scrolls the hand. A lift starts the drag.
      if (Math.abs(dx) > Math.abs(dy)) {
        dragged.current = true;
        return;
      }
      current.active = true;
      dragged.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone on a very fast lift.
      }
      setLiftedId(current.tileId);
      onSelectRef.current(null);
    }
    event.preventDefault();
    const parked = ghostTopLeft(event.clientX, event.clientY);
    setGhost({
      tileId: current.tileId,
      high: current.high,
      low: current.low,
      left: parked.left,
      top: parked.top,
      spring: false,
    });
    const aim = ghostAimPoint(event.clientX, event.clientY);
    onDragRef.current(current.tileId, chooseDropEnd(aim.x, aim.y, targetsFor(current.tileId, viewRef.current)));
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>, cancel = false) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    session.current = null;
    if (!current.active) return;
    const aim = ghostAimPoint(event.clientX, event.clientY);
    const targets = targetsFor(current.tileId, viewRef.current);
    const endId = cancel ? null : chooseDropEnd(aim.x, aim.y, targets);
    const parked = ghostTopLeft(event.clientX, event.clientY);
    onDragRef.current(null, null);
    const stamp = motion.current;
    if (endId) {
      const target = targets.find((box) => box.id === endId);
      if (target && !prefersReducedMotion()) {
        glide(current, parked, {
          left: target.left + target.width / 2 - GHOST_WIDTH / 2,
          top: target.top + target.height / 2 - GHOST_HEIGHT / 2,
        }, stamp, () => {
          setLiftedId(null);
          onPlayRef.current(current.tileId, endId);
          onSelectRef.current(null);
          setGhost(null);
        });
        return;
      }
      setLiftedId(null);
      onPlayRef.current(current.tileId, endId);
      onSelectRef.current(null);
      setGhost(null);
      return;
    }
    const home = document.querySelector<HTMLElement>(`[data-tile-id="${current.tileId}"]`);
    const rect = home?.getBoundingClientRect();
    if (!rect || prefersReducedMotion()) {
      setLiftedId(null);
      setGhost(null);
      return;
    }
    glide(current, parked, { left: rect.left, top: rect.top }, stamp, () => {
      setLiftedId(null);
      setGhost(null);
    });
  }

  function glide(
    current: Session,
    from: { left: number; top: number },
    to: { left: number; top: number },
    stamp: number,
    done: () => void,
  ) {
    const parked = {
      tileId: current.tileId,
      high: current.high,
      low: current.low,
    };
    setGhost({ ...parked, left: from.left, top: from.top, spring: true });
    frame.current = window.requestAnimationFrame(() => {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        if (motion.current !== stamp) return;
        setGhost({ ...parked, left: to.left, top: to.top, spring: true });
        later(done, 240);
      });
    });
  }

  function later(run: () => void, ms: number) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const stamp = motion.current;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (motion.current !== stamp) return;
      run();
    }, ms);
  }

  function cancelMotion() {
    motion.current += 1;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }
}

function targetsFor(tileId: string, view: PlayerView): DropBox[] {
  const ids = new Set(view.legalPlays.filter((play) => play.tileId === tileId).map((play) => play.endId));
  const targets: DropBox[] = [];
  if (ids.has("lead")) {
    const felt = document.querySelector(".table-scroll");
    if (felt) targets.push(toBox("lead", felt.getBoundingClientRect()));
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-end-id]")) {
    const id = element.dataset.endId;
    if (!id || !ids.has(id)) continue;
    targets.push(toBox(id, element.getBoundingClientRect()));
  }
  return targets;
}

function toBox(id: string, rect: DOMRect): DropBox {
  return { id, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
