import { useEffect, useState } from "react";
import { Domino } from "../table";
import { playFeel } from "./synth.js";
import { unlockSound } from "../sound.js";

export const REEL: ReadonlyArray<{ at: number; scene: string; label: string; sound?: "place" | "score" | "score-strong" | "score-rare" | "knock" | "lock" | "domino" | "hand" | "game" }> = [
  { at: 0, scene: "play", label: "", sound: "place" },
  { at: 1500, scene: "score", label: "+10", sound: "score" },
  { at: 3200, scene: "big", label: "+25", sound: "score-rare" },
  { at: 5200, scene: "knock1", label: "", sound: "knock" },
  { at: 6100, scene: "knock2", label: "", sound: "knock" },
  { at: 7000, scene: "knock3", label: "", sound: "knock" },
  { at: 7900, scene: "silence", label: "" },
  { at: 8300, scene: "lock", label: "UH OH.", sound: "lock" },
  { at: 9400, scene: "showdown", label: "18 + 11 + 7" },
  { at: 10600, scene: "low", label: "7 LOW HAND" },
  { at: 11800, scene: "pay", label: "35" },
  { at: 12800, scene: "domino", label: "DOMINO!", sound: "domino" },
  { at: 13800, scene: "hand", label: "HAND WON", sound: "hand" },
  { at: 15000, scene: "tally", label: "12 + 9 + 6" },
  { at: 16000, scene: "total", label: "25" },
  { at: 17000, scene: "game", label: "YOU WIN", sound: "game" },
];

export const REEL_END_MS = 18800;

export function feelPreviewRequested(): string | null {
  const feel = new URLSearchParams(location.search).get("feel");
  return feel && feel.length > 0 ? feel : null;
}

function sceneAt(elapsed: number): (typeof REEL)[number] {
  let current = REEL[0]!;
  for (const beat of REEL) {
    if (elapsed >= beat.at) current = beat;
  }
  return current;
}

export function FeelPreview() {
  const [elapsed, setElapsed] = useState(0);
  const beat = sceneAt(elapsed);
  const [heard, setHeard] = useState("");

  useEffect(() => {
    unlockSound();
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(REEL_END_MS, now - started);
      setElapsed(next);
      if (next < REEL_END_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!beat.sound || heard === beat.scene) return;
    setHeard(beat.scene);
    const silence = beat.scene === "lock" || beat.scene === "domino" || beat.scene === "game" ? 150 : 0;
    playFeel(beat.sound, silence);
  }, [beat, heard]);

  const wide = typeof window !== "undefined" && window.innerWidth >= 720;
  return (
    <main className={`feel-reel${wide ? " wide" : ""}`} data-screen="feel-reel" data-feel-scene={beat.scene} data-feel-label={beat.label}>
      <div className="feel-reel-table" data-dim={beat.scene === "silence" || beat.scene === "lock" || beat.scene === "game" ? "true" : "false"}>
        <div className="feel-reel-chain" data-nudge={beat.scene === "domino" ? "true" : "false"}>
          <Domino a={6} b={6} orientation="vertical" spinner />
          <Domino a={6} b={3} orientation="horizontal" />
          <Domino a={3} b={1} orientation="vertical" />
          {beat.scene !== "play" ? null : <span className="feel-landing"><Domino a={1} b={4} orientation="horizontal" /></span>}
        </div>
        <div className="feel-seats">
          <span data-feel={beat.scene.startsWith("knock") ? "knock" : beat.scene === "hand" || beat.scene === "game" || beat.scene === "domino" ? "win" : ""}>Alex</span>
          <span data-feel={beat.scene === "knock1" ? "knock" : ""}>Rio</span>
          <span data-feel={beat.scene === "knock2" ? "knock" : ""}>Sam</span>
          <span data-feel={beat.scene === "knock3" || beat.scene === "silence" ? "knock" : ""}>Jordan</span>
        </div>
        {beat.scene === "score" || beat.scene === "big" ? <p className={`feel-pop tier-${beat.scene}`}>{beat.label}</p> : null}
        {beat.scene.startsWith("knock") ? <i className="feel-ripple live" data-streak={beat.scene === "knock3" ? 3 : beat.scene === "knock2" ? 2 : 1} /> : null}
        {beat.label && beat.scene !== "score" && beat.scene !== "big" ? (
          <p className={`feel-call-word scene-${beat.scene}`} role="status">{beat.label}</p>
        ) : null}
      </div>
    </main>
  );
}
