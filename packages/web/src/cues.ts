import { SLAM_MS } from "./glass.js";
import { bigMomentLevel } from "../../rules/src/moment.js";
import { scorePopWindow } from "./feel/score-time.js";

/** Recorded samples in public/sounds. See SOUNDS.md. */
export const SOUND_FILES = {
  clack: "clack.mp3",
  "clack-heavy": "clack-heavy.mp3",
  ching: "ching.mp3",
  glass: "glass.mp3",
  tap: "tap.wav",
} as const;

export type SoundId = keyof typeof SOUND_FILES;

export interface Cue {
  id: SoundId;
  /** Seconds after the event. The big moment waits for the tile to land. */
  delay: number;
  /** Light clacks vary in pitch. The heavy slam stays low. */
  vary: "light" | "heavy" | "none";
}

const IMPACT_S = SLAM_MS / 1000;

function isDouble(tileId: string): boolean {
  const [low, high] = tileId.split("-");
  return low !== undefined && low === high;
}

/**
 * Which recordings play for a tile landing on the board.
 * A score of 10 or 15 adds the cha-ching. 20 or more is the UH-OH moment:
 * the heavy slam, the glass, and the cha-ching together.
 */
export function cuesForPlay(awarded: number, tileId: string): Cue[] {
  if (bigMomentLevel(awarded)) {
    const land = scorePopWindow(awarded).land / 1000;
    return [
      { id: "clack-heavy", delay: IMPACT_S, vary: "heavy" },
      { id: "glass", delay: IMPACT_S, vary: "none" },
      { id: "ching", delay: Math.max(IMPACT_S, land), vary: "none" },
    ];
  }
  const cues: Cue[] = [{ id: isDouble(tileId) ? "clack-heavy" : "clack", delay: 0, vary: isDouble(tileId) ? "heavy" : "light" }];
  if (awarded > 0) cues.push({ id: "ching", delay: scorePopWindow(awarded).land / 1000, vary: "none" });
  return cues;
}

/** A quiet wooden tap when the turn reaches you. Not a chime, and not the score. */
export function cuesForTurn(): Cue[] {
  return [{ id: "tap", delay: 0, vary: "none" }];
}
