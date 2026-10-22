import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { detectContext, type ContextEvent, type FeelSnap } from "./context.js";
import { direct } from "./director.js";
import { pulse } from "./haptics.js";
import { scoreTier, type FeelTier } from "./ladder.js";
import { playFeel } from "./synth.js";

export interface LiveFeel {
  tier: FeelTier;
  cues: ContextEvent[];
  cry: boolean;
  knock: { playerId: string; streak: number; key: string } | null;
  scoring: boolean;
}

function boardCount(board: PlayerView["board"]): number {
  if (!board?.center) return 0;
  return 1 + Object.values(board.arms).reduce((sum, arm) => sum + arm.length, 0);
}

function snapOf(view: PlayerView, reason: FeelSnap["reason"], actorId: string | null, awarded: number, tileId: string | null): FeelSnap {
  return {
    seats: view.players.map((player) => ({ id: player.id, score: player.score })),
    target: view.settings.targetScore,
    awarded,
    tileId,
    boardTiles: boardCount(view.board),
    knockStreak: view.knockStreak,
    reason,
    actorId,
    winnerIds: view.lastHand?.winnerIds ?? [],
    pipCounts: view.lastHand?.pipCounts ?? null,
  };
}

/** Watches the live table and plays the reaction. It does not delay the turn. */
export function useLiveFeel(view: PlayerView): LiveFeel {
  const prev = useRef<FeelSnap | null>(null);
  const seen = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [knock, setKnock] = useState<LiveFeel["knock"]>(null);
  const [scoring, setScoring] = useState(false);
  const [tier, setTier] = useState<FeelTier>("play");
  const [cues, setCues] = useState<ContextEvent[]>([]);
  const [cry, setCry] = useState(false);

  const playKey = view.lastPlay ? `play:${view.lastPlay.seq}` : "";
  const knockKey = view.lastEvent?.kind === "knock" ? `knock:${view.knockStreak}:${view.lastEvent.playerId}` : "";
  const key = knockKey || playKey;

  useEffect(() => {
    const view = viewRef.current;
    const play = view.lastPlay;
    const event = view.lastEvent;
    const knocking = event?.kind === "knock";
    const awarded = play?.awarded ?? 0;
    const actorId = knocking ? event.playerId : play?.playerId ?? null;
    const reason: FeelSnap["reason"] = knocking ? "knock" : play ? "play" : null;
    const next = snapOf(view, reason, actorId, knocking ? 0 : awarded, knocking ? null : play?.tileId ?? null);
    const contexts = detectContext(prev.current, next);
    prev.current = next;
    const feelTier: FeelTier = knocking ? "knock" : scoreTier(awarded);
    const reaction = direct({
      tier: feelTier,
      knockStreak: view.knockStreak,
      local: actorId === view.yourId,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      contexts,
      comeback: contexts.includes("comeback"),
    });
    setTier(feelTier);
    setCues(reaction.cues);
    setCry(reaction.cry);
    document.documentElement.dataset.feelTier = feelTier;
    document.documentElement.dataset.feelCues = reaction.cues.join(" ");
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (!key || key === seen.current) return;
    seen.current = key;
    if (knocking && event) {
      setKnock({ playerId: event.playerId, streak: view.knockStreak, key });
      playFeel(reaction.spec.sound, reaction.spec.silenceMs);
      pulse(reaction.haptic);
      const seat = document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(event.playerId)}"]`);
      seat?.setAttribute("data-feel", view.knockStreak >= 3 ? "knock-tight" : "knock");
      window.setTimeout(() => seat?.removeAttribute("data-feel"), 420);
      return;
    }
    if (awarded >= 10) {
      setScoring(true);
      window.setTimeout(() => setScoring(false), 520);
      if (feelTier !== "score-rare") playFeel(reaction.spec.sound, reaction.spec.silenceMs);
      pulse(reaction.haptic);
      const seat = document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(play?.playerId ?? "")}"]`);
      seat?.setAttribute("data-feel", "score");
      window.setTimeout(() => seat?.removeAttribute("data-feel"), 360);
    }
  }, [key]);

  return { tier, cues, cry, knock, scoring };
}

export function FeelRipple({ knock }: { knock: LiveFeel["knock"] }) {
  const [box, setBox] = useState<{ left: number; top: number; streak: number } | null>(null);
  useEffect(() => {
    if (!knock) return;
    const seat = document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(knock.playerId)}"]`);
    const rect = seat?.getBoundingClientRect();
    if (!rect) return;
    setBox({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2, streak: knock.streak });
    const timer = window.setTimeout(() => setBox(null), 420);
    return () => window.clearTimeout(timer);
  }, [knock]);
  if (!box) return null;
  return <i className="feel-ripple" data-streak={box.streak} style={{ left: box.left, top: box.top }} aria-hidden="true" />;
}
