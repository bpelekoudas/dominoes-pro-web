/**
 * Where the end-of-hand / end-of-match card sits.
 *
 * The page is `viewport-fit=cover`, so `bottom: 0` is the layout viewport,
 * which on a phone runs under the browser chrome and the system nav. The
 * card has to use the visual viewport instead, and the buttons stay in the
 * box even when the standings are taller than the screen.
 */
export interface MatchCardBox {
  top: number;
  bottom: number;
  actionsTop: number;
  scrolls: boolean;
}

export function matchCardBox(input: {
  visualTop: number;
  visualHeight: number;
  safeTop: number;
  safeBottom: number;
  bodyHeight: number;
  actionsHeight: number;
  gap?: number;
}): MatchCardBox {
  const gap = input.gap ?? 8;
  const topLimit = input.visualTop + Math.max(gap, input.safeTop);
  const bottom = input.visualTop + input.visualHeight - Math.max(0, input.safeBottom);
  const available = Math.max(0, bottom - topLimit);
  const actions = Math.min(Math.max(0, input.actionsHeight), available);
  const wanted = Math.max(0, input.bodyHeight) + actions;
  const height = Math.min(available, Math.max(actions, wanted));
  const top = bottom - height;
  return {
    top,
    bottom,
    actionsTop: bottom - actions,
    scrolls: wanted > available + 0.5,
  };
}

export function readVisualViewport(): { top: number; height: number } {
  const viewport = window.visualViewport;
  return {
    top: viewport?.offsetTop ?? 0,
    height: Math.max(1, viewport?.height ?? window.innerHeight),
  };
}
