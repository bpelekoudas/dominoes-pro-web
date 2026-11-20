import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { afterDailyClaim, nextDailyHistory } from "./daily-sheet";
import { dailyChallengeMark, dailyLoginMark } from "./home-model";
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

export function DailyHome({
  userId,
  variant = "row",
  onBones,
}: {
  userId: string | null;
  variant?: "row" | "icons";
  onBones?: (bones: number) => void;
}) {
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [sheet, setSheet] = useState<"login" | "challenge" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerHidden, setOfferHidden] = useState(false);
  const historyState = useRef({ open: false, pushed: false });

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

  useEffect(() => {
    const onPop = () => {
      const next = nextDailyHistory(historyState.current, "hardware");
      historyState.current = { open: next.open, pushed: next.pushed };
      setSheet(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openSheet = (nextSheet: "login" | "challenge") => {
    const next = nextDailyHistory(historyState.current, "open");
    if (!historyState.current.pushed) history.pushState({ uhohDaily: nextSheet }, "");
    historyState.current = { open: next.open, pushed: next.pushed };
    setError(null);
    setSheet(nextSheet);
  };

  const closeSheet = (event: "back" | "close" | "outside" | "claimed") => {
    const next = nextDailyHistory(historyState.current, event);
    historyState.current = { open: next.open, pushed: next.pushed };
    setSheet(null);
    if (next.goBack) history.back();
  };

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
      if (Number.isFinite(body.bones)) onBones?.(body.bones);
      if (afterDailyClaim({ ok: true, already: body.already }) === "home") closeSheet("claimed");
    } finally {
      setBusy(false);
    }
  };

  const loginLabel = dailyLoginMark(status ? ladder : null);
  const challengeLabel = dailyChallengeMark(status ? done : null);

  return (
    <>
      {variant === "icons" ? (
        <div className="ph-dailies">
          <button type="button" className="ph-side-btn" data-action="daily-login" onClick={press(() => openSheet("login"))}>
            <span className="ph-side-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="9" width="18" height="11" rx="2" />
                <path d="M3 13h18M12 9v11M7 9c-2-4 3-5 5 0M17 9c2-4-3-5-5 0" />
              </svg>
            </span>
            <span className="ph-side-label">{loginLabel}</span>
            {status && !claimed ? <i className="daily-dot" aria-label="Reward ready" /> : null}
          </button>
          <button type="button" className="ph-side-btn" data-action="daily-challenge" onClick={press(() => openSheet("challenge"))}>
            <span className="ph-side-icon ph-side-icon-red" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="4" y="3" width="10" height="18" rx="2" />
                <path d="M4 12h10" />
                <circle cx="9" cy="7.5" r="0.8" fill="currentColor" />
                <circle cx="9" cy="16.5" r="0.8" fill="currentColor" />
              </svg>
            </span>
            <span className="ph-side-label">{challengeLabel}</span>
          </button>
        </div>
      ) : (
        <>
      {showOffer && status ? (
        <div className="daily-offer">
          <button type="button" className="text-button" data-action="daily-offer" onClick={press(() => openSheet("login"))}>
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
        <button type="button" className="daily-tile" data-action="daily-login" onClick={press(() => openSheet("login"))}>
          <small>Daily login</small>
          <strong>Day {ladder} of 7</strong>
          {status && status.login.streakTotal > 0 ? <em>Streak {status.login.streakTotal}</em> : null}
          {status && !claimed ? <i className="daily-dot" aria-label="Reward ready" /> : null}
        </button>
        <button type="button" className="daily-tile" data-action="daily-challenge" onClick={press(() => openSheet("challenge"))}>
          <small>Challenges</small>
          <strong>Daily {done}/3</strong>
        </button>
      </div>
        </>
      )}

      {sheet
        ? createPortal(
            <div
              className="daily-sheet"
              data-screen={sheet === "login" ? "daily-login" : "daily-challenge"}
              onClick={press(() => closeSheet("outside"))}
            >
              <section
                className="daily-card"
                role="dialog"
                aria-modal="true"
                aria-label={sheet === "login" ? "Daily login" : "Daily challenges"}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="daily-card-bar">
                  <h2>{sheet === "login" ? "Daily login" : `Daily ${done}/3`}</h2>
                  <button type="button" className="daily-x" data-action="close-daily" aria-label="Close" onClick={press(() => closeSheet("close"))}>
                    ×
                  </button>
                </div>
                {sheet === "login" ? (
                  status ? (
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
                  )
                ) : (
                  <>
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
                  </>
                )}
                {error ? <p className="banner error">{error}</p> : null}
                <button type="button" className="capsule capsule-back" data-action="daily-back" onClick={press(() => closeSheet("back"))}>
                  Back
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
