import { useEffect, useRef, useState } from "react";
import { Logo } from "./logo";
import { AccountChip, type AccountUser } from "./account";
import { AvatarFace, AvatarPicker, Portrait } from "./avatars";
import { RankLine } from "./rank";
import { isMuted, playUiClick, setMuted, unlockSound } from "./sound";
import { BoneMark, PREVIEW_COINS, PREVIEW_GEMS, StorePreview } from "./store";

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
  connecting,
  initialName,
  user,
  onCreate,
  onSolo,
  onJoin,
  onQuick,
  onGuest,
  onAccount,
  onBoard,
  onLook,
  onPreview,
  forced = null,
}: {
  presetCode: string;
  error: string | null;
  connecting: boolean;
  initialName: string;
  user: AccountUser | null;
  onCreate: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength) => void;
  onSolo: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength, difficulty: Difficulty) => void;
  onJoin: (name: string, code: string) => void;
  onQuick: (name: string, size: QuickSize) => void;
  onGuest: (name: string) => void;
  onAccount: () => void;
  onBoard: () => void;
  onLook: () => void;
  onPreview: (() => void) | null;
  forced?: Sheet;
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
  const [tables, setTables] = useState<OpenTable[]>([]);
  const [muted, setMuteState] = useState(isMuted);
  const readyName = name.trim();

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

  return (
    <main className="arcade-home" data-screen="home" data-skin="ivory">
      <header className="arcade-bar">
        {user ? (
          <AccountChip user={user} onOpen={onAccount} />
        ) : (
          <button type="button" className="profile-chip" onClick={press(onAccount)}>
            <span className="avatar">?</span>
            <span className="profile-name">Sign in</span>
          </button>
        )}
        <div className="wallet">
          <button type="button" className="coin-chip" aria-label={`${PREVIEW_COINS.toLocaleString()} Bones`} onClick={press(() => setSheet("store"))}>
            <BoneMark />
            <span>{PREVIEW_COINS.toLocaleString()}</span>
          </button>
          <button type="button" className="gold-chip" aria-label={`${PREVIEW_GEMS.toLocaleString()} Gold Bones`} onClick={press(() => setSheet("store"))}>
            <BoneMark gold />
            <span>{PREVIEW_GEMS.toLocaleString()}</span>
          </button>
        </div>
        <div className="arcade-tools">
          <button type="button" className="icon-button" aria-label="Settings" onClick={press(() => setSheet("settings"))}>
            <GearIcon />
          </button>
          <button type="button" className="icon-button" aria-label="Leaderboard" onClick={press(onBoard)}>
            <BoardIcon />
          </button>
          <button type="button" className="icon-button" aria-label="Store" onClick={press(() => setSheet("store"))}>
            <BagIcon />
          </button>
        </div>
      </header>

      <div className="hero-stage">
        <Portrait id={user?.avatarId} size="hero" />
        <button
          type="button"
          className="change-look"
          disabled={!user && !readyName}
          onClick={press(() => {
            if (!user && readyName) onGuest(readyName);
            onLook();
          })}
        >
          Change look
        </button>
      </div>

      {error ? <p className="banner error">{error}</p> : null}
      {connecting ? <p className="banner">Connecting…</p> : null}

      <div className="arcade-actions">
        <button type="button" className="capsule" data-action="solo" disabled={connecting || !readyName} onClick={press(() => setSheet("mode"))}>
          Play vs computer
        </button>
        <button type="button" className="capsule capsule-red" data-action="multi" disabled={connecting || !readyName} onClick={press(() => setSheet("multi"))}>
          Multiplayer
        </button>
      </div>

      <label className="name-field arcade-name">
        Nickname
        <input value={name} maxLength={16} autoComplete="nickname" placeholder="Your name" onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="account-row">
        <button type="button" className="text-button" disabled={connecting || !readyName} onClick={press(() => onGuest(readyName))}>
          Continue as guest
        </button>
        <button type="button" className="text-button" onClick={press(onAccount)}>
          Sign in
        </button>
      </div>
      {onPreview ? (
        <button type="button" className="uhoh-test" data-demo="uhoh" onClick={onPreview}>
          Preview UH-OH
        </button>
      ) : null}

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
            onClick={press(() => requireName(() => onSolo(readyName, playerCount, boneyardMode, seriesLength, difficulty)))}
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
              requireName(() => onCreate(readyName, playerCount, boneyardMode, seriesLength));
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
              requireName(() => onJoin(readyName, code));
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
              onClick={press(() => requireName(() => onQuick(readyName, quickSize)))}
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
                onClick={press(() => requireName(() => onJoin(readyName, table.code)))}
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

      {sheet === "store" ? <StorePreview onClose={() => setSheet(null)} /> : null}

      {sheet === "settings" ? (
        <section className="arcade-modal" role="dialog" aria-label="Settings" data-screen="settings">
          <h2>Settings</h2>
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
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button type="button" className="capsule capsule-red" onClick={press(onAccount)}>
            Sign in
          </button>
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
        </section>
      ) : null}
    </main>
  );
}

export function QuickWait({
  players,
  playerCount,
  waitUntil,
  canFill,
  serverNow,
  onCancel,
  onFill,
  onKeep,
}: {
  players: Array<{
    id: string;
    name: string;
    isYou: boolean;
    bot: boolean;
    avatarId: string;
    rank: { tierId: string; tierName?: string; step: "III" | "II" | "I" | null; rating: number; provisional: boolean } | null;
  }>;
  playerCount: number;
  waitUntil: number;
  canFill: boolean;
  serverNow: number;
  onCancel: () => void;
  onFill: () => void;
  onKeep: () => void;
}) {
  const clock = useServerClock(serverNow);
  const left = Math.max(0, waitUntil - clock);
  const open = Math.max(0, playerCount - players.length);
  const offer = canFill || left <= 0;
  return (
    <section className="quick-wait" data-screen="quick-wait">
      <p className="eyebrow">Quick match</p>
      <h2>Finding a table</h2>
      <p className="hint">Best of 3. Draw until you can play. All human, so this one counts toward your rating.</p>
      <ul className="quick-seats">
        {players.map((player) => (
          <li key={player.id}>
            <AvatarFace id={player.avatarId} bot={player.bot} />
            <span className="quick-who">
              <strong>{player.isYou ? "You" : player.name}</strong>
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
      ) : (
        <p className="hint">Asking again in {Math.ceil(left / 1000)}s if the table is still open.</p>
      )}
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
  return <ArcadeHome {...demoHome} />;
}

const demoHome = {
  presetCode: "",
  error: null,
  connecting: false,
  initialName: "Bryan",
  user: {
    id: "demo",
    displayName: "Bryan",
    avatarId: "homescreen",
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
  onGuest: () => undefined,
  onAccount: () => undefined,
  onBoard: () => undefined,
  onLook: () => undefined,
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
            avatarId: "homescreen",
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
    { name: "You", avatar: "homescreen", score: 95, tier: "rookie", rating: 1212, provisional: true, you: true, timer: 0.62 },
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
