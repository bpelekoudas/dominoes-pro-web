import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { prefersReducedMotion } from "../moment";
import { useWinScore } from "../win-fx";
import { scorePopWindow } from "./score-time.js";
import { chipScore, scoreChaseFrames, scoreChaseKey } from "./score-delta.js";

export interface ScoreChase {
  id: string;
  key: string;
  shown: number;
  pulse: boolean;
}

export interface ScoreChaseState {
  liveKey: string;
  chase: ScoreChase | null;
}

export const ScoreChaseContext = createContext<ScoreChaseState | null>(null);

/**
 * Holds a seat's score at the pre-play number, then counts by fives once
 * the +N reaches the chip. The count belongs to that play only. A later
 * tile, or the hand break, drops it before paint, including the from+20
 * step on the way to a 25.
 */
export function useScoreChase(view: PlayerView): ScoreChaseState {
  const seen = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [chase, setChase] = useState<ScoreChase | null>(null);
  const key = scoreChaseKey({
    gameNumber: view.gameNumber,
    handNumber: view.handNumber,
    seq: view.lastPlay?.seq ?? -1,
    awarded: view.lastPlay?.awarded ?? 0,
    betweenHands: view.betweenHands,
    phase: view.phase,
  });
  if (chase && chase.key !== key) setChase(null);

  useLayoutEffect(() => {
    const timers: number[] = [];
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (!key || key === seen.current) return;
    const previous = seen.current;
    seen.current = key;
    const current = viewRef.current;
    const play = current.lastPlay;
    const seat = play ? current.players.find((player) => player.id === play.playerId) : undefined;
    if (!play || !seat) return;
    const awarded = play.awarded;
    const to = seat.score;
    const from = to - awarded;
    const frames = scoreChaseFrames(from, to, awarded);
    if (frames.length === 0) return;
    if (prefersReducedMotion()) {
      setChase({ id: play.playerId, key, shown: to, pulse: false });
      return () => {
        if (seen.current === key) seen.current = previous;
      };
    }
    const land = scorePopWindow(awarded).land;
    const steps = frames.length - 1;
    setChase({ id: play.playerId, key, shown: frames[0] ?? from, pulse: false });
    timers.push(
      window.setTimeout(() => {
        for (let step = 1; step <= steps; step += 1) {
          const frame = frames[step] ?? to;
          timers.push(
            window.setTimeout(() => {
              setChase((prev) =>
                prev && prev.key === key ? { id: play.playerId, key, shown: frame, pulse: true } : prev,
              );
            }, (step - 1) * 55),
          );
        }
        timers.push(
          window.setTimeout(() => {
            setChase((prev) => (prev && prev.key === key ? { ...prev, shown: to, pulse: false } : prev));
          }, steps * 55 + 260),
        );
      }, land),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      if (seen.current === key) seen.current = previous;
    };
  }, [key]);

  return { liveKey: key, chase: chase && chase.key === key ? chase : null };
}

/** Celebration counts win. Otherwise a live scoring play counts into the chip. */
export function useShownScore(playerId: string, score: number): { score: number; pulse: boolean; hot: boolean } {
  const live = useWinScore(playerId, score);
  const state = useContext(ScoreChaseContext);
  const celebrating = live.hot || live.pulse || live.score !== score;
  const chase = state?.chase && state.chase.id === playerId ? state.chase : null;
  return chipScore({
    score,
    chaseKey: state?.liveKey ?? "",
    chase,
    celebration: celebrating ? live : null,
  });
}
