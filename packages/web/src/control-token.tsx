import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlayerView } from "@uhoh/rules";
import { motionMs } from "../../rules/src/motion.js";
import {
  controlRoute,
  controlSlideMs,
  dominoTokenAction,
  parkOnBadge,
  pointAlong,
  type Box,
  type Point,
} from "./control-path.js";

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function ease(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function obstacles(): Box[] {
  const boxes: Box[] = [];
  document.querySelectorAll("[data-board-tile], .sliver, .hand-tile, .talk-line").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    boxes.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  });
  return boxes;
}

function chipFor(playerId: string): HTMLElement | null {
  // Only the live table. A win pose or a demo chip must not pull the token onto another seat.
  return document.querySelector<HTMLElement>(`.felt-app .seat-chip[data-player-id="${CSS.escape(playerId)}"]`);
}

/**
 * One red domino for whoever last went out. It stays hidden until then,
 * flies when someone else dominoes, and bumps when the same player does it again.
 * A lock does not move it. A blocked slide jumps.
 */
export function ControlToken({ playerId, stamp }: { playerId: string | null; stamp: string }) {
  const [pos, setPos] = useState<Point | null>(null);
  const [bump, setBump] = useState(0);
  const posRef = useRef<Point | null>(null);
  const heldRef = useRef<{ playerId: string; key: string } | null>(null);
  const bumpedRef = useRef<string | null>(null);
  posRef.current = pos;

  useLayoutEffect(() => {
    const nextHold = playerId ? { playerId, key: stamp } : null;
    const previous = heldRef.current;
    const action = dominoTokenAction(previous, nextHold);
    let commit = true;
    queueMicrotask(() => {
      if (commit) heldRef.current = nextHold;
    });
    if (!playerId || action === "hide") {
      posRef.current = null;
      setPos(null);
      return () => {
        commit = false;
      };
    }
    let frame = 0;
    let cancelled = false;
    let flying = false;
    const place = (animate: boolean) => {
      const chip = chipFor(playerId);
      if (!chip || flying) return;
      const rect = chip.getBoundingClientRect();
      if (rect.width < 2) return;
      const next = parkOnBadge({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      const from = posRef.current;
      const far = from ? Math.hypot(next.x - from.x, next.y - from.y) : Infinity;
      const sameSeat = from != null && far < 24;
      if (animate && action === "bump" && sameSeat && !reducedMotion()) {
        posRef.current = next;
        setPos(next);
        if (bumpedRef.current !== stamp) {
          bumpedRef.current = stamp;
          setBump((value) => value + 1);
        }
        return;
      }
      if (!from || !animate || reducedMotion() || far < 4 || action !== "fly") {
        posRef.current = next;
        setPos(next);
        return;
      }
      const route = controlRoute(from, next, obstacles(), { width: window.innerWidth, height: window.innerHeight });
      if (route.length < 2) {
        posRef.current = next;
        setPos(next);
        return;
      }
      const distance = route.slice(1).reduce((sum, point, index) => {
        const prev = route[index]!;
        return sum + Math.hypot(point.x - prev.x, point.y - prev.y);
      }, 0);
      const duration = controlSlideMs(distance);
      const started = performance.now();
      flying = true;
      const tick = (now: number) => {
        if (cancelled) return;
        const u = ease(Math.min(1, (now - started) / duration));
        const at = pointAlong(route, u);
        posRef.current = at;
        setPos(at);
        if (u < 1) frame = window.requestAnimationFrame(tick);
        else flying = false;
      };
      frame = window.requestAnimationFrame(tick);
    };
    place(action === "fly" || action === "bump");
    const chip = chipFor(playerId);
    const follow = () => place(false);
    const observer = new ResizeObserver(follow);
    if (chip) observer.observe(chip);
    window.addEventListener("resize", follow);
    return () => {
      commit = false;
      cancelled = true;
      flying = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [playerId, stamp]);

  if (!pos || !playerId) return null;
  return createPortal(
    <svg
      key={bump}
      className={bump > 0 ? "control-token is-bump" : "control-token"}
      data-control="token"
      data-token="last-domino"
      data-holder={playerId}
      data-bump={bump > 0 ? "true" : "false"}
      viewBox="0 0 16 24"
      aria-hidden="true"
      style={{ left: pos.x, top: pos.y }}
    >
      <rect x="0.9" y="0.9" width="14.2" height="22.2" rx="2" />
      <line x1="1.4" y1="12" x2="14.6" y2="12" />
      <circle cx="8" cy="6.2" r="1.35" />
      <circle cx="5.3" cy="17.6" r="1.15" />
      <circle cx="10.7" cy="17.6" r="1.15" />
    </svg>,
    document.body,
  );
}

/**
 * A face-down tile leaves the boneyard and lands on the seat that drew.
 * Same travel time as a tile sliding into the chain.
 */
export function DrawFlight({
  draw,
  handKey,
}: {
  draw: PlayerView["lastDraw"];
  handKey: string;
}) {
  const key = draw ? `${handKey}:${draw.playerId}:${draw.count}:${draw.tileIds?.join(",") ?? ""}` : "";
  const [pos, setPos] = useState<Point | null>(null);
  const seen = useRef(key);

  useLayoutEffect(() => {
    if (!key || key === seen.current || reducedMotion()) {
      seen.current = key;
      return;
    }
    seen.current = key;
    const pile = document.querySelector<HTMLElement>(".bone-pile");
    const seat = draw ? chipFor(draw.playerId) : null;
    if (!pile || !seat || !draw) return;
    const fromRect = pile.getBoundingClientRect();
    const toRect = seat.getBoundingClientRect();
    const from = { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 };
    const to = parkOnBadge({ left: toRect.left, top: toRect.top, right: toRect.right, bottom: toRect.bottom });
    const route = controlRoute(from, to, obstacles(), { width: window.innerWidth, height: window.innerHeight });
    if (route.length < 2) return;
    let frame = 0;
    let cancelled = false;
    const duration = motionMs(420);
    const started = performance.now();
    const tick = (now: number) => {
      if (cancelled) return;
      const u = ease(Math.min(1, (now - started) / duration));
      setPos(pointAlong(route, u));
      if (u < 1) frame = window.requestAnimationFrame(tick);
      else setPos(null);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      setPos(null);
    };
  }, [key, draw]);

  if (!pos) return null;
  return createPortal(<i className="draw-flight" data-draw-flight="true" style={{ left: pos.x, top: pos.y }} aria-hidden="true" />, document.body);
}
