/** Screen pixels. The dragged tile is this tall, and it floats this far above the fingertip. */
export const GHOST_WIDTH = 48;
export const GHOST_HEIGHT = 96;
export const GHOST_LIFT = 64;

/** Extra pixels around an open end that still count as a drop on that end. */
export const DROP_SLOP = 36;

export interface DropBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the tile itself is, so the player aims the tile rather than the fingertip. */
export function ghostAimPoint(clientX: number, clientY: number): { x: number; y: number } {
  return {
    x: clientX,
    y: clientY - GHOST_LIFT - GHOST_HEIGHT / 2,
  };
}

export function ghostTopLeft(clientX: number, clientY: number): { left: number; top: number } {
  return {
    left: clientX - GHOST_WIDTH / 2,
    top: clientY - GHOST_HEIGHT - GHOST_LIFT,
  };
}

/**
 * Which open end a drop lands on.
 * A point on two ends picks the nearer center. A point on none of them is a miss.
 */
export function chooseDropEnd(x: number, y: number, targets: readonly DropBox[], slop = DROP_SLOP): string | null {
  const hits = targets.filter((box) =>
    x >= box.left - slop &&
    x <= box.left + box.width + slop &&
    y >= box.top - slop &&
    y <= box.top + box.height + slop,
  );
  if (hits.length === 0) return null;
  hits.sort((a, b) => distanceToCenter(a, x, y) - distanceToCenter(b, x, y));
  return hits[0]!.id;
}

function distanceToCenter(box: DropBox, x: number, y: number): number {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = cx - x;
  const dy = cy - y;
  return dx * dx + dy * dy;
}
