import { useEffect, useRef, useState } from "react";
import { Logo } from "./logo";
import { AccountChip, type AccountUser } from "./account";
import { AvatarFace, AvatarPicker, BotBadge, Portrait } from "./avatars";
import { StoreScreen } from "./store";
import { RankLine } from "./rank";
import { MUSIC_TRACKS, musicChoice, musicVolume, setMusicChoice, setMusicVolume, type MusicChoice } from "./music";
import { hapticsOn, setHaptics } from "./feel/haptics";
import { isMuted, playUiClick, setMuted, unlockSound } from "./sound";
import { applyA11y, largeTilesOn, pipMarksOn, setLargeTiles, setPipMarks } from "./a11y";
import { HOWTO_BEAT_MS, HOWTO_KEY, HOWTO_STEPS, PRACTICE_KEY } from "./howto";
import { pulse } from "./pulse";
import { Domino } from "./table";
import { DailyHome } from "./daily";
import { PlayerHome } from "./home-screen";
import { InstallHint } from "./install-hint";

type BoneyardMode = "draw_one" | "draw_until";
type SeriesLength = 3 | 5 | 7;
type Difficulty = "easy" | "medium" | "hard" | "expert";
type QuickSize = 2 | 3 | 4 | "any";
type Sheet = "mode" | "multi" | "store" | "settings" | null;

export interface OpenTable {
  code: string;
  playerCount: number;
  seated: number;
  players: Array<{
    name: string;
    avatarId: string;
    rating: number;
    provisional: boolean;
    tierId: string;
    tierName: string;
    step: "III" | "II" | "I" | null;
  }>;
}

export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function menuDemoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "menu";
}

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function press(action: () => void): () => void {
  return () => {
    unlockSound();
    playUiClick();
    action();
  };
}

export function Splash({ onDone, hold = false }: { onDone: () => void; hold?: boolean }) {
  useEffect(() => {
    if (hold) return;
    const timer = window.setTimeout(onDone, reducedMotion() ? 700 : 2600);
    return () => window.clearTimeout(timer);
  }, [hold, onDone]);
  return (
    <button type="button" className={`splash${hold ? " splash-hold" : ""}`} data-screen="splash" aria-label="Skip the intro" onClick={onDone}>
      <span className="splash-logo">
        <Logo />
        <span className="splash-sweep" />
      </span>
    </button>
  );
}

export function ArcadeHome({
  presetCode,
  error,
  notice = null,
  connecting,
  initialName,
  user,
  onCreate,
  onSolo,
  onJoin,
  onQuick,
  onQuickPlay,
  onGuest,
  onAccount,
  onBoard,
  onLook,
  onRefresh,
  onPreview,
  forced = null,
  introBusy: _introBusy = false,
  needsAge = false,
  ageChecked = false,
  onAge = () => undefined,
  onNeedAge = () => undefined,
  onDelete,
}: {
  presetCode: string;
  error: string | null;
  notice?: string | null;
  connecting: boolean;
  initialName: string;
  user: AccountUser | null;
  onCreate: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength) => void;
  onSolo: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength, difficulty: Difficulty, casual?: boolean) => void;
  onJoin: (name: string, code: string) => void;
  onQuick: (name: string, size: QuickSize) => void;
  onQuickPlay: (name: string, seriesLength: 3 | 5 | 7) => void;
  onGuest: (name: string) => void;
  onAccount: () => void;
  onBoard: () => void;
  onLook: () => void;
  onRefresh: () => void;
  onPreview: (() => void) | null;
  forced?: Sheet;
  /** Splash is still up, so the how-to waits. */
  introBusy?: boolean;
  needsAge?: boolean;
  ageChecked?: boolean;
  onAge?: (checked: boolean) => void;
  onNeedAge?: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (initialName) setName((current) => current || initialName);
  }, [initialName]);
  const [playerCount, setPlayerCount] = useState(2);
  const [boneyardMode, setBoneyardMode] = useState<BoneyardMode>("draw_until");
  const [seriesLength, setSeriesLength] = useState<SeriesLength>(3);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [quickSize, setQuickSize] = useState<QuickSize>(4);
  const [code, setCode] = useState(presetCode);
  const [sheet, setSheet] = useState<Sheet>(forced);
  const [guide, setGuide] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [practiceOffer, setPracticeOffer] = useState(false);
  const [largeTiles, setLargeTileState] = useState(largeTilesOn);
  const [pipNumbers, setPipNumberState] = useState(pipMarksOn);
  const [tables, setTables] = useState<OpenTable[]>([]);
  const [muted, setMuteState] = useState(isMuted);
  const [haptics, setHapticState] = useState(hapticsOn);
  const [music, setMusic] = useState<MusicChoice>(musicChoice);
  const [musicLevel, setMusicLevel] = useState(() => Math.round(musicVolume() * 100));
  const readyName = name.trim();
  const [deleteArmed, setDeleteArmed] = useState(false);
  const gate = (action: () => void) => {
    if (needsAge && !ageChecked) {
      setSheet(null);
      onNeedAge();
      return;
    }
    action();
  };
  const [wearTick, setWearTick] = useState(0);
  const [frameId, setFrameId] = useState<string | null>(null);
  const [goldBones, setGoldBones] = useState<number | null>(null);
  const [bones, setBones] = useState<number | null>(null);
  const heroFrame = frameId ?? (user?.avatarId === "pitmaster" ? "FRM-015" : null);
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    void fetch("/api/store")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { loadout?: { frameId?: string | null }; goldBones?: number; bones?: number } | null) => {
        if (stopped || !body) return;
        setFrameId(body.loadout?.frameId ?? null);
        setGoldBones(body.goldBones ?? 0);
        setBones(body.bones ?? 0);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [user?.id, wearTick]);

  useEffect(() => {
    if (sheet !== "multi") return;
    let stopped = false;
    const load = () => {
      void fetch("/api/open-tables")
        .then((response) => response.json())
        .then((body: { tables?: OpenTable[] }) => {
          if (!stopped) setTables(body.tables ?? []);
        })
        .catch(() => {
          if (!stopped) setTables([]);
        });
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [sheet]);

  const requireName = (action: () => void) => {
    if (!readyName) return;
    action();
  };

  useEffect(() => {
    pulse("home");
  }, []);

  const closeGuide = () => {
    try {
      localStorage.setItem(HOWTO_KEY, "1");
    } catch {
      // Private mode can refuse the write. The card still closes.
    }
    setGuide(false);
  };

  useEffect(() => {
    if (!guide || reducedMotion()) return;
    const last = guideStep >= HOWTO_STEPS.length - 1;
    const timer = window.setTimeout(() => {
      if (last) closeGuide();
      else setGuideStep((current) => Math.min(current + 1, HOWTO_STEPS.length - 1));
    }, HOWTO_BEAT_MS);
    return () => window.clearTimeout(timer);
  }, [guide, guideStep]);

  const startPractice = () => {
    if (needsAge && !ageChecked) {
      onNeedAge();
      return;
    }
    try {
      localStorage.setItem(PRACTICE_KEY, "1");
      localStorage.setItem(HOWTO_KEY, "1");
    } catch {
      // The game still starts.
    }
    setPracticeOffer(false);
    setGuide(false);
    onSolo(readyName || user?.displayName || "Guest", 2, "draw_until", 3, "easy");
  };

  return (
    <main className={user ? "player-home" : "arcade-home"} data-screen="home" data-skin="ivory">
      <InstallHint />
      {user ? (
        <>
        <PlayerHome
          userId={user.id}
          displayName={user.displayName}
          avatarId={user.avatarId}
          rating={user.rating}
          bones={bones}
          goldBones={goldBones}
          connecting={connecting}
          onSettings={() => setSheet("settings")}
          onStore={() => setSheet("store")}
          onCharacters={onLook}
          onRanks={onBoard}
          onMulti={() => setSheet("multi")}
          onVersus={() =>
            gate(() => onSolo(readyName || user.displayName || "Guest", 2, "draw_until", 3, "easy", true))
          }
          onQuickPlay={(series) => gate(() => onQuickPlay(readyName || user.displayName || "Guest", series))}
        />
        {error ? <p className="banner error">{error}</p> : notice ? <p className="banner">{notice}</p> : null}
        {connecting ? <p className="banner">Connecting…</p> : null}
        </>
      ) : null}
      {user ? null : (
      <>
      <header className="arcade-bar">
          <button type="button" className="profile-chip" onClick={press(onAccount)}>
            <span className="avatar">?</span>
            <span className="profile-name">Sign in</span>
          </button>
        <div className="arcade-tools">
          <button type="button" className="icon-button" aria-label="Settings" onClick={press(() => setSheet("settings"))}>
            <GearIcon />
          </button>
          <button type="button" className="icon-button" aria-label="Leaderboard" onClick={press(onBoard)}>
            <BoardIcon />
          </button>
          {goldBones != null ? (
            <span className="gold-home" aria-label={`${goldBones} Gold Bones`}>
              <i className="gold-pip" aria-hidden="true" />
              {goldBones}
            </span>
          ) : null}
          <button type="button" className="icon-button" aria-label="Store" onClick={press(() => setSheet("store"))}>
            <BagIcon />
          </button>
        </div>
      </header>

      <div className="hero-stage">
        <span className="hero-portrait">
          <Portrait id="2hot4tv" size="hero" />
          {heroFrame ? <img className="hero-frame" src={`/store/${heroFrame}.webp`} alt="" draggable={false} /> : null}
        </span>
        <button
          type="button"
          className="change-look"
          disabled={!readyName}
          onClick={press(() => {
            if (readyName) onGuest(readyName);
            onLook();
          })}
        >
          Change look
        </button>
        {guide ? (
          <section className="howto" data-screen="howto" aria-live="polite">
            <p className="howto-title">{HOWTO_STEPS[guideStep]?.title}</p>
            <p className="howto-body">{HOWTO_STEPS[guideStep]?.body}</p>
            <div className="howto-actions">
              <button type="button" className="text-button" data-action="practice" disabled={connecting} onClick={press(startPractice)}>
                Practice
              </button>
              <button type="button" className="text-button" data-action="howto-skip" onClick={press(closeGuide)}>
                Skip
              </button>
              <button
                type="button"
                className="text-button"
                data-action="howto-next"
                onClick={press(() => {
                  if (guideStep >= HOWTO_STEPS.length - 1) closeGuide();
                  else setGuideStep((current) => current + 1);
                })}
              >
                {guideStep >= HOWTO_STEPS.length - 1 ? "Done" : "Next"}
              </button>
            </div>
          </section>
        ) : practiceOffer ? (
          <button type="button" className="howto-practice" data-action="practice" disabled={connecting} onClick={press(startPractice)}>
            Practice vs easy computer
          </button>
        ) : null}
      </div>

      {error ? <p className="banner error">{error}</p> : notice ? <p className="banner">{notice}</p> : null}
      {connecting ? <p className="banner">Connecting…</p> : null}

      <div className="home-play">
      <div className="arcade-actions">
        <button
          type="button"
          className="capsule"
          data-action="play-now"
          disabled={connecting}
          onClick={press(() =>
            gate(() => onSolo(readyName || "Guest", 2, "draw_until", 3, "easy", true)),
          )}
        >
          Play
        </button>
        <button type="button" className="capsule capsule-red" data-action="multi" disabled={connecting} onClick={press(() => setSheet("multi"))}>
          Multiplayer
        </button>
      </div>

      <label className="name-field arcade-name">
        Nickname
        <input value={name} maxLength={16} autoComplete="nickname" placeholder="Your name" onChange={(event) => setName(event.target.value)} />
      </label>
      {needsAge ? (
        <label className="age-gate">
          <input
            type="checkbox"
            data-action="age-13"
            checked={ageChecked}
            onChange={(event) => onAge(event.target.checked)}
          />
          I am 13 or older
        </label>
      ) : null}
      <div className="account-row">
        <button type="button" className="text-button" data-action="solo" disabled={connecting} onClick={press(() => setSheet("mode"))}>
          Choose seats
        </button>
        <button
          type="button"
          className="text-button"
          data-action="quick-play"
          disabled={connecting}
          onClick={press(() => gate(() => onQuickPlay(readyName || "Guest", 5)))}
        >
          Quick Play
        </button>
        <button type="button" className="text-button" disabled={connecting || !readyName} onClick={press(() => gate(() => onGuest(readyName)))}>
          Continue as guest
        </button>
        <button type="button" className="text-button" onClick={press(onAccount)}>
          Sign in
        </button>
      </div>
      <DailyHome userId={null} />
      </div>

      <section className="landing" data-screen="landing">
        <h2>Match the ends. Race to 150.</h2>
        <p>Text a friend a table link, or sit down with the computer.</p>
        <div className="shot-row">
          <figure className="shot">
            <div className="shot-frame" data-shot="table">
              <span className="shot-chain">
                <Domino a={6} b={1} orientation="horizontal" />
                <Domino a={1} b={4} orientation="horizontal" />
              </span>
            </div>
            <figcaption>The table</figcaption>
          </figure>
          <figure className="shot">
            <div className="shot-frame" data-shot="hand">
              <span className="shot-hand">
                <Domino a={2} b={3} orientation="vertical" />
                <Domino a={5} b={5} orientation="vertical" />
                <Domino a={0} b={6} orientation="vertical" />
              </span>
            </div>
            <figcaption>Your hand</figcaption>
          </figure>
          <figure className="shot">
            <div className="shot-frame" data-shot="score">
              <p className="shot-score">1/2</p>
              <p className="shot-score-note">First to 2 games</p>
            </div>
            <figcaption>The score</figcaption>
          </figure>
        </div>
      </section>
      {onPreview ? (
        <button type="button" className="uhoh-test" data-demo="uhoh" onClick={onPreview}>
          Preview UH-OH
        </button>
      ) : null}
      </>
      )}

      {sheet === "mode" ? (
        <section className="arcade-modal" role="dialog" aria-label="Play vs computer" data-screen="mode">
          <h2>Single player</h2>
          <fieldset>
            <legend>Players</legend>
            <div className="choices chunky">
              {[2, 3, 4].map((count) => (
                <button type="button" key={count} aria-pressed={playerCount === count} onClick={press(() => setPlayerCount(count))}>
                  {count}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Computer</legend>
            <div className="choices chunky">
              {(["easy", "medium", "hard", "expert"] as const).map((level) => (
                <button type="button" key={level} aria-pressed={difficulty === level} onClick={press(() => setDifficulty(level))}>
                  {level}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Boneyard</legend>
            <div className="choices">
              <button type="button" aria-pressed={boneyardMode === "draw_until"} onClick={press(() => setBoneyardMode("draw_until"))}>
                Draw until
              </button>
              <button type="button" aria-pressed={boneyardMode === "draw_one"} onClick={press(() => setBoneyardMode("draw_one"))}>
                Draw one
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Series</legend>
            <div className="choices">
              {([3, 5, 7] as const).map((length) => (
                <button type="button" key={length} aria-pressed={seriesLength === length} onClick={press(() => setSeriesLength(length))}>
                  Best of {length}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="capsule"
            data-action="start-solo"
            onClick={press(() => gate(() => requireName(() => onSolo(readyName, playerCount, boneyardMode, seriesLength, difficulty))))}
          >
            Start
          </button>
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
        </section>
      ) : null}

      {sheet === "multi" ? (
        <section className="arcade-modal" role="dialog" aria-label="Multiplayer" data-screen="multi">
          <h2>Multiplayer</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              gate(() => requireName(() => onCreate(readyName, playerCount, boneyardMode, seriesLength)));
            }}
          >
            <h3>Create room</h3>
            <p className="hint">A private table. You share the code.</p>
            <div className="choices chunky">
              {[2, 3, 4].map((count) => (
                <button type="button" key={count} aria-pressed={playerCount === count} onClick={press(() => setPlayerCount(count))}>
                  {count}
                </button>
              ))}
            </div>
            <div className="choices">
              <button type="button" aria-pressed={boneyardMode === "draw_until"} onClick={press(() => setBoneyardMode("draw_until"))}>
                Draw until
              </button>
              <button type="button" aria-pressed={boneyardMode === "draw_one"} onClick={press(() => setBoneyardMode("draw_one"))}>
                Draw one
              </button>
            </div>
            <div className="choices">
              {([3, 5, 7] as const).map((length) => (
                <button type="button" key={length} aria-pressed={seriesLength === length} onClick={press(() => setSeriesLength(length))}>
                  Best of {length}
                </button>
              ))}
            </div>
            <button className="capsule capsule-red" type="submit" data-action="create">
              Create room
            </button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              gate(() => requireName(() => onJoin(readyName, code)));
            }}
          >
            <h3>Join room</h3>
            <label>
              Room code
              <input
                className="code-input"
                value={code}
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                required
              />
            </label>
            <button className="capsule" type="submit" data-action="join">
              Join room
            </button>
          </form>
          <div>
            <h3>Quick match</h3>
            <p className="hint">A public table. It starts when the seats are full, and it counts toward your rating.</p>
            <div className="choices chunky">
              {([2, 3, 4, "any"] as const).map((size) => (
                <button type="button" key={String(size)} aria-pressed={quickSize === size} onClick={press(() => setQuickSize(size))}>
                  {size === "any" ? "Any" : size}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="capsule"
              data-action="quick"
              onClick={press(() => gate(() => requireName(() => onQuick(readyName, quickSize))))}
            >
              Find a table
            </button>
          </div>
          <div className="open-tables" data-screen="open-tables">
            <h3>Open tables</h3>
            {tables.length === 0 ? <p className="hint">No public tables waiting.</p> : null}
            {tables.map((table) => (
              <button
                type="button"
                key={table.code}
                className="open-table"
                onClick={press(() => gate(() => requireName(() => onJoin(readyName, table.code))))}
              >
                <span>
                  {table.code} · {table.seated}/{table.playerCount}
                </span>
                <span className="open-faces">
                  {table.players.map((player) => (
                    <AvatarFace key={player.name} id={player.avatarId} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
        </section>
      ) : null}

      {sheet === "store" ? (
        <StoreScreen
          onClose={() => setSheet(null)}
          onChanged={() => {
            setWearTick((tick) => tick + 1);
            onRefresh();
          }}
        />
      ) : null}

      {sheet === "settings" ? (
        <section className="arcade-modal" role="dialog" aria-label="Settings" data-screen="settings">
          <h2>Settings</h2>
          {notice ? <p className="banner">{notice}</p> : null}
          <button
            type="button"
            className="capsule"
            aria-pressed={muted}
            onClick={press(() => {
              const next = !muted;
              setMuteState(next);
              setMuted(next);
            })}
          >
            {muted ? "Sound effects off" : "Sound effects on"}
          </button>
          <button
            type="button"
            className="capsule"
            aria-pressed={haptics}
            data-action="haptics"
            onClick={press(() => {
              const next = !haptics;
              setHapticState(next);
              setHaptics(next);
            })}
          >
            {haptics ? "Haptics on" : "Haptics off"}
          </button>
          <h3>Accessibility</h3>
          <button
            type="button"
            className="capsule"
            aria-pressed={largeTiles}
            data-action="large-tiles"
            onClick={press(() => {
              const next = !largeTiles;
              setLargeTileState(next);
              setLargeTiles(next);
              applyA11y();
            })}
          >
            {largeTiles ? "Larger tiles on" : "Larger tiles off"}
          </button>
          <button
            type="button"
            className="capsule"
            aria-pressed={pipNumbers}
            data-action="pip-numbers"
            onClick={press(() => {
              const next = !pipNumbers;
              setPipNumberState(next);
              setPipMarks(next);
              applyA11y();
            })}
          >
            {pipNumbers ? "Numbers on the tiles" : "Dots on the tiles"}
          </button>
          <h3>Music</h3>
          <div className="choices music-choices" data-music={music} role="group" aria-label="Music">
            <button type="button" aria-pressed={music === "off"} data-action="music-off" onClick={press(() => { setMusic("off"); setMusicChoice("off"); })}>
              Off
            </button>
            {MUSIC_TRACKS.map((track) => (
              <button
                key={track.id}
                type="button"
                aria-pressed={music === track.id}
                data-action={`music-${track.id}`}
                onClick={press(() => { setMusic(track.id); setMusicChoice(track.id); })}
              >
                {track.label}
              </button>
            ))}
          </div>
          <label className="music-volume">
            Music volume
            <input
              type="range"
              min={0}
              max={100}
              value={musicLevel}
              data-action="music-volume"
              aria-label="Music volume"
              onChange={(event) => {
                const next = Number(event.target.value);
                setMusicLevel(next);
                setMusicVolume(next / 100);
              }}
            />
          </label>
          <p className="music-credit" data-music-credit>
            These four tracks are CC0 (public domain). Credit is not required. Rap: Lofi Hip Hop Loop — Taylor Harris. Rock: Rock Theme 3 — Umplix. EDM: Synthwave House Loop — Fupi. Classical: Gymnopédie No. 1 — Erik Satie, performed by Teknopazzo.
          </p>
          <button
            type="button"
            className="capsule"
            data-action="howto"
            onClick={press(() => {
              setSheet(null);
              setGuideStep(0);
              setGuide(true);
            })}
          >
            How to play
          </button>
          {needsAge ? (
            <label className="age-gate">
              <input type="checkbox" checked={ageChecked} onChange={(event) => onAge(event.target.checked)} />
              I am 13 or older
            </label>
          ) : (
            <p className="hint">Age confirmed. You need to be 13 or older.</p>
          )}
          <p className="hint">During a game, open Table talk to report or block a player. Names and table talk are checked for slurs.</p>
          <p className="hint">We count visits and crashes on this server. No name is stored with them. <a href="/privacy">Privacy</a></p>
          {user && onDelete ? (
            deleteArmed ? (
              <div className="safety-confirm">
                <p>This removes your name, email, and sign-in. Wins stay, under the name Deleted.</p>
                <button type="button" className="capsule capsule-red" data-action="delete-confirm" onClick={press(() => void onDelete())}>
                  Yes, delete it
                </button>
                <button type="button" className="capsule capsule-back" onClick={press(() => setDeleteArmed(false))}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="capsule" data-action="delete-account" onClick={press(() => setDeleteArmed(true))}>
                Delete account
              </button>
            )
          ) : null}
          <button type="button" className="capsule capsule-red" onClick={press(onAccount)}>
            Sign in
          </button>
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
          <button type="button" className="text-button" data-action="solo" onClick={press(() => setSheet("mode"))}>
            Choose seats
          </button>
        </section>
      ) : null}
      {user ? null : (
        <nav className="arcade-legal" aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      )}
    </main>
  );
}

export function QuickWait({
  players,
  playerCount,
  waitUntil,
  canFill,
  botFillAt = null,
  serverNow,
  onCancel,
  onFill,
  onFillBots,
  onKeep,
  autoStartAt = null,
  seriesLength = 3,
  youAreHost = false,
  onSeries,
}: {
  players: Array<{
    id: string;
    name: string;
    isYou: boolean;
    bot: boolean;
    accountBot?: boolean;
    avatarId: string;
    rank: { tierId: string; tierName?: string; step: "III" | "II" | "I" | null; rating: number; provisional: boolean } | null;
  }>;
  playerCount: number;
  waitUntil: number;
  canFill: boolean;
  botFillAt?: number | null;
  serverNow: number;
  onCancel: () => void;
  onFill: () => void;
  onFillBots?: () => void;
  onKeep: () => void;
  autoStartAt?: number | null;
  seriesLength?: 3 | 5 | 7;
  youAreHost?: boolean;
  onSeries?: (length: 3 | 5 | 7) => void;
}) {
  const clock = useServerClock(serverNow);
  const left = Math.max(0, waitUntil - clock);
  const botLeft = botFillAt == null ? null : Math.max(0, botFillAt - clock);
  const autoLeft = autoStartAt == null ? null : Math.max(0, autoStartAt - clock);
  const open = Math.max(0, playerCount - players.length);
  const offer = autoStartAt == null && (canFill || left <= 0);
  const finding = autoStartAt != null;
  return (
    <section className="quick-wait" data-screen="quick-wait">
      <p className="eyebrow">{finding ? "Quick Play" : "Quick match"}</p>
      <h2>{finding ? "Finding players..." : "Finding a table"}</h2>
      <p className="hint">
        {finding
          ? `Best of ${seriesLength}. Computers sit down in ${Math.max(0, Math.round((autoLeft ?? 0) / 1000))}s if these seats stay open. A computer game stays off the rating. For the first two hands, someone can take a computer's seat between hands.`
          : `Best of 3. Draw until you can play.${
              botFillAt != null
                ? " A bot sits down if the seat stays open, and the game still counts toward your rating."
                : " All human, so this one counts toward your rating."
            }`}
      </p>
      {finding && youAreHost && onSeries ? (
        <div className="choices">
          {([3, 5, 7] as const).map((length) => (
            <button
              type="button"
              key={length}
              aria-pressed={seriesLength === length}
              data-action={`series-${length}`}
              onClick={press(() => onSeries(length))}
            >
              Best of {length}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="quick-seats">
        {players.map((player) => (
          <li key={player.id}>
            <AvatarFace id={player.avatarId} bot={player.bot && !player.accountBot} />
            <span className="quick-who">
              <strong>
                {player.isYou ? "You" : player.name}
                {player.accountBot ? <BotBadge /> : null}
              </strong>
              {player.rank ? (
                <RankLine
                  tierId={player.rank.tierId}
                  tierName={player.rank.tierName}
                  step={player.rank.step}
                  rating={player.rank.rating}
                  provisional={player.rank.provisional}
                />
              ) : (
                <small className="hint">1200</small>
              )}
            </span>
          </li>
        ))}
        {Array.from({ length: open }, (_, index) => (
          <li key={`open-${index}`} className="open-seat">
            <span className="avatar empty" />
            <span>Open seat</span>
          </li>
        ))}
      </ul>
      {botFillAt != null && onFillBots ? (
        <button type="button" className="capsule capsule-red" data-action="fill-bots" onClick={press(onFillBots)}>
          Play with a bot{botLeft != null && botLeft > 0 ? ` · ${Math.ceil(botLeft / 1000)}s` : ""}
        </button>
      ) : null}
      {offer ? (
        <div className="quick-offer" data-quick-offer="true">
          <p>Still an open seat. Keep waiting, or fill the rest with computers. Computers take this game off the rating.</p>
          <button type="button" className="capsule" data-action="keep-waiting" onClick={press(onKeep)}>
            Keep waiting
          </button>
          <button type="button" className="capsule capsule-red" data-action="fill-quick" onClick={press(onFill)}>
            Fill with computers
          </button>
        </div>
      ) : !finding && botFillAt == null ? (
        <p className="hint">Asking again in {Math.ceil(left / 1000)}s if the table is still open.</p>
      ) : null}
      <button type="button" className="capsule capsule-back" data-action="cancel-quick" onClick={press(onCancel)}>
        Cancel
      </button>
    </section>
  );
}

function useServerClock(serverNow: number): number {
  const offset = useRef(serverNow - Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    offset.current = serverNow - Date.now();
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return now + offset.current;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.2a3.8 3.8 0 1 0 .01 0z" />
      <path d="M12 3.2v2M12 18.8v2M4.7 6.2l1.6 1.6M17.7 16.2l1.6 1.6M3.2 12h2M18.8 12h2M4.7 17.8l1.6-1.6M17.7 7.8l1.6-1.6" />
    </svg>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V11M10 19V7M15 19V13M20 19V4" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 8h11l-1 12h-9l-1-12z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

export function MenuDemo() {
  const shot = new URLSearchParams(location.search).get("shot") ?? "home";
  if (shot === "splash") return <Splash hold onDone={() => undefined} />;
  if (shot === "picker") {
    return (
      <main className="arcade-home" data-shot="picker">
        <h2 className="demo-title">Your look</h2>
        <AvatarPicker selected="golfer" onPick={() => undefined} />
      </main>
    );
  }
  if (shot === "mode") {
    return (
      <ArcadeHome
        {...demoHome}
        forced="mode"
      />
    );
  }
  if (shot === "quick") return <DemoQuick />;
  if (shot === "table") return <DemoTable />;
  const avatar = new URLSearchParams(location.search).get("avatar");
  const user = avatar ? { ...demoHome.user, avatarId: avatar } : demoHome.user;
  return <ArcadeHome {...demoHome} user={user} />;
}

const demoHome = {
  presetCode: "",
  error: null,
  connecting: false,
  initialName: "Bryan",
  user: {
    id: "demo",
    displayName: "Bryan",
    avatarId: "2hot4tv",
    guest: true,
    providers: [],
    rating: 1544,
    provisional: false,
    rankedGames: 29,
    rankedWins: 18,
    rankedLosses: 11,
    gamesPlayed: 41,
    vsComputerGames: 12,
    vsComputerWins: 9,
    vsComputerLosses: 3,
    seasonId: 1,
    seasonPoints: 1420,
    seasonEndsAt: "2026-12-14T06:00:00.000Z",
    tierId: "hustler",
    tierName: "Hustler",
    tierStep: "II" as const,
    nextAt: 1567,
    stepFloor: 1334,
    peakTierId: "hustler",
    peakTierName: "Hustler",
    peakStep: "II" as const,
  } satisfies AccountUser,
  onCreate: () => undefined,
  onSolo: () => undefined,
  onJoin: () => undefined,
  onQuick: () => undefined,
  onQuickPlay: () => undefined,
  onGuest: () => undefined,
  onAccount: () => undefined,
  onBoard: () => undefined,
  onLook: () => undefined,
  onRefresh: () => undefined,
  onPreview: null,
};

function DemoQuick() {
  return (
    <main className="arcade-home" data-shot="quick">
      <QuickWait
        playerCount={4}
        waitUntil={Date.now()}
        canFill
        serverNow={Date.now()}
        onCancel={() => undefined}
        onFill={() => undefined}
        onKeep={() => undefined}
        players={[
          {
            id: "you",
            name: "Bryan",
            isYou: true,
            bot: false,
            avatarId: "2hot4tv",
            rank: { tierId: "hustler", tierName: "Hustler", step: "II", rating: 1544, provisional: false },
          },
          {
            id: "sam",
            name: "Sam",
            isYou: false,
            bot: false,
            avatarId: "golfer",
            rank: { tierId: "shuffler", tierName: "Shuffler", step: "I", rating: 1310, provisional: false },
          },
        ]}
      />
    </main>
  );
}

function DemoTable() {
  const seats = [
    { name: "You", avatar: "2hot4tv", score: 95, tier: "rookie", rating: 1212, provisional: true, you: true, timer: 0.62 },
    { name: "Sam", avatar: "golfer", score: 70, tier: "hustler", rating: 1540, provisional: false, you: false, timer: null },
    { name: "Ada", avatar: "barista", score: 40, tier: "shark", rating: 2210, provisional: false, you: false, timer: null },
    { name: "Jo", avatar: "gaperilla", score: 20, tier: "legend", rating: 6120, provisional: false, you: false, timer: null },
  ];
  return (
    <main className="felt-app" data-skin="ivory" data-shot="table">
      <header className="playbar">
        <p className="series-line">Bo3 · G1 · H2 · to 150</p>
      </header>
      <div className="demo-felt">
        {seats.map((seat) => (
          <div key={seat.name} className={`seat-chip${seat.you ? " you turn" : ""}`} data-player-id={seat.name} data-turn-timer={seat.timer != null ? "true" : "false"}>
            <AvatarFace id={seat.avatar} timer={seat.timer} />
            <span className="chip-text">
              <span className="chip-name">{seat.name}</span>
              <span className="chip-meta">
                <strong>{seat.score}</strong>
                <RankLine tierId={seat.tier} rating={seat.rating} provisional={seat.provisional} compact />
              </span>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
