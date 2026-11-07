const TAP = "uhoh.hint.tap";
const DRAG = "uhoh.hint.drag";

function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markHint(kind: "tap" | "drag"): void {
  try {
    localStorage.setItem(kind === "tap" ? TAP : DRAG, "1");
  } catch {
    // The line still closes for this visit.
  }
}

/** One line, the first time, then never again. */
export function playHint(yourTurn: boolean, playable: boolean, severalEnds: boolean): "tap" | "drag" | null {
  if (!yourTurn || !playable) return null;
  if (!seen(TAP)) return "tap";
  if (severalEnds && !seen(DRAG)) return "drag";
  return null;
}

export function hintText(kind: "tap" | "drag"): string {
  return kind === "tap" ? "Tap a glowing tile" : "Drag it to an end";
}
