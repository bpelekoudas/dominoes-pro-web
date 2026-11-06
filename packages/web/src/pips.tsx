/**
 * Pip centers for one half of a double-six tile.
 *
 * Coordinates are fractions of the half, origin at the top-left. Neighbouring
 * pips are one pitch apart on both axes, so a 6 is a 2×3 grid and not a
 * stretched 3×3 with a hole in the middle. A quarter turn rotates that grid
 * with the tile. The diameter is one number, used for both width and height,
 * so a pip stays a circle when the half is not square.
 */
/** Centre-to-centre, as a fraction of the half. A 6 then reaches near both edges. */
export const PIP_PITCH = 0.3;
/** Diameter as a fraction of the half's shorter side. Matches 16cqmin in the CSS. */
export const PIP_DIAMETER = 0.16;
export const PIP_RADIUS = PIP_DIAMETER / 2;

export type PipRotation = 0 | 90 | 180 | 270;

export interface PipPoint {
  x: number;
  y: number;
}

/** Column and row offsets from the centre, in pitches. */
const OFFSETS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  0: [],
  1: [[0, 0]],
  2: [[-0.5, -0.5], [0.5, 0.5]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  // Two columns, three rows. The column gap equals the row gap.
  6: [[-0.5, -1], [0.5, -1], [-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]],
};

export function pipCenters(value: number, rotation: PipRotation = 0): PipPoint[] {
  const upright = (OFFSETS[value] ?? []).map(([column, row]) => ({
    x: 0.5 + column * PIP_PITCH,
    y: 0.5 + row * PIP_PITCH,
  }));
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
