/**
 * Pip centers for one half of a double-six tile.
 *
 * Coordinates are fractions of the half, origin at the top-left. The upright
 * pattern is the one on a vertical tile. A quarter turn rotates that pattern
 * with the tile, the way a physical domino does, so a 6's two columns become
 * two rows when the tile lies on its side.
 *
 * The corner dots used to sit in the outer cells of a 3×3 grid. On a 36px
 * half with a 7px face radius those cells fall outside the rounded corner,
 * so the dot painted on the tile's edge. Every dot now sits far enough in
 * that its whole circle is on the flat part of the face.
 */
export const PIP_INSET = 0.32;
export const PIP_RADIUS = 0.08;

const COLUMN = [PIP_INSET, 0.5, 1 - PIP_INSET] as const;
const ROW = [PIP_INSET, 0.5, 1 - PIP_INSET] as const;

/** Column, row in the upright 3×3. */
const SLOTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

export type PipRotation = 0 | 90 | 180 | 270;

export interface PipPoint {
  x: number;
  y: number;
}

export function pipCenters(value: number, rotation: PipRotation = 0): PipPoint[] {
  const upright = (SLOTS[value] ?? []).map(([column, row]) => ({
    x: COLUMN[column]!,
    y: ROW[row]!,
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
