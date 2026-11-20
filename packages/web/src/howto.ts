/** One pass of the first-run cards. Three beats stay under half a minute. */
export const HOWTO_BEAT_MS = 8_000;

export const HOWTO_KEY = "uhoh.howto";
export const PRACTICE_KEY = "uhoh.practiced";

export const HOWTO_STEPS = [
  {
    title: "Match the ends",
    body: "Play a tile that touches the same number. Only the open ends count.",
  },
  {
    title: "Draw, or knock",
    body: "If nothing fits, draw. When the boneyard is empty and you still cannot play, knock.",
  },
  {
    title: "Race to 150",
    body: "A game ends at 150. The series is first to 2, 3, or 4 game wins.",
  },
] as const;

export function howToLengthMs(): number {
  return HOWTO_STEPS.length * HOWTO_BEAT_MS;
}
