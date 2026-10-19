import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bigMomentLevel, type BigMomentLevel } from "../../rules/src/moment.js";
import { playUhOh, unlockSound } from "./sound.js";

const SLAM_MS = 280;
const SHAKE_MS = 400;
const TOTAL_MS = 1800;
const REDUCED_MS = 900;

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
      }, reduced ? 0 : 700),
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
    const scene = buildScene(rect.width, rect.height, hitX, hitY, awarded);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const t = now - started;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (t >= SLAM_MS) paintCracks(ctx, scene, Math.min(1, (t - SLAM_MS) / 1000));
      if (t < TOTAL_MS) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
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

interface Scene {
  cracks: Array<{ points: Array<{ x: number; y: number }>; width: number }>;
  shards: Array<{ x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number }>;
}

function buildScene(width: number, height: number, ox: number, oy: number, seed: number): Scene {
  const rand = mulberry(seed * 997 + 13);
  const cracks: Scene["cracks"] = [];
  const count = 12;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + (rand() - 0.5) * 0.45;
    const len = Math.hypot(width, height) * (0.28 + rand() * 0.42);
    const points = [{ x: ox, y: oy }];
    const steps = 7;
    for (let step = 1; step <= steps; step += 1) {
      const dist = (len * step) / steps;
      const wobble = (rand() - 0.5) * 22;
      points.push({
        x: ox + Math.cos(angle) * dist + wobble,
        y: oy + Math.sin(angle) * dist + (rand() - 0.5) * 16,
      });
    }
    cracks.push({ points, width: 1.1 + rand() * 1.3 });
    if (rand() > 0.45) {
      const fork = points[3] ?? points[1]!;
      const branch = (rand() - 0.5) * 1.2;
      cracks.push({
        width: 0.8,
        points: [
          fork,
          {
            x: fork.x + Math.cos(angle + branch) * (40 + rand() * 70),
            y: fork.y + Math.sin(angle + branch) * (40 + rand() * 70),
          },
        ],
      });
    }
  }
  const shards: Scene["shards"] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = rand() * Math.PI * 2;
    const speed = 70 + rand() * 160;
    shards.push({
      x: ox + Math.cos(angle) * 8,
      y: oy + Math.sin(angle) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 20,
      rot: rand() * Math.PI,
      vr: (rand() - 0.5) * 4,
      size: 6 + rand() * 8,
    });
  }
  return { cracks, shards };
}

function paintCracks(ctx: CanvasRenderingContext2D, scene: Scene, u: number): void {
  const grow = Math.min(1, u / 0.18);
  const fade = u < 0.35 ? 1 : 1 - (u - 0.35) / 0.65;
  const alpha = Math.max(0, fade);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(239, 239, 239, ${0.85 * alpha})`;
  ctx.shadowColor = "rgba(213, 163, 54, 0.85)";
  ctx.shadowBlur = 8;
  for (const crack of scene.cracks) {
    const last = Math.max(1, Math.floor(grow * (crack.points.length - 1)));
    ctx.beginPath();
    ctx.lineWidth = crack.width;
    const first = crack.points[0]!;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i <= last; i += 1) {
      const point = crack.points[i]!;
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(239, 239, 239, ${0.75 * alpha})`;
  for (const shard of scene.shards) {
    ctx.save();
    ctx.translate(shard.x + shard.vx * u, shard.y + shard.vy * u + 40 * u * u);
    ctx.rotate(shard.rot + shard.vr * u);
    ctx.beginPath();
    ctx.moveTo(0, -shard.size);
    ctx.lineTo(shard.size * 0.8, shard.size * 0.35);
    ctx.lineTo(-shard.size * 0.35, shard.size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function mulberry(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
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
