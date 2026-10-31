import type { FeelTier } from "./ladder.js";

/**
 * Moments the director can notice. Most are hooks. Only close-game,
 * lead-change, and near-target change the picture today.
 */
export const CONTEXT_EVENTS = [
  "lead-change",
  "first-lead",
  "takes-lead",
  "comeback",
  "last-to-first",
  "huge-score",
  "shutout",
  "long-hand",
  "knock-streak",
  "rare-combo",
  "final-tile",
  "near-target",
  "close-game",
] as const;

export type ContextEvent = (typeof CONTEXT_EVENTS)[number];

/** These three get a restrained cue. The rest are detected and left for later. */
export const WIRED_CONTEXT: readonly ContextEvent[] = ["close-game", "lead-change", "near-target"];

export interface SeatSnap {
  id: string;
  score: number;
}

export interface FeelSnap {
  seats: readonly SeatSnap[];
  target: number;
  awarded: number;
  tileId: string | null;
  /** Tiles on the table. A long chain is a long hand. */
  boardTiles: number;
  knockStreak: number;
  reason: "play" | "knock" | "domino" | "locked" | "hand" | "game" | "match" | null;
  actorId: string | null;
  winnerIds: readonly string[];
  pipCounts: Record<string, number> | null;
}

export function leaderId(seats: readonly SeatSnap[]): string | null {
  let best: SeatSnap | null = null;
  let tied = false;
  for (const seat of seats) {
    if (!best || seat.score > best.score) {
      best = seat;
      tied = false;
    } else if (seat.score === best.score) tied = true;
  }
  if (!best || best.score <= 0 || tied) return null;
  return best.id;
}

function lowestId(seats: readonly SeatSnap[]): string | null {
  if (seats.length === 0) return null;
  return [...seats].sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1))[0]!.id;
}

function isDouble(tileId: string | null): boolean {
  if (!tileId) return false;
  const [low, high] = tileId.split("-");
  return low !== undefined && low === high;
}

/** What changed between two snapshots. Order is stable. */
export function detectContext(prev: FeelSnap | null, next: FeelSnap): ContextEvent[] {
  const found = new Set<ContextEvent>();
  const before = leaderId(prev?.seats ?? []);
  const after = leaderId(next.seats);
  if (after && after !== before) {
    if (!before) found.add("first-lead");
    else found.add("lead-change");
    if (next.actorId === after) found.add("takes-lead");
  }

  const actor = next.actorId;
  if (actor && prev) {
    const oldSeats = prev.seats;
    const oldLeader = leaderId(oldSeats);
    const oldActor = oldSeats.find((seat) => seat.id === actor)?.score ?? 0;
    const oldTop = Math.max(0, ...oldSeats.map((seat) => seat.score));
    const now = next.seats.find((seat) => seat.id === actor)?.score ?? oldActor;
    if (oldLeader && oldLeader !== actor && oldTop - oldActor >= 25 && (now >= oldTop || next.winnerIds.includes(actor))) {
      found.add("comeback");
    }
    if (lowestId(oldSeats) === actor && after === actor && oldSeats.length > 1 && (oldSeats.find((seat) => seat.id === actor)?.score ?? 0) < oldTop) {
      found.add("last-to-first");
    }
  }

  if (next.awarded >= 25) found.add("huge-score");
  if (next.reason === "domino" && next.pipCounts) {
    const others = Object.entries(next.pipCounts).filter(([id]) => !next.winnerIds.includes(id));
    if (others.length > 0 && others.every(([, pips]) => pips >= 10)) found.add("shutout");
  }
  if (next.boardTiles >= 18) found.add("long-hand");
  if (next.knockStreak >= 2) found.add("knock-streak");
  if ((isDouble(next.tileId) && next.awarded >= 15) || next.awarded >= 30) found.add("rare-combo");
  if (next.reason === "domino") found.add("final-tile");
  if (next.seats.some((seat) => seat.score < next.target && next.target - seat.score <= 15 && seat.score >= next.target - 15)) {
    found.add("near-target");
  }
  const ranked = [...next.seats].sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const second = ranked[1]?.score ?? 0;
  if (ranked.length >= 2 && top >= next.target * 0.55 && top - second <= 10 && second >= next.target * 0.5) {
    found.add("close-game");
  }

  return CONTEXT_EVENTS.filter((event) => found.has(event));
}

/** Cues that should actually change the picture for this tier. */
export function wiredCues(events: readonly ContextEvent[], tier: FeelTier): ContextEvent[] {
  if (tier === "match" || tier === "game") return [];
  return events.filter((event) => WIRED_CONTEXT.includes(event));
}
