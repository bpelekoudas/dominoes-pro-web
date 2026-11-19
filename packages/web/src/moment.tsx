import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BIG_MOMENT_MS, bigMomentLevel, type BigMomentLevel } from "../../rules/src/moment.js";
import { MOTION, motionMs } from "../../rules/src/motion.js";
import { FX_LIST, HEAVY_FX, createFxScene, drawFx, normalizeFx, peakReach, readEquippedFx, videoFxAsset, warmVideoFx, type FxId } from "./fx.js";
import { CRACK_MS, SLAM_MS, buildGlass, drawGlass } from "./glass.js";
import { scorePopupText } from "./feel/score-delta.js";
import { playUhOh, unlockSound } from "./sound.js";
import { faceRotation, PipHalf, SpinnerDot } from "./pips.js";

const SHAKE_MS = 400;
const TOTAL_MS = BIG_MOMENT_MS;
const REDUCED_MS = 900;
const BREAK_MS = SLAM_MS + CRACK_MS;

export function demoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "uhoh";
}

export function fxGalleryRequested(): boolean {
  const params = new URLSearchParams(location.search);
  return params.has("fxgallery") || params.get("demo") === "fxgallery";
}

export function previewFx(): FxId {
  const picked = new URLSearchParams(location.search).get("fx");
  if (picked) return normalizeFx(picked);
  return readEquippedFx();
}

export function demoAward(): number {
  const raw = Number(new URLSearchParams(location.search).get("score"));
  if (raw === 20 || raw === 25 || raw === 30 || raw === 35 || raw === 40) return raw;
  return 25;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function buzz(heavy: boolean): void {
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  vibrate(heavy ? [16, 28, 22] : [12]);
}

function boardEdge(): "left" | "right" | null {
  const edge = new URLSearchParams(location.search).get("edge");
  return edge === "left" || edge === "right" ? edge : null;
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
  effect = "glass",
  cry = true,
  onShake,
  onPhase,
  onDone,
}: {
  token: string;
  awarded: number;
  tileId: string | null;
  tile: { a: number; b: number; orientation: "horizontal" | "vertical"; spinner?: boolean };
  anchor: HitBox | null;
  effect?: FxId;
  /** Say UH OH only for a lock or a comeback. A plain big score shows the points. */
  cry?: boolean;
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
  const fxId = normalizeFx(effect);
  const level = bigMomentLevel(awarded) ?? "medium";
  const [phase, setPhase] = useState<"impact" | "shatter" | "title">(reduced ? "title" : "impact");
  const [clipOk, setClipOk] = useState(true);
  const blastRef = useRef<HTMLVideoElement>(null);
  const [shake, setShake] = useState<BigMomentLevel | null>(null);

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
    const shake = reduced ? null : HEAVY_FX.has(fxId) ? (level === "small" ? "medium" : level) : "small";
    const timers = [
      window.setTimeout(() => {
        setPhase("shatter");
        onPhaseRef.current?.("shatter");
      }, reduced ? 0 : motionMs(SLAM_MS)),
      window.setTimeout(() => {
        setPhase("title");
        onPhaseRef.current?.("title");
      }, reduced ? 0 : motionMs(640)),
      window.setTimeout(() => {
        setShake(shake);
        onShakeRef.current(shake);
        if (shake) buzz(shake !== "small");
      }, reduced ? 0 : motionMs(200)),
      window.setTimeout(() => {
        setShake(null);
        onShakeRef.current(null);
      }, reduced ? 0 : motionMs(200) + motionMs(SHAKE_MS)),
      window.setTimeout(() => onDoneRef.current(), reduced ? REDUCED_MS : TOTAL_MS),
    ];
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      setShake(null);
      onShakeRef.current(null);
    };
  }, [fxId, token, level, reduced]);

  const clip = videoFxAsset(fxId);
  const blast = Boolean(clip) && clipOk && !reduced;
  useEffect(() => {
    setClipOk(true);
  }, [token, fxId]);
  useEffect(() => {
    if (!blast) return;
    warmVideoFx();
    const video = blastRef.current;
    if (!video) return;
    const fail = () => setClipOk(false);
    video.addEventListener("error", fail);
    const pending = video.play();
    if (pending) pending.catch(fail);
    return () => video.removeEventListener("error", fail);
  }, [blast, token]);

  useLayoutEffect(() => {
    if (reduced || blast) return;
    const canvas = canvasRef.current;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!canvas || width < 8 || height < 8) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const hitX = anchor ? anchor.x : width / 2;
    const hitY = anchor ? anchor.y : height / 2;
    document.documentElement.style.setProperty("--hit-x", `${(hitX / width) * 100}%`);
    document.documentElement.style.setProperty("--hit-y", `${(hitY / height) * 100}%`);
    document.documentElement.dataset.crackX = hitX.toFixed(1);
    document.documentElement.dataset.crackY = hitY.toFixed(1);
    // A filmed effect that did not start falls back to its canvas. Mega
    // explosion has no particle scene, so that one uses the house shatter.
    const canvasId = fxId === "explosion" ? "glass" : fxId;
    const particles = canvasId === "glass" || canvasId === "explosion" ? null : createFxScene(canvasId, width, height, hitX, hitY, awarded);
    const glass = particles ? null : buildGlass(width, height, hitX, hitY, awarded);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    const started = performance.now();
    const root = document.documentElement;
    const draw = (now: number) => {
      const t = now - started;
      const visual = t / MOTION;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (glass) drawGlass(ctx, glass, visual);
      else if (particles) drawFx(ctx, particles, visual);
      const glassPhase = visual < SLAM_MS ? "impact" : visual < BREAK_MS ? "cracks" : visual < 500 ? "loose" : visual < 640 ? "mid" : "fly";
      if (root.dataset.uhohGlass !== glassPhase) root.dataset.uhohGlass = glassPhase;
      if (t < TOTAL_MS) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      delete root.dataset.uhohGlass;
      delete root.dataset.crackX;
      delete root.dataset.crackY;
    };
  }, [anchor, awarded, blast, effect, fxId, reduced, token]);

  const hitStyle = anchor
    ? { left: anchor.x, top: anchor.y, width: anchor.w, height: anchor.h }
    : { left: "50%", top: "46%", width: 44, height: 88 };
  const titleAt = clearTitleSpot(anchor);

  // Every 20+ plays the equipped burst. Glass is the default. Glass, fire,
  // lightning, money, confetti, tumble, and mega explosion play the filmed clip, and fall
  // back to canvas if it will not start. A lock or a comeback also says UH-OH. A
  // plain score shows the points. The burst is portaled onto the body so
  // the stage transform cannot clip it.
  const blastAt = blastBox(anchor);
  const burst = reduced
    ? null
    : blast
      ? createPortal(
          <video
            key={token}
            ref={blastRef}
            className="uhoh-blast"
            data-uhoh="blast"
            data-fx={fxId}
            muted
            playsInline
            autoPlay
            preload="auto"
            style={{ left: blastAt.left, top: blastAt.top, width: blastAt.size, height: blastAt.size }}
          >
            <source src={clip?.webm} type="video/webm" />
            <source src={clip?.mp4} type="video/mp4" />
          </video>,
          document.body,
        )
      : createPortal(
          <>
            <canvas ref={canvasRef} className="uhoh-cracks" data-uhoh="shatter" data-shake={shake ?? "off"} />
            <div className="uhoh-flash" aria-hidden="true" />
          </>,
          document.body,
        );
  const slam = reduced || phase !== "impact" ? null : (
    <div className="uhoh-slam" style={hitStyle} data-uhoh="impact" data-tile={tileId ?? "demo"}>
      <Face a={tile.a} b={tile.b} orientation={tile.orientation} spinner={tile.spinner} />
    </div>
  );
  const title = (
    <div
      className={`uhoh-title${reduced ? " reduced" : ""}`}
      data-uhoh="title"
      data-origin={anchor ? "tile" : "center"}
      data-phase={phase}
      data-awarded={awarded}
      style={{
        left: titleAt.left,
        top: titleAt.top,
        ["--uhoh-size" as string]: `${titleAt.font}px`,
        ["--uhoh-points" as string]: `${Math.round(titleAt.font * 0.46)}px`,
      }}
      role="img"
      aria-label={cry ? `UH-OH, plus ${awarded}` : `plus ${awarded}`}
    >
      {cry ? (
        <div className="uhoh-word">
          <span>UH</span>
          <Hyphen />
          <span>OH</span>
        </div>
      ) : (
        <div className="uhoh-word">{scorePopupText(awarded)}</div>
      )}
      {cry ? <p className="uhoh-points">{scorePopupText(awarded)}</p> : null}
    </div>
  );

  return (
    <>
      {burst}
      {createPortal(
        <>
          {slam}
          {title}
        </>,
        document.body,
      )}
    </>
  );
}

/**
 * A spot for the big word that misses tiles, badges, and the rack.
 * The word shrinks only as far as it must to find that clear spot.
 */
function blastBox(anchor: HitBox | null): { left: number; top: number; size: number } {
  const x = anchor ? anchor.x : window.innerWidth / 2;
  const y = anchor ? anchor.y : window.innerHeight * 0.46;
  // peakReach is how far the burst travels. The square is about 1.6 times that
  // radius, so the circle covers ~80% of the viewport. It may run off the felt.
  const size = peakReach(window.innerWidth, window.innerHeight, x, y) * 1.6;
  return { left: x, top: y, size };
}

function clearTitleSpot(anchor: HitBox | null): { left: number; top: number; font: number } {
  const blocked = [...document.querySelectorAll("[data-board-tile], .edge-badge, .seat-chip, .hand-tile, .hand-tray, .playbar")]
    .map((node) => node.getBoundingClientRect())
    .filter((box) => box.width > 2 && box.height > 2);
  const nominal = Math.min(window.innerWidth * 0.415, 250);
  const fonts = [nominal, nominal * 0.78, nominal * 0.62, 96, 78];
  const spotsFor = (height: number) => {
    const spots = [
      { left: window.innerWidth / 2, top: window.innerHeight * 0.16 },
      { left: window.innerWidth / 2, top: window.innerHeight * 0.84 },
      { left: window.innerWidth * 0.5, top: window.innerHeight * 0.32 },
      { left: window.innerWidth * 0.22, top: window.innerHeight * 0.46 },
      { left: window.innerWidth * 0.78, top: window.innerHeight * 0.46 },
    ];
    if (anchor) {
      spots.unshift({
        left: anchor.x,
        top: Math.max(height / 2 + 8, anchor.y - anchor.h / 2 - height / 2 - 14),
      });
    }
    return spots;
  };
  for (const font of fonts) {
    const width = font * 2.3;
    const height = font * 1.05;
    const hits = (left: number, top: number) => {
      const box = { left: left - width / 2, right: left + width / 2, top: top - height / 2, bottom: top + height / 2 };
      if (box.left < 8 || box.top < 8 || box.right > window.innerWidth - 8 || box.bottom > window.innerHeight - 8) return true;
      return blocked.some((other) => box.left < other.right - 2 && box.right > other.left + 2 && box.top < other.bottom - 2 && box.bottom > other.top + 2);
    };
    const clear = spotsFor(height).find((spot) => !hits(spot.left, spot.top));
    if (clear) return { ...clear, font };
  }
  return { left: window.innerWidth / 2, top: Math.max(56, window.innerHeight * 0.14), font: 78 };
}

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
  const rotation = faceRotation(orientation);
  return (
    <span className={`domino ${orientation}${spinner ? " spinner" : ""}`}>
      <PipHalf value={a} rotation={rotation} />
      <span className="domino-split" />
      <PipHalf value={b} rotation={rotation} />
      {spinner ? <SpinnerDot /> : null}
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

export function FxBoard({
  effect,
  award = 25,
  token,
  paused = false,
  onDone,
}: {
  effect: FxId;
  award?: number;
  token: string;
  paused?: boolean;
  onDone?: () => void;
}) {
  const [shake, setShake] = useState<BigMomentLevel | null>(null);
  const [show, setShow] = useState(true);
  const [slamming, setSlamming] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HitBox | null>(null);
  const [ready, setReady] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const edge = boardEdge();

  useLayoutEffect(() => {
    const spot = stageRef.current?.querySelector<HTMLElement>("[data-board-tile='2-5']");
    if (!spot) return;
    const rect = spot.getBoundingClientRect();
    setAnchor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height });
    setReady(true);
  }, [token]);

  return (
    <div className={`fx-board${shake ? " shaking" : ""}`} data-shake={shake ?? "off"} data-fx={effect}>
      <div className="uhoh-stage" ref={stageRef}>
        <div className="uhoh-chain" data-edge={edge ?? "center"} aria-hidden="true">
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
        {show && ready && !paused ? (
          <MomentLayer
            token={token}
            awarded={award}
            tileId="2-5"
            tile={{ a: 2, b: 5, orientation: "vertical" }}
            anchor={anchor}
            effect={effect}
            onShake={setShake}
            onPhase={(next) => setSlamming(next === "impact")}
            onDone={() => {
              setShow(false);
              onDoneRef.current?.();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function UhOhPreview({ award, onClose }: { award: number; onClose: () => void }) {
  const [run, setRun] = useState(1);
  const effect = previewFx();
  return (
    <main className="uhoh-preview" data-demo="uhoh" data-fx={effect}>
      <FxBoard effect={effect} award={award} token={`preview-${effect}-${run}`} />
      <div className="uhoh-preview-bar">
        <button
          type="button"
          className="primary"
          data-action="replay-uhoh"
          onClick={() => {
            unlockSound();
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

function galleryScript(): { list: FxId[]; auto: boolean; start: number } {
  const params = new URLSearchParams(location.search);
  const seq = params.get("seq");
  if (seq) {
    const list = seq.split(",").map((part) => normalizeFx(part.trim()));
    return { list: list.length > 0 ? list : ["glass"], auto: true, start: 0 };
  }
  const one = params.get("fx");
  if (one && params.get("clean") === "1") return { list: [normalizeFx(one)], auto: false, start: 0 };
  const start = Math.max(0, FX_LIST.findIndex((fx) => fx.id === normalizeFx(one)));
  return { list: FX_LIST.map((fx) => fx.id), auto: false, start };
}

export function FxGallery() {
  const params = new URLSearchParams(location.search);
  const clean = params.get("clean") === "1";
  const armed = params.get("arm") === "1";
  const script = galleryScript();
  const { list, auto } = script;
  const [index, setIndex] = useState(script.start);
  const [run, setRun] = useState(1);
  const [live, setLive] = useState(!armed);
  const [phase, setPhase] = useState<"armed" | "playing" | "done">(armed ? "armed" : "playing");
  const current = list[Math.min(index, list.length - 1)] ?? "glass";
  const meta = FX_LIST.find((fx) => fx.id === current) ?? FX_LIST[0];

  useEffect(() => {
    if (!armed) return;
    const start = () => {
      setLive(true);
      setPhase("playing");
    };
    window.addEventListener("fx-go", start);
    (window as unknown as { __playFx?: () => void }).__playFx = start;
    return () => {
      window.removeEventListener("fx-go", start);
      delete (window as unknown as { __playFx?: () => void }).__playFx;
    };
  }, [armed]);

  return (
    <main
      className="uhoh-preview"
      data-demo="fxgallery"
      data-fxgallery="true"
      data-fx={current}
      data-fx-phase={phase}
      data-fx-index={index}
      data-clean={clean ? "1" : "0"}
    >
      <FxBoard
        key={`${current}-${index}-${run}`}
        effect={current}
        token={`${current}-${index}-${run}`}
        paused={!live}
        onDone={() => {
          if (auto && index < list.length - 1) setIndex((value) => value + 1);
          else setPhase("done");
        }}
      />
      {clean ? null : (
        <div className="uhoh-preview-bar fx-gallery-bar">
          <p className="fx-gallery-label">{meta.code} {meta.name}</p>
          <div className="fx-gallery-picks">
            {FX_LIST.map((fx) => (
              <button
                key={fx.id}
                type="button"
                data-fx-pick={fx.id}
                aria-pressed={fx.id === current}
                onClick={() => {
                  unlockSound();
                  setPhase("playing");
                  setIndex(FX_LIST.findIndex((entry) => entry.id === fx.id));
                  setRun((value) => value + 1);
                }}
              >
                {fx.code.slice(3)}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
