/**
 * Intensity ladder, lowest to highest. Each step is meant to read without
 * a caption: normal, then a knock, then a good score, then a great one,
 * then the signature moments, then the wins.
 */
export const FEEL_TIERS = [
  "play",
  "knock",
  "score",
  "score-strong",
  "score-rare",
  "domino",
  "locked",
  "hand",
  "game",
  "match",
] as const;

export type FeelTier = (typeof FEEL_TIERS)[number];

export type FeelSound =
  | "place"
  | "place-heavy"
  | "knock"
  | "score"
  | "score-strong"
  | "score-rare"
  | "domino"
  | "hand"
  | "game"
  | "match"
  | "lock";

export interface TierSpec {
  tier: FeelTier;
  /** Time the turn clock must wait. Routine events stay at 0. */
  blockMs: number;
  /** Held quiet beat after the tile lands, before the reaction. */
  pauseMs: number;
  impactMs: number;
  word: string | null;
  shake: number;
  /** 0 is full light. Higher dims the felt. */
  dim: number;
  haptic: number[];
  sound: FeelSound;
  /** Quiet before the sound, so a big moment has contrast. */
  silenceMs: number;
}

/**
 * A routine opponent tile still travels for 420ms, and the score popup
 * still appears at 460ms and clears at 1100ms. Neither blocks the next turn.
 * Those numbers are the same after this pass.
 */
export const ROUTINE_TURN_MS = {
  before: { opponentArrive: 420, scoreShow: 460, scoreHide: 1100, blocked: 0 },
  after: { opponentArrive: 420, scoreShow: 460, scoreHide: 1100, blocked: 0 },
} as const;

const SPECS: Record<FeelTier, TierSpec> = {
  play: { tier: "play", blockMs: 0, pauseMs: 0, impactMs: 160, word: null, shake: 0, dim: 0, haptic: [], sound: "place", silenceMs: 0 },
  knock: { tier: "knock", blockMs: 0, pauseMs: 0, impactMs: 280, word: null, shake: 0, dim: 0, haptic: [14, 46, 14], sound: "knock", silenceMs: 0 },
  score: { tier: "score", blockMs: 0, pauseMs: 80, impactMs: 420, word: null, shake: 0, dim: 0, haptic: [12], sound: "score", silenceMs: 0 },
  "score-strong": { tier: "score-strong", blockMs: 0, pauseMs: 120, impactMs: 520, word: null, shake: 2, dim: 0, haptic: [16, 24, 14], sound: "score-strong", silenceMs: 0 },
  "score-rare": { tier: "score-rare", blockMs: 0, pauseMs: 180, impactMs: 640, word: null, shake: 5, dim: 0.08, haptic: [22, 30, 26], sound: "score-rare", silenceMs: 40 },
  domino: { tier: "domino", blockMs: 0, pauseMs: 200, impactMs: 700, word: "DOMINO!", shake: 6, dim: 0.12, haptic: [28, 36, 40], sound: "domino", silenceMs: 150 },
  locked: { tier: "locked", blockMs: 0, pauseMs: 220, impactMs: 880, word: "UH OH.", shake: 4, dim: 0.28, haptic: [18, 40, 18, 50, 24], sound: "lock", silenceMs: 150 },
  hand: { tier: "hand", blockMs: 0, pauseMs: 200, impactMs: 1500, word: "HAND WON", shake: 6, dim: 0.16, haptic: [30, 36, 34, 28, 48], sound: "hand", silenceMs: 150 },
  game: { tier: "game", blockMs: 0, pauseMs: 240, impactMs: 2400, word: "YOU WIN", shake: 8, dim: 0.34, haptic: [36, 40, 36, 40, 70], sound: "game", silenceMs: 150 },
  match: { tier: "match", blockMs: 0, pauseMs: 280, impactMs: 2500, word: null, shake: 10, dim: 0.4, haptic: [40, 48, 40, 48, 40, 90], sound: "match", silenceMs: 150 },
};

export function tierSpec(tier: FeelTier): TierSpec {
  return SPECS[tier];
}

/** Board points. 5 never scores. 10 is the small reward, 15–20 strong, 25+ rare. */
export function scoreTier(awarded: number): FeelTier {
  if (awarded >= 25) return "score-rare";
  if (awarded >= 15) return "score-strong";
  if (awarded >= 10) return "score";
  return "play";
}

export function tierRank(tier: FeelTier): number {
  return FEEL_TIERS.indexOf(tier);
}

/** A knock grows tighter as the streak climbs. The tier stays "knock". */
export function knockSpec(streak: number, reduced: boolean): TierSpec {
  const base = tierSpec("knock");
  const n = Math.max(1, streak);
  if (reduced) return { ...base, shake: 0, dim: 0, haptic: [], pauseMs: 0 };
  if (n >= 3) return { ...base, impactMs: 360, shake: 3, dim: 0.22, haptic: [16, 36, 16] };
  if (n === 2) return { ...base, impactMs: 320, shake: 1, dim: 0.08 };
  return base;
}

export function specFor(tier: FeelTier, reduced: boolean, knockStreak = 1): TierSpec {
  const spec = tier === "knock" ? knockSpec(knockStreak, reduced) : tierSpec(tier);
  if (!reduced || tier === "knock") return spec;
  return { ...spec, pauseMs: 0, shake: 0, dim: 0, haptic: [], silenceMs: 0, impactMs: Math.min(spec.impactMs, 280) };
}
