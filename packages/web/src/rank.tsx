import { useEffect, useState } from "react";
import { Portrait } from "./avatars";
import type { RankRecap } from "@uhoh/rules";

export interface RankFacts {
  rating: number;
  provisional: boolean;
  rankedGames: number;
  rankedWins: number;
  rankedLosses: number;
  gamesPlayed: number;
  vsComputerGames: number;
  vsComputerWins: number;
  vsComputerLosses: number;
  seasonId: number;
  seasonPoints: number;
  seasonEndsAt: string;
  tierId: string;
  tierName: string;
  tierStep: "III" | "II" | "I" | null;
  nextAt: number | null;
  stepFloor: number;
  peakTierId: string;
  peakTierName: string;
  peakStep: "III" | "II" | "I" | null;
  /** Decision-weighted lifetime. Missing until the profile has a counted game. */
  playAccuracy?: number | null;
  /** Average of the last 10 counted games, or of every counted game when fewer than 10. */
  playAccuracyRecent?: number | null;
  playAccuracyGames?: number;
}

function accuracyDetail(recent: number | null | undefined, games: number): string {
  if (games <= 0 || recent == null) return "No counted games yet";
  const window = Math.min(10, games);
  const label = window === 1 ? "Last game" : `Last ${window} games`;
  return `${label} ${recent}% · ${games} ${games === 1 ? "game" : "games"}`;
}

export function RankBadge({ tier }: { tier: string }) {
  const id = BADGE_IDS.has(tier) ? tier : "rookie";
  return (
    <svg className={`rank-badge tier-${id}`} viewBox="0 0 32 32" aria-hidden="true">
      {badgeShape(id)}
    </svg>
  );
}

export function RankLine({
  tierId,
  tierName,
  step,
  rating,
  provisional,
  compact,
}: {
  tierId: string;
  tierName?: string;
  step?: "III" | "II" | "I" | null;
  rating: number;
  provisional?: boolean;
  compact?: boolean;
}) {
  const label = `${tierName ?? tierLabel(tierId)}${step ? ` ${step}` : ""}`;
  return (
    <span
      className={`rank-line${provisional ? " provisional" : ""}`}
      data-rating={rating}
      data-tier={tierId}
      data-provisional={provisional ? "true" : "false"}
      title={provisional ? `${label}, ${rating}, still settling` : `${label}, ${rating}`}
    >
      <RankBadge tier={tierId} />
      <span className="rank-number">{rating}</span>
      {compact ? null : <span className="rank-tier">{label}</span>}
    </span>
  );
}

export function ProfileStats({ user, avatarId }: { user: RankFacts; avatarId?: string | null }) {
  const span = user.nextAt == null ? 1 : Math.max(1, user.nextAt - user.stepFloor);
  const filled = user.nextAt == null ? 1 : Math.min(1, Math.max(0, (user.seasonPoints - user.stepFloor) / span));
  const nextLabel = user.nextAt == null ? "Top of the ladder" : `${user.nextAt.toLocaleString()} pts`;
  return (
    <section className="profile-stats" data-screen="profile">
      {avatarId ? (
        <div className="profile-portrait">
          <Portrait id={avatarId} size="grid" />
        </div>
      ) : null}
      <div className="profile-rank-row">
        <RankBadge tier={user.tierId} />
        <div>
          <p className="profile-tier">
            {user.tierName}
            {user.tierStep ? ` ${user.tierStep}` : ""}
          </p>
          <p className={`profile-rating${user.provisional ? " provisional" : ""}`} data-rating={user.rating}>
            {user.rating}
            {user.provisional ? <small> provisional</small> : null}
          </p>
        </div>
      </div>
      {user.provisional ? (
        <p className="hint">The number shows right away. It stops looking unsettled after five ranked games.</p>
      ) : null}
      <dl className="stat-grid">
        <div>
          <dt>Ranked</dt>
          <dd>
            {user.rankedWins}–{user.rankedLosses}
          </dd>
        </div>
        <div>
          <dt>Ranked games</dt>
          <dd>{user.rankedGames}</dd>
        </div>
        <div>
          <dt>Games played</dt>
          <dd>{user.gamesPlayed}</dd>
        </div>
        <div>
          <dt>Vs computer</dt>
          <dd>
            {user.vsComputerWins}–{user.vsComputerLosses}
            <small> of {user.vsComputerGames}</small>
          </dd>
        </div>
        <div className="accuracy-stat" data-accuracy={user.playAccuracy ?? ""} data-accuracy-games={user.playAccuracyGames ?? 0}>
          <dt>Play accuracy</dt>
          <dd>
            {user.playAccuracy == null ? "—" : `${user.playAccuracy}%`}
            <small>
              {accuracyDetail(user.playAccuracyRecent, user.playAccuracyGames ?? 0)}
            </small>
          </dd>
        </div>
      </dl>
      <div className="season-block">
        <p className="eyebrow">Season {user.seasonId}</p>
        <p className="season-points">
          {user.seasonPoints.toLocaleString()} <span>pts</span>
        </p>
        <div className="tier-bar" aria-label={`Progress to ${nextLabel}`}>
          <span style={{ transform: `scaleX(${filled})` }} />
        </div>
        <p className="hint">
          Next step {nextLabel}. Season ends {prettyDate(user.seasonEndsAt)}.
        </p>
        <p className="hint">
          Peak this season: {user.peakTierName}
          {user.peakStep ? ` ${user.peakStep}` : ""}.
        </p>
      </div>
    </section>
  );
}

export function RankRecapView({
  recap,
  names,
  faces,
}: {
  recap: RankRecap;
  names: Map<string, string>;
  faces?: Map<string, string>;
}) {
  return (
    <div className="rank-recap" data-ranked={recap.ranked ? "true" : "false"} data-screen="rank-recap">
      <p className="eyebrow" data-format={recap.format}>
        {recap.format === "single" ? "Single game" : "Series"}
        {" · "}
        {recap.ranked ? "Rating" : "Season points"}
      </p>
      {recap.format === "single" && recap.ranked ? <p className="hint">A single game moves your rating a quarter as much as a series game.</p> : null}
      {!recap.ranked ? (
        <p className="rank-note">
          {recap.casual
            ? "Casual table. Ratings stay put."
            : recap.vsComputer
              ? "A computer sat in, so ratings stay put."
              : "Someone wasn't on an account, so ratings stay put."}
        </p>
      ) : null}
      <ul className="recap-list">
        {recap.players.map((player) => {
          const span = player.nextAt == null ? 1 : Math.max(1, player.nextAt - player.stepFloor);
          const filled = player.nextAt == null ? 1 : Math.min(1, Math.max(0, (player.pointsAfter - player.stepFloor) / span));
          const lines = breakdownLines(player.breakdown);
          return (
            <li key={player.playerId} data-player-id={player.playerId}>
              <div className="recap-head">
                <strong className="recap-who">
                  {faces?.get(player.playerId) ? <Portrait id={faces.get(player.playerId)} size="chip" /> : null}
                  {names.get(player.playerId) ?? "Player"}
                </strong>
                {player.ranked && player.ratingBefore != null && player.ratingAfter != null ? (
                  <span className={`recap-delta${player.provisional ? " provisional" : ""}`} data-delta={player.delta ?? 0}>
                    {player.ratingBefore} → {player.ratingAfter}
                    <em>{signed(player.delta ?? 0)}</em>
                  </span>
                ) : (
                  <RankLine tierId={player.tierAfterId} step={player.tierAfterStep} rating={player.pointsAfter} compact />
                )}
              </div>
              {player.steppedUp ? (
                <p className="tier-up" data-tier-up="true">
                  <RankBadge tier={player.tierAfterId} />
                  {player.tierAfterName}
                  {player.tierAfterStep ? ` ${player.tierAfterStep}` : ""}
                </p>
              ) : null}
              <p className="recap-points">+{player.pointsEarned} season pts</p>
              <ul className="breakdown">
                {lines.map((line) => (
                  <li key={line.label}>
                    <span>{line.label}</span>
                    <span>+{line.amount}</span>
                  </li>
                ))}
              </ul>
              {player.breakdown.doubled ? <p className="hint">Ranked table, so these points are doubled.</p> : null}
              <div className="tier-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${filled})` }} />
              </div>
              <p className="hint">
                {player.tierAfterName}
                {player.tierAfterStep ? ` ${player.tierAfterStep}` : ""} · {player.pointsAfter.toLocaleString()} pts
                {player.nextAt == null ? "" : ` · ${player.nextAt.toLocaleString()} next`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface BoardRow {
  name: string;
  avatarId?: string;
  guest: boolean;
  bot?: boolean;
  rating: number;
  provisional: boolean;
  tierId: string;
  tierName: string;
  step: "III" | "II" | "I" | null;
  seasonPoints: number;
}

export function Leaderboard({
  board,
  onBoard,
}: {
  board: "rating" | "season";
  onBoard: (board: "rating" | "season") => void;
}) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [ends, setEnds] = useState("");
  const [seasonId, setSeasonId] = useState<number | null>(null);
  useEffect(() => {
    let stopped = false;
    void fetch(`/api/leaderboard?board=${board}&bots=0`)
      .then((response) => response.json())
      .then((body: { rows?: BoardRow[]; seasonEndsAt?: string; seasonId?: number }) => {
        if (stopped) return;
        setRows(body.rows ?? []);
        setEnds(body.seasonEndsAt ?? "");
        setSeasonId(body.seasonId ?? null);
      })
      .catch(() => {
        if (!stopped) setRows([]);
      });
    return () => {
      stopped = true;
    };
  }, [board]);
  return (
    <section className="leaderboard" data-screen="leaderboard" data-board={board}>
      <div className="board-switch">
        <button type="button" className={board === "rating" ? "primary" : "secondary"} onClick={() => onBoard("rating")}>
          Rating
        </button>
        <button type="button" className={board === "season" ? "primary" : "secondary"} onClick={() => onBoard("season")}>
          Season
        </button>
      </div>
      <p className="hint">Computers play at the table. They are not on this board.</p>
      <p className="hint">
        {board === "rating" ? "Lifetime rating. It never resets." : `Season ${seasonId ?? ""} points. Ends ${prettyDate(ends)}.`}
      </p>
      <ol>
        {rows.length === 0 ? <li className="hint">No one is on the board yet.</li> : null}
        {rows.map((row, index) => (
          <li key={`${row.name}-${index}`}>
            <span className="board-place">{index + 1}</span>
            {row.avatarId ? <Portrait id={row.avatarId} size="chip" /> : null}
            <RankBadge tier={row.tierId} />
            <span className="board-name">
              {row.name}
              {row.bot ? <small className="bot-badge" data-bot-badge="true">BOT</small> : null}
              {row.guest ? <small> guest</small> : null}
            </span>
            <strong>{board === "rating" ? row.rating : row.seasonPoints.toLocaleString()}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function rankDemoRequested(): boolean {
  return new URLSearchParams(location.search).get("demo") === "rank";
}

export function RankDemo() {
  const shot = new URLSearchParams(location.search).get("shot") ?? "profile";
  if (shot === "table") return <DemoTable />;
  if (shot === "popup") return <DemoPopup />;
  return <DemoProfile />;
}

const SAMPLE_PROFILE: RankFacts = {
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
  tierStep: "II",
  nextAt: 1567,
  stepFloor: 1334,
  peakTierId: "hustler",
  peakTierName: "Hustler",
  peakStep: "II",
};

function DemoProfile() {
  return (
    <main className="rank-demo" data-skin="ivory" data-shot="profile">
      <header className="brand">
        <p className="eyebrow">Your profile</p>
        <h1>Bryan</h1>
      </header>
      <ProfileStats user={SAMPLE_PROFILE} />
    </main>
  );
}

function DemoTable() {
  const seats = [
    { name: "You", score: 95, tiles: 4, tier: "rookie", rating: 1212, provisional: true, you: true },
    { name: "Sam", score: 70, tiles: 3, tier: "hustler", rating: 1540, provisional: false, you: false },
    { name: "Ada", score: 40, tiles: 5, tier: "shark", rating: 2210, provisional: false, you: false },
    { name: "Jo", score: 20, tiles: 6, tier: "legend", rating: 6120, provisional: false, you: false },
  ];
  return (
    <main className="rank-demo felt-app" data-skin="ivory" data-shot="table">
      <header className="playbar">
        <p className="series-line">Bo3 · G1 · H4 · to 150</p>
        <span className="profile-chip compact">
          <span className="avatar">B</span>
          <RankLine tierId="rookie" rating={1212} provisional compact />
        </span>
      </header>
      <div className="demo-felt">
        {seats.map((seat) => (
          <div key={seat.name} className={`seat-chip${seat.you ? " you turn" : ""}`} data-player-id={seat.name}>
            <span className="avatar">{seat.name.slice(0, 1)}</span>
            <span className="chip-text">
              <span className="chip-name">{seat.you ? "You" : seat.name}</span>
              <span className="chip-meta">
                <strong>{seat.score}</strong>
                <RankLine tierId={seat.tier} rating={seat.rating} provisional={seat.provisional} compact />
                {seat.you ? null : <span className="tile-label">{seat.tiles} tiles</span>}
              </span>
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}

function DemoPopup() {
  const recap: RankRecap = {
    gameNumber: 1,
    ranked: true,
    casual: false,
    format: "series",
    vsComputer: false,
    seasonEndsAt: "2026-12-14T06:00:00.000Z",
    players: [
      {
        playerId: "you",
        ranked: true,
        ratingBefore: 1212,
        ratingAfter: 1227,
        delta: 15,
        provisional: true,
        pointsEarned: 130,
        pointsBefore: 80,
        pointsAfter: 210,
        breakdown: {
          finish: 20,
          win: 50,
          second: 0,
          moments: 10,
          momentCount: 1,
          streak: 10,
          streakCount: 1,
          firstWin: 40,
          doubled: true,
          total: 130,
        },
        tierBeforeId: "rookie",
        tierBeforeName: "Rookie",
        tierBeforeStep: null,
        tierAfterId: "rookie",
        tierAfterName: "Rookie",
        tierAfterStep: null,
        steppedUp: false,
        stepFloor: 0,
        nextAt: 250,
      },
      {
        playerId: "sam",
        ranked: true,
        ratingBefore: 1488,
        ratingAfter: 1476,
        delta: -12,
        provisional: false,
        pointsEarned: 40,
        pointsBefore: 590,
        pointsAfter: 630,
        breakdown: {
          finish: 20,
          win: 0,
          second: 20,
          moments: 0,
          momentCount: 0,
          streak: 0,
          streakCount: 0,
          firstWin: 0,
          doubled: true,
          total: 40,
        },
        tierBeforeId: "shuffler",
        tierBeforeName: "Shuffler",
        tierBeforeStep: "I",
        tierAfterId: "clacker",
        tierAfterName: "Clacker",
        tierAfterStep: "III",
        steppedUp: true,
        stepFloor: 600,
        nextAt: 767,
      },
    ],
  };
  return (
    <main className="rank-demo" data-skin="ivory" data-shot="popup">
      <section className="hand-summary demo-summary" data-screen="game">
        <p className="result-kicker">Game over</p>
        <h2>You won the hand</h2>
        <p>You reach 155 and win the game.</p>
        <RankRecapView recap={recap} names={new Map([["you", "You"], ["sam", "Sam"]])} />
      </section>
    </main>
  );
}

const BADGE_IDS = new Set(["rookie", "shuffler", "clacker", "hustler", "shark", "boss", "big-shot", "legend"]);

function badgeShape(id: string) {
  if (id === "shuffler") {
    return (
      <>
        <rect x="4" y="7" width="10" height="18" rx="2" className="badge-paper" />
        <rect x="16" y="7" width="10" height="18" rx="2" className="badge-gold" />
      </>
    );
  }
  if (id === "clacker") {
    return (
      <>
        <rect x="9" y="3" width="14" height="26" rx="2" className="badge-paper" />
        <rect x="9" y="15" width="14" height="2" className="badge-red" />
        <circle cx="16" cy="9" r="1.6" className="badge-ink" />
        <circle cx="16" cy="23" r="1.6" className="badge-ink" />
      </>
    );
  }
  if (id === "hustler") {
    return <polygon points="16,3 29,16 16,29 3,16" className="badge-gold" />;
  }
  if (id === "shark") {
    return <polygon points="4,26 28,26 16,4" className="badge-red" />;
  }
  if (id === "boss") {
    return <polygon points="4,24 4,14 10,18 16,6 22,18 28,14 28,24" className="badge-gold" />;
  }
  if (id === "big-shot") {
    return <polygon points="16,2 20,12 30,12 22,19 25,30 16,23 7,30 10,19 2,12 12,12" className="badge-red" />;
  }
  if (id === "legend") {
    return (
      <>
        <circle cx="16" cy="16" r="13" className="badge-gold" />
        <circle cx="16" cy="16" r="8" className="badge-red" />
        <circle cx="16" cy="16" r="3" className="badge-paper" />
      </>
    );
  }
  return (
    <>
      <circle cx="16" cy="16" r="12" className="badge-ink" />
      <circle cx="16" cy="16" r="3" className="badge-gold" />
    </>
  );
}

function tierLabel(id: string): string {
  const names: Record<string, string> = {
    rookie: "Rookie",
    shuffler: "Shuffler",
    clacker: "Clacker",
    hustler: "Hustler",
    shark: "Shark",
    boss: "Boss",
    "big-shot": "Big Shot",
    legend: "UH-OH Legend",
  };
  return names[id] ?? "Rookie";
}

function signed(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function breakdownLines(breakdown: RankRecap["players"][number]["breakdown"]): Array<{ label: string; amount: number }> {
  const lines: Array<{ label: string; amount: number }> = [{ label: "Finished the game", amount: breakdown.finish }];
  if (breakdown.win) lines.push({ label: "Win", amount: breakdown.win });
  if (breakdown.second) lines.push({ label: "Second place", amount: breakdown.second });
  if (breakdown.moments) lines.push({ label: `UH-OH × ${breakdown.momentCount}`, amount: breakdown.moments });
  if (breakdown.streak) lines.push({ label: `Win streak (${breakdown.streakCount})`, amount: breakdown.streak });
  if (breakdown.firstWin) lines.push({ label: "First win today", amount: breakdown.firstWin });
  return lines.filter((line) => line.amount > 0);
}

function prettyDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "soon";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(date);
}
