/** Remembered on this device. Series is a best of 5. */
export type QuickFormat = "series" | "single";

const KEY = "uhoh.quick.format";

export function readQuickFormat(): QuickFormat {
  try {
    return window.localStorage.getItem(KEY) === "single" ? "single" : "series";
  } catch {
    return "series";
  }
}

export function writeQuickFormat(format: QuickFormat): void {
  try {
    window.localStorage.setItem(KEY, format);
  } catch {
    // The choice still applies for this visit.
  }
}

export function seriesForFormat(format: QuickFormat): 1 | 5 {
  return format === "single" ? 1 : 5;
}
