/** Same travel as a tile the player drags onto the chain (220ms ease, 240ms to land). */
export const OPPONENT_GLIDE_MS = 240;

export interface SeatBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * An opponent play that arrives while we are watching. The play already on
 * the table when we sit down (reconnect or a late join) does not fly.
 */
export function shouldFlyOpponentTile(input: {
  playerId: string | null;
  yourId: string;
  seq: number;
  joinedSeq: number | null;
  bigMoment: boolean;
  reducedMotion: boolean;
}): boolean {
  if (input.joinedSeq === null || input.seq === input.joinedSeq) return false;
  if (!input.playerId || input.playerId === input.yourId) return false;
  if (input.bigMoment || input.reducedMotion) return false;
  return true;
}

/** Where the face-down tile was, before this play removed it from the side hand. */
export function departureBox(hands: ReadonlyMap<string, SeatBox>, playerId: string): SeatBox | null {
  const box = hands.get(playerId);
  if (!box || box.width < 2 || box.height < 2) return null;
  return box;
}

/** The camera stays put until this flight's seq is cleared. */
export function cameraBlockedByFlight(hold: { seq: number } | null, seq: number): boolean {
  return hold !== null && hold.seq === seq;
}

/**
 * The felt is still showing the previous chain. A new hand can replace the
 * play seq before that glide is cleared, so the flight check alone lets the
 * opening scale through and the old chain is cut off at the felt edge.
 */
export function holdCameraForChain(input: {
  chainHeld: boolean;
  flightHold: { seq: number } | null;
  liveSeq: number;
  haveHeldScale: boolean;
}): boolean {
  if (input.chainHeld) return true;
  return input.haveHeldScale && cameraBlockedByFlight(input.flightHold, input.liveSeq);
}

/** Tiles already on the felt stay where they are while an opponent tile is in the air. */
export function boardDuringOpponentFlight<T>(previous: T, next: T, flying: boolean): T {
  return flying ? previous : next;
}
