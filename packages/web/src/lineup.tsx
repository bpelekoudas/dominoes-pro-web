import { useEffect, useState } from "react";
import { Portrait } from "./avatars";
import { gameTallyText } from "./game-tally.js";

/** Bump when a pose file's bytes change. */
export const POSE_ART = "2";

/**
 * Characters with a cut-out win pose and a lose pose.
 * The house portrait and anyone added later keep their ordinary portrait.
 */
const POSE_IDS = new Set([
  "abuela",
  "barista",
  "biker",
  "bingograndma",
  "cowgirl",
  "fisherman",
  "floridaman",
  "fratbro",
  "gaperilla",
  "golfer",
  "grungerocker",
  "gymbro",
  "hipster",
  "lumberjack",
  "mallcop",
  "mexicancowboy",
  "nascar",
  "pitmaster",
  "rapper",
  "retiredman",
  "scarface",
  "surfer",
  "tailgatedad",
  "techmogul",
  "trucker",
  "2hot4tv",
]);

export interface LineupPlayer {
  id: string;
  name: string;
  avatarId: string;
}

function poseUrl(avatarId: string, role: "winner" | "loser"): string | null {
  const pose = lineupPoseFor(avatarId, role);
  if (!pose) return null;
  return `/poses/${avatarId}-${pose}.webp?v=${POSE_ART}`;
}

/** Cut-out win pose. Null keeps the portrait. */
export function winPoseSrc(avatarId: string | null | undefined): string | null {
  if (!avatarId) return null;
  return poseUrl(avatarId, "winner");
}

/** Win/lose file for a character, or null when the portrait should stand in. */
export function lineupPoseFor(avatarId: string | null | undefined, role: "winner" | "loser"): "win" | "lose" | null {
  if (!avatarId || !POSE_IDS.has(avatarId)) return null;
  return role === "winner" ? "win" : "lose";
}

function LineupFigure({
  player,
  role,
  side,
}: {
  player: LineupPlayer;
  role: "winner" | "loser";
  side: "left" | "center" | "right";
}) {
  const src = poseUrl(player.avatarId, role);
  const [failed, setFailed] = useState(false);
  const pose = src && !failed ? (role === "winner" ? "win" : "lose") : "fallback";
  return (
    <figure className="lineup-figure" data-role={role} data-side={side} data-pose={pose} data-player-id={player.id}>
      <div className="lineup-art">
        {src && !failed ? (
          <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
        ) : (
          <Portrait id={player.avatarId} size="hero" />
        )}
      </div>
      <figcaption>{player.name}</figcaption>
    </figure>
  );
}

export function MatchLineup({
  players,
  winnerId,
  line,
  motion,
  instant,
  onContinue,
  games,
  winsNeeded,
}: {
  players: readonly LineupPlayer[];
  winnerId: string;
  line: string;
  motion: "on" | "off";
  instant: boolean;
  onContinue: () => void;
  games?: readonly number[];
  winsNeeded?: number;
}) {
  const winner = players.find((player) => player.id === winnerId) ?? players[0];
  const losers = players.filter((player) => player.id !== winner?.id);
  const left = losers.slice(0, Math.floor(losers.length / 2));
  const right = losers.slice(left.length);
  const [count, setCount] = useState(instant ? line.length : 0);

  useEffect(() => {
    if (instant) {
      setCount(line.length);
      return;
    }
    setCount(0);
    let current = 0;
    const timer = window.setInterval(() => {
      current += 1;
      setCount(current);
      if (current >= line.length) window.clearInterval(timer);
    }, 32);
    return () => window.clearInterval(timer);
  }, [line, instant]);

  if (!winner) return null;
  const shown = line.slice(0, count);
  const done = count >= line.length;

  return (
    <button
      type="button"
      className="lineup"
      data-action="lineup-continue"
      data-motion={motion}
      data-typed={done ? "done" : "typing"}
      data-win-line={line}
      aria-label="Continue"
      onClick={onContinue}
    >
      <div className="lineup-stage">
        <div className="lineup-winner">
          <p className="lineup-bubble" role="status" aria-label={line}>
            <span aria-hidden="true">{shown}</span>
            {done || motion === "off" ? null : <i className="lineup-caret" aria-hidden="true" />}
          </p>
          <LineupFigure player={winner} role="winner" side="center" />
        </div>
        <div className="lineup-sides">
          <div className="lineup-side left">
            {left.map((player) => (
              <LineupFigure key={player.id} player={player} role="loser" side="left" />
            ))}
          </div>
          <div className="lineup-side right">
            {right.map((player) => (
              <LineupFigure key={player.id} player={player} role="loser" side="right" />
            ))}
          </div>
        </div>
      </div>
      <p className="lineup-hint">Tap to continue</p>
      {winsNeeded && games && games.length > 0 ? (
        <p className="lineup-tally" data-games-tally={gameTallyText(games)} data-series-target={winsNeeded}>
          Games {gameTallyText(games)} · first to {winsNeeded}
        </p>
      ) : null}
    </button>
  );
}
