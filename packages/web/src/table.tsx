import type { PlayerView } from "@uhoh/rules";

const PIPS: Record<number, number[]> = {
  0: [],
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

type Board = NonNullable<PlayerView["board"]>;
type Oriented = Board["arms"]["west"][number];
type Direction = "west" | "east" | "north" | "south";

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
  const ends = new Map(view.openEnds.map((end) => [end.id, end]));
  const hotEnds = new Set(
    selectedTile ? view.legalPlays.filter((play) => play.tileId === selectedTile).map((play) => play.endId) : [],
  );

  return (
    <div className="table-scroll" data-open-total={view.openTotal}>
      {!board?.center ? (
        <p className="empty-felt">The felt is clear. Whoever leads, play a tile.</p>
      ) : (
        <div className="cross">
          <Arm direction="north" tiles={board.arms.north} end={ends.get("north")} hot={hotEnds.has("north")} onEnd={() => chooseEnd("north")} />
          <Arm direction="west" tiles={board.arms.west} end={ends.get("west")} hot={hotEnds.has("west")} onEnd={() => chooseEnd("west")} />
          <div className="center-slot">
            <Domino
              a={board.center.westValue}
              b={board.center.eastValue}
              orientation={board.center.low === board.center.high ? "vertical" : "horizontal"}
              spinner={board.center.isSpinner}
            />
          </div>
          <Arm direction="east" tiles={board.arms.east} end={ends.get("east")} hot={hotEnds.has("east")} onEnd={() => chooseEnd("east")} />
          <Arm direction="south" tiles={board.arms.south} end={ends.get("south")} hot={hotEnds.has("south")} onEnd={() => chooseEnd("south")} />
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

function Arm({
  direction,
  tiles,
  end,
  hot,
  onEnd,
}: {
  direction: Direction;
  tiles: Oriented[];
  end: PlayerView["openEnds"][number] | undefined;
  hot: boolean;
  onEnd: () => void;
}) {
  if (!end && tiles.length === 0) return <div className={`arm arm-${direction}`} />;
  return (
    <div className={`arm arm-${direction}`}>
      {tiles.map((tile) => {
        const faces = facing(direction, tile);
        const isDouble = tile.low === tile.high;
        const along = direction === "west" || direction === "east" ? "horizontal" : "vertical";
        return (
          <Domino
            key={tile.tileId}
            a={faces.a}
            b={faces.b}
            orientation={isDouble ? (along === "horizontal" ? "vertical" : "horizontal") : along}
          />
        );
      })}
      {end ? (
        <button
          type="button"
          className={`end-cap${hot ? " hot" : ""}`}
          data-end-id={end.id}
          data-hot={hot ? "true" : "false"}
          onClick={onEnd}
          aria-label={`Open ${end.id} end, match ${end.match}, counts ${end.scorePips}`}
        >
          <strong>{end.match}</strong>
          {end.scorePips !== end.match ? <small>×2</small> : null}
        </button>
      ) : null}
    </div>
  );
}

function facing(direction: Direction, tile: Oriented): { a: number; b: number } {
  if (direction === "west" || direction === "north") return { a: tile.outward, b: tile.inward };
  return { a: tile.inward, b: tile.outward };
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
