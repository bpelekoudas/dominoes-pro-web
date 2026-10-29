import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MOTION } from "../../../rules/src/motion.js";
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
    }, 560);
    return () => window.clearTimeout(timer);
  }, [kind, reduced]);
  const text = beat === "uh" ? "UH OH." : beat === "hand" ? "HAND WON" : "DOMINO!";
  return (
    <>
      <TileBurst key={beat} active={kind === "domino"} reduced={reduced} />
      <button type="button" className="feel-call" data-feel-call={beat} data-motion={reduced ? "off" : "on"} data-action="skip-feel" aria-label={text} onClick={onSkip}>
        <span>{text}</span>
      </button>
    </>
  );
}

/** Ivory dominos bursting from the played tile. Deterministic, no Math.random. */
function TileBurst({ active, reduced }: { active: boolean; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!active || reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const read = () => {
      const x = Number(document.documentElement.dataset.tileHitX);
      const y = Number(document.documentElement.dataset.tileHitY);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
      return { x: width / 2, y: height / 2 };
    };
    const bits = Array.from({ length: 16 }, (_, index) => {
      const ang = (index / 16) * Math.PI * 2 + 0.18;
      return {
        ang,
        delay: (index % 4) * 0.02,
        speed: 110 + (index % 5) * 26,
        w: index % 2 === 0 ? 7 : 14,
        h: index % 2 === 0 ? 14 : 7,
        spin: ((index % 3) - 1) * 2.4,
      };
    });
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const t = (now - started) / 1000 / MOTION;
      const origin = read();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const ring = Math.min(1, t / 0.42);
      if (ring > 0 && ring < 1) {
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, 8 + ring * 70, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(246, 241, 230, ${1 - ring})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      for (const bit of bits) {
        const age = t - bit.delay;
        if (age < 0 || age > 0.72) continue;
        const dist = age * bit.speed;
        const x = origin.x + Math.cos(bit.ang) * dist;
        const y = origin.y + Math.sin(bit.ang) * dist + 36 * age * age;
        const alpha = age < 0.1 ? age / 0.1 : Math.max(0, 1 - (age - 0.1) / 0.62);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(bit.ang + bit.spin * age);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#f6f1e6";
        ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
        ctx.fillStyle = "#e31e26";
        ctx.fillRect(-bit.w / 2, -1, bit.w, 2);
        ctx.restore();
      }
      if (t < 0.8) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, reduced]);
  if (!active || reduced) return null;
  return createPortal(<canvas ref={ref} className="feel-burst" data-feel-burst="tile" aria-hidden="true" />, document.body);
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
  const lineKey = tally.lines.join("\n");
  const [step, setStep] = useState(reduced ? tally.lines.length - 1 : 0);
  const [seen, setSeen] = useState(lineKey);
  if (seen !== lineKey) {
    setSeen(lineKey);
    setStep(reduced ? tally.lines.length - 1 : 0);
  }
  useEffect(() => {
    if (reduced) return;
    const timers = tally.lines.map((_, index) => window.setTimeout(() => setStep(index), index * 700));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [lineKey, reduced]);
  const text = tally.lines[Math.min(step, tally.lines.length - 1)] ?? "";
  if (!text) return null;
  return (
    <p className="feel-tally" data-feel-tally={String(step)} data-feel-awarded={tally.awarded} role="status">
      {text}
    </p>
  );
}
