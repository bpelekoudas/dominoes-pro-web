/**
 * Pip centers for one half of a double-six tile.
 *
 * Coordinates are fractions of the half, origin at the top-left. A 4 uses the
 * four corners. A 6 uses those same corners plus the middle of each side, so
 * the 4 does not float in the centre of the half. A quarter turn rotates the
 * grid with the tile. The diameter is one number for both axes, so a pip stays
 * a circle when the half is not square.
 */
/** Centre of a corner pip, as a fraction of the half from each edge. */
export const PIP_INSET = 0.24;
/** Diameter as a fraction of the half's shorter side. Matches 18cqmin in the CSS. */
export const PIP_DIAMETER = 0.18;
export const PIP_RADIUS = PIP_DIAMETER / 2;

export type PipRotation = 0 | 90 | 180 | 270;

export interface PipPoint {
  x: number;
  y: number;
}

const EDGE = PIP_INSET;
const FAR = 1 - PIP_INSET;
const MID = 0.5;

/** Positions in the upright half, before a turn. */
const FACES: Record<number, ReadonlyArray<readonly [number, number]>> = {
  0: [],
  1: [[MID, MID]],
  2: [
    [EDGE, EDGE],
    [FAR, FAR],
  ],
  3: [
    [EDGE, EDGE],
    [MID, MID],
    [FAR, FAR],
  ],
  4: [
    [EDGE, EDGE],
    [FAR, EDGE],
    [EDGE, FAR],
    [FAR, FAR],
  ],
  5: [
    [EDGE, EDGE],
    [FAR, EDGE],
    [MID, MID],
    [EDGE, FAR],
    [FAR, FAR],
  ],
  // Two columns on the corner lines, three evenly spaced rows.
  6: [
    [EDGE, EDGE],
    [FAR, EDGE],
    [EDGE, MID],
    [FAR, MID],
    [EDGE, FAR],
    [FAR, FAR],
  ],
};

export function pipCenters(value: number, rotation: PipRotation = 0): PipPoint[] {
  const upright = (FACES[value] ?? []).map(([x, y]) => ({ x, y }));
  return upright.map((point) => rotatePip(point, rotation));
}

/** Clockwise about the centre of the half. */
export function rotatePip(point: PipPoint, rotation: PipRotation): PipPoint {
  let x = point.x - 0.5;
  let y = point.y - 0.5;
  const turns = rotation / 90;
  for (let turn = 0; turn < turns; turn += 1) {
    const nextX = y;
    const nextY = -x;
    x = nextX;
    y = nextY;
  }
  return { x: x + 0.5, y: y + 0.5 };
}

/** Vertical tiles keep the upright pattern. Horizontal tiles take it through a quarter turn. */
export function faceRotation(orientation: "horizontal" | "vertical"): PipRotation {
  return orientation === "horizontal" ? 90 : 0;
}

export function PipHalf({ value, rotation }: { value: number; rotation: PipRotation }) {
  return (
    <span className="half" aria-hidden="true">
      {pipCenters(value, rotation).map((pip) => (
        <i key={`${pip.x.toFixed(4)}-${pip.y.toFixed(4)}`} style={{ left: `${pip.x * 100}%`, top: `${pip.y * 100}%` }} />
      ))}
      <b className="pip-num">{value}</b>
    </span>
  );
}
