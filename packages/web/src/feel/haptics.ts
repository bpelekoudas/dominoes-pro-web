const KEY = "uhoh.haptics";

export function hapticsOn(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(KEY) !== "0";
}

export function setHaptics(on: boolean): void {
  localStorage.setItem(KEY, on ? "1" : "0");
}

/** Android and the Fold vibrate. Everywhere else this is a no-op. */
export function pulse(pattern: readonly number[]): void {
  if (!hapticsOn() || pattern.length === 0) return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  try {
    vibrate([...pattern]);
  } catch {
    return;
  }
}
