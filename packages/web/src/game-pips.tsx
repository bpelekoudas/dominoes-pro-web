import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./moment";
import { gameCountLabel } from "./game-tally.js";

/** Games won, on the score chip. "1/2" is one game toward first to 2. */
export function GamePips({ won, needed }: { won: number; needed: number }) {
  const label = gameCountLabel(won, needed);
  const previous = useRef(won);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = won;
    if (won <= before || prefersReducedMotion()) {
      setPop(false);
      return;
    }
    setPop(true);
    const timer = window.setTimeout(() => setPop(false), 320);
    return () => window.clearTimeout(timer);
  }, [won]);
  return (
    <span
      className={pop ? "game-pips pop" : "game-pips"}
      data-games-won={won}
      data-games-needed={needed}
      title={`First to ${needed}`}
      aria-label={`${won} of ${needed} games`}
    >
      {label}
    </span>
  );
}
