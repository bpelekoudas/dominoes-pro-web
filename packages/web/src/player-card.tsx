import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Portrait } from "./avatars";
import { nextDailyHistory } from "./daily-sheet";
import { RankBadge } from "./rank";
import { cardForSeat, type SeatCard } from "./player-card-model";
import { playUiClick, unlockSound } from "./sound";

const OPEN_EVENT = "uhoh-player-card";
const OWN_EVENT = "uhoh-own-profile";

type OpenCard = Exclude<SeatCard, { kind: "self" }>;

interface AccountCard {
  kind: "account";
  name: string;
  avatarId: string;
  guest: boolean;
  rating: number;
  provisional: boolean;
  tierId: string;
  tierName: string;
  tierStep: "III" | "II" | "I" | null;
  rankedWins: number;
  rankedLosses: number;
  gamesPlayed: number;
  vsComputerWins: number;
  vsComputerLosses: number;
  vsComputerGames: number;
  playAccuracy: number | null;
  seasonPoints: number;
  peakTierName: string;
  peakStep: "III" | "II" | "I" | null;
  winStreak: number;
}

export function requestSeatCard(player: Parameters<typeof cardForSeat>[0]): void {
  const card = cardForSeat(player);
  if (card.kind === "self") {
    window.dispatchEvent(new CustomEvent(OWN_EVENT));
    return;
  }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: card }));
}

function press(action: () => void): () => void {
  return () => {
    unlockSound();
    playUiClick();
    action();
  };
}

export function PlayerCardLayer() {
  const [card, setCard] = useState<OpenCard | null>(null);
  const [account, setAccount] = useState<AccountCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const historyState = useRef({ open: false, pushed: false });

  const close = (event: "back" | "close" | "outside") => {
    const next = nextDailyHistory(historyState.current, event);
    historyState.current = { open: next.open, pushed: next.pushed };
    setCard(null);
    setAccount(null);
    setError(null);
    if (next.goBack) history.back();
  };

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenCard>).detail;
      if (!detail || (detail.kind !== "account" && detail.kind !== "computer" && detail.kind !== "guest")) return;
      const next = nextDailyHistory(historyState.current, "open");
      if (!historyState.current.pushed) history.pushState({ uhohCard: true }, "");
      historyState.current = { open: next.open, pushed: next.pushed };
      setAccount(null);
      setError(null);
      setCard(detail);
    };
    const onPop = () => {
      const next = nextDailyHistory(historyState.current, "hardware");
      historyState.current = { open: next.open, pushed: next.pushed };
      setCard(null);
      setAccount(null);
      setError(null);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    if (card?.kind !== "account") return;
    let stopped = false;
    const userId = card.userId;
    void fetch(`/api/card/${encodeURIComponent(userId)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { card?: AccountCard; error?: string } | null;
        if (stopped) return;
        if (!response.ok || !body?.card || body.card.kind !== "account") {
          setError(body?.error ?? "That card did not load.");
          return;
        }
        setAccount(body.card);
      })
      .catch(() => {
        if (!stopped) setError("That card did not load.");
      });
    return () => {
      stopped = true;
    };
  }, [card]);

  if (!card) return null;
  const shown = card.kind === "account" ? account : null;
  return createPortal(
    <div className="player-card-sheet" data-screen="player-card" data-card={card.kind} onClick={press(() => close("outside"))}>
      <section
        className="player-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${card.name}'s card`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="player-card-bar">
          <h2>{card.name}</h2>
          <button type="button" className="daily-x" data-action="close-player" aria-label="Close" onClick={press(() => close("close"))}>
            ×
          </button>
        </div>
        <div className="player-card-face">
          <Portrait id={shown?.avatarId ?? card.avatarId} size="chip" />
          <div>
          {card.kind === "computer" ? (
            <p className="player-card-skill">
              CPU {card.skill} <strong>{card.rating}</strong>
            </p>
          ) : null}
          {card.kind === "guest" ? <p className="hint">No account yet. Just a name at the table.</p> : null}
          {card.kind === "account" && !shown && !error ? <p className="hint">Loading…</p> : null}
          </div>
        </div>
          {shown ? (
            <div className="player-card-stats">
              <p className="player-card-tier">
                <RankBadge tier={shown.tierId} />
                <span>
                  {shown.tierName}
                  {shown.tierStep ? ` ${shown.tierStep}` : ""}
                </span>
                <strong>
                  {shown.rating}
                  {shown.provisional ? <small> provisional</small> : null}
                </strong>
              </p>
              <dl>
                <div>
                  <dt>Ranked</dt>
                  <dd>
                    {shown.rankedWins}–{shown.rankedLosses}
                  </dd>
                </div>
                <div>
                  <dt>Games played</dt>
                  <dd>{shown.gamesPlayed}</dd>
                </div>
                <div>
                  <dt>Vs computer</dt>
                  <dd>
                    {shown.vsComputerWins}–{shown.vsComputerLosses}
                    <small> of {shown.vsComputerGames}</small>
                  </dd>
                </div>
                <div>
                  <dt>Play accuracy</dt>
                  <dd>{shown.playAccuracy == null ? "—" : `${shown.playAccuracy}%`}</dd>
                </div>
                <div>
                  <dt>Season</dt>
                  <dd>{shown.seasonPoints.toLocaleString()} pts</dd>
                </div>
                <div>
                  <dt>Peak</dt>
                  <dd>
                    {shown.peakTierName}
                    {shown.peakStep ? ` ${shown.peakStep}` : ""}
                    {shown.winStreak > 0 ? ` · streak ${shown.winStreak}` : ""}
                  </dd>
                </div>
              </dl>
              {shown.guest ? <p className="hint">Guest account on this phone.</p> : null}
            </div>
          ) : null}
          {error ? <p className="banner error">{error}</p> : null}
        <button type="button" className="capsule capsule-back" data-action="player-back" onClick={press(() => close("back"))}>
          Back
        </button>
      </section>
    </div>,
    document.body,
  );
}
