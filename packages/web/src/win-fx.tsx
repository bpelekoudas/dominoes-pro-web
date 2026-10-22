import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayerView } from "@uhoh/rules";
import { isAvatarId } from "../../rules/src/avatars.js";
import { scoreDomino } from "../../rules/src/score.js";
import { Portrait, AvatarFace } from "./avatars";
import { MatchLineup } from "./lineup";
import { prefersReducedMotion } from "./moment";
import { seatAround } from "./seats";
import { playWinSting } from "./sound";
import { matchLineSeed, winLineFor } from "./win-lines";
import { Domino } from "./table";
import { FeelCall, FeelTally } from "./feel/overlay";
import { pulse as feelPulse } from "./feel/haptics";
import { playFeel } from "./feel/synth";
import {
  GAME_BANNER_MS,
  MATCH_BANNER_MS,
  bannerMotion,
  callMs,
  confettiAt,
  easeInOut,
  lastLandMs,
  matchImpact,
  pipPosition,
  planWinPips,
  revealOrigin,
  scoreAt,
  uhOhWaitMs,
  winBannerCopy,
  type Point,
  type WinPlan,
} from "./win-plan";

type BannerKindName = "game" | "match";

export interface WinBanner {
  kind: BannerKindName;
  winnerId: string;
  text: string;
  avatarId: string;
}

export interface RevealSeat {
  playerId: string;
  edge: "left" | "top" | "right" | "bottom";
  tiles: Array<{ id: string; low: number; high: number }>;
}

export interface WinScoreState {
  shown: Record<string, number>;
  pulse: Record<string, boolean>;
  hot: Record<string, boolean>;
}

type Stage = "idle" | "wait" | "call" | "pips" | "banner" | "lineup" | "done";
type FreezeStage = "pips" | "banner" | "lineup";

export interface HandCelebration {
  active: boolean;
  sheet: boolean;
  stage: Stage;
  plan: WinPlan | null;
  banner: WinBanner | null;
  reveals: RevealSeat[];
  reduced: boolean;
  scores: WinScoreState | null;
  frozenAt: number | null;
  skip: () => void;
  onLand: (id: string, winnerId: string, value: number) => void;
  call: "domino" | "lock" | null;
}

export const WinScoreContext = createContext<WinScoreState | null>(null);

export function useWinScore(playerId: string, score: number): { score: number; pulse: boolean; hot: boolean } {
  const live = useContext(WinScoreContext);
  if (!live || !Object.prototype.hasOwnProperty.call(live.shown, playerId)) {
    return { score, pulse: false, hot: false };
  }
  return {
    score: live.shown[playerId] ?? score,
    pulse: live.pulse[playerId] === true,
    hot: live.hot[playerId] === true,
  };
}

const stung = new Set<string>();

function playWinStingOnce(key: string, kind: "hand" | "game" | "match" | "lineup"): void {
  if (stung.has(key)) return;
  stung.add(key);
  playWinSting(kind);
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, "");
}

function baseScores(view: PlayerView): Record<string, number> {
  const awards = view.lastHand?.leftoverAwards ?? {};
  const shown: Record<string, number> = {};
  for (const player of view.players) {
    const award = Math.max(0, awards[player.id] ?? 0);
    shown[player.id] = player.score - award;
  }
  return shown;
}

function finalScores(base: Record<string, number>, plan: WinPlan | null): Record<string, number> {
  const shown = { ...base };
  if (!plan) return shown;
  for (const [id, award] of Object.entries(plan.awards)) {
    if (award > 0) shown[id] = (base[id] ?? 0) + award;
  }
  return shown;
}

function bannerFrom(view: PlayerView): WinBanner | null {
  const hand = view.lastHand;
  if (!hand) return null;
  const kind: BannerKindName | null = hand.seriesWinnerId ? "match" : hand.gameWinnerId ? "game" : null;
  if (!kind) return null;
  const winnerId = (kind === "match" ? hand.seriesWinnerId : hand.gameWinnerId) ?? "";
  const player = view.players.find((seat) => seat.id === winnerId);
  return {
    kind,
    winnerId,
    text: winBannerCopy(kind, player?.name ?? "Someone", winnerId === view.yourId),
    avatarId: player?.avatarId || "homescreen",
  };
}

function revealList(view: PlayerView): RevealSeat[] {
  const hand = view.lastHand;
  if (!hand) return [];
  const edges = new Map(seatAround(view.players).map((seat) => [seat.player.id, seat.edge]));
  return hand.remaining
    .filter((seat) => seat.playerId !== view.yourId && seat.tiles.length > 0)
    .sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
    .map((seat) => ({
      playerId: seat.playerId,
      edge: edges.get(seat.playerId) ?? "top",
      tiles: seat.tiles.map((tile) => ({ id: tile.id, low: tile.low, high: tile.high })),
    }));
}

function handKeyOf(view: PlayerView): string {
  const hand = view.lastHand;
  if (!hand) return "";
  return `${view.roomCode}:${hand.gameNumber}:${hand.handNumber}:${hand.reason}`;
}

export function useHandCelebration(
  view: PlayerView,
  freeze: { at: number; stage: FreezeStage } | null = null,
): HandCelebration {
  const active = Boolean(
    view.lastHand && (view.betweenHands || view.phase === "over" || view.phase === "between") && !view.ended,
  );
  const key = active ? handKeyOf(view) : "";
  const plan = useMemo(
    () => (key && view.lastHand ? planWinPips(view.lastHand.leftoverAwards, view.lastHand.remaining) : null),
    [key],
  );
  const banner = useMemo(() => (key ? bannerFrom(view) : null), [key]);
  const reveals = useMemo(() => (key ? revealList(view) : []), [key]);
  const reduced = prefersReducedMotion();
  const base = useMemo(() => baseScores(view), [key]);
  const final = useMemo(() => finalScores(base, plan), [base, plan]);
  const waitMs = active && view.lastHand ? uhOhWaitMs(view.lastHand.reason, view.lastPlay?.awarded ?? null, reduced) : 0;
  const spokenMs = active && view.lastHand ? callMs(view.lastHand.reason, view.lastPlay?.awarded ?? null, reduced) : 0;

  const [tracked, setTracked] = useState(key);
  const [stage, setStage] = useState<Stage>("idle");
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState<Record<string, number>>(base);
  const [pulse, setPulse] = useState<Record<string, boolean>>({});
  const landed = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const viewRef = useRef(view);
  const planRef = useRef(plan);
  const bannerRef = useRef(banner);
  const baseRef = useRef(base);
  const finalRef = useRef(final);
  const keyRef = useRef(key);
  const startPipsRef = useRef<() => void>(() => {});
  viewRef.current = view;
  planRef.current = plan;
  bannerRef.current = banner;
  baseRef.current = base;
  finalRef.current = final;
  keyRef.current = key;

  if (tracked !== key) {
    setTracked(key);
    setStage("idle");
    setSheet(false);
    setShown(base);
    setPulse({});
    landed.current = new Set();
  }

  const clearTimers = () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
  };

  useEffect(() => {
    clearTimers();
    landed.current = new Set();
    const planNow = planRef.current;
    const handNow = viewRef.current.lastHand;
    if (!active || !planNow || !handNow || freeze) return;
    const reducedNow = prefersReducedMotion();
    const wait = uhOhWaitMs(handNow.reason, viewRef.current.lastPlay?.awarded ?? null, reducedNow);
    const keyNow = keyRef.current;

    const goSheet = () => {
      setShown(finalRef.current);
      setPulse({});
      setStage("done");
      setSheet(true);
    };
    const goLineup = () => {
      setStage("lineup");
      playWinStingOnce(`${keyNow}:lineup`, "lineup");
    };
    const afterBanner = (kind: BannerKindName) => {
      if (kind === "match") goLineup();
      else goSheet();
    };
    const goBannerOrSheet = () => {
      const bannerNow = bannerRef.current;
      setShown(finalRef.current);
      setPulse({});
      if (!bannerNow) {
        goSheet();
        return;
      }
      setStage("banner");
      playWinStingOnce(`${keyNow}:banner`, bannerNow.kind === "match" ? "match" : "game");
      const ms = bannerNow.kind === "match" ? MATCH_BANNER_MS : GAME_BANNER_MS;
      timers.current.push(window.setTimeout(() => afterBanner(bannerNow.kind), ms));
    };
    const startPips = () => {
      setStage("pips");
      setShown(reducedNow ? finalRef.current : baseRef.current);
      if (Object.values(planNow.awards).some((value) => value > 0)) playWinStingOnce(`${keyNow}:hand`, "hand");
      if (!reducedNow && planNow.pips.length > 0) {
        timers.current.push(
          window.setTimeout(() => {
            for (const pip of planNow.pips) landed.current.add(pip.id);
            setShown(finalRef.current);
            const pulsing: Record<string, boolean> = {};
            for (const [id, value] of Object.entries(planNow.awards)) if (value > 0) pulsing[id] = true;
            setPulse(pulsing);
          }, Math.max(0, lastLandMs(planNow))),
        );
      }
      const land = lastLandMs(planNow);
      const bannerAt = land >= 0 ? land + 200 : planNow.holdMs;
      timers.current.push(window.setTimeout(goBannerOrSheet, bannerAt));
    };
    startPipsRef.current = startPips;

    const begin = () => {
      if (spokenMs > 0 && handNow.reason !== "score") {
        setStage("call");
        const lock = handNow.reason === "locked";
        playFeel(lock ? "lock" : "domino", reducedNow ? 0 : 150);
        feelPulse(lock ? [18, 40, 18, 50, 24] : [28, 36, 40]);
        // The word confirms the moment. The board reaction starts while it is still up.
        const boardAt = reducedNow ? 0 : Math.min(460, spokenMs);
        timers.current.push(window.setTimeout(startPips, boardAt));
        return;
      }
      startPips();
    };

    if (wait > 0) {
      setStage("wait");
      timers.current.push(window.setTimeout(begin, wait));
    } else {
      begin();
    }
    return clearTimers;
  }, [active, key, freeze]);

  const stageNow: Stage = !active || !plan ? "idle" : freeze ? freeze.stage : stage === "idle" ? (waitMs > 0 ? "wait" : spokenMs > 0 ? "call" : "pips") : stage;
  const visible = (() => {
    if (!plan) return base;
    if (freeze) return reduced || freeze.stage === "banner" || freeze.stage === "lineup" ? final : scoreAt(base, plan, freeze.at, false);
    if (reduced && active) return final;
    if (stage === "banner" || stage === "lineup" || stage === "done") return final;
    if (stage === "pips" && Object.keys(shown).length > 0) return shown;
    return base;
  })();
  const hot: Record<string, boolean> = {};
  if (active && plan && !sheet && stageNow !== "done") {
    for (const [id, award] of Object.entries(plan.awards)) if (award > 0) hot[id] = true;
  }
  const scores = active && !sheet && stageNow !== "idle" ? { shown: visible, pulse, hot } : null;
  const stageRef = useRef(stageNow);
  stageRef.current = stageNow;

  const skip = () => {
    if (freeze) return;
    const current = stageRef.current;
    if (current === "call") {
      clearTimers();
      startPipsRef.current();
      return;
    }
    if (current !== "pips" && current !== "banner" && current !== "lineup") return;
    clearTimers();
    setShown(finalRef.current);
    setPulse({});
    const bannerNow = bannerRef.current;
    if (current === "pips" && bannerNow) {
      setStage("banner");
      playWinStingOnce(`${keyRef.current}:banner`, bannerNow.kind === "match" ? "match" : "game");
      const ms = bannerNow.kind === "match" ? MATCH_BANNER_MS : GAME_BANNER_MS;
      timers.current.push(
        window.setTimeout(() => {
          if (bannerNow.kind === "match") {
            setStage("lineup");
            playWinStingOnce(`${keyRef.current}:lineup`, "lineup");
            return;
          }
          setStage("done");
          setSheet(true);
        }, ms),
      );
      return;
    }
    if (current === "banner" && bannerNow?.kind === "match") {
      setStage("lineup");
      playWinStingOnce(`${keyRef.current}:lineup`, "lineup");
      return;
    }
    setStage("done");
    setSheet(true);
  };

  const onLand = (id: string, winnerId: string, value: number) => {
    if (freeze || landed.current.has(id)) return;
    landed.current.add(id);
    setShown((prev) => {
      const running = prev[winnerId] ?? baseRef.current[winnerId] ?? 0;
      return { ...baseRef.current, ...prev, [winnerId]: running + value };
    });
  };

  return {
    active,
    sheet,
    stage: stageNow,
    plan,
    banner,
    reveals,
    reduced,
    scores,
    frozenAt: freeze ? freeze.at : null,
    skip,
    onLand,
    call: view.lastHand?.reason === "locked" ? "lock" : view.lastHand?.reason === "domino" ? "domino" : null,
  };
}

function boxCenter(node: Element): Point {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function WinShow({
  stage,
  plan,
  banner,
  reveals,
  yourId,
  reduced,
  frozenAt,
  onSkip,
  onLand,
}: {
  stage: Stage;
  plan: WinPlan;
  banner: WinBanner | null;
  reveals: RevealSeat[];
  yourId: string;
  reduced: boolean;
  frozenAt: number | null;
  onSkip: () => void;
  onLand: (id: string, winnerId: string, value: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const shockRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const pipNodes = useRef(new Map<string, HTMLElement>());
  const bitNodes = useRef(new Map<number, HTMLElement>());
  const painted = useRef("");
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;
  const revealsRef = useRef(reveals);
  revealsRef.current = reveals;
  const planRef = useRef(plan);
  planRef.current = plan;
  const bannerRef = useRef(banner);
  bannerRef.current = banner;

  const place = () => {
    const root = rootRef.current;
    if (!root) return;
    for (const seat of revealsRef.current) {
      const node = root.querySelector(`[data-win-reveal="${cssEscape(seat.playerId)}"]`) as HTMLElement | null;
      const rail = document.querySelector(`.rail[data-player-id="${cssEscape(seat.playerId)}"]`);
      if (!node || !rail) continue;
      const railBox = rail.getBoundingClientRect();
      const row = { width: node.offsetWidth || 32, height: node.offsetHeight || 64 };
      const spot = revealOrigin(
        seat.edge,
        {
          left: railBox.left,
          top: railBox.top,
          right: railBox.right,
          bottom: railBox.bottom,
          width: railBox.width,
          height: railBox.height,
        },
        row,
        { width: window.innerWidth, height: window.innerHeight },
      );
      node.style.left = `${spot.left}px`;
      node.style.top = `${spot.top}px`;
    }
  };

  const boardCenter = (): Point => {
    const board = document.querySelector("[data-win-board]");
    const rect = board?.getBoundingClientRect();
    if (rect && rect.width > 8 && rect.height > 8) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  };

  const paintPips = (elapsed: number) => {
    let flying = 0;
    for (const pip of planRef.current.pips) {
      const node = pipNodes.current.get(pip.id);
      if (!node) continue;
      const local = elapsed - pip.startMs;
      if (local < 0 || local > pip.flightMs) {
        node.style.opacity = "0";
        continue;
      }
      const tile = document.querySelector(`[data-win-tile="${cssEscape(`${pip.sourcePlayerId}:${pip.sourceTileId}`)}"]`);
      const hand =
        pip.sourcePlayerId === yourId
          ? document.querySelector(`.hand-tile[data-tile-id="${cssEscape(pip.sourceTileId)}"]`)
          : null;
      const source = tile ?? hand ?? document.querySelector(`[data-win-score="${cssEscape(pip.sourcePlayerId)}"]`);
      const target = document.querySelector(`[data-win-score="${cssEscape(pip.winnerId)}"]`);
      if (!source || !target) {
        node.style.opacity = "0";
        continue;
      }
      const eased = pipPosition(easeInOut(local / pip.flightMs), boxCenter(source), boxCenter(target), pip.bend);
      node.style.opacity = "1";
      node.style.transform = `translate(${eased.x}px, ${eased.y}px) translate(-50%, -50%)`;
      flying += 1;
      if (local >= pip.flightMs - 20) onLandRef.current(pip.id, pip.winnerId, pip.value);
    }
    if (rootRef.current) rootRef.current.dataset.winFlying = String(flying);
  };

  const paintBanner = (elapsed: number) => {
    const bannerNow = bannerRef.current;
    if (!bannerNow) return;
    const center = boardCenter();
    const motion = bannerMotion(bannerNow.kind, elapsed, reduced);
    const pop = popRef.current;
    if (pop) {
      pop.style.left = `${center.x}px`;
      pop.style.top = `${center.y}px`;
      pop.style.transform = `translate(-50%, -50%) scale(${motion.scale})`;
      pop.style.opacity = String(motion.opacity);
      pop.dataset.winScale = motion.scale.toFixed(3);
    }
    const impact = bannerNow.kind === "match" ? matchImpact(elapsed, reduced) : { flash: 0, shock: 1, shockOpacity: 0 };
    if (flashRef.current) flashRef.current.style.opacity = String(impact.flash);
    if (shockRef.current) {
      shockRef.current.style.left = `${center.x}px`;
      shockRef.current.style.top = `${center.y}px`;
      shockRef.current.style.opacity = String(impact.shockOpacity);
      shockRef.current.style.transform = `translate(-50%, -50%) scale(${impact.shock})`;
    }
    if (confettiRef.current) {
      confettiRef.current.style.left = `${center.x}px`;
      confettiRef.current.style.top = `${center.y}px`;
    }
    const bits = confettiAt(bannerNow.kind, elapsed, reduced);
    const byId = new Map(bits.map((bit) => [bit.id, bit]));
    for (const [index, node] of bitNodes.current) {
      const bit = byId.get(index);
      if (!bit) {
        node.style.opacity = "0";
        continue;
      }
      node.style.opacity = String(bit.opacity);
      node.style.width = `${bit.size}px`;
      node.style.height = `${bit.round ? bit.size : Math.max(4, bit.size * 0.55)}px`;
      node.style.background = bit.color;
      node.style.borderRadius = bit.round ? "50%" : "2px";
      node.style.transform = `translate(${bit.x}px, ${bit.y}px) rotate(${bit.rot}deg)`;
    }
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    pipNodes.current.clear();
    for (const node of root.querySelectorAll<HTMLElement>("[data-win-pip]")) {
      if (node.dataset.winPip) pipNodes.current.set(node.dataset.winPip, node);
    }
    bitNodes.current.clear();
    for (const node of root.querySelectorAll<HTMLElement>("[data-bit]")) {
      bitNodes.current.set(Number(node.dataset.bit), node);
    }
    place();
    const token = `${stage}:${frozenAt ?? "live"}:${reduced ? 1 : 0}`;
    if (frozenAt != null) {
      if (stage === "pips" && !reduced) paintPips(frozenAt);
      if (stage === "banner") paintBanner(frozenAt);
      painted.current = token;
      return;
    }
    if (painted.current === token) return;
    painted.current = token;
    if (stage === "banner") paintBanner(0);
    if (stage === "pips" && !reduced) paintPips(0);
  });

  useEffect(() => {
    if (frozenAt != null || (stage !== "pips" && stage !== "banner")) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      place();
      if (stage === "pips" && !reduced) paintPips(elapsed);
      if (stage === "banner") paintBanner(elapsed);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stage, frozenAt, reduced]);

  const bitCount = banner?.kind === "match" ? 46 : 8;
  return (
    <div className="win-layer" data-win-stage={stage} data-win-kind={banner?.kind ?? ""} ref={rootRef}>
      {reveals.map((seat) => (
        <div key={seat.playerId} className="win-reveal" data-win-reveal={seat.playerId} data-edge={seat.edge}>
          <span className="win-faces">
            {seat.tiles.map((tile) => (
              <span key={tile.id} data-win-tile={`${seat.playerId}:${tile.id}`}>
                <Domino a={tile.low} b={tile.high} orientation="vertical" />
              </span>
            ))}
          </span>
          <em className="win-count" data-win-count={seat.tiles.reduce((sum, tile) => sum + tile.low + tile.high, 0)}>
            {seat.tiles.reduce((sum, tile) => sum + tile.low + tile.high, 0)}
          </em>
        </div>
      ))}
      {stage === "pips" && !reduced
        ? plan.pips.map((pip) => <i key={pip.id} className="win-pip" data-win-pip={pip.id} data-tone={pip.bend > 0 ? "red" : "gold"} />)
        : null}
      {stage === "banner" && banner ? (
        <>
          <div className="win-flash" ref={flashRef} />
          {banner.kind === "match" && !reduced ? <div className="win-shock" ref={shockRef} /> : null}
          {!reduced ? (
            <div className="win-confetti" ref={confettiRef}>
              {Array.from({ length: bitCount }, (_, index) => (
                <i key={index} className="win-bit" data-bit={index} />
              ))}
            </div>
          ) : null}
          <div className={`win-banner ${banner.kind}`} ref={popRef}>
            {banner.kind === "game" && !reduced ? (
              <div className="feel-topple" aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i /><i />
              </div>
            ) : null}
            <div className="win-banner-pop">
              {banner.kind === "match" ? (
                <span className="win-avatar">
                  <Portrait id={banner.avatarId} size="chip" />
                </span>
              ) : null}
              <p className="win-banner-title" role="status" data-win-text={banner.text}>
                {banner.text}
              </p>
            </div>
          </div>
        </>
      ) : null}
      {stage === "pips" || stage === "banner" ? (
        <button type="button" className="win-skip" aria-label="Skip" data-action="skip-win" onClick={onSkip} />
      ) : null}
    </div>
  );
}

export type WinPreviewMode = "pips" | "game" | "match" | "lineup";

export function winPreviewRequested(): WinPreviewMode | null {
  const win = new URLSearchParams(location.search).get("win");
  if (win === "pips" || win === "game" || win === "match" || win === "lineup") return win;
  return null;
}

function readFreeze(mode: WinPreviewMode): { at: number; stage: FreezeStage } | null {
  if (mode === "lineup") return { at: 0, stage: "lineup" };
  const raw = new URLSearchParams(location.search).get("t");
  if (raw == null || raw === "") return null;
  const at = Number(raw);
  if (!Number.isFinite(at)) return null;
  return { at, stage: mode === "pips" ? "pips" : "banner" };
}

function previewWinnerAvatar(): string {
  const raw = new URLSearchParams(location.search).get("winner");
  if (!raw || !isAvatarId(raw) || raw === "homescreen") return "2hot4tv";
  return raw;
}

const PREVIEW_TILES = [
  { id: "4-6", low: 4, high: 6 },
  { id: "2-3", low: 2, high: 3 },
  { id: "1-1", low: 1, high: 1 },
];

function loserAvatar(slot: number, winner: string): string {
  const prefs = ["surfer", "hipster", "golfer", "barista", "grungerocker"].filter((id) => id !== winner);
  return prefs[slot] ?? "biker";
}

function previewView(mode: WinPreviewMode): PlayerView {
  const match = mode === "match" || mode === "lineup";
  const winnerAvatar = previewWinnerAvatar();
  const seriesWinner = match ? "you" : null;
  const gameWinnerId = mode === "pips" ? null : mode === "game" ? "you" : "rio";
  const seat = (
    id: string,
    name: string,
    score: number,
    tiles: number,
    isYou: boolean,
    avatarId: string,
    index: number,
  ) => ({
    id,
    name,
    seat: index,
    connected: true,
    score,
    gamesWon: seriesWinner === id || (mode === "game" && id === "you") ? 2 : 0,
    tileCount: tiles,
    isYou,
    isTurn: false,
    bot: !isYou,
    accountBot: false,
    difficulty: isYou ? null : ("medium" as const),
    rank: null,
    avatarId,
    frameId: null,
    effectId: "glass",
    effectItemId: null,
    tileId: null,
    tileSkin: "ivory",
    tableId: "TBL-011",
  });
  if (!match) {
    const awards = scoreDomino({ you: 0, rio: 17 }, "you");
    const youTiles: typeof PREVIEW_TILES = [];
    const rioTiles = PREVIEW_TILES;
    return {
      roomCode: "WINFX",
      status: "playing",
      yourId: "you",
      hostId: "you",
      settings: { playerCount: 2, boneyardMode: "draw_until", seriesLength: 3, targetScore: 150, casual: true },
      players: [
        seat("you", "Alex", 55, youTiles.length, true, "homescreen", 0),
        seat("rio", "Rio", 20, rioTiles.length, false, "homescreen", 1),
      ],
      you: { hand: youTiles },
      board: null,
      openEnds: [],
      openTotal: 0,
      openEquation: null,
      boneyardCount: 0,
      turnPlayerId: null,
      phase: "between",
      turnDeadline: null,
      turnBudgetMs: 30_000,
      serverNow: Date.now(),
      betweenHands: true,
      continueDeadline: Date.now() + 9000,
      ended: null,
      prompt: "Hand over.",
      legalPlays: [],
      canDraw: false,
      canKnock: false,
      canStart: false,
      canRematch: false,
      openingTileId: null,
      gameNumber: 1,
      handNumber: 4,
      winsNeeded: 2,
      seriesWinnerId: null,
      lastHand: {
        summary: "Alex went out and took 15 from the table.",
        reason: "domino",
        gameWinnerId,
        seriesWinnerId: null,
        winnerIds: ["you"],
        nextLeaderId: "you",
        pipCounts: { you: 0, rio: 17 },
        leftoverAwards: awards,
        placements: [
          { playerId: "you", place: 1, pips: 0, tied: false },
          { playerId: "rio", place: 2, pips: 17, tied: false },
        ],
        remaining: [
          { playerId: "you", pips: 0, tiles: youTiles },
          { playerId: "rio", pips: 17, tiles: rioTiles },
        ],
        scoresAfter: { you: 55, rio: 20 },
        gameNumber: 1,
        handNumber: 4,
      },
      recap: null,
      quick: null,
      tableId: "TBL-011",
      lastPlay: { playerId: "you", tileId: "0-0", endId: "lead", total: 0, awarded: 0, seq: 1 },
      lastEvent: null,
      knockStreak: 0,
      lastDraw: null,
      taunts: [],
    };
  }
  const rioTiles = [{ id: "6-6", low: 6, high: 6 }];
  const samTiles = [{ id: "4-4", low: 4, high: 4 }];
  const jordanTiles = [{ id: "3-4", low: 3, high: 4 }];
  const pipCounts = { you: 0, rio: 12, sam: 8, jordan: 7 };
  const awards = scoreDomino(pipCounts, "you");
  const scores = { you: 160, rio: 40, sam: 55, jordan: 30 };
  return {
    roomCode: "WINFX",
    status: "complete",
    yourId: "you",
    hostId: "you",
    settings: { playerCount: 4, boneyardMode: "draw_until", seriesLength: 3, targetScore: 150, casual: true },
    players: [
      seat("you", "Alex", scores.you, 0, true, winnerAvatar, 0),
      seat("rio", "Rio", scores.rio, rioTiles.length, false, loserAvatar(0, winnerAvatar), 1),
      seat("sam", "Sam", scores.sam, samTiles.length, false, loserAvatar(1, winnerAvatar), 2),
      seat("jordan", "Jordan", scores.jordan, jordanTiles.length, false, loserAvatar(2, winnerAvatar), 3),
    ],
    you: { hand: [] },
    board: null,
    openEnds: [],
    openTotal: 0,
    openEquation: null,
    boneyardCount: 0,
    turnPlayerId: null,
    phase: "over",
    turnDeadline: null,
    turnBudgetMs: 30_000,
    serverNow: Date.now(),
    betweenHands: false,
    continueDeadline: null,
    ended: null,
    prompt: "Series over.",
    legalPlays: [],
    canDraw: false,
    canKnock: false,
    canStart: false,
    canRematch: true,
    openingTileId: null,
    gameNumber: 1,
    handNumber: 4,
    winsNeeded: 2,
    seriesWinnerId: "you",
    lastHand: {
      summary: "Alex went out and took the match.",
      reason: "domino",
      gameWinnerId: "you",
      seriesWinnerId: "you",
      winnerIds: ["you"],
      nextLeaderId: "you",
      pipCounts,
      leftoverAwards: awards,
      placements: [
        { playerId: "you", place: 1, pips: 0, tied: false },
        { playerId: "jordan", place: 2, pips: 7, tied: false },
        { playerId: "sam", place: 3, pips: 8, tied: false },
        { playerId: "rio", place: 4, pips: 12, tied: false },
      ],
      remaining: [
        { playerId: "you", pips: 0, tiles: [] },
        { playerId: "rio", pips: 12, tiles: rioTiles },
        { playerId: "sam", pips: 8, tiles: samTiles },
        { playerId: "jordan", pips: 7, tiles: jordanTiles },
      ],
      scoresAfter: scores,
      gameNumber: 1,
      handNumber: 4,
    },
    recap: null,
    quick: null,
    tableId: "TBL-011",
    lastPlay: { playerId: "you", tileId: "0-0", endId: "lead", total: 0, awarded: 0, seq: 1 },
    lastEvent: null,
    knockStreak: 0,
    lastDraw: null,
    taunts: [],
  };
}

function PreviewSeat({ id, name, score, avatarId }: { id: string; name: string; score: number; avatarId: string }) {
  const live = useWinScore(id, score);
  return (
    <div className={`seat-chip${id === "you" ? " you" : ""}${live.hot ? " win-hot" : ""}`} data-player-id={id}>
      <AvatarFace id={avatarId} />
      <span className="chip-text">
        <span className="chip-name">{name}</span>
        <span className="chip-meta">
          <strong className={live.pulse ? "is-scoring" : undefined} data-win-score={id}>
            {live.score}
          </strong>
        </span>
      </span>
    </div>
  );
}

function lineupCast(view: PlayerView) {
  return view.players.map((player) => ({ id: player.id, name: player.name, avatarId: player.avatarId }));
}

export function WinPreview({ mode }: { mode: WinPreviewMode }) {
  const view = useMemo(() => previewView(mode), [mode]);
  const freeze = useMemo(() => readFreeze(mode), [mode]);
  const win = useHandCelebration(view, freeze);
  const seated = seatAround(view.players);
  const you = seated.find((seat) => seat.edge === "bottom");
  const match = mode === "match" || mode === "lineup";
  const settled = win.reduced || win.frozenAt != null;
  const winnerName = view.players.find((player) => player.id === view.seriesWinnerId)?.name ?? "Rio";
  return (
    <WinScoreContext.Provider value={win.scores}>
      <main className="felt-app win-preview" data-tile-skin="ivory" data-win-stage={win.stage} data-screen="win-preview">
        <div
          className="win-preview-table"
          data-win-board="true"
          data-players={view.players.length}
          data-table-id="TBL-011"
          style={{ backgroundImage: "url(/store/TBL-011.webp?v=7)" }}
        >
          {seated
            .filter((seat) => seat.edge !== "bottom")
            .map((seat) => (
              <div key={seat.player.id} className={`rail rail-${seat.edge}`} data-edge={seat.edge} data-player-id={seat.player.id}>
                <PreviewSeat id={seat.player.id} name={seat.player.name} score={seat.player.score} avatarId={seat.player.avatarId} />
              </div>
            ))}
          <div className="win-preview-chain" aria-hidden="true">
            <Domino a={6} b={6} orientation="vertical" spinner />
            <Domino a={6} b={3} orientation="horizontal" />
            <Domino a={3} b={1} orientation="vertical" />
          </div>
          {view.you.hand.length > 0 ? (
            <div className="preview-hand hand">
              {view.you.hand.map((tile) => (
                <div key={tile.id} className="hand-tile" data-tile-id={tile.id}>
                  <Domino a={tile.low} b={tile.high} orientation="vertical" />
                </div>
              ))}
            </div>
          ) : null}
          {you ? (
            <div className="you-float">
              <PreviewSeat id={you.player.id} name="You" score={you.player.score} avatarId={you.player.avatarId} />
            </div>
          ) : null}
        </div>
        {win.stage === "call" && win.call ? <FeelCall kind={win.call} reduced={win.reduced} onSkip={win.skip} /> : null}
        {win.stage === "pips" && view.lastHand ? (
          <FeelTally
            reason={view.lastHand.reason}
            pipCounts={view.lastHand.pipCounts}
            winnerIds={view.lastHand.winnerIds}
            awards={view.lastHand.leftoverAwards}
            reduced={win.reduced}
          />
        ) : null}
        {win.plan && (win.stage === "pips" || win.stage === "banner") ? (
          <WinShow
            stage={win.stage}
            plan={win.plan}
            banner={win.banner}
            reveals={win.reveals}
            yourId={view.yourId}
            reduced={win.reduced}
            frozenAt={win.frozenAt}
            onSkip={win.skip}
            onLand={win.onLand}
          />
        ) : null}
        {win.stage === "lineup" && win.banner ? (
          <MatchLineup
            players={lineupCast(view)}
            winnerId={win.banner.winnerId}
            line={winLineFor(
              win.banner.avatarId,
              matchLineSeed(view.roomCode, view.gameNumber, view.handNumber, win.banner.winnerId),
            )}
            motion={settled ? "off" : "on"}
            instant={settled}
            onContinue={win.skip}
          />
        ) : null}
        {win.sheet ? (
          match ? (
            <section className="hand-summary" data-screen="series">
              <p className="result-kicker">Series over</p>
              <div className="winner-row">
                <h2>{winnerName} won the hand</h2>
              </div>
              <p>{view.lastHand?.summary}</p>
              <div className="match-over-actions">
                <button type="button" className="secondary" data-action="rematch">
                  Play Again
                </button>
                <button type="button" className="primary" data-action="leave-match">
                  Leave Match
                </button>
              </div>
            </section>
          ) : (
            <div className="preview-continue match-over-actions">
              <button type="button" className="primary" data-action="continue">
                Continue
              </button>
            </div>
          )
        ) : null}
      </main>
    </WinScoreContext.Provider>
  );
}
