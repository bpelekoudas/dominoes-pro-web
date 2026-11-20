export type ScoreHintChoice = "on" | "off" | "auto";

const KEY = "uhoh.score-hints";

export function scoreHintChoice(): ScoreHintChoice {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "on" || raw === "off") return raw;
  } catch {
    // Private mode keeps the automatic intro.
  }
  return "auto";
}

export function setScoreHintChoice(choice: "on" | "off"): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // The button still changes for this visit.
  }
}

/**
 * Numbers show on an easy practice table during the first two computer games,
 * then stay off unless the player turns them back on. Other tables never show them.
 */
export function showScoreNumbers(easyPractice: boolean, botGames: number, choice: ScoreHintChoice): boolean {
  if (!easyPractice) return false;
  if (choice === "on") return true;
  if (choice === "off") return false;
  return botGames < 2;
}
