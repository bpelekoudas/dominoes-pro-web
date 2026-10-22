import { useEffect, useState } from "react";
import { handTally } from "./tally.js";
import { playFeel } from "./synth.js";

export function FeelCall({
  kind,
  reduced,
  onSkip,
}: {
  kind: "domino" | "lock";
  reduced: boolean;
  onSkip: () => void;
}) {
  const [beat, setBeat] = useState(kind === "lock" ? "uh" : "domino");
  useEffect(() => {
    if (kind !== "domino" || reduced) {
      if (kind === "domino" && reduced) setBeat("hand");
      return;
    }
    const timer = window.setTimeout(() => {
      setBeat("hand");
      playFeel("hand");
    }, 480);
    return () => window.clearTimeout(timer);
  }, [kind, reduced]);
  const text = beat === "uh" ? "UH OH." : beat === "hand" ? "HAND WON" : "DOMINO!";
  return (
    <button type="button" className="feel-call" data-feel-call={beat} data-motion={reduced ? "off" : "on"} data-action="skip-feel" aria-label={text} onClick={onSkip}>
      <span>{text}</span>
    </button>
  );
}

export function FeelTally({
  reason,
  pipCounts,
  winnerIds,
  awards,
  reduced,
}: {
  reason: "domino" | "locked" | "score";
  pipCounts: Record<string, number>;
  winnerIds: readonly string[];
  awards: Record<string, number>;
  reduced: boolean;
}) {
  const tally = handTally({ reason, pipCounts, winnerIds, awards });
  const [step, setStep] = useState(reduced ? tally.lines.length - 1 : 0);
  useEffect(() => {
    if (reduced) return;
    const timers = tally.lines.map((_, index) => window.setTimeout(() => setStep(index), index * 700));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [reason, tally.lines.length, reduced]);
  const text = tally.lines[Math.min(step, tally.lines.length - 1)] ?? "";
  if (!text) return null;
  return (
    <p className="feel-tally" data-feel-tally={String(step)} data-feel-awarded={tally.awarded} role="status">
      {text}
    </p>
  );
}
