const AGE_KEY = "uhoh.age13";

/** The age question belongs on the first visit only, and it stays gone once answered. */
export function shouldAskAge(input: {
  hasAccount: boolean;
  ageOk: boolean;
  checked: boolean;
  remembered: boolean;
}): boolean {
  if (input.hasAccount || input.ageOk || input.checked || input.remembered) return false;
  return true;
}

export function readRememberedAge(): boolean {
  try {
    return localStorage.getItem(AGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberAge(checked: boolean): void {
  try {
    if (checked) localStorage.setItem(AGE_KEY, "1");
    else localStorage.removeItem(AGE_KEY);
  } catch {
    // A private browser still keeps the answer for this visit.
  }
}

/** Real balances only. A missing wallet shows a dash, never a sample number. */
export function formatBones(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

/** Null when the account has no rating yet, so the badge stays off. */
export function ratingLabel(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  return `RATING ${Math.round(rating)}`;
}

export function dailyLoginMark(day: number | null | undefined): string {
  if (day == null || !Number.isFinite(day)) return "DAY — / 7";
  return `DAY ${Math.min(7, Math.max(1, Math.floor(day)))} / 7`;
}

export function dailyChallengeMark(done: number | null | undefined): string {
  if (done == null || !Number.isFinite(done)) return "DAILY —/3";
  return `DAILY ${Math.min(3, Math.max(0, Math.floor(done)))}/3`;
}
