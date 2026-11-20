import { wiredCues, type ContextEvent } from "./context.js";
import { specFor, type FeelTier, type TierSpec } from "./ladder.js";

export interface Reaction {
  tier: FeelTier;
  spec: TierSpec;
  word: string | null;
  /** Local human only, unless the moment belongs to the whole table. */
  haptic: number[];
  cues: ContextEvent[];
  cry: boolean;
}

const TABLE_MOMENTS = new Set<FeelTier>(["domino", "locked", "hand", "game", "match"]);

export function direct(input: {
  tier: FeelTier;
  knockStreak?: number;
  local: boolean;
  reduced: boolean;
  contexts?: readonly ContextEvent[];
  /** A comeback may say UH OH. A plain big score does not. */
  comeback?: boolean;
}): Reaction {
  const spec = specFor(input.tier, input.reduced, input.knockStreak ?? 1);
  const cues = wiredCues(input.contexts ?? [], input.tier);
  const table = TABLE_MOMENTS.has(input.tier);
  const haptic = input.reduced ? [] : input.local || table ? spec.haptic : [];
  const cry = input.tier === "locked" || (input.comeback === true && (input.tier === "score-rare" || input.tier === "hand" || input.tier === "game"));
  let word = spec.word;
  if (input.tier === "game" && !input.local) word = "GAME WON";
  if (input.tier === "score" || input.tier === "score-strong" || input.tier === "score-rare") word = null;
  return { tier: input.tier, spec, word, haptic, cues, cry };
}
