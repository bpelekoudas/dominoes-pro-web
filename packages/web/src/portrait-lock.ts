/**
 * Phones in landscape get the rotate overlay. The Fold 7 inner screen is
 * nearly square (about 751×832), so a plain "wider than tall" check would
 * treat a turned inner screen as landscape. A phone's short side stays under
 * 500 CSS pixels; the Fold inner short side and a desktop window do not.
 * The aspect cut (wider than 1.3) is a second guard for that nearly square screen.
 */
export const PORTRAIT_ASPECT = 1.3;
export const PORTRAIT_SHORT_SIDE = 500;

/** True only for a phone held sideways. Portrait, the Fold inner screen, and desktop stay clear. */
export function needsPortraitOverlay(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0) || width <= height) return false;
  const shortSide = Math.min(width, height);
  const aspect = width / height;
  return aspect > PORTRAIT_ASPECT && shortSide < PORTRAIT_SHORT_SIDE;
}

/**
 * The landscape overlay is not a felt the chain should fit. Measuring it
 * zooms the hand out, and the play rule that never zooms back in would
 * keep that tiny scale after the phone turns upright.
 */
export function shouldRefitFelt(viewport: { width: number; height: number }): boolean {
  return !needsPortraitOverlay(viewport.width, viewport.height);
}

/**
 * Ask the browser to lock portrait. Android honors this for an installed
 * home-screen app and for fullscreen. A normal tab rejects the call.
 * iOS Safari does not implement screen.orientation.lock, and it does not
 * apply the manifest orientation to a browser tab. Either failure is ignored.
 */
export function lockPortrait(): void {
  try {
    const orientation = screen.orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    void Promise.resolve(orientation.lock("portrait")).catch(() => undefined);
  } catch {
    // The page is not installed or fullscreen, or this browser has no lock.
  }
}
