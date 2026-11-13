export type DailyDismiss = "back" | "close" | "outside" | "hardware";

export interface DailyHistory {
  open: boolean;
  pushed: boolean;
}

/**
 * What the daily sheet should do after the claim request.
 * A new claim goes home. A repeat claim stays put so the player can still leave.
 * A failed claim stays so the error remains on screen.
 */
export function afterDailyClaim(result: { ok: boolean; already: boolean }): "home" | "stay" {
  if (result.ok && !result.already) return "home";
  return "stay";
}

/**
 * Back, the close mark, a tap on the dim area, and the Android back key all leave the sheet.
 * Leaving with a button steps history back only when this sheet pushed an entry.
 * The hardware key already moved history, so it must not step back again.
 */
export function nextDailyHistory(
  state: DailyHistory,
  event: "open" | DailyDismiss | "claimed",
): DailyHistory & { goBack: boolean } {
  if (event === "open") {
    return { open: true, pushed: true, goBack: false };
  }
  if (event === "hardware") {
    return { open: false, pushed: false, goBack: false };
  }
  return { open: false, pushed: false, goBack: state.pushed };
}
