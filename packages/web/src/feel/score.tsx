import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { prefersReducedMotion } from "../moment";
import { useWinScore } from "../win-fx";
import { scorePopWindow } from "./score-time.js";

export interface ScoreChase {
  id: string;
  shown: number;
  pulse: boolean;
}

export const ScoreChaseContext = createContext<ScoreChase | null>(null);

/**
 * Holds a seat's score at the pre-play number, then counts by fives once
 * the +N reaches the chip. Hand-end pips own the readout after that.
 */
export function useScoreChase(view: PlayerView): ScoreChase | null {
  const seen = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [chase, setChase] = useState<ScoreChase | null>(null);
  const seq = view.lastPlay?.seq ?? -1;
  const awarded = view.lastPlay?.awarded ?? 0;
  const playerId = view.lastPlay?.playerId ?? "";

  useLayoutEffect(() => {
    const timers: number[] = [];
    const key = awarded >= 10 ? String(seq) : "";
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (key === seen.current) return;
    seen.current = key;
    if (!key) {
      setChase(null);
      return;
    }
    const current = viewRef.current;
    if (current.betweenHands || current.phase === "between" || current.phase === "over") return;
    const player = current.players.find((seat) => seat.id === playerId);
    if (!player) return;
    const to = player.score;
    const from = to - awarded;
    if (from >= to) return;
    if (prefersReducedMotion()) {
      setChase({ id: playerId, shown: to, pulse: false });
      return;
    }
    const land = scorePopWindow(awarded).land;
    const steps = Math.max(1, Math.round(awarded / 5));
    setChase({ id: playerId, shown: from, pulse: false });
    timers.push(
      window.setTimeout(() => {
        for (let step = 1; step <= steps; step += 1) {
          timers.push(
            window.setTimeout(() => {
              setChase({
                id: playerId,
                shown: step === steps ? to : from + step * 5,
                pulse: true,
              });
            }, (step - 1) * 55),
          );
        }
        timers.push(
          window.setTimeout(() => {
            setChase((prev) => (prev && prev.id === playerId ? { ...prev, shown: to, pulse: false } : prev));
          }, steps * 55 + 260),
        );
      }, land),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [seq, awarded, playerId]);

  return chase;
}

/** Celebration counts win. Otherwise a live scoring play counts into the chip. */
export function useShownScore(playerId: string, score: number): { score: number; pulse: boolean; hot: boolean } {
  const live = useWinScore(playerId, score);
  const chase = useContext(ScoreChaseContext);
  const celebrating = live.hot || live.pulse || live.score !== score;
  if (celebrating) return live;
  if (chase && chase.id === playerId) return { score: chase.shown, pulse: chase.pulse, hot: false };
  return live;
}
