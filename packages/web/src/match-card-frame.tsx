import { useLayoutEffect, useRef, type ReactNode } from "react";
import { matchCardBox, readVisualViewport } from "./match-card";

function readSafeInsets(): { top: number; bottom: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const top = Number.parseFloat(style.paddingTop) || 0;
  const bottom = Number.parseFloat(style.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

/** Pins a result card to the visual viewport and keeps its buttons on screen. */
export function MatchCardFrame({
  screen,
  className,
  children,
}: {
  screen: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const place = () => {
      const visual = readVisualViewport();
      const safe = readSafeInsets();
      frame.style.top = `${visual.top}px`;
      frame.style.height = `${visual.height}px`;
      frame.style.bottom = "auto";
      frame.style.maxHeight = "none";
      const sheet = frame.querySelector<HTMLElement>(".hand-summary-sheet, .ended-screen");
      const body = frame.querySelector<HTMLElement>(".hand-summary-scroll");
      const actions = frame.querySelector<HTMLElement>(".match-over-actions");
      const box = matchCardBox({
        visualTop: visual.top,
        visualHeight: visual.height,
        safeTop: safe.top,
        safeBottom: safe.bottom,
        bodyHeight: body?.scrollHeight ?? 0,
        actionsHeight: actions?.offsetHeight ?? 0,
      });
      if (sheet) sheet.style.maxHeight = `${Math.max(0, box.bottom - box.top)}px`;
    };
    place();
    const follow = window.requestAnimationFrame(place);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    return () => {
      window.cancelAnimationFrame(follow);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, []);
  return (
    <section ref={ref} className={`sheet-frame${className ? ` ${className}` : ""}`} data-screen={screen}>
      {children}
    </section>
  );
}
