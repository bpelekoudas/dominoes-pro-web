import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PlayerView } from "@uhoh/rules";
import { PHONE_HEIGHT, PHONE_WIDTH, straightBox, TILE_SHORT, type BoardLayout, type LayoutBox, type LayoutLimits, type PlacedEnd } from "../../rules/src/layout.js";
import { scoreDeltaLabel, scorePopupForPlay } from "./feel/score-delta.js";
import { shouldRefitFelt } from "./portrait-lock";
import { motionMs } from "../../rules/src/motion.js";
import { SCORE_FLY_MS, scorePopWindow } from "./feel/score-time.js";
import {
  boardShift,
  CAMERA_EASE_MS,
  TILE_SNAP_MS,
  cameraHoldStale,
  cameraSettlesOn,
  cameraTransform,
  poseAt,
  chainHeldAtHandEnd,
  type CameraPose,
  chainViewShift,
  clampGhostToFelt,
  PINWHEEL_LONG_FRAC,
  PINWHEEL_MARGIN,
  safeRoom,
  frameInsets,
  settledHandCamera,
  nextFeltSize,
  pictureFrom,
  renderedTileRect,
  tilesRelocating,
  landedTileBox,
  zoneInsets,
  type AxisInsets,
  type ZoneRect,
} from "./board-scale.js";
import { handFit } from "./hand-fit.js";
import { FeelRipple, useLiveFeel } from "./feel/live";
import { scoreTier } from "./feel/ladder";
import { BIG_MOMENT_MS, bigMomentLevel, type BigMomentLevel } from "../../rules/src/moment.js";
import { boardDuringOpponentFlight, departureBox, holdCameraForChain, OPPONENT_GLIDE_MS, shouldFlyOpponentTile, type SeatBox } from "./arrival.js";
import { normalizeFx, type FxId } from "./fx.js";
import { demoAward, MomentLayer } from "./moment.js";
import {
  chooseDropEnd,
  type DropBox,
  ghostAimPoint,
  ghostTopLeft,
  GHOST_HEIGHT,
  GHOST_WIDTH,
} from "./drop.js";
import { faceRotation, PipHalf, SpinnerDot } from "./pips.js";

const NO_SLOTS: Array<LayoutBox & { id: string }> = [];

function sampleCamera(motion: { from: CameraPose; to: CameraPose; snapUntil: number }, now: number): CameraPose {
  if (now <= motion.snapUntil) return motion.from;
  return poseAt(motion.from, motion.to, Math.min(1, (now - motion.snapUntil) / CAMERA_EASE_MS));
}

export function Domino({
  a,
  b,
  orientation,
  spinner = false,
  faceDown = false,
}: {
  a: number;
  b: number;
  orientation: "horizontal" | "vertical";
  spinner?: boolean;
  faceDown?: boolean;
}) {
  const rotation = faceRotation(orientation);
  return (
    <span className={`domino ${orientation}${spinner ? " spinner" : ""}${faceDown ? " face-down" : ""}`}>
      {faceDown ? null : (
        <>
          <PipHalf value={a} rotation={rotation} />
          <span className="domino-split" />
          <PipHalf value={b} rotation={rotation} />
          {spinner ? <SpinnerDot /> : null}
        </>
      )}
    </span>
  );
}

export function Table({
  view,
  selectedTile,
  dragTileId,
  aimEndId,
  onPlay,
  onSelect,
  replayToken = 0,
  tableArt = null,
  showScores = false,
}: {
  view: PlayerView;
  selectedTile: string | null;
  dragTileId: string | null;
  aimEndId: string | null;
  onPlay: (tileId: string, endId: string) => void;
  onSelect: (tileId: string | null) => void;
  tableArt?: string | null;
  replayToken?: number;
  /** Points for each open end. Easy practice only, and only while hints are on. */
  showScores?: boolean;
}) {
  const liveBoard = view.board;
  const previousBoard = useRef(liveBoard);
  const frozenBoard = useRef(liveBoard);
  const flightHold = useRef<{ seq: number } | null>(null);
  const armedFlight = useRef<number | null>(null);
  const joinedSeq = useRef<number | null>(null);
  const chainHeld = useRef(false);
  const cameraAim = useRef<SeatBox | null>(null);
  const [flightDone, setFlightDone] = useState(0);
  const [concealed, setConcealed] = useState<string | null>(null);
  const playSeq = view.lastPlay?.seq ?? -1;
  if (joinedSeq.current === null) joinedSeq.current = playSeq;
  const flyNow = shouldFlyOpponentTile({
    playerId: view.lastPlay?.playerId ?? null,
    yourId: view.yourId,
    seq: playSeq,
    joinedSeq: joinedSeq.current,
    bigMoment: view.lastPlay ? bigMomentLevel(view.lastPlay.awarded) !== null : false,
    reducedMotion: prefersReducedMotion(),
  });
  if (flyNow && armedFlight.current !== playSeq) {
    armedFlight.current = playSeq;
    frozenBoard.current = previousBoard.current;
    flightHold.current = { seq: playSeq };
    chainHeld.current = true;
    cameraAim.current = null;
  }
  const board = boardDuringOpponentFlight(frozenBoard.current, liveBoard, chainHeld.current);
  // The felt the chain should fold into, in design pixels, at the readable floor.
  const [limits, setLimits] = useState<LayoutLimits | null>(null);
  const handKey = `${view.gameNumber}:${view.handNumber}`;
  const handOver = view.phase === "between" || view.phase === "over";
  const chainMemory = useRef<BoardLayout | null>(null);
  const chainMemoryHand = useRef("");
  const settledChain = useRef<BoardLayout | null>(null);
  const settledKey = useRef("");
  const turnBudget = useRef<{ scale: number; roomW: number; roomH: number } | null>(null);
  const pinwheelRoom = useRef<{ roomW: number; roomH: number; openScale: number } | null>(null);
  const [pinEpoch, setPinEpoch] = useState(0);
  const boardKeyNow = board?.center
    ? [board.center.tileId, ...(["west", "east", "north", "south"] as const).flatMap((arm) => board.arms[arm].map((tile) => tile.tileId))].join(",")
    : "";
  if (chainMemoryHand.current !== handKey) {
    chainMemory.current = null;
    settledChain.current = null;
    settledKey.current = "";
    turnBudget.current = null;
    chainMemoryHand.current = handKey;
  }
  if (settledKey.current !== boardKeyNow) {
    settledChain.current = chainMemory.current;
    settledKey.current = boardKeyNow;
  }
  const computed = useMemo(
    () => pictureFrom(board, limits, settledChain.current, turnBudget.current, pinwheelRoom.current ?? undefined),
    [board, limits, flightDone, handKey, boardKeyNow, pinEpoch],
  );
  const incomingComputed = useMemo(
    () => pictureFrom(liveBoard, limits, settledChain.current, turnBudget.current, pinwheelRoom.current ?? undefined),
    [liveBoard, limits, handKey, boardKeyNow, pinEpoch],
  );
  if (computed) chainMemory.current = computed;
  const chainRef = useRef<BoardLayout | null>(null);
  const heldChain = useRef<BoardLayout | null>(null);
  if (!handOver) {
    chainRef.current = computed;
    heldChain.current = null;
  } else if (chainRef.current && !heldChain.current) {
    // Latch once, from the board the play just made. A later fallback fold
    // must not replace that chain under DOMINO!.
    heldChain.current = chainHeldAtHandEnd(chainRef.current, incomingComputed ?? computed, true);
  }
  const layout = handOver && heldChain.current ? heldChain.current : computed;
  const incoming = handOver && heldChain.current ? heldChain.current : incomingComputed;
  const frame = useMemo(() => {
    if (!layout && !liveBoard?.center) return null;
    // The stage stays centred on the spinner so a tile's place does not jump.
    // The camera shift moves the whole chain's box into the safe felt.
    const w = limits?.width ?? PHONE_WIDTH;
    const h = limits?.height ?? PHONE_HEIGHT;
    return { x: -w / 2, y: -h / 2, w, h };
  }, [layout, limits, liveBoard]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [lift, setLift] = useState(0);
  const [clip, setClip] = useState<AxisInsets>({ top: 30, right: 30, bottom: 30, left: 30 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [offscreen, setOffscreen] = useState({ top: false, right: false, bottom: false, left: false });
  const [camMode, setCamMode] = useState<"fit" | "follow">("fit");
  const [overview, setOverview] = useState(false);
  const [punch, setPunch] = useState(1);
  const [nudge, setNudge] = useState({ x: 0, y: 0, zoom: 1 });
  const [userCam, setUserCam] = useState<"follow" | "drag">("follow");
  const [cameraArmed, setCameraArmed] = useState(false);
  const [glideOn, setGlideOn] = useState(false);
  const [pin, setPin] = useState<{ left: number; top: number } | null>(null);
  const motionRef = useRef<{ from: CameraPose; to: CameraPose; snapUntil: number; hide: Set<string> } | null>(null);
  const glideTimer = useRef(0);
  const shownPose = useRef({ scale: 1, x: 0, y: 0 });
  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  const frameRef = useRef(frame);
  const liftRef = useRef(lift);
  const pinRef = useRef(pin);
  const handOverRef = useRef(handOver);
  scaleRef.current = scale;
  panRef.current = pan;
  frameRef.current = frame;
  liftRef.current = lift;
  pinRef.current = pin;
  handOverRef.current = handOver;
  const feltRef = useRef<{ w: number; h: number } | null>(null);
  const edgeRef = useRef<AxisInsets | null>(null);
  const visual = motionRef.current ? sampleCamera(motionRef.current, performance.now()) : { scale, x: pan.x, y: pan.y };
  const shownScale = visual.scale * nudge.zoom;
  const shift = { x: visual.x + nudge.x, y: visual.y + nudge.y };
  const gliding = glideOn && motionRef.current != null;
  shownPose.current = { scale: visual.scale, x: visual.x, y: visual.y };
  const armOnce = useRef(false);
  const held = useRef<{ hand: string; scale: number } | null>(null);
  const feltLock = useRef<{ hand: string; w: number; h: number; table: string } | null>(null);
  const placedBoxes = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const [relocating, setRelocating] = useState<ReadonlySet<string>>(new Set());
  const relocateTimer = useRef(0);
  const limitHold = useRef<{ hand: string; limits: { width: number; height: number } } | null>(null);
  const anchorHold = useRef<{ hand: string; shift: { x: number; y: number } } | null>(null);
  const settledTiles = useRef<{ hand: string; ids: string[] }>({ hand: "", ids: [] });
  const knownTiles = useRef<{ hand: string; ids: Set<string> }>({ hand: "", ids: new Set() });
  const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(new Set());
  const frozen = useRef(false);
  const handEndFit = useRef<"" | "gliding" | "ready">("");
  const seatHands = useRef(new Map<string, SeatBox>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastTileId = view.lastPlay?.tileId ?? null;
  const playableKey = view.legalPlays.map((play) => play.endId).sort().join(",");

  useLayoutEffect(() => {
    if (!chainHeld.current) previousBoard.current = liveBoard;
  });

  useLayoutEffect(() => {
    placedBoxes.current = new Map();
    motionRef.current = null;
    window.cancelAnimationFrame(glideTimer.current);
    glideTimer.current = 0;
    handEndFit.current = "";
    setGlideOn(false);
    setRelocating(new Set());
    window.clearTimeout(relocateTimer.current);
  }, [handKey]);

  useLayoutEffect(() => {
    if (!layout) return;
    if (handOver) {
      setRelocating((current) => (current.size === 0 ? current : new Set()));
      return;
    }
    const hidden = tilesRelocating(placedBoxes.current, layout.tiles);
    placedBoxes.current = new Map(layout.tiles.map((tile) => [tile.tileId, { x: tile.x, y: tile.y, w: tile.w, h: tile.h }]));
    if (hidden.length === 0) return;
    setRelocating(new Set(hidden));
    window.clearTimeout(relocateTimer.current);
    relocateTimer.current = window.setTimeout(() => setRelocating(new Set()), CAMERA_EASE_MS);
  }, [layout, handOver]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !frame || !liveBoard?.center) return;
    let measuredThisFrame = false;
    const measure = () => {
      if (measuredThisFrame) return;
      measuredThisFrame = true;
      window.requestAnimationFrame(() => {
        measuredThisFrame = false;
      });
      const handsClear = handClearance(viewport);
      setClip((current) => (sameInsets(current, handsClear) ? current : handsClear));
      // The overlay must not zoom the chain again once the last tile is inside
      // the copper. Until that fit lands, the new tile is still on the old camera.
      if (handOver && handEndFit.current !== "") {
        frozen.current = handEndFit.current === "ready";
        return;
      }
      if (!handOver && frozen.current && held.current?.hand === handKey) {
        frozen.current = true;
        return;
      }
      let width = viewport.clientWidth;
      let height = viewport.clientHeight;
      if (width < 8 || height < 8) return;
      // A sideways phone is covered by the rotate overlay. Fitting that short
      // felt zooms the chain out, and a later portrait measure must not keep
      // the tiny scale. Plays still zoom out; turning the phone does not.
      if (!shouldRefitFelt({ width: window.innerWidth, height: window.innerHeight })) return;
      // The first felt size of the hand is the one that fits the chain.
      // A later hint, banner, or sheet must not zoom it. A real resize
      // changes the width and takes a fresh measurement.
      const locked = feltLock.current;
      const tableId = view.tableId ?? "";
      const nextFelt = nextFeltSize(locked, handKey, width, height, tableId);
      const resized = nextFelt.resized;
      width = nextFelt.w;
      height = nextFelt.h;
      if (resized) feltLock.current = { hand: handKey, w: width, h: height, table: tableId };
      const column = viewport.closest(".felt-column");
      const screenWidth = column instanceof HTMLElement ? column.clientWidth : width;
      const felt = { w: width, h: height };
      const frameEdge = frameInsets(view.tableId, felt);
      const openScale = (PINWHEEL_LONG_FRAC * Math.max(1, screenWidth)) / 72;
      const fitEdge = {
        left: Math.max(frameEdge.left, PINWHEEL_MARGIN),
        right: Math.max(frameEdge.right, PINWHEEL_MARGIN),
        top: Math.max(frameEdge.top, PINWHEEL_MARGIN),
        bottom: Math.max(frameEdge.bottom, PINWHEEL_MARGIN),
      };
      const pinRoom = safeRoom(felt, fitEdge);
      const nextPin = { roomW: pinRoom.w, roomH: pinRoom.h, openScale };
      const prevPin = pinwheelRoom.current;
      pinwheelRoom.current = nextPin;
      if (!prevPin || prevPin.roomW !== nextPin.roomW || prevPin.roomH !== nextPin.roomH
        || Math.abs(prevPin.openScale - nextPin.openScale) > 1e-4) {
        setPinEpoch((value) => value + 1);
      }
      const feltBox = viewport.getBoundingClientRect();
      const keepOuts = [...document.querySelectorAll<HTMLElement>(".edge-slivers")].map(
        (node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left - feltBox.left,
            top: rect.top - feltBox.top,
            right: rect.right - feltBox.left,
            bottom: rect.bottom - feltBox.top,
          };
        },
      );
      // The felt frame is the fit. Badges, the token, and the side hands are
      // local obstacles: an arm turns before the box in front of it, and the
      // picture zooms only when that turned chain no longer fits the frame.
      if (!liveBoard?.center) return;
      const previous = held.current?.hand === handKey ? held.current.scale : null;
      feltRef.current = felt;
      const solved = settledHandCamera({
        board: liveBoard,
        felt,
        screenWidth,
        frame: frameEdge,
        keepOuts,
        previous,
        heldLimits: limitHold.current?.hand === handKey ? limitHold.current.limits : null,
        committed: chainMemory.current,
      });
      edgeRef.current = solved.edge;
      // The readable fold already keeps the previous limits when a new
      // rectangle would not make the tiles larger. Adopt that choice.
      if (!limitHold.current || limitHold.current.hand !== handKey || resized) {
        limitHold.current = { hand: handKey, limits: solved.limits };
      } else if (
        Math.abs(limitHold.current.limits.width - solved.limits.width) > 1
        || Math.abs(limitHold.current.limits.height - solved.limits.height) > 1
      ) {
        limitHold.current = { hand: handKey, limits: solved.limits };
      }
      const handLimits = limitHold.current.limits;
      // pictureFrom can fall back to a larger fold when the limited one
      // overlaps. The scale has to fit the chain that will actually be painted.
      const roomNow = safeRoom(felt, solved.edge);
      const budgetNow = turnBudget.current ?? {
        scale: previous ?? solved.scale,
        roomW: roomNow.w,
        roomH: roomNow.h,
      };
      const picture = pictureFrom(liveBoard, handLimits, settledChain.current, budgetNow, pinwheelRoom.current ?? undefined) ?? solved.layout;
      // The camera fits and centres the placed tiles. Drop targets stay put
      // but they are not part of the picture the board scales to.
      const drawn = picture.tiles;
      const frameShift = boardShift(solved.edge);
      const zoom = solved.scale;
      const centered = chainViewShift(drawn, zoom);
      const nextShift = {
        x: centered.x + frameShift.x + solved.nudge.x,
        y: centered.y + frameShift.y + solved.nudge.y,
      };
      const placed = view.lastPlay ? picture.tiles.find((tile) => tile.tileId === view.lastPlay?.tileId) : undefined;
      if (placed) {
        const rect = renderedTileRect(felt, placed, zoom, nextShift);
        const origin = viewport.getBoundingClientRect();
        cameraAim.current = {
          left: origin.left + rect.left,
          top: origin.top + rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
        };
      }
      // The tile is still in the air. Remember where it will sit, and ease
      // the camera only after the glide lands. The chain on the felt stays
      // the previous one until that ease finishes, so it never draws on the hands.
      if (
        !handOver
        && holdCameraForChain({
          chainHeld: chainHeld.current,
          flightHold: flightHold.current,
          liveSeq: view.lastPlay?.seq ?? -1,
          haveHeldScale: Boolean(held.current),
        })
      ) return;
      if (!chainHeld.current) setLimits((current) => {
        if (
          current
          && Math.abs(current.width - handLimits.width) < 1
          && Math.abs(current.height - handLimits.height) < 1
          && !(current.obstacles && current.obstacles.length > 0)
        ) {
          return current;
        }
        return handLimits;
      });
      const tileIds = picture.tiles.map((tile) => tile.tileId);
      const landed = settledTiles.current.hand !== handKey || cameraSettlesOn(settledTiles.current.ids, tileIds);
      // A refold can walk a tile into a token slot without adding a tile.
      // That still has to pull the scale down. Choosing does not.
      const needsRoom = held.current?.hand === handKey && zoom < held.current.scale - 0.01;
      const heldShift = anchorHold.current?.hand === handKey ? anchorHold.current.shift : nextShift;
      const shiftDelta = Math.max(Math.abs(heldShift.x - nextShift.x), Math.abs(heldShift.y - nextShift.y));
      if (
        !cameraHoldStale({
          sameHand: held.current?.hand === handKey,
          landed,
          resized,
          needsRoom,
          shiftDelta,
        })
      ) {
        if (handOver) handEndFit.current = "ready";
        return;
      }
      const previousShift = anchorHold.current?.hand === handKey ? anchorHold.current.shift : null;
      anchorHold.current = { hand: handKey, shift: nextShift };
      settledTiles.current = { hand: handKey, ids: tileIds };
      const shift = nextShift;
      // The new tile stays visible. The whole board, including it, eases
      // to the new scale and centre in one motion.
      knownTiles.current = { hand: handKey, ids: new Set(tileIds) };
      if (heldIds.size > 0) setHeldIds(new Set());
      viewport.dataset.playTop = solved.edge.top.toFixed(0);
      viewport.dataset.playBottom = solved.edge.bottom.toFixed(0);
      viewport.dataset.playLeft = solved.edge.left.toFixed(0);
      viewport.dataset.playRight = solved.edge.right.toFixed(0);
      viewport.dataset.cameraSettling = "false";
      viewport.dataset.zoom = "ease";
      const prevScale = held.current?.hand === handKey ? held.current.scale : null;
      const cameraMoves =
        prevScale == null
        || Math.abs(prevScale - zoom) > 0.01
        || previousShift == null
        || Math.abs(previousShift.x - shift.x) > 1
        || Math.abs(previousShift.y - shift.y) > 1;
      const feltNow = { w: width, h: height };
      const shown = shownPose.current;
      const glideThis = cameraMoves && prevScale != null && previousShift && shown.scale > 0.05 && !prefersReducedMotion();
      if (glideThis) {
        const hide = new Set<string>();
        for (const tile of picture.tiles) {
          const start = renderedTileRect(feltNow, tile, shown.scale, { x: shown.x, y: shown.y });
          const past = Math.max(
            solved.edge.left - start.left,
            solved.edge.top - start.top,
            start.right - (feltNow.w - solved.edge.right),
            start.bottom - (feltNow.h - solved.edge.bottom),
          );
          if (past > 0.6) hide.add(tile.tileId);
        }
        const now = performance.now();
        const from = motionRef.current ? sampleCamera(motionRef.current, now) : { scale: shown.scale, x: shown.x, y: shown.y };
        motionRef.current = { from, to: { scale: zoom, x: shift.x, y: shift.y }, snapUntil: now + TILE_SNAP_MS, hide };
        const step = (frameNow: number) => {
          const motion = motionRef.current;
          const node = stageRef.current;
          const box = frameRef.current;
          if (!motion || !node || !box) {
            glideTimer.current = 0;
            return;
          }
          const pose = sampleCamera(motion, frameNow);
          node.style.transform = pinRef.current
            ? `scale(${pose.scale})`
            : cameraTransform(pose, box, liftRef.current);
          shownPose.current = pose;
          if (frameNow < motion.snapUntil + CAMERA_EASE_MS) {
            glideTimer.current = window.requestAnimationFrame(step);
            return;
          }
          motionRef.current = null;
          glideTimer.current = 0;
          shownPose.current = motion.to;
          setScale(motion.to.scale);
          setPan({ x: motion.to.x, y: motion.to.y });
          setGlideOn(false);
          if (handOverRef.current) handEndFit.current = "ready";
        };
        window.cancelAnimationFrame(glideTimer.current);
        glideTimer.current = window.requestAnimationFrame(step);
        setGlideOn(true);
        if (handOver) handEndFit.current = "gliding";
      } else {
        if (handOver) handEndFit.current = "ready";
        setScale((current) => (Math.abs(current - zoom) < 0.01 ? current : zoom));
        setPan((current) => (Math.abs(current.x - shift.x) < 1 && Math.abs(current.y - shift.y) < 1 ? current : shift));
      }
      held.current = { hand: handKey, scale: zoom };
      turnBudget.current = { scale: zoom, roomW: roomNow.w, roomH: roomNow.h };
      frozen.current = handOver;
      setCamMode("fit");
      setOffscreen((current) =>
        current.top || current.right || current.bottom || current.left
          ? { top: false, right: false, bottom: false, left: false }
          : current,
      );
      if (!armOnce.current) {
        armOnce.current = true;
        requestAnimationFrame(() => setCameraArmed(true));
      }
    };
    measure();
    let measureFrame = 0;
    const schedule = () => {
      if (measureFrame) return;
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = 0;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    const app = viewport.closest(".felt-app");
    app?.querySelectorAll(".playbar, .hand-tray, .edge-top, .edge-badge, .edge-slivers, .token-slot, .seat-pips, .talk-line").forEach((node) => {
      observer.observe(node);
    });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(measureFrame);
    };
  }, [layout, frame, handOver, handKey, lastTileId, playableKey, overview, punch, view.tableId, view.lastPlay?.seq, flightDone]);

  useLayoutEffect(() => {
    const next = new Map<string, SeatBox>();
    document.querySelectorAll<HTMLElement>(".rail[data-player-id]").forEach((rail) => {
      const id = rail.getAttribute("data-player-id");
      const slivers = rail.querySelectorAll(".sliver");
      const last = slivers[slivers.length - 1];
      if (!id || !(last instanceof HTMLElement)) return;
      const rect = last.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      next.set(id, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    });
    seatHands.current = next;
  });

  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = viewportRef.current;
    if (!handOver || !viewport || handEndFit.current !== "ready" || glideOn) {
      if (!handOver) {
        setLift((current) => (current === 0 ? current : 0));
        setPin((current) => (current == null ? current : null));
        root.style.removeProperty("--hand-sheet-max");
      }
      return;
    }
    // The clip-path on the felt is a containing block, so a fixed scaler
    // inside it moves when the reveal resizes the table. Lift the picture
    // onto the body at the rect the player is already looking at.
    window.cancelAnimationFrame(glideTimer.current);
    glideTimer.current = 0;
    motionRef.current = null;
    const stage = stageRef.current;
    const matrix = new DOMMatrix(getComputedStyle(stage ?? viewport).transform);
    const seen = Math.abs(matrix.a) > 0.05 ? Math.abs(matrix.a) : null;
    if (seen != null) {
      held.current = { hand: handKey, scale: seen };
      setScale((current) => (Math.abs(current - seen) < 0.001 ? current : seen));
    }
    if (stage) {
      const rect = stage.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) setPin({ left: rect.left, top: rect.top });
    }
    setLift(0);
    root.style.removeProperty("--hand-sheet-max");
  }, [handOver, handKey, glideOn]);

  useLayoutEffect(() => {
    const node = stageRef.current;
    const box = frameRef.current;
    if (!node || !box) return;
    const motion = motionRef.current;
    const pose = motion ? sampleCamera(motion, performance.now()) : { scale: scaleRef.current, x: panRef.current.x, y: panRef.current.y };
    node.style.transform = pinRef.current ? `scale(${pose.scale})` : cameraTransform(pose, box, liftRef.current);
    if (!motion) shownPose.current = pose;
  });

  const focusTile = dragTileId ?? selectedTile;
  const focusPlays = focusTile ? view.legalPlays.filter((play) => play.tileId === focusTile) : [];
  // A drag shows every legal end. A tap shows them only when the tile fits more than one.
  const armed = dragTileId !== null || focusPlays.length > 1;
  const hotEnds = new Set(armed ? focusPlays.map((play) => play.endId) : []);
  const dropLead = dragTileId !== null && hotEnds.has("lead");
  const slotKey = armed ? [...hotEnds].sort().join(",") : "";
  const previewDouble = Boolean(focusTile && focusTile.split("-")[0] === focusTile.split("-")[1]);
  const slotBoxes = useMemo(() => {
    if (!layout || !slotKey) return NO_SLOTS;
    const ids = new Set(slotKey.split(","));
    return layout.ends.filter((end) => ids.has(end.id)).map((end) => ({ ...nextSlotBox(layout, end, previewDouble), id: end.id }));
  }, [layout, slotKey, previewDouble]);
  const ghostFaces = useMemo(() => {
    const faces = new Map<string, { a: number; b: number; orientation: "horizontal" | "vertical" }>();
    if (!layout || !focusTile) return faces;
    for (const box of slotBoxes) {
      const end = layout.ends.find((item) => item.id === box.id);
      if (!end) continue;
      faces.set(box.id, ghostFace(focusTile, box, end));
    }
    return faces;
  }, [layout, focusTile, slotBoxes]);
  const slots = useScreenBoxes(stageRef, frame, shownScale, slotBoxes);
  const feel = useLiveFeel(view);
  const pop = useScorePop(view.lastPlay);
  const { moment, dismissMoment } = useBigMoment(view.lastPlay, view.players, replayToken);
  const [shake, setShake] = useState<BigMomentLevel | null>(null);
  const [slamming, setSlamming] = useState(false);
  // Follow the scoring tile, not whichever tile landed last. A later play
  // used to drop the anchor and unmount the moment before the word faded in.
  const hitId = moment?.tileId ?? lastTileId;
  const landed = useTileCenter(viewportRef, layout, frame, shownScale, shift.x, shift.y + lift, hitId);
  const heldAnchor = useRef<{ id: string; box: { x: number; y: number; w: number; h: number } } | null>(null);
  if (!moment) heldAnchor.current = null;
  else if (moment.tileId && landed && hitId === moment.tileId) heldAnchor.current = { id: moment.tileId, box: landed };
  const anchor = !moment
    ? null
    : moment.tileId
      ? landed && hitId === moment.tileId
        ? landed
        : heldAnchor.current?.id === moment.tileId
          ? heldAnchor.current.box
          : null
      : landed;
  const popup = scorePopupForPlay(view.lastPlay, pop);
  const tray = typeof document === "undefined" ? null : document.querySelector(".hand-tray");
  const trayRect = tray?.getBoundingClientRect();
  const popAt =
    popup && pop && trayRect && trayRect.width > 1
      ? { left: trayRect.left + Math.min(96, trayRect.width / 2), top: trayRect.top + 10, place: "above" as const }
      : null;
  const placed = moment?.tileId ? layout?.tiles.find((tile) => tile.tileId === moment.tileId) : undefined;

  function onCamDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, .end-cap")) return;
    // The board does not pan or pinch. A tap still falls through to the felt.
    void event;
  }

  function onCamMove(_event: ReactPointerEvent<HTMLDivElement>) {
    return;
  }

  function onCamUp(_event: ReactPointerEvent<HTMLDivElement>) {
    return;
  }

  return (
    <div
      className={`table-scroll${dropLead ? " drop-ready" : ""}${shake ? " shaking" : ""}${handOver && lastTileId ? " hand-over" : ""}`}
      data-last-tile={lastTileId ?? ""}
      data-moment={moment?.key ?? ""}
      data-live-award={view.lastPlay?.awarded ?? ""}
      data-moment-tile={moment?.tileId ?? ""}
      data-anchor={anchor ? "yes" : "no"}
      data-shake={shake ?? "off"}
      ref={viewportRef}
      data-open-total={view.openTotal}
      data-knock-streak={view.knockStreak}
      data-table-id={view.tableId}
      data-board-scale={shownScale.toFixed(2)}
      data-tile-px={(TILE_SHORT * shownScale).toFixed(0)}
      data-cam-mode={handOver || overview ? "overview" : camMode}
      data-cam-user={userCam}
      onPointerDown={onCamDown}
      onPointerMove={onCamMove}
      onPointerUp={onCamUp}
      onPointerCancel={onCamUp}
      data-board-lift={String(lift)}
      data-fit-top={clip.top.toFixed(0)}
      data-fit-right={clip.right.toFixed(0)}
      data-fit-bottom={clip.bottom.toFixed(0)}
      data-fit-left={clip.left.toFixed(0)}
      data-board-frozen={handOver ? "true" : "false"}
      data-win-board="true"
      data-camera={cameraArmed ? "armed" : "hold"}
      data-zoom="ease"
      data-glide={glideOn ? "locked" : "free"}
      data-drop-ready={dropLead ? "true" : "false"}
      style={tableArt ? { backgroundImage: `url(${tableArt})` } : undefined}
    >
      {offscreen.top ? <i className="cam-edge cam-n" aria-hidden="true" /> : null}
      {offscreen.right ? <i className="cam-edge cam-e" aria-hidden="true" /> : null}
      {offscreen.bottom ? <i className="cam-edge cam-s" aria-hidden="true" /> : null}
      {offscreen.left ? <i className="cam-edge cam-w" aria-hidden="true" /> : null}
      {layout && frame ? (
        <div
          className="board-clip"
          style={pin ? undefined : { clipPath: `inset(${Math.max(clip.top, edgeRef.current?.top ?? 0)}px ${Math.max(clip.right, edgeRef.current?.right ?? 0)}px ${Math.max(clip.bottom, edgeRef.current?.bottom ?? 0)}px ${Math.max(clip.left, edgeRef.current?.left ?? 0)}px)` }}
        >
        <div
          className="board-scaler"
          data-pinned={pin ? "true" : "false"}
          style={pin ? {
            position: "fixed",
            left: pin.left,
            top: pin.top,
            margin: 0,
            zIndex: 2,
            width: frame.w,
            height: frame.h,
            transform: "none",
          } : undefined}
        >
          <div
            className="board-stage"
            ref={stageRef}
            style={{ width: frame.w, height: frame.h }}
          >
            {layout.tiles.map((tile) => (
              <div
                key={tile.tileId}
                className={`board-tile${tile.tileId === lastTileId ? " last-move" : ""}${heldIds.has(tile.tileId) ? " is-camera-hold" : ""}${!handOver && (relocating.has(tile.tileId) || (gliding && motionRef.current?.hide.has(tile.tileId)) || tileCrossesInset(tile, shownScale, shift, feltRef.current, edgeRef.current)) ? " is-relocating" : ""}${concealed === tile.tileId ? " is-arriving" : ""}${slamming && !handOver && tile.tileId === moment?.tileId ? " is-slamming" : ""}`}
                data-feel={tile.tileId === lastTileId ? feel.tier : undefined}
                style={place(tile, frame)}
                data-board-tile={tile.tileId}
                data-cross={tile.spinner ? (liveBoard.spinnerOpen ? "open" : "closed") : undefined}
              >
                <Domino a={tile.a} b={tile.b} orientation={tile.orientation} spinner={tile.spinner} />
              </div>
            ))}
            {layout.ends.map((end) => {
              const hot = hotEnds.has(end.id);
              const aim = aimEndId === end.id;
              return (
                <button
                  key={end.id}
                  type="button"
                  className={`end-cap${hot ? " hot" : ""}${aim ? " aim" : ""}${feel.scoring ? " is-scoring" : ""}`}
                  style={place(end, frame)}
                  data-end-id={end.id}
                  data-hot={hot ? "true" : "false"}
                  onClick={() => chooseEnd(end.id)}
                  aria-label={`Open ${end.id} end, match ${end.match}`}
                >
                  {/* The open-end total stays in the tray. A number here sits on the felt. */}
                </button>
              );
            })}
          </div>
        </div>
        </div>
      ) : null}
      {moment && anchor ? (
        <MomentLayer
          token={moment.key}
          awarded={moment.awarded}
          tileId={moment.tileId}
          tile={{
            a: placed?.a ?? faceOf(moment.tileId).a,
            b: placed?.b ?? faceOf(moment.tileId).b,
            orientation: placed?.orientation ?? "vertical",
            spinner: placed?.spinner,
          }}
          anchor={anchor}
          effect={moment.effect}
          cry={feel.cry}
          onShake={setShake}
          onPhase={(phase) => setSlamming(phase === "impact" && !prefersReducedMotion())}
          onDone={() => {
            setSlamming(false);
            dismissMoment(moment.key);
          }}
        />
      ) : null}
      {slots.map((slot) => {
        const face = ghostFaces.get(slot.id) ?? null;
        const viewport = viewportRef.current;
        const felt = viewport?.getBoundingClientRect();
        const inset = (name: string) => Number(viewport?.dataset[name] ?? 8);
        const placed = felt
          ? clampGhostToFelt(slot, {
            left: felt.left + inset("playLeft"),
            top: felt.top + inset("playTop"),
            right: felt.right - inset("playRight"),
            bottom: felt.bottom - inset("playBottom"),
          })
          : slot;
        return createPortal(
          <div
            key={slot.id}
            className="ghost-slot"
            data-end-id={slot.id}
            style={{ left: placed.left, top: placed.top, width: placed.width, height: placed.height }}
          >
            {face ? <Domino a={face.a} b={face.b} orientation={face.orientation} /> : null}
          </div>,
          document.body,
        );
      })}
      <Arrival
        lastPlay={view.lastPlay}
        yourId={view.yourId}
        layout={layout}
        incoming={incoming}
        flightHold={flightHold}
        cameraAim={cameraAim}
        hands={seatHands}
        onFlightEnd={() => {
          chainHeld.current = false;
          setConcealed(view.lastPlay?.tileId ?? null);
          setFlightDone((n) => n + 1);
        }}
        onSettled={() => setConcealed(null)}
      />
      <FeelRipple knock={feel.knock} />
      {popup && pop && popAt ? (
        <FlyingScore pop={pop} text={popup.text} at={popAt} />
      ) : null}
    </div>
  );

  function chooseEnd(endId: string) {
    if (!selectedTile || !hotEnds.has(endId)) return;
    onPlay(selectedTile, endId);
    onSelect(null);
  }
}

function ghostFace(
  tileId: string,
  box: LayoutBox,
  end: PlacedEnd,
): { a: number; b: number; orientation: "horizontal" | "vertical" } {
  const parts = tileId.split("-").map((part) => Number(part));
  const low = Number.isFinite(parts[0]) ? parts[0]! : 0;
  const high = Number.isFinite(parts[1]) ? parts[1]! : low;
  const orientation = box.w >= box.h ? "horizontal" : "vertical";
  const match = low === end.match || high === end.match ? end.match : low;
  const other = match === low ? high : low;
  const dx = box.x + box.w / 2 - (end.x + end.w / 2);
  const dy = box.y + box.h / 2 - (end.y + end.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { a: match, b: other, orientation } : { a: other, b: match, orientation };
  }
  return dy >= 0 ? { a: match, b: other, orientation } : { a: other, b: match, orientation };
}

function Arrival({
  lastPlay,
  yourId,
  layout,
  incoming,
  flightHold,
  cameraAim,
  hands,
  onFlightEnd,
  onSettled,
}: {
  lastPlay: PlayerView["lastPlay"];
  yourId: string;
  layout: BoardLayout | null;
  incoming: BoardLayout | null;
  flightHold: { current: { seq: number } | null };
  cameraAim: { current: SeatBox | null };
  hands: { current: Map<string, SeatBox> };
  onFlightEnd: () => void;
  onSettled: () => void;
}) {
  const seq = lastPlay?.seq ?? -1;
  const tileId = lastPlay?.tileId ?? null;
  const playerId = lastPlay?.playerId ?? null;
  const awarded = lastPlay?.awarded ?? 0;
  const joined = useRef<number | null>(null);
  const armed = useRef<number | null>(null);
  if (joined.current === null) joined.current = seq;
  const fly = shouldFlyOpponentTile({
    playerId,
    yourId,
    seq,
    joinedSeq: joined.current,
    bigMoment: bigMomentLevel(awarded) !== null,
    reducedMotion: prefersReducedMotion(),
  });
  if (fly && armed.current !== seq) {
    armed.current = seq;
    flightHold.current = { seq };
  }
  const [box, setBox] = useState<SeatBox | null>(null);
  const [face, setFace] = useState<{ a: number; b: number; orientation: "horizontal" | "vertical" } | null>(null);
  const layoutRef = useRef(incoming ?? layout);
  layoutRef.current = incoming ?? layout;
  const aimRef = useRef(cameraAim);
  aimRef.current = cameraAim;
  const endRef = useRef(onFlightEnd);
  endRef.current = onFlightEnd;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useLayoutEffect(() => {
    if (!fly || !tileId || !playerId) return;
    const from = departureBox(hands.current, playerId);
    let tile: HTMLElement | null = null;
    let frameId = 0;
    let timer = 0;
    let parkTimer = 0;
    let cancelled = false;
    const mySeq = seq;
    const releaseCamera = () => {
      if (flightHold.current?.seq === mySeq) flightHold.current = null;
    };
    const finish = () => {
      if (cancelled) return;
      if (flightHold.current && flightHold.current.seq !== mySeq) return;
      releaseCamera();
      endRef.current();
      settledRef.current();
    };
    const destination = (): SeatBox | null => {
      const placed = layoutRef.current?.tiles.find((item) => item.tileId === tileId);
      const live = placed ? projectTile(placed) : null;
      if (live && live.width > 2) return live;
      const aimed = aimRef.current.current;
      if (aimed && aimed.width > 2 && aimed.height > 2) return aimed;
      return null;
    };
    const insideFelt = (box: SeatBox): boolean => {
      const viewport = document.querySelector<HTMLElement>(".table-scroll");
      if (!viewport) return true;
      const felt = viewport.getBoundingClientRect();
      const inset = (name: string) => Number(viewport.dataset[name] ?? 8);
      return box.left >= felt.left + inset("playLeft") - 0.6
        && box.top >= felt.top + inset("playTop") - 0.6
        && box.left + box.width <= felt.right - inset("playRight") + 0.6
        && box.top + box.height <= felt.bottom - inset("playBottom") + 0.6;
    };
    const start = () => {
      const placed = layoutRef.current?.tiles.find((item) => item.tileId === tileId);
      const live = placed ? projectTile(placed) : null;
      tile = document.querySelector<HTMLElement>(`[data-board-tile="${CSS.escape(tileId)}"]`);
      tile?.classList.add("is-arriving");
      // A copy parked at the future camera sits a tile-length off the chain
      // and stays there. The tile has to be the chain's own tile.
      if (!live || !insideFelt(live)) {
        setBox(null);
        releaseCamera();
        endRef.current();
        parkTimer = window.setTimeout(() => {
          tile?.classList.remove("is-arriving");
          settledRef.current();
        }, 32);
        return true;
      }
      const origin = from ?? liveHandBox(playerId);
      if (!origin) return false;
      setFace(
        placed
          ? { a: placed.a, b: placed.b, orientation: placed.orientation }
          : { a: 0, b: 0, orientation: live.width >= live.height ? "horizontal" : "vertical" },
      );
      setBox(origin);
      timer = window.setTimeout(() => {
        if (cancelled) return;
        tile?.classList.remove("is-arriving");
        setBox(null);
        releaseCamera();
        endRef.current();
        settledRef.current();
      }, OPPONENT_GLIDE_MS);
      frameId = window.requestAnimationFrame(() => {
        frameId = window.requestAnimationFrame(() => {
          if (cancelled) return;
          const next = projectTile(placed!);
          if (!next) return;
          setBox({ left: next.left, top: next.top, width: next.width, height: next.height });
        });
      });
      return true;
    };
    frameId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (start()) return;
      frameId = window.requestAnimationFrame(() => {
        if (cancelled) return;
        if (!start()) finish();
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timer);
      window.clearTimeout(parkTimer);
      tile?.classList.remove("is-arriving");
      // A new hand can replace this play before the glide ends. Drop the
      // frozen chain then, or the next camera paints it at the opening size.
      if (flightHold.current?.seq === mySeq) {
        flightHold.current = null;
        endRef.current();
      }
      setBox(null);
    };
  }, [fly, seq, tileId, playerId]);

  if (!box || !face) return null;
  return createPortal(
    <div className="arrive-tile is-reveal" data-arrive={tileId ?? ""} data-arrive-from={playerId ?? ""} style={box}>
      <Domino a={face.a} b={face.b} orientation={face.orientation} />
    </div>,
    document.body,
  );
}

/** Keep chain tiles off the face-down hands. The inset is the sliver stack, in felt pixels. */
function handClearance(viewport: HTMLElement): AxisInsets {
  const felt = viewport.getBoundingClientRect();
  const clear: AxisInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (felt.width < 8 || felt.height < 8) return clear;
  document.querySelectorAll<HTMLElement>(".rail[data-edge]").forEach((rail) => {
    const edge = rail.getAttribute("data-edge");
    const box = rail.querySelector(".edge-slivers")?.getBoundingClientRect();
    if (!box || box.width < 2 || box.height < 2) return;
    if (edge === "left") clear.left = Math.max(clear.left, Math.ceil(box.right - felt.left));
    else if (edge === "right") clear.right = Math.max(clear.right, Math.ceil(felt.right - box.left));
    else if (edge === "top") clear.top = Math.max(clear.top, Math.ceil(box.bottom - felt.top));
  });
  return clear;
}

function projectTile(box: LayoutBox): SeatBox | null {
  const stage = document.querySelector<HTMLElement>(".board-stage");
  if (!stage) return null;
  const origin = stage.getBoundingClientRect();
  const width = stage.offsetWidth;
  const height = stage.offsetHeight;
  if (width < 2 || height < 2 || origin.width < 2) return null;
  const scale = origin.width / width;
  const left = box.x + width / 2;
  const top = box.y + height / 2;
  return {
    left: origin.left + left * scale,
    top: origin.top + top * scale,
    width: box.w * scale,
    height: box.h * scale,
  };
}

function liveHandBox(playerId: string): SeatBox | null {
  const rail = document.querySelector<HTMLElement>(`.rail[data-player-id="${CSS.escape(playerId)}"]`);
  const slivers = rail?.querySelectorAll(".sliver");
  const last = slivers?.[slivers.length - 1];
  if (!(last instanceof HTMLElement)) return null;
  const rect = last.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function nextSlotBox(layout: BoardLayout, end: PlacedEnd, isDouble: boolean): LayoutBox {
  const tip = [...layout.tiles].reverse().find((tile) => tile.arm === end.id);
  if (!tip) {
    const center = layout.tiles[0];
    if (!center) return end;
    return straightBox(center, end.id, isDouble);
  }
  // A double, and the tile played on a double, stay on the current line.
  const tipIsDouble = tip.direction === "north" || tip.direction === "south" ? tip.w > tip.h : tip.h > tip.w;
  if (isDouble || tipIsDouble) return straightBox(tip, tip.direction, isDouble);
  return layout.previews[end.id] ?? straightBox(tip, tip.direction, false);
}

interface ScreenBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function useScreenBoxes(
  stageRef: { current: HTMLDivElement | null },
  fit: LayoutBox | null,
  scale: number,
  boxes: Array<LayoutBox & { id: string }>,
): ScreenBox[] {
  const [placed, setPlaced] = useState<ScreenBox[]>([]);
  const key = boxes.map((box) => `${box.id}:${box.x}:${box.y}:${box.w}:${box.h}`).join("|");
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !fit || boxes.length === 0) {
      setPlaced([]);
      return;
    }
    const origin = stage.getBoundingClientRect();
    setPlaced(
      boxes.map((box) => {
        const local = place(box, fit);
        return {
          id: box.id,
          left: origin.left + local.left * scale,
          top: origin.top + local.top * scale,
          width: local.width * scale,
          height: local.height * scale,
        };
      }),
    );
  }, [stageRef, fit, scale, key, boxes]);
  return placed;
}

function useBigMoment(
  lastPlay: PlayerView["lastPlay"],
  players: PlayerView["players"],
  replayToken: number,
): {
  moment: { key: string; awarded: number; tileId: string | null; effect: FxId } | null;
  dismissMoment: (key?: string) => void;
} {
  const liveKey =
    lastPlay && bigMomentLevel(lastPlay.awarded) ? `play-${lastPlay.seq}:${lastPlay.awarded}` : "";
  // Empty on purpose. Seeding this with the first liveKey skips a 20 that is
  // already on the table when the felt mounts.
  const skip = useRef("");
  const [moment, setMoment] = useState<{ key: string; awarded: number; tileId: string | null; effect: FxId } | null>(null);
  const dismiss = (key?: string) => {
    setMoment((prev) => {
      if (!prev) return null;
      if (key && prev.key !== key) return prev;
      return null;
    });
  };
  // Start before paint. A later small play does not clear it. The timer
  // does, and the same play does not start again.
  useLayoutEffect(() => {
    if (!liveKey || !lastPlay || liveKey === skip.current) return;
    skip.current = liveKey;
    const scorer = players.find((player) => player.id === lastPlay.playerId);
    setMoment({ key: liveKey, awarded: lastPlay.awarded, tileId: lastPlay.tileId, effect: normalizeFx(scorer?.effectId) });
  }, [liveKey, lastPlay, players]);
  useEffect(() => {
    if (!moment) return;
    const key = moment.key;
    const timer = window.setTimeout(() => dismiss(key), BIG_MOMENT_MS);
    return () => window.clearTimeout(timer);
  }, [moment?.key]);
  const tileRef = useRef(lastPlay?.tileId ?? null);
  tileRef.current = lastPlay?.tileId ?? null;
  useEffect(() => {
    if (replayToken <= 0) return;
    setMoment({ key: `demo-${replayToken}`, awarded: demoAward(), tileId: tileRef.current, effect: "glass" });
  }, [replayToken]);
  return { moment, dismissMoment: dismiss };
}

function useEndCenter(
  viewportRef: { current: HTMLDivElement | null },
  layout: BoardLayout | null,
  frame: LayoutBox | null,
  scale: number,
  shiftX: number,
  shiftY: number,
  active: boolean,
): { x: number; y: number } | null {
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!active || !viewport || !layout || !frame || layout.ends.length === 0) {
      setSpot(null);
      return;
    }
    const felt = viewport.getBoundingClientRect();
    let x = 0;
    let y = 0;
    for (const end of layout.ends) {
      const box = landedTileBox(
        { left: felt.left, top: felt.top, width: felt.width, height: felt.height },
        frame,
        scale,
        shiftX,
        shiftY,
        end,
      );
      x += box.x;
      y += box.y;
    }
    const next = { x: x / layout.ends.length, y: y / layout.ends.length };
    setSpot((current) => (current && Math.abs(current.x - next.x) < 0.5 && Math.abs(current.y - next.y) < 0.5 ? current : next));
  }, [viewportRef, layout, frame, scale, shiftX, shiftY, active]);
  return spot;
}

function useTileCenter(
  viewportRef: { current: HTMLDivElement | null },
  layout: BoardLayout | null,
  frame: LayoutBox | null,
  scale: number,
  shiftX: number,
  shiftY: number,
  tileId: string | null,
): { x: number; y: number; w: number; h: number } | null {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const tile = tileId && layout ? layout.tiles.find((item) => item.tileId === tileId) : undefined;
    const root = document.documentElement;
    if (!viewport || !frame || !tile) {
      setBox(null);
      delete root.dataset.tileHitX;
      delete root.dataset.tileHitY;
      return;
    }
    const felt = viewport.getBoundingClientRect();
    const next = landedTileBox(
      { left: felt.left, top: felt.top, width: felt.width, height: felt.height },
      frame,
      scale,
      shiftX,
      shiftY,
      tile,
    );
    root.dataset.tileHitX = next.x.toFixed(1);
    root.dataset.tileHitY = next.y.toFixed(1);
    root.dataset.tileHitW = next.w.toFixed(1);
    root.dataset.tileHitH = next.h.toFixed(1);
    setBox((current) =>
      current &&
      Math.abs(current.x - next.x) < 0.5 &&
      Math.abs(current.y - next.y) < 0.5 &&
      Math.abs(current.w - next.w) < 0.5 &&
      Math.abs(current.h - next.h) < 0.5
        ? current
        : next,
    );
  }, [viewportRef, layout, frame, scale, shiftX, shiftY, tileId]);
  return box;
}

function sameInsets(a: AxisInsets, b: AxisInsets): boolean {
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5 && Math.abs(a.left - b.left) < 0.5;
}

function measureZones(viewport: HTMLElement): ZoneRect[] {
  const felt = viewport.getBoundingClientRect();
  const zones: ZoneRect[] = [];
  const app = viewport.closest(".felt-app");
  app?.querySelectorAll(".playbar, .hand-tray, .edge-top, .edge-badge, .edge-slivers, .token-slot, .seat-pips, .talk-line").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const rect = node.getBoundingClientRect();
    const left = Math.max(rect.left, felt.left) - felt.left;
    const top = Math.max(rect.top, felt.top) - felt.top;
    const right = Math.min(rect.right, felt.right) - felt.left;
    const bottom = Math.min(rect.bottom, felt.bottom) - felt.top;
    if (right - left < 1 || bottom - top < 1) return;
    zones.push({ left, top, right, bottom });
  });
  return zones;
}

function measureReserve(viewport: HTMLElement): AxisInsets {
  const felt = viewport.getBoundingClientRect();
  const zones: DOMRect[] = [];
  const app = viewport.closest(".felt-app");
  app?.querySelectorAll(".playbar, .hand-tray, .edge-top, .edge-badge, .edge-slivers, .token-slot, .seat-pips, .talk-line").forEach((node) => {
    if (node instanceof HTMLElement) zones.push(node.getBoundingClientRect());
  });
  return zoneInsets(
    { left: felt.left, top: felt.top, right: felt.right, bottom: felt.bottom },
    zones.map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })),
  );
}

function faceOf(tileId: string | null): { a: number; b: number } {
  const [low, high] = (tileId ?? "6-6").split("-").map((part) => Number(part));
  return { a: Number.isFinite(low) ? low! : 6, b: Number.isFinite(high) ? high! : 6 };
}

function useScorePop(lastPlay: PlayerView["lastPlay"]): { seq: number; awarded: number; tileId: string; endId: string; playerId: string } | null {
  const label = scoreDeltaLabel(lastPlay?.awarded ?? 0);
  const liveKey = lastPlay && label != null ? `${lastPlay.seq}:${label}` : "";
  const tileId = lastPlay?.tileId ?? "";
  const endId = lastPlay?.endId ?? "";
  const playerId = lastPlay?.playerId ?? "";
  const [pop, setPop] = useState<{ seq: number; awarded: number; tileId: string; endId: string; playerId: string } | null>(null);
  const keyRef = useRef(liveKey);
  keyRef.current = liveKey;
  if (pop && `${pop.seq}:${pop.awarded}` !== liveKey) setPop(null);
  useEffect(() => {
    if (!liveKey || label == null) return;
    // A routine award appears and leaves on the shared motion pace.
    // The flight into the chip happens inside that window.
    const timing = scorePopWindow(label);
    const token = liveKey;
    const awarded = label;
    const seq = Number(liveKey.slice(0, liveKey.indexOf(":")));
    const show = window.setTimeout(() => {
      if (keyRef.current !== token) return;
      setPop({ seq, awarded, tileId, endId, playerId });
    }, timing.show);
    const hide = window.setTimeout(() => {
      setPop((prev) => (prev && `${prev.seq}:${prev.awarded}` === token ? null : prev));
    }, timing.hide);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [liveKey, label, tileId, endId, playerId]);
  return pop && `${pop.seq}:${pop.awarded}` === liveKey ? pop : null;
}

function FlyingScore({
  pop,
  text,
  at,
}: {
  pop: { seq: number; awarded: number; playerId: string };
  text: string;
  at: { left: number; top: number; place: "tile" | "above" | "beside" };
}) {
  const [spot, setSpot] = useState(at);
  const [fly, setFly] = useState(false);
  useLayoutEffect(() => {
    setSpot(at);
    setFly(false);
    let frame = 0;
    const wait = scorePopWindow(pop.awarded).fly;
    const timer = window.setTimeout(() => {
      const chip = document.querySelector<HTMLElement>(`[data-win-score="${CSS.escape(pop.playerId)}"]`);
      const rect = chip?.getBoundingClientRect();
      if (!rect || rect.width < 1) return;
      frame = window.requestAnimationFrame(() => {
        setFly(true);
        setSpot({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2, place: "above" });
      });
    }, wait);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [pop.seq, pop.awarded, pop.playerId, at.left, at.top, at.place]);
  return createPortal(
    <p
      className="score-pop"
      style={{ left: spot.left, top: spot.top, transitionDuration: fly ? `${SCORE_FLY_MS}ms` : "0ms" }}
      data-awarded={pop.awarded}
      data-tier={scoreTier(pop.awarded)}
      data-place={fly ? "fly" : at.place}
      data-fly={fly ? "1" : "0"}
    >
      {text}
    </p>,
    document.body,
  );
}

function tileCrossesInset(
  tile: LayoutBox,
  scale: number,
  shift: { x: number; y: number },
  felt: { w: number; h: number } | null,
  edge: AxisInsets | null,
): boolean {
  if (!felt || felt.w < 8 || felt.h < 8 || !edge || !(scale > 0)) return false;
  const rect = renderedTileRect(felt, tile, scale, shift);
  return Math.max(
    edge.left - rect.left,
    edge.top - rect.top,
    rect.right - (felt.w - edge.right),
    rect.bottom - (felt.h - edge.bottom),
  ) > 0.6;
}

function place(box: LayoutBox, fit: LayoutBox): { left: number; top: number; width: number; height: number } {
  return {
    left: box.x - fit.x,
    top: box.y - fit.y,
    width: box.w,
    height: box.h,
  };
}

type Ghost = {
  tileId: string;
  high: number;
  low: number;
  left: number;
  top: number;
  spring: boolean;
};

type Session = {
  pointerId: number;
  tileId: string;
  high: number;
  low: number;
  originX: number;
  originY: number;
  active: boolean;
};

export function Hand({
  view,
  selectedTile,
  onSelect,
  onPlay,
  onDragTile,
  showScores = false,
}: {
  view: PlayerView;
  selectedTile: string | null;
  onSelect: (tileId: string | null) => void;
  onPlay: (tileId: string, endId: string) => void;
  onDragTile: (tileId: string | null, aimEndId: string | null) => void;
  showScores?: boolean;
}) {
  const mine = view.turnPlayerId === view.yourId;
  const session = useRef<Session | null>(null);
  const dragged = useRef(false);
  const timer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const motion = useRef(0);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onDragRef = useRef(onDragTile);
  onDragRef.current = onDragTile;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handRef = useRef<HTMLDivElement>(null);
  const count = view.you.hand.length;

  useLayoutEffect(() => {
    const el = handRef.current;
    const frame = el?.parentElement;
    if (!el || !frame) return;
    const natural = () => {
      const base = window.matchMedia("(min-width: 880px) and (min-height: 640px)").matches
        ? 68
        : window.matchMedia("(min-width: 720px)").matches
          ? 58
          : 44;
      return document.documentElement.dataset.tileSize === "large" ? Math.round(base * 1.28) : base;
    };
    const apply = () => {
      const next = handFit(el.clientWidth, count, natural());
      el.style.setProperty("--hand-tile", `${next.tile}px`);
      el.style.setProperty("--hand-gap", `${next.gap}px`);
      el.dataset.scroll = next.scroll ? "true" : "false";
      const hidden = el.scrollWidth - el.clientWidth - el.scrollLeft;
      frame.dataset.fadeStart = next.scroll && el.scrollLeft > 4 ? "true" : "false";
      frame.dataset.fadeEnd = next.scroll && hidden > 4 ? "true" : "false";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    el.addEventListener("scroll", apply, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", apply);
    };
  }, [count]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    if (!liftedId) return;
    const blockScroll = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", blockScroll, { passive: false });
    document.body.classList.add("is-dragging");
    return () => {
      document.removeEventListener("touchmove", blockScroll);
      document.body.classList.remove("is-dragging");
    };
  }, [liftedId]);

  return (
    <div className="hand-frame">
    <div className="hand" role="list" ref={handRef} data-count={count} data-scroll="false">
      {view.you.hand.map((tile) => {
        const plays = view.legalPlays.filter((play) => play.tileId === tile.id);
        const playable = mine && plays.length > 0;
        const best = plays.reduce((high, play) => Math.max(high, play.points), 0);
        const selected = selectedTile === tile.id;
        const lifted = liftedId === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            role="listitem"
            className={`hand-tile${playable ? " playable" : ""}${selected ? " selected" : ""}${lifted ? " lifted" : ""}`}
            data-tile-id={tile.id}
            data-playable={playable ? "true" : "false"}
            aria-label={`${tile.high} ${tile.low}${playable ? ", playable" : ""}`}
            aria-grabbed={lifted}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!playable || event.button !== 0) return;
              cancelMotion();
              dragged.current = false;
              session.current = {
                pointerId: event.pointerId,
                tileId: tile.id,
                high: tile.high,
                low: tile.low,
                originX: event.clientX,
                originY: event.clientY,
                active: false,
              };
            }}
            onPointerMove={(event) => moveDrag(event)}
            onPointerUp={(event) => finishDrag(event)}
            onPointerCancel={(event) => finishDrag(event, true)}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              if (!playable) return;
              if (plays.length === 1 && plays[0]) {
                onPlay(tile.id, plays[0].endId);
                onSelect(null);
                return;
              }
              onSelect(selected ? null : tile.id);
            }}
          >
            {showScores && playable && best > 0 ? <em className="play-points">+{best}</em> : null}
            <Domino a={tile.high} b={tile.low} orientation="vertical" />
          </button>
        );
      })}
      {ghost
        ? createPortal(
            <div
              className={`drag-ghost${ghost.spring ? " spring" : ""}`}
              style={{ left: ghost.left, top: ghost.top, width: GHOST_WIDTH, height: GHOST_HEIGHT }}
            >
              <Domino a={ghost.high} b={ghost.low} orientation="vertical" />
            </div>,
            document.body,
          )
        : null}
    </div>
    </div>
  );

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.originX;
    const dy = event.clientY - current.originY;
    if (!current.active) {
      if (Math.hypot(dx, dy) < 12) return;
      // A sideways slide still scrolls the hand. A lift starts the drag.
      if (Math.abs(dx) > Math.abs(dy)) {
        dragged.current = true;
        return;
      }
      current.active = true;
      dragged.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone on a very fast lift.
      }
      setLiftedId(current.tileId);
      onSelectRef.current(null);
    }
    event.preventDefault();
    const parked = ghostTopLeft(event.clientX, event.clientY);
    setGhost({
      tileId: current.tileId,
      high: current.high,
      low: current.low,
      left: parked.left,
      top: parked.top,
      spring: false,
    });
    const aim = ghostAimPoint(event.clientX, event.clientY);
    onDragRef.current(current.tileId, chooseDropEnd(aim.x, aim.y, targetsFor(current.tileId, viewRef.current)));
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>, cancel = false) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    session.current = null;
    if (!current.active) return;
    const aim = ghostAimPoint(event.clientX, event.clientY);
    const targets = targetsFor(current.tileId, viewRef.current);
    const endId = cancel ? null : chooseDropEnd(aim.x, aim.y, targets);
    const parked = ghostTopLeft(event.clientX, event.clientY);
    onDragRef.current(null, null);
    const stamp = motion.current;
    if (endId) {
      const target = targets.find((box) => box.id === endId);
      if (target && !prefersReducedMotion()) {
        glide(current, parked, {
          left: target.left + target.width / 2 - GHOST_WIDTH / 2,
          top: target.top + target.height / 2 - GHOST_HEIGHT / 2,
        }, stamp, () => {
          setLiftedId(null);
          onPlayRef.current(current.tileId, endId);
          onSelectRef.current(null);
          setGhost(null);
        });
        return;
      }
      setLiftedId(null);
      onPlayRef.current(current.tileId, endId);
      onSelectRef.current(null);
      setGhost(null);
      return;
    }
    const home = document.querySelector<HTMLElement>(`[data-tile-id="${current.tileId}"]`);
    const rect = home?.getBoundingClientRect();
    if (!rect || prefersReducedMotion()) {
      setLiftedId(null);
      setGhost(null);
      return;
    }
    glide(current, parked, { left: rect.left, top: rect.top }, stamp, () => {
      setLiftedId(null);
      setGhost(null);
    });
  }

  function glide(
    current: Session,
    from: { left: number; top: number },
    to: { left: number; top: number },
    stamp: number,
    done: () => void,
  ) {
    const parked = {
      tileId: current.tileId,
      high: current.high,
      low: current.low,
    };
    setGhost({ ...parked, left: from.left, top: from.top, spring: true });
    frame.current = window.requestAnimationFrame(() => {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        if (motion.current !== stamp) return;
        setGhost({ ...parked, left: to.left, top: to.top, spring: true });
        later(done, 240);
      });
    });
  }

  function later(run: () => void, ms: number) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const stamp = motion.current;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (motion.current !== stamp) return;
      run();
    }, ms);
  }

  function cancelMotion() {
    motion.current += 1;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }
}

function targetsFor(tileId: string, view: PlayerView): DropBox[] {
  const ids = new Set(view.legalPlays.filter((play) => play.tileId === tileId).map((play) => play.endId));
  const targets: DropBox[] = [];
  if (ids.has("lead")) {
    const felt = document.querySelector(".table-scroll");
    if (felt) targets.push(toBox("lead", felt.getBoundingClientRect()));
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-end-id]")) {
    const id = element.dataset.endId;
    if (!id || !ids.has(id)) continue;
    targets.push(toBox(id, element.getBoundingClientRect()));
  }
  return targets;
}

function toBox(id: string, rect: DOMRect): DropBox {
  return { id, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
