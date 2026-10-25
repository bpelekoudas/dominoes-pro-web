import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { AvatarFace } from "./avatars";
import { winPoseSrc } from "./lineup";
import { prefersReducedMotion } from "./moment";
import { characterWinLine, matchLineSeed } from "./win-lines";
import {
  REDUCED_POP_MS,
  placeWinnerPop,
  popTiming,
  winnerPopFrame,
  winnerPopPoint,
  type Box,
  type PopKind,
  type PopPlace,
  type SeatEdge,
} from "./winner-pop.js";

interface Probe {
  kind: PopKind;
  playerId: string;
  token: number;
}

/**
 * Hand and game wins only. A match win keeps the lineup and does not mount this.
 * The pop is pointer-events none and ends inside the tally the table already shows.
 */
export function WinnerPopLayer({
  view,
  stage,
  reduced,
  frozenAt,
}: {
  view: PlayerView;
  stage: string;
  reduced: boolean;
  frozenAt: number | null;
}) {
  const [probe, setProbe] = useState<Probe | null>(null);
  useEffect(() => {
    const onProbe = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; playerId?: string }>).detail ?? {};
      const playerId = typeof detail.playerId === "string" ? detail.playerId : view.yourId;
      setProbe({ kind: detail.kind === "game" ? "game" : "hand", playerId, token: performance.now() });
    };
    window.addEventListener("uhoh-winner-pop", onProbe);
    return () => window.removeEventListener("uhoh-winner-pop", onProbe);
  }, [view.yourId]);

  const hand = view.lastHand;
  const matchWin = Boolean(hand?.seriesWinnerId);
  const live = stage === "pips" && Boolean(hand) && !matchWin;
  const kind: PopKind | null = live ? (hand?.gameWinnerId ? "game" : "hand") : probe ? probe.kind : null;
  const ids = live && hand ? hand.winnerIds : probe ? [probe.playerId] : [];
  if (!kind || ids.length === 0 || view.status !== "playing") return null;
  return (
    <PopRun
      key={live ? `live-${hand?.gameNumber}-${hand?.handNumber}` : `probe-${probe?.token}`}
      view={view}
      ids={ids}
      kind={kind}
      reduced={reduced || prefersReducedMotion()}
      frozenAt={live ? frozenAt : null}
      onDone={() => setProbe(null)}
    />
  );
}

function PopRun({
  view,
  ids,
  kind,
  reduced,
  frozenAt,
  onDone,
}: {
  view: PlayerView;
  ids: readonly string[];
  kind: PopKind;
  reduced: boolean;
  frozenAt: number | null;
  onDone: () => void;
}) {
  const [plans, setPlans] = useState<Record<string, PopPlace>>({});
  const [finished, setFinished] = useState(false);
  const nodes = useRef(new Map<string, HTMLElement>());
  const viewRef = useRef(view);
  viewRef.current = view;
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useLayoutEffect(() => {
    const current = viewRef.current;
    const obstacles = collectObstacles();
    const next: Record<string, PopPlace> = {};
    const claimed: Box[] = [];
    for (const id of ids) {
      const found = findSeat(id);
      if (!found) continue;
      const player = current.players.find((seat) => seat.id === id);
      const line = characterWinLine(
        player?.avatarId,
        matchLineSeed(current.roomCode, current.lastHand?.gameNumber ?? current.gameNumber, current.lastHand?.handNumber ?? current.handNumber, id),
      );
      const placed = placeWinnerPop({
        kind,
        withLine: Boolean(line),
        edge: found.edge,
        avatar: found.avatar,
        score: found.score,
        obstacles: obstacles.concat(claimed),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      if (!placed) continue;
      next[id] = placed;
      claimed.push(placed.box);
    }
    if (Object.keys(next).length === 0) {
      onDoneRef.current();
      return;
    }
    setPlans(next);
  }, [ids.join("|"), kind]);

  useLayoutEffect(() => {
    paint(frozenAt ?? 0, kind, reduced, plans, nodes.current);
  }, [plans, frozenAt, kind, reduced]);

  useEffect(() => {
    if (finished || frozenAt != null || Object.keys(plans).length === 0) return;
    const total = reduced ? REDUCED_POP_MS : popTiming(kind).total;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= total) {
        setFinished(true);
        onDoneRef.current();
        return;
      }
      paint(elapsed, kind, reduced, plansRef.current, nodes.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [plans, kind, reduced, finished, frozenAt]);

  if (finished || Object.keys(plans).length === 0) return null;
  return (
    <>
      {Object.entries(plans).map(([id, plan]) => {
        const player = view.players.find((seat) => seat.id === id);
        if (!player) return null;
        const pose = winPoseSrc(player.avatarId);
        const line = plan.withLine
          ? characterWinLine(
              player.avatarId,
              matchLineSeed(view.roomCode, view.lastHand?.gameNumber ?? view.gameNumber, view.lastHand?.handNumber ?? view.handNumber, id),
            )
          : null;
        return (
          <span
            key={id}
            ref={(node) => {
              if (node) nodes.current.set(id, node);
              else nodes.current.delete(id);
            }}
            className="winner-pop"
            data-winner-pop={kind}
            data-player-id={id}
            data-reduced={reduced ? "true" : "false"}
            aria-hidden="true"
          >
            <AvatarFace
              id={player.avatarId}
              bot={player.bot && !player.accountBot}
              frameId={player.frameId}
              pose={pose}
            />
            {line ? (
              <em className="winner-pop-line" data-win-line={line}>
                {line}
              </em>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

function paint(
  elapsed: number,
  kind: PopKind,
  reduced: boolean,
  plans: Record<string, PopPlace>,
  nodes: Map<string, HTMLElement>,
): void {
  const frame = winnerPopFrame(kind, elapsed, reduced);
  for (const [id, plan] of Object.entries(plans)) {
    const node = nodes.get(id);
    if (!node) continue;
    const point = reduced ? plan.rest : winnerPopPoint(frame.along, plan.seat, plan.rest, plan.score);
    node.style.left = `${point.x}px`;
    node.style.top = `${point.y}px`;
    node.style.width = `${plan.box.width}px`;
    node.style.height = `${plan.box.height}px`;
    node.style.opacity = String(frame.opacity);
    node.style.transform = `translate(-50%, -50%) scale(${frame.scale})`;
  }
}

function findSeat(id: string): { edge: SeatEdge; avatar: Box; score: Box } | null {
  const safe = window.CSS?.escape ? window.CSS.escape(id) : id.replace(/["\\]/g, "");
  const avatar = document.querySelector(`.seat-chip[data-player-id="${safe}"] .avatar`);
  const score = document.querySelector(`[data-win-score="${safe}"]`);
  if (!avatar || !score) return null;
  const rail = avatar.closest("[data-edge]");
  const edge = rail?.getAttribute("data-edge");
  return {
    edge: edge === "left" || edge === "right" || edge === "top" ? edge : "bottom",
    avatar: toBox(avatar),
    score: toBox(score),
  };
}

function collectObstacles(): Box[] {
  const nodes = document.querySelectorAll(
    "[data-board-tile], .hand-tile, .edge-badge, .seat-chip, .edge-slivers, .hand-tray, .playbar, .win-reveal, .bone-pile, .feel-call span, .feel-tally",
  );
  const boxes: Box[] = [];
  for (const node of nodes) {
    if (node.closest(".winner-pop")) continue;
    const box = toBox(node);
    if (box.width > 2 && box.height > 2) boxes.push(box);
  }
  return boxes;
}

function toBox(node: Element): Box {
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}
