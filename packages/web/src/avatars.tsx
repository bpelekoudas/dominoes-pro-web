import { useState } from "react";
import { AVATARS, resolveAvatar } from "../../rules/src/avatars.js";
import { playUiClick } from "./sound";

/** Bump when portrait bytes change so phones drop a cached opaque WebP. */
export const AVATAR_ART = "1";

export function Portrait({
  id,
  size = "chip",
}: {
  id: string | null | undefined;
  size?: "chip" | "hero" | "grid";
}) {
  const avatar = resolveAvatar(id);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`portrait-fallback portrait-${size}`}>{avatar.slice(0, 1).toUpperCase()}</span>;
  }
  const file = size === "chip" ? `${avatar}-256.webp` : `${avatar}.webp`;
  const src = `/avatars/${file}?v=${AVATAR_ART}`;
  return (
    <img
      className={`portrait portrait-${size}`}
      src={src}
      alt=""
      draggable={false}
      data-avatar={avatar}
      onError={() => setFailed(true)}
    />
  );
}

/** Round portrait. `timer` is the fraction of the turn still left, from 1 down to 0. */
export function AvatarFace({
  id,
  bot = false,
  timer = null,
  frameId = null,
  pose = null,
}: {
  id: string | null | undefined;
  bot?: boolean;
  timer?: number | null;
  frameId?: string | null;
  /** Win-pose cutout. The frame paints behind it so a sign on the pose stays visible. */
  pose?: string | null;
}) {
  const ratio = timer == null ? null : Math.max(0, Math.min(1, timer));
  return (
    <span className={`avatar${bot ? " bot" : ""}${pose ? " posing" : ""}`} data-avatar={resolveAvatar(id)} aria-hidden="true">
      {ratio != null && !pose ? (
        <svg className="timer-ring" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="16" pathLength="100" />
          <circle
            cx="18"
            cy="18"
            r="16"
            pathLength="100"
            className="timer-arc"
            style={{ strokeDashoffset: `${100 - ratio * 100}` }}
          />
        </svg>
      ) : null}
      {pose ? <img className="avatar-pose" src={pose} alt="" draggable={false} data-pose="win" /> : <Portrait id={id} size="chip" />}
      {frameId ? <img className="avatar-frame" src={`/store/${frameId}.webp`} alt="" draggable={false} /> : null}
    </span>
  );
}

export function BotBadge() {
  return (
    <small className="bot-badge" data-bot-badge="true">
      BOT
    </small>
  );
}

export function AvatarPicker({
  selected,
  onPick,
  allowed,
}: {
  selected: string | null | undefined;
  onPick: (id: string) => void;
  allowed?: readonly string[];
}) {
  const current = resolveAvatar(selected);
  const list = allowed ? AVATARS.filter((avatar) => allowed.includes(avatar.id)) : AVATARS;
  return (
    <div className="avatar-grid" data-screen="picker">
      {list.map((avatar) => (
        <button
          type="button"
          key={avatar.id}
          className={avatar.id === current ? "picked" : ""}
          aria-pressed={avatar.id === current}
          data-avatar={avatar.id}
          onClick={() => {
            playUiClick();
            onPick(avatar.id);
          }}
        >
          <Portrait id={avatar.id} size="grid" />
          <span>{avatar.name}</span>
        </button>
      ))}
    </div>
  );
}
