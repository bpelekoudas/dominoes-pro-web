import { useEffect, useState } from "react";
import { playUiClick, unlockSound } from "./sound";

const OFFER_KEY = "uhoh.login-offer";

interface LoginDay {
  day: number;
  bones: number;
  claimed: boolean;
  today: boolean;
  big: boolean;
}

interface DailyChallenge {
  id: string;
  tier: "easy" | "medium" | "hard";
  title: string;
  detail: string;
  bones: number;
  progress: number;
  goal: number;
  done: boolean;
}

interface DailyStatus {
  today: string;
  bones: number;
  awarded: number;
  already: boolean;
  login: {
    claimed: boolean;
    ladderDay: number;
    streakTotal: number;
    bones: number;
    days: LoginDay[];
  };
  challenges: DailyChallenge[];
  done: number;
}

function press(action: () => void): () => void {
  return () => {
    unlockSound();
    playUiClick();
    action();
  };
}

function offerSeen(today: string): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) === today;
  } catch {
    return true;
  }
}

function rememberOffer(today: string): void {
  try {
    localStorage.setItem(OFFER_KEY, today);
  } catch {
    // A private browser can still claim from the tile.
  }
}

export function DailyHome({ userId }: { userId: string | null }) {
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [sheet, setSheet] = useState<"login" | "challenge" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerHidden, setOfferHidden] = useState(false);

  useEffect(() => {
    if (!userId) {
      setStatus(null);
      return;
    }
    let stopped = false;
    void fetch("/api/daily", { credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: DailyStatus | null) => {
        if (!stopped && body?.login) setStatus(body);
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
    };
  }, [userId]);

  const done = status?.done ?? 0;
  const ladder = status?.login.ladderDay ?? 1;
  const claimed = status?.login.claimed ?? false;
  const showOffer = Boolean(status && !claimed && !offerHidden && !offerSeen(status.today));

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/daily/claim", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => null)) as (DailyStatus & { error?: string }) | null;
      if (!response.ok || !body?.login) {
        setError(body?.error ?? "That claim did not go through.");
        return;
      }
      setStatus(body);
      rememberOffer(body.today);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {showOffer && status ? (
        <div className="daily-offer">
          <button type="button" className="text-button" data-action="daily-offer" onClick={press(() => setSheet("login"))}>
            Daily login is ready
          </button>
          <button
            type="button"
            className="text-button"
            data-action="dismiss-login"
            onClick={press(() => {
              rememberOffer(status.today);
              setOfferHidden(true);
            })}
          >
            Not now
          </button>
        </div>
      ) : null}
      <div className="daily-row">
        <button type="button" className="daily-tile" data-action="daily-login" onClick={press(() => setSheet("login"))}>
          <small>Daily login</small>
          <strong>Day {ladder} of 7</strong>
          {status && status.login.streakTotal > 0 ? <em>Streak {status.login.streakTotal}</em> : null}
          {status && !claimed ? <i className="daily-dot" aria-label="Reward ready" /> : null}
        </button>
        <button type="button" className="daily-tile" data-action="daily-challenge" onClick={press(() => setSheet("challenge"))}>
          <small>Challenges</small>
          <strong>Daily {done}/3</strong>
        </button>
      </div>

      {sheet === "login" ? (
        <section className="arcade-modal" role="dialog" aria-label="Daily login" data-screen="daily-login">
          <h2>Daily login</h2>
          {status ? (
            <>
              <p className="hint">
                Day {status.login.ladderDay} of 7
                {status.login.streakTotal > 0 ? ` · Streak ${status.login.streakTotal}` : ""}
                {` · ${status.bones.toLocaleString()} Bones`}
              </p>
              <ol className="daily-days">
                {status.login.days.map((day) => (
                  <li key={day.day} className={`${day.today ? "today" : ""}${day.claimed ? " claimed" : ""}${day.big ? " big" : ""}`}>
                    <b>{day.day}</b>
                    <span>{day.bones}</span>
                    {day.big ? <em>Big</em> : day.claimed ? <em>Done</em> : <em>{day.today ? "Today" : ""}</em>}
                  </li>
                ))}
              </ol>
              <button type="button" className="capsule" data-action="claim-login" disabled={busy || status.login.claimed} onClick={press(() => void claim())}>
                {status.login.claimed ? "Claimed" : busy ? "Claiming…" : `Claim ${status.login.bones} Bones`}
              </button>
            </>
          ) : (
            <p>Sit down once and the streak starts for this guest or this account. It never blocks a game.</p>
          )}
          {error ? <p className="banner error">{error}</p> : null}
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
        </section>
      ) : null}

      {sheet === "challenge" ? (
        <section className="arcade-modal" role="dialog" aria-label="Daily challenges" data-screen="daily-challenge">
          <h2>Daily {done}/3</h2>
          <p className="hint">Three challenges. 25, 35, and 40 Bones. 100 if you finish all three.</p>
          {status ? (
            <ul className="daily-list">
              {status.challenges.map((item) => (
                <li key={item.id} data-tier={item.tier} data-done={item.done ? "true" : "false"}>
                  <p>
                    <strong>{item.title}</strong>
                    <span>{item.bones} Bones</span>
                  </p>
                  <p className="hint">{item.detail}</p>
                  <p>{item.done ? "Done" : `${item.progress} of ${item.goal}`}</p>
                  {item.goal > 1 ? (
                    <div className="daily-progress" aria-hidden="true">
                      <span style={{ width: `${Math.round((item.progress / item.goal) * 100)}%` }} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>The three challenges show up after you sit down. Games against the computer count.</p>
          )}
          <button type="button" className="capsule capsule-back" onClick={press(() => setSheet(null))}>
            Back
          </button>
        </section>
      ) : null}
    </>
  );
}
