import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { layoutBoard, type LayoutBox } from "../../rules/src/layout.js";

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
  onPlay,
  onSelect,
}: {
  view: PlayerView;
  selectedTile: string | null;
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
      const next = Math.min(width / layout.fit.w, height / layout.fit.h, width >= 800 ? 2 : 1.65);
      setScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout]);

  const hotEnds = new Set(
    selectedTile ? view.legalPlays.filter((play) => play.tileId === selectedTile).map((play) => play.endId) : [],
  );

  return (
    <div className="table-scroll" ref={viewportRef} data-open-total={view.openTotal} data-board-scale={scale.toFixed(2)}>
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
              return (
                <button
                  key={end.id}
                  type="button"
                  className={`end-cap${hot ? " hot" : ""}`}
                  style={place(end, layout.fit)}
                  data-end-id={end.id}
                  data-hot={hot ? "true" : "false"}
                  onClick={() => chooseEnd(end.id)}
                  aria-label={`Open ${end.id} end, match ${end.match}, counts ${end.scorePips}`}
                >
                  <strong className={`pip-badge badge-${end.id}`}>{end.match}</strong>
                  {end.scorePips !== end.match ? <small>×2</small> : null}
                </button>
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

export function Hand({
  view,
  selectedTile,
  onSelect,
  onPlay,
}: {
  view: PlayerView;
  selectedTile: string | null;
  onSelect: (tileId: string | null) => void;
  onPlay: (tileId: string, endId: string) => void;
}) {
  const mine = view.turnPlayerId === view.yourId;
  return (
    <div className="hand" role="list">
      {view.you.hand.map((tile) => {
        const plays = view.legalPlays.filter((play) => play.tileId === tile.id);
        const playable = mine && plays.length > 0;
        const selected = selectedTile === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            role="listitem"
            className={`hand-tile${playable ? " playable" : ""}${selected ? " selected" : ""}`}
            data-tile-id={tile.id}
            data-playable={playable ? "true" : "false"}
            aria-label={`${tile.high} ${tile.low}${playable ? ", playable" : ""}`}
            onClick={() => {
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
    </div>
  );
}
