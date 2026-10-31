import { useState } from "react";
import { DailyHome } from "./daily";
import { formatBones, ratingLabel } from "./home-model";
import { Logo } from "./logo";
import { winPoseSrc } from "./lineup";
import { Portrait } from "./avatars";
import { playUiClick, unlockSound } from "./sound";
import { readQuickFormat, seriesForFormat, writeQuickFormat, type QuickFormat } from "./quick-format";

export function QuickFormatToggle({
  format,
  onChange,
}: {
  format: QuickFormat;
  onChange: (format: QuickFormat) => void;
}) {
  return (
    <div className="ph-format" role="group" aria-label="Quick Play format">
      <button type="button" data-action="format-series" aria-pressed={format === "series"} onClick={press(() => onChange("series"))}>
        Series
      </button>
      <button type="button" data-action="format-single" aria-pressed={format === "single"} onClick={press(() => onChange("single"))}>
        Single game
      </button>
    </div>
  );
}

function press(action: () => void): () => void {
  return () => {
    unlockSound();
    playUiClick();
    action();
  };
}

function BoneIcon({ gold = false }: { gold?: boolean }) {
  return (
    <svg className={gold ? "ph-bone ph-bone-gold" : "ph-bone"} viewBox="0 0 24 24" aria-hidden="true">
      <g transform="rotate(-45 12 12)">
        <rect x="5.5" y="9.6" width="13" height="4.8" rx="1" />
        <circle cx="5" cy="9" r="2.5" />
        <circle cx="5" cy="15" r="2.5" />
        <circle cx="19" cy="9" r="2.5" />
        <circle cx="19" cy="15" r="2.5" />
      </g>
    </svg>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  );
}

export function PlayerHome({
  userId,
  displayName,
  avatarId,
  rating,
  bones,
  goldBones,
  connecting,
  onSettings,
  onStore,
  onCharacters,
  onRanks,
  onMulti,
  onVersus,
  onQuickPlay,
}: {
  userId: string;
  displayName: string;
  avatarId: string | null;
  rating: number | null;
  bones: number | null;
  goldBones: number | null;
  connecting: boolean;
  onSettings: () => void;
  onStore: () => void;
  onCharacters: () => void;
  onRanks: () => void;
  onMulti: () => void;
  onVersus: () => void;
  onQuickPlay: (series: 1 | 5) => void;
}) {
  const [format, setFormat] = useState<QuickFormat>(readQuickFormat);
  const [soon, setSoon] = useState<string | null>(null);
  const chooseFormat = (next: QuickFormat) => {
    setFormat(next);
    writeQuickFormat(next);
  };
  const pose = winPoseSrc(avatarId || "2hot4tv");
  const ratingText = ratingLabel(rating);
  const ping = (label: string) => {
    setSoon(label);
    window.setTimeout(() => setSoon((current) => (current === label ? null : current)), 1600);
  };

  return (
    <div className="ph" data-home="player">
      <div className="ph-bg" aria-hidden="true" />
      <div className="ph-felt" aria-hidden="true" />
      <header className="ph-top">
        <button type="button" className="ph-gear" aria-label="Settings" onClick={press(onSettings)}>
          <Gear />
        </button>
        <button type="button" className="ph-pill" aria-label={`${formatBones(bones)} Bones`} onClick={press(onStore)}>
          <BoneIcon />
          <span>{formatBones(bones)}</span>
          <span className="ph-plus" aria-hidden="true">+</span>
        </button>
        <div className="ph-avatar-wrap">
          <span className="ph-avatar" aria-label={displayName}>
            <Portrait id={avatarId || "2hot4tv"} size="chip" />
          </span>
          {ratingText ? <span className="ph-rating">{ratingText}</span> : null}
        </div>
        <button type="button" className="ph-pill" aria-label={`${formatBones(goldBones)} Gold Bones`} onClick={press(onStore)}>
          <BoneIcon gold />
          <span>{formatBones(goldBones)}</span>
          <span className="ph-plus" aria-hidden="true">+</span>
        </button>
      </header>

      <button type="button" className="ph-banner ph-soon" data-action="season-pass" onClick={press(() => ping("Coming soon"))}>
        <span className="ph-banner-kicker">Season</span>
        <span className="ph-banner-title">Uh-Oh Pass</span>
        <span className="ph-soon-tag">Coming soon</span>
      </button>

      <button type="button" className="ph-event ph-soon" data-action="tournament" onClick={press(() => ping("Coming soon"))}>
        <span className="ph-arrow" aria-hidden="true">‹</span>
        <span className="ph-event-copy">
          <span className="ph-event-title">Weekend <em>Tournament</em></span>
          <span className="ph-event-sub">Free entry · Top 8 advance</span>
        </span>
        <span className="ph-arrow" aria-hidden="true">›</span>
        <span className="ph-soon-tag">Coming soon</span>
      </button>
      <div className="ph-dots" aria-hidden="true">
        <i /><i className="on" /><i /><i />
      </div>

      <div className="ph-stage">
        <DailyHome userId={userId} variant="icons" />
        <div className="ph-center">
          <Logo />
          <div className="ph-hero">
            {pose ? (
              <img src={pose} alt="" draggable={false} data-pose="win" data-avatar={avatarId || "2hot4tv"} />
            ) : (
              <Portrait id={avatarId || "2hot4tv"} size="hero" />
            )}
          </div>
        </div>
        <div className="ph-side-col">
          <button type="button" className="ph-side-btn ph-soon" data-action="rated" onClick={press(() => ping("Coming soon"))}>
            <span className="ph-side-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
                <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
              </svg>
            </span>
            <span className="ph-side-label">Rated</span>
            <span className="ph-soon-tag">Coming soon</span>
          </button>
          <button type="button" className="ph-side-btn ph-soon" data-action="achievements" onClick={press(() => ping("Coming soon"))}>
            <span className="ph-side-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8L6.7 19.6l1-6L3.3 9.4l6-.9z" />
              </svg>
            </span>
            <span className="ph-side-label">Achieve</span>
            <span className="ph-soon-tag">Coming soon</span>
          </button>
        </div>
      </div>

      <div className="ph-actions">
        <div className="ph-play-wrap">
          <button
            type="button"
            className="ph-play"
            data-action="quick-play"
            disabled={connecting}
            onClick={press(() => onQuickPlay(seriesForFormat(format)))}
          >
            <span className="ph-pips" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="ph-play-copy">
              <span>Quick Play</span>
            </span>
          </button>
        </div>
        <QuickFormatToggle format={format} onChange={chooseFormat} />
        <div className="ph-pills">
          <button type="button" className="ph-pill-btn" data-action="multi" disabled={connecting} onClick={press(onMulti)}>
            Multiplayer
          </button>
          <button type="button" className="ph-pill-btn" data-action="play-now" disabled={connecting} onClick={press(onVersus)}>
            Vs Computer
          </button>
        </div>
      </div>

      <nav className="ph-nav" aria-label="Home">
        <button type="button" className="ph-tab" data-action="nav-events" onClick={press(() => ping("Coming soon"))}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /></svg>
          Events
          <span className="ph-soon-tag ph-soon-tab">Coming soon</span>
        </button>
        <button type="button" className="ph-tab" data-action="nav-characters" onClick={press(onCharacters)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
          Characters
        </button>
        <button type="button" className="ph-tab on" data-action="nav-home" aria-current="page">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          Home
        </button>
        <button type="button" className="ph-tab" data-action="nav-store" onClick={press(onStore)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>
          Store
        </button>
        <button type="button" className="ph-tab" data-action="nav-ranks" onClick={press(onRanks)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /></svg>
          Ranks
        </button>
      </nav>
      {soon ? <p className="ph-toast" role="status">{soon}</p> : null}
    </div>
  );
}
