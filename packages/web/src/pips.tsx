/**
 * Pip centers for one half of a double-six tile.
 *
 * Coordinates are fractions of the half, origin at the top-left. A 4 uses the
 * four corners. A 6 uses those same corners plus the middle of each side, so
 * the 4 does not float in the centre of the half. A quarter turn rotates the
 * grid with the tile. The diameter is one number for both axes, so a pip stays
 * a circle when the half is not square.
 */
/**
 * Measured on Bryan's 6-6 crop: the tile is 95px wide and the half about 93px
 * tall. Column centres are 0.20 of the half's width in from the long edges.
 * The end row is 0.19 of the half's length in from the end, so the two row
 * gaps are 0.31 (his pitch reading was about 0.29). A 4 and a 5 use those
 * same corners. The dot is 0.20 of the half's width.
 */
export const PIP_DIAMETER = 0.2;
export const PIP_COL_INSET = 0.2;
export const PIP_END_INSET = 0.19;
export const PIP_PITCH = (1 - 2 * PIP_END_INSET) / 2;
/** Kept so older checks can say "the corner inset". A 4's corner uses both. */
export const PIP_INSET = PIP_END_INSET;
export const PIP_RADIUS = PIP_DIAMETER / 2;

export type PipRotation = 0 | 90 | 180 | 270;

export interface PipPoint {
  x: number;
  y: number;
}

const COL = PIP_COL_INSET;
const FAR_COL = 1 - PIP_COL_INSET;
const END = PIP_END_INSET;
const FAR_END = 1 - PIP_END_INSET;
const MID = 0.5;

/** Positions in the upright half, before a turn. */
const FACES: Record<number, ReadonlyArray<readonly [number, number]>> = {
  0: [],
  1: [[MID, MID]],
  2: [
    [COL, END],
    [FAR_COL, FAR_END],
  ],
  3: [
    [COL, END],
    [MID, MID],
    [FAR_COL, FAR_END],
  ],
  4: [
    [COL, END],
    [FAR_COL, END],
    [COL, FAR_END],
    [FAR_COL, FAR_END],
  ],
  5: [
    [COL, END],
    [FAR_COL, END],
    [MID, MID],
    [COL, FAR_END],
    [FAR_COL, FAR_END],
  ],
  // Two columns on the 4's side inset, three rows on the 4's end inset.
  6: [
    [COL, END],
    [FAR_COL, END],
    [COL, MID],
    [FAR_COL, MID],
    [COL, FAR_END],
    [FAR_COL, FAR_END],
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
