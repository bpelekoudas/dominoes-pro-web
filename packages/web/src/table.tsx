import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PlayerView } from "@uhoh/rules";
import { layoutBoard, type LayoutBox } from "../../rules/src/layout.js";
import {
  chooseDropEnd,
  type DropBox,
  ghostAimPoint,
  ghostTopLeft,
  GHOST_HEIGHT,
  GHOST_WIDTH,
} from "./drop.js";

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
}: {
  view: PlayerView;
  selectedTile: string | null;
  dragTileId: string | null;
  aimEndId: string | null;
  onPlay: (tileId: string, endId: string) => void;
  onSelect: (tileId: string | null) => void;
}) {
  const board = view.board;
  const layout = useMemo(() => (board?.center ? layoutBoard(board) : null), [board]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !layout) return;
    const measure = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (width < 8 || height < 8) return;
      const next = Math.min(width / layout.fit.w, height / layout.fit.h, width >= 800 ? 2.4 : 2.2);
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout]);

  const focusTile = dragTileId ?? selectedTile;
  const hotEnds = new Set(
    focusTile ? view.legalPlays.filter((play) => play.tileId === focusTile).map((play) => play.endId) : [],
  );
  const dropLead = dragTileId !== null && hotEnds.has("lead");

  return (
    <div
      className={`table-scroll${dropLead ? " drop-ready" : ""}`}
      ref={viewportRef}
      data-open-total={view.openTotal}
      data-board-scale={scale.toFixed(2)}
      data-drop-ready={dropLead ? "true" : "false"}
    >
      {!layout ? (
        <p className="empty-felt">The felt is clear. Whoever leads, play a tile.</p>
      ) : (
        <div className="board-scaler" style={{ width: layout.fit.w * scale, height: layout.fit.h * scale }}>
          <div
            className="board-stage"
            style={{ width: layout.fit.w, height: layout.fit.h, transform: `scale(${scale})` }}
          >
            {layout.tiles.map((tile) => (
              <div key={tile.tileId} className="board-tile" style={place(tile, layout.fit)}>
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
                  className={`end-cap${hot ? " hot" : ""}${aim ? " aim" : ""}`}
                  style={place(end, layout.fit)}
                  data-end-id={end.id}
                  data-hot={hot ? "true" : "false"}
                  onClick={() => chooseEnd(end.id)}
                  aria-label={`Open ${end.id} end, match ${end.match}, counts ${end.scorePips}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  function chooseEnd(endId: string) {
    if (!selectedTile || !hotEnds.has(endId)) return;
    onPlay(selectedTile, endId);
    onSelect(null);
  }
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
    <div className="hand" role="list">
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
