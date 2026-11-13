const SIZE_KEY = "uhoh.tile-size";
const MARK_KEY = "uhoh.pip-marks";

export function largeTilesOn(): boolean {
  try {
    return localStorage.getItem(SIZE_KEY) === "large";
  } catch {
    return false;
  }
}

export function pipMarksOn(): boolean {
  try {
    return localStorage.getItem(MARK_KEY) === "numbers";
  } catch {
    return false;
  }
}

export function applyA11y(): void {
  const root = document.documentElement;
  root.dataset.tileSize = largeTilesOn() ? "large" : "regular";
  root.dataset.pipMarks = pipMarksOn() ? "numbers" : "dots";
}

export function setLargeTiles(on: boolean): void {
  try {
    localStorage.setItem(SIZE_KEY, on ? "large" : "regular");
  } catch {
    // The choice still applies for this visit.
  }
  applyA11y();
}

export function setPipMarks(numbers: boolean): void {
  try {
    localStorage.setItem(MARK_KEY, numbers ? "numbers" : "dots");
  } catch {
    // The choice still applies for this visit.
  }
  applyA11y();
}
