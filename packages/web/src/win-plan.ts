import { BIG_MOMENT_MS, bigMomentLevel } from "../../rules/src/moment.js";

/** Face-up reveal when the hand pays nothing. */
export const ZERO_HOLD_MS = 2000;
/** Reveal plus the pip flight, before the score pulse finishes. */
export const HAND_HOLD_MS = 2400;
export const GAME_BANNER_MS = 2400;
export const MATCH_BANNER_MS = 2500;
/** Domino, then HAND WON, before the pip tally. Shorter when the UH-OH slam already played. */
export const HAND_CALL_MS = 1100;
export const HAND_CALL_AFTER_UHOH_MS = 420;
export const LOCK_CALL_MS = 880;
export const PIP_START_MS = 420;
export const PIP_FLIGHT_MS = 680;
/** The last pip has landed by this time, then the score pulses. */
export const PIP_LAND_BY_MS = 2200;
export const PULSE_MS = 350;
export const MAX_PIPS = 12;
export const PIP_BEND = 36;
/** Same shortened UH-OH read as the big-moment title. */
export const UHOH_REDUCED_MS = 900;

export interface PipTile {
  id: string;
}

export interface PipSeat {
  playerId: string;
  tiles: readonly PipTile[];
}

export interface WinPip {
  id: string;
  winnerId: string;
  value: number;
  sourcePlayerId: string;
  sourceTileId: string;
  startMs: number;
  flightMs: number;
  /** Which side of the path the curve bends toward. */
  bend: 1 | -1;
}

export interface WinPlan {
  pips: WinPip[];
  holdMs: number;
  /** Points are owed, but nobody else still holds a tile to fly them from. */
  jump: boolean;
  awards: Record<string, number>;
}

/**
 * Split each leftover award into a short, deterministic stream of pips.
 * The values add up to the award. Sources are the tiles everyone except
 * the winners still holds, in player then tile order, dealt round-robin.
 */
export function planWinPips(awards: Record<string, number>, remaining: readonly PipSeat[]): WinPlan {
  const clean: Record<string, number> = {};
  for (const [id, value] of Object.entries(awards)) clean[id] = value > 0 ? value : 0;
  const winners = Object.keys(clean)
    .filter((id) => (clean[id] ?? 0) > 0)
    .sort();
  const winnerSet = new Set(winners);
  const sources: Array<{ playerId: string; tileId: string }> = [];
  const seats = [...remaining].sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  for (const seat of seats) {
    if (winnerSet.has(seat.playerId)) continue;
    const tiles = [...seat.tiles].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const tile of tiles) sources.push({ playerId: seat.playerId, tileId: tile.id });
  }
  if (winners.length === 0) return { pips: [], holdMs: ZERO_HOLD_MS, jump: false, awards: clean };
  if (sources.length === 0) return { pips: [], holdMs: ZERO_HOLD_MS, jump: true, awards: clean };

  const pips: WinPip[] = [];
  let cursor = 0;
  for (const winnerId of winners) {
    const award = clean[winnerId] ?? 0;
    const count = Math.min(MAX_PIPS, award);
    const base = Math.floor(award / count);
    const extra = award - base * count;
    for (let index = 0; index < count; index += 1) {
      const source = sources[cursor % sources.length]!;
      cursor += 1;
      pips.push({
        id: `${winnerId}:${index}`,
        winnerId,
        value: base + (index < extra ? 1 : 0),
        sourcePlayerId: source.playerId,
        sourceTileId: source.tileId,
        startMs: 0,
        flightMs: PIP_FLIGHT_MS,
        bend: index % 2 === 0 ? 1 : -1,
      });
    }
  }

  const lastIndex = pips.length - 1;
  const lastStart = Math.max(PIP_START_MS, PIP_LAND_BY_MS - PIP_FLIGHT_MS);
  const span = lastStart - PIP_START_MS;
  for (let index = 0; index < pips.length; index += 1) {
    const start = pips.length === 1 ? PIP_START_MS : PIP_START_MS + (span * index) / lastIndex;
    pips[index]!.startMs = Math.round(start);
  }
  const lastLand = pips[lastIndex]!.startMs + PIP_FLIGHT_MS;
  return {
    pips,
    holdMs: Math.max(HAND_HOLD_MS, lastLand + PULSE_MS),
    jump: false,
    awards: clean,
  };
}

export function lastLandMs(plan: WinPlan): number {
  if (plan.pips.length === 0) return plan.jump ? Math.max(0, plan.holdMs - PULSE_MS) : -1;
  return Math.max(...plan.pips.map((pip) => pip.startMs + pip.flightMs));
}

/** Score readout while the pips are in the air. Reduced motion jumps straight to the award. */
export function scoreAt(
  base: Record<string, number>,
  plan: WinPlan,
  elapsed: number,
  reduced: boolean,
): Record<string, number> {
  const shown = { ...base };
  const apply = () => {
    for (const [id, award] of Object.entries(plan.awards)) {
      if (award > 0) shown[id] = (base[id] ?? 0) + award;
    }
  };
  if (reduced) {
    apply();
    return shown;
  }
  if (plan.pips.length === 0) {
    if (plan.jump && elapsed >= plan.holdMs - PULSE_MS) apply();
    return shown;
  }
  for (const pip of plan.pips) {
    if (elapsed >= pip.startMs + pip.flightMs) {
      shown[pip.winnerId] = (shown[pip.winnerId] ?? 0) + pip.value;
    }
  }
  return shown;
}

export function winBannerCopy(kind: "game" | "match", name: string, local: boolean): string {
  if (kind === "match") return local ? "You Win the Match!" : `${name} Wins the Match!`;
  return local ? "YOU WIN" : "GAME WON";
}

/** The word that plays before the pip tally. A score-out has no extra call. */
export function callMs(reason: "domino" | "locked" | "score", awarded: number | null, reduced: boolean): number {
  if (reason === "score") return 0;
  if (reduced) return 280;
  if (reason === "locked") return LOCK_CALL_MS;
  return bigMomentLevel(awarded ?? 0) ? HAND_CALL_AFTER_UHOH_MS : HAND_CALL_MS;
}

/**
 * The winning play and the UH-OH moment arrive together. Wait that moment
 * out before the pips. A later lock does not wait on an earlier score.
 */
export function uhOhWaitMs(
  reason: "domino" | "locked" | "score",
  awarded: number | null,
  reduced: boolean,
): number {
  if (reason !== "domino" || awarded == null || !bigMomentLevel(awarded)) return 0;
  return reduced ? UHOH_REDUCED_MS : BIG_MOMENT_MS;
}

export interface CelebrationStep {
  stage: "uhoh" | "call" | "reveal" | "banner" | "lineup" | "sheet";
  ms: number;
  banner?: "game" | "match";
  call?: "domino" | "lock";
}

/** Client-only sequence. Bots use the same lengths; the server continue clock stays put. */
export function celebrationTimeline(input: {
  reason: "domino" | "locked" | "score";
  awarded: number | null;
  plan: WinPlan;
  gameWinner: boolean;
  seriesWinner: boolean;
  reduced: boolean;
}): { steps: CelebrationStep[]; untilSheet: number } {
  const steps: CelebrationStep[] = [];
  const wait = uhOhWaitMs(input.reason, input.awarded, input.reduced);
  if (wait > 0) steps.push({ stage: "uhoh", ms: wait });
  const call = callMs(input.reason, input.awarded, input.reduced);
  if (call > 0) steps.push({ stage: "call", ms: call, call: input.reason === "locked" ? "lock" : "domino" });
  steps.push({ stage: "reveal", ms: input.plan.holdMs });
  if (input.seriesWinner) {
    steps.push({ stage: "banner", ms: MATCH_BANNER_MS, banner: "match" });
    // Tap moves the lineup on. It does not eat the continue clock.
    steps.push({ stage: "lineup", ms: 0 });
  } else if (input.gameWinner) steps.push({ stage: "banner", ms: GAME_BANNER_MS, banner: "game" });
  steps.push({ stage: "sheet", ms: 0 });
  const untilSheet = steps.reduce((sum, step) => sum + step.ms, 0);
  return { steps, untilSheet };
}

export function easeInOut(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - ((-2 * clamped + 2) ** 2) / 2;
}

export interface Point {
  x: number;
  y: number;
}

/** Quadratic curve. The control point sits PIP_BEND pixels off the straight line. */
export function pipPosition(t: number, from: Point, to: Point, bend: 1 | -1): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (from.x + to.x) / 2 + (-dy / len) * PIP_BEND * bend;
  const cy = (from.y + to.y) / 2 + (dx / len) * PIP_BEND * bend;
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
    y: u * u * from.y + 2 * u * t * cy + t * t * to.y,
  };
}

export function bannerMotion(
  kind: "game" | "match",
  elapsed: number,
  reduced: boolean,
): { scale: number; opacity: number } {
  if (reduced) return { scale: 1, opacity: Math.max(0, Math.min(1, elapsed / 180)) };
  const keys: Array<[number, number]> =
    kind === "match"
      ? [
          [0, 0.04],
          [520, 1.28],
          [780, 0.94],
          [980, 1],
        ]
      : [
          [0, 0.18],
          [360, 1.14],
          [520, 0.97],
          [640, 1],
        ];
  let scale = keys[0]![1];
  if (elapsed <= keys[0]![0]) scale = keys[0]![1];
  else if (elapsed >= keys[keys.length - 1]![0]) scale = keys[keys.length - 1]![1];
  else {
    for (let index = 1; index < keys.length; index += 1) {
      const prev = keys[index - 1]!;
      const next = keys[index]!;
      if (elapsed <= next[0]) {
        const span = next[0] - prev[0] || 1;
        const mix = (elapsed - prev[0]) / span;
        scale = prev[1] + (next[1] - prev[1]) * mix;
        break;
      }
    }
  }
  return { scale, opacity: elapsed <= 0 ? 0 : Math.min(1, elapsed / 120) };
}

export interface ConfettiBit {
  id: number;
  x: number;
  y: number;
  rot: number;
  size: number;
  color: "#e31e26" | "#d5a336";
  opacity: number;
  round: boolean;
}

export function confettiAt(kind: "game" | "match", elapsed: number, reduced: boolean): ConfettiBit[] {
  if (reduced || elapsed <= 0) return [];
  const count = kind === "match" ? 46 : 8;
  const bits: ConfettiBit[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + (index % 5) * 0.08;
    const dist = (kind === "match" ? 220 : 120) + (index % 7) * (kind === "match" ? 26 : 16);
    const delay = (index % 8) * 28;
    const life = kind === "match" ? 1200 : 900;
    const local = elapsed - delay;
    if (local <= 0) continue;
    const progress = Math.min(1, local / life);
    const ease = 1 - (1 - progress) * (1 - progress);
    const fade = progress < 0.72 ? 1 : Math.max(0, 1 - (progress - 0.72) / 0.28);
    bits.push({
      id: index,
      x: Math.cos(angle) * dist * ease,
      y: Math.sin(angle) * dist * ease * 0.72 + ease * (kind === "match" ? 48 : 28),
      rot: (index % 2 === 0 ? 1 : -1) * (36 + (index % 9) * 24) * ease,
      size: 6 + (index % 4) * 3,
      color: index % 2 === 0 ? "#e31e26" : "#d5a336",
      opacity: fade,
      round: kind === "match" && index % 3 === 0,
    });
  }
  return bits;
}

export function matchImpact(elapsed: number, reduced: boolean): { flash: number; shock: number; shockOpacity: number } {
  if (reduced) return { flash: 0, shock: 1, shockOpacity: 0 };
  const flash = elapsed < 70 ? elapsed / 70 : elapsed < 300 ? 1 - (elapsed - 70) / 230 : 0;
  const grow = Math.max(0, Math.min(1, elapsed / 760));
  return {
    flash: Math.max(0, flash) * 0.72,
    shock: 0.12 + grow * 1.7,
    shockOpacity: grow <= 0 ? 0 : (1 - grow) * 0.9,
  };
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/** Where a revealed hand sits relative to that player's rail. */
export function revealOrigin(
  edge: "left" | "top" | "right" | "bottom",
  rail: Box,
  row: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let left = rail.left;
  let top = rail.bottom + 6;
  if (edge === "left") {
    left = rail.right + 8;
    top = rail.top + Math.min(72, Math.max(48, rail.height * 0.2));
  } else if (edge === "right") {
    left = rail.left - row.width - 8;
    top = rail.top + Math.min(72, Math.max(48, rail.height * 0.2));
  } else if (edge === "bottom") {
    left = rail.left;
    top = rail.top - row.height - 8;
  }
  left = Math.max(8, Math.min(left, viewport.width - row.width - 8));
  top = Math.max(8, Math.min(top, viewport.height - row.height - 8));
  return { left, top };
}
