import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BIG_MOMENT_MS, bigMomentLevel, type BigMomentLevel } from "../../rules/src/moment.js";
import { CRACK_MS, SLAM_MS, buildGlass, drawGlass } from "./glass.js";
import { playUhOh, unlockSound } from "./sound.js";

const SHAKE_MS = 400;
const TOTAL_MS = BIG_MOMENT_MS;
const REDUCED_MS = 900;
const BREAK_MS = SLAM_MS + CRACK_MS;

export function demoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "uhoh";
}

export function demoAward(): number {
  const raw = Number(new URLSearchParams(location.search).get("score"));
  if (raw === 20 || raw === 25 || raw === 30 || raw === 35 || raw === 40) return raw;
  return 25;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface HitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function MomentLayer({
  token,
  awarded,
  tileId,
  tile,
  anchor,
  onShake,
  onPhase,
  onDone,
}: {
  token: string;
  awarded: number;
  tileId: string | null;
  tile: { a: number; b: number; orientation: "horizontal" | "vertical"; spinner?: boolean };
  anchor: HitBox | null;
  onShake: (level: BigMomentLevel | null) => void;
  onPhase?: (phase: "impact" | "shatter" | "title") => void;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDoneRef = useRef(onDone);
  const onShakeRef = useRef(onShake);
  const onPhaseRef = useRef(onPhase);
  onDoneRef.current = onDone;
  onShakeRef.current = onShake;
  onPhaseRef.current = onPhase;
  const reduced = prefersReducedMotion();
  const level = bigMomentLevel(awarded) ?? "medium";
  const [phase, setPhase] = useState<"impact" | "shatter" | "title">(reduced ? "title" : "impact");

  useEffect(() => {
    document.documentElement.dataset.uhohPhase = phase;
    document.documentElement.dataset.uhohLevel = level;
    return () => {
      delete document.documentElement.dataset.uhohPhase;
      delete document.documentElement.dataset.uhohLevel;
    };
  }, [phase, level]);

  useEffect(() => {
    setPhase(reduced ? "title" : "impact");
    onPhaseRef.current?.(reduced ? "title" : "impact");
    playUhOh();
    const timers = [
      window.setTimeout(() => {
        setPhase("shatter");
        onPhaseRef.current?.("shatter");
      }, reduced ? 0 : SLAM_MS),
      window.setTimeout(() => {
        setPhase("title");
        onPhaseRef.current?.("title");
      }, reduced ? 0 : 920),
      window.setTimeout(() => onShakeRef.current(reduced ? null : level), reduced ? 0 : SLAM_MS),
      window.setTimeout(() => onShakeRef.current(null), reduced ? 0 : SLAM_MS + SHAKE_MS),
      window.setTimeout(() => onDoneRef.current(), reduced ? REDUCED_MS : TOTAL_MS),
    ];
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      onShakeRef.current(null);
    };
  }, [token, level, reduced]);

  useLayoutEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const hitX = anchor ? anchor.x - rect.left : rect.width / 2;
    const hitY = anchor ? anchor.y - rect.top : rect.height / 2;
    stage.style.setProperty("--hit-x", `${(hitX / rect.width) * 100}%`);
    stage.style.setProperty("--hit-y", `${(hitY / rect.height) * 100}%`);
    const scene = buildGlass(rect.width, rect.height, hitX, hitY, awarded);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const started = performance.now();
    const root = document.documentElement;
    const draw = (now: number) => {
      const t = now - started;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      drawGlass(ctx, scene, t);
      const glass = t < SLAM_MS ? "impact" : t < BREAK_MS ? "cracks" : t < 500 ? "loose" : t < 640 ? "mid" : "fly";
      if (root.dataset.uhohGlass !== glass) root.dataset.uhohGlass = glass;
      if (t < TOTAL_MS) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      delete root.dataset.uhohGlass;
    };
  }, [anchor, awarded, reduced, token]);

  const hitStyle = anchor
    ? { left: anchor.x, top: anchor.y, width: anchor.w, height: anchor.h }
    : { left: "50%", top: "46%", width: 44, height: 88 };

  return (
    <>
      {reduced ? null : <canvas ref={canvasRef} className="uhoh-cracks" data-uhoh="shatter" />}
      {reduced ? null : <div className="uhoh-flash" aria-hidden="true" />}
      {reduced || phase !== "impact" ? null : (
        <div className="uhoh-slam" style={hitStyle} data-uhoh="impact" data-tile={tileId ?? "demo"}>
          <Face a={tile.a} b={tile.b} orientation={tile.orientation} spinner={tile.spinner} />
        </div>
      )}
      <div
        className={`uhoh-title${reduced ? " reduced" : ""}`}
        data-uhoh="title"
        data-phase={phase}
        role="img"
        aria-label={`UH-OH, plus ${awarded}`}
      >
        <div className="uhoh-word">
          <span>UH</span>
          <Hyphen />
          <span>OH</span>
        </div>
        <p className="uhoh-points">+{awarded}</p>
      </div>
    </>
  );
}

const PIPS: Record<number, number[]> = {
  0: [],
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function Face({
  a,
  b,
  orientation,
  spinner = false,
}: {
  a: number;
  b: number;
  orientation: "horizontal" | "vertical";
  spinner?: boolean;
}) {
  return (
    <span className={`domino ${orientation}${spinner ? " spinner" : ""}`}>
      <span className="half" aria-hidden="true">
        {(PIPS[a] ?? []).map((pos) => (
          <i key={pos} data-pos={pos} />
        ))}
      </span>
      <span className="domino-split" />
      <span className="half" aria-hidden="true">
        {(PIPS[b] ?? []).map((pos) => (
          <i key={pos} data-pos={pos} />
        ))}
      </span>
    </span>
  );
}

function Hyphen() {
  return (
    <svg className="uhoh-hyphen" viewBox="0 0 34 60" aria-hidden="true">
      <rect width="34" height="60" rx="5" fill="#E31E26" />
      <rect x="5" y="28.5" width="24" height="3" fill="#EFEFEF" />
      <circle cx="17" cy="15" r="3.1" fill="#EFEFEF" />
      <circle cx="11" cy="45" r="3.1" fill="#EFEFEF" />
      <circle cx="23" cy="45" r="3.1" fill="#EFEFEF" />
    </svg>
  );
}

export function UhOhPreview({ award, onClose }: { award: number; onClose: () => void }) {
  const [run, setRun] = useState(1);
  const [shake, setShake] = useState<BigMomentLevel | null>(null);
  const [show, setShow] = useState(true);
  const [slamming, setSlamming] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HitBox | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const spot = stageRef.current?.querySelector<HTMLElement>("[data-board-tile='2-5']");
    if (!spot) return;
    const rect = spot.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height });
    setReady(true);
  }, [run]);

  return (
    <main className={`uhoh-preview${shake ? " shaking" : ""}`} data-demo="uhoh" data-shake={shake ?? "off"}>
      <div className="uhoh-stage" ref={stageRef}>
        <div className="uhoh-chain" aria-hidden="true">
          <div className="uhoh-spot">
            <Face a={6} b={6} orientation="vertical" spinner />
          </div>
          <div className="uhoh-spot">
            <Face a={6} b={2} orientation="horizontal" />
          </div>
          <div className={`uhoh-spot${show && slamming && !prefersReducedMotion() ? " is-slamming" : ""}`} data-board-tile="2-5">
            <Face a={2} b={5} orientation="vertical" />
          </div>
        </div>
        {show && ready ? (
          <MomentLayer
            token={`preview-${run}`}
            awarded={award}
            tileId="2-5"
            tile={{ a: 2, b: 5, orientation: "vertical" }}
            anchor={anchor}
            onShake={setShake}
            onPhase={(next) => setSlamming(next === "impact")}
            onDone={() => setShow(false)}
          />
        ) : null}
      </div>
      <div className="uhoh-preview-bar">
        <button
          type="button"
          className="primary"
          data-action="replay-uhoh"
          onClick={() => {
            unlockSound();
            setSlamming(true);
            setReady(false);
            setShow(true);
            setRun((value) => value + 1);
          }}
        >
          Play it again
        </button>
        <button type="button" className="text-button" onClick={onClose}>
          Back
        </button>
      </div>
    </main>
  );
}
