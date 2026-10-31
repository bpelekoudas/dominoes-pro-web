import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Intent, PlayerView } from "@uhoh/rules";
import { shareText, smsHref, tableLink } from "./link.js";
import { pulse } from "./pulse";
import { seatAround, type SeatEdge } from "./seats.js";
import { sliverGap } from "./edge-slivers.js";
import { bigMomentLevel } from "../../rules/src/moment.js";
import { motionMs } from "../../rules/src/motion.js";
import { demoAward, demoRequested, FxGallery, fxGalleryRequested, UhOhPreview } from "./moment.js";
import { cuesForPlay, cuesForTurn } from "./cues";
import { primeMusic } from "./music";
import { isMuted, playCues, preloadSounds, setMuted, unlockSound } from "./sound";
import { Domino, Hand, Table } from "./table";
import { ControlToken, DrawFlight } from "./control-token";
import { AccountChip, AccountLayer, useAccount, type AccountUser } from "./account";
import { RankLine, RankRecapView, RankDemo, rankDemoRequested } from "./rank";
import { ArcadeHome, MenuDemo, QuickWait, Splash, menuDemoRequested, reducedMotion } from "./arcade";
import { shouldAskAge } from "./home-model";
import { hintText, markHint, playHint } from "./play-hints";
import { scoreHintChoice, setScoreHintChoice, showScoreNumbers, type ScoreHintChoice } from "./score-hints";
import { AvatarFace, BotBadge, cpuSkill } from "./avatars";
import { CheckoutBanner, useMatchCosmetics } from "./store";
import { MatchLineup } from "./lineup";
import { matchLineSeed, winLineFor } from "./win-lines";
import { FeelCall, FeelTally } from "./feel/overlay";
import { FeelPreview, feelPreviewRequested } from "./feel/preview";
import { crowdView, feelSeatsRequested, feelTableRequested, useFeelPlay } from "./feel/table-play";
import { ScoreChaseContext, useScoreChase, useShownScore } from "./feel/score";
import { useHandCelebration, WinPreview, WinScoreContext, WinShow, winPreviewRequested } from "./win-fx";
import { WinnerPopLayer } from "./winner-pop-layer";
import { GamePips } from "./game-pips";
import { gameTallyText } from "./game-tally.js";

interface ChatLine {
  id: number;
  playerId: string;
  name: string;
  kind: "preset" | "text";
  text: string;
  at?: string;
}

type ServerMessage =
  | { type: "welcome"; token: string; playerId: string; roomCode: string; chat: ChatLine[] }
  | { type: "state"; view: PlayerView }
  | { type: "chat"; line: ChatLine }
  | { type: "error"; message: string };

type BoneyardMode = "draw_one" | "draw_until";
type SeriesLength = 1 | 3 | 5 | 7;

const TOKEN_KEY = "uhoh.token";
/** Set while this tab is in a game, so a refresh resumes and a new visit deals fresh. */
const RESUME_KEY = "uhoh.resume";

export function App() {
  const [view, setView] = useState<PlayerView | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedHand, setDismissedHand] = useState<string | null>(null);
  const [leaveArmed, setLeaveArmed] = useState(false);
  const [preview, setPreview] = useState(demoRequested);
  const account = useAccount();
  const [splash, setSplash] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    if (sessionStorage.getItem("uhoh.splash") === "1") return false;
    if (localStorage.getItem(TOKEN_KEY)) return false;
    if (new URLSearchParams(location.search).get("checkout")) return false;
    return true;
  });
  const [iris, setIris] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const leaveRef = useRef(false);
  const connectRef = useRef<(first?: object) => void>(() => undefined);

  const send = (message: object) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  useEffect(() => {
    let stopped = false;
    let retryMs = 400;
    let timer = 0;
    let attempt = 0;
    let socket: WebSocket | null = null;
    // The first message of a new seat (create or join). Cleared once the server welcomes us,
    // so a later drop reconnects the same seat instead of opening another room.
    let pending: object | null = null;

    const connect = () => {
      if (stopped || leaveRef.current) return;
      const token = localStorage.getItem(TOKEN_KEY);
      if (!pending && !token) {
        setStatus("idle");
        return;
      }
      const mine = ++attempt;
      setStatus("connecting");
      const next = new WebSocket(socketUrl());
      socket = next;
      socketRef.current = next;
      next.onopen = () => {
        if (mine !== attempt) return;
        retryMs = 400;
        setStatus("live");
        const currentToken = localStorage.getItem(TOKEN_KEY);
        if (pending) next.send(JSON.stringify(pending));
        else if (currentToken) next.send(JSON.stringify({ type: "reconnect", token: currentToken }));
      };
      next.onmessage = (event) => {
        if (mine !== attempt || leaveRef.current) return;
        const message = handleMessage(String(event.data), setView, setChat, setError);
        if (message?.type === "welcome") {
          pending = null;
          sessionStorage.setItem(RESUME_KEY, "1");
          localStorage.setItem(TOKEN_KEY, message.token);
          const url = `/r/${message.roomCode}`;
          if (location.pathname !== url) history.replaceState(null, "", url);
        }
      };
      next.onclose = () => {
        if (mine !== attempt || stopped || leaveRef.current) return;
        if (!pending && !localStorage.getItem(TOKEN_KEY)) {
          setStatus("idle");
          return;
        }
        setStatus("connecting");
        timer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 4_000);
      };
    };

    connectRef.current = (first?: object) => {
      leaveRef.current = false;
      if (first) pending = first;
      retryMs = 400;
      window.clearTimeout(timer);
      attempt += 1;
      socket?.close();
      connect();
    };

    if (!feelTableRequested() && sessionStorage.getItem(RESUME_KEY) === "1" && localStorage.getItem(TOKEN_KEY)) connect();
    return () => {
      stopped = true;
      attempt += 1;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    setSelectedTile(null);
  }, [view?.turnPlayerId, view?.handNumber, view?.gameNumber, view?.you.hand.length]);

  useEffect(() => {
    preloadSounds();
    const unlock = () => {
      unlockSound();
      primeMusic();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const openSocket = (first: object) => {
    unlockSound();
    primeMusic();
    setError(null);
    connectRef.current(first);
  };

  const begin = async (first: { type: string; name: string; [key: string]: unknown }) => {
    const guest = await account.ensureGuest(first.name);
    if (!guest) return;
    // Drop the saved seat first. A retry must not reopen a game that already started.
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.setItem(RESUME_KEY, "1");
    openSocket({ ...first, name: guest.displayName });
  };

  const goHome = () => {
    leaveRef.current = true;
    sessionStorage.removeItem(RESUME_KEY);
    localStorage.removeItem(TOKEN_KEY);
    socketRef.current?.close();
    setView(null);
    setChat([]);
    setLeaveArmed(false);
    setStatus("idle");
    if (location.pathname !== "/") history.replaceState(null, "", "/");
  };

  const leave = () => {
    goHome();
  };

  // The match is already scored. Tell the server to drop this seat, then go home.
  const finishMatch = () => {
    leaveRef.current = true;
    sessionStorage.removeItem(RESUME_KEY);
    localStorage.removeItem(TOKEN_KEY);
    send({ type: "finish" });
    goHome();
  };

  const matchIsOver =
    view?.phase === "over" || view?.status === "complete" || view?.status === "abandoned";

  useEffect(() => {
    if (!view?.recap) return;
    void account.refresh();
  }, [view?.recap, view?.roomCode]);

  const seenRoom = useRef<{ code: string | null; status: string | null }>({ code: null, status: null });
  useEffect(() => {
    const previous = seenRoom.current;
    const intoMatch = Boolean(view && view.status === "playing" && (previous.code !== view.roomCode || previous.status !== "playing"));
    seenRoom.current = { code: view?.roomCode ?? null, status: view?.status ?? null };
    if (!intoMatch || reducedMotion()) return;
    setIris(true);
    const timer = window.setTimeout(() => setIris(false), 700);
    return () => window.clearTimeout(timer);
  }, [view?.roomCode, view?.status]);

  const finishSplash = () => {
    sessionStorage.setItem("uhoh.splash", "1");
    setSplash(false);
  };

  const winMode = winPreviewRequested();
  if (feelSeatsRequested()) return <FeelSeatsScreen />;
  if (feelTableRequested()) return <FeelPlayScreen />;
  if (feelPreviewRequested() && !view) return <FeelPreview />;
  if (winMode && !view) {
    return <WinPreview mode={winMode} />;
  }

  if (fxGalleryRequested() && !view) {
    return <FxGallery />;
  }

  if (menuDemoRequested() && !view) {
    return <MenuDemo />;
  }

  if (rankDemoRequested() && !view) {
    return <RankDemo />;
  }

  if (!view && preview) {
    return (
      <>
        <UhOhPreview award={demoAward()} onClose={() => setPreview(false)} />
        <AccountLayer account={account} />
      </>
    );
  }

  if (!view) {
    return (
      <>
        <CheckoutBanner />
        <ArcadeHome
          presetCode={roomFromLocation() ?? ""}
          error={error ?? account.error}
          notice={account.notice}
          connecting={status === "connecting"}
          initialName={account.user?.displayName ?? ""}
          user={account.user}
          onCreate={(name, playerCount, boneyardMode, seriesLength) =>
            void begin({ type: "create", name, playerCount, boneyardMode, seriesLength })
          }
          onSolo={(name, playerCount, boneyardMode, seriesLength, difficulty, casual) => {
            const reel =
              new URLSearchParams(location.search).get("reel") === "score" &&
              name.trim().toLowerCase().startsWith("soak-");
            void begin({
              type: "solo",
              name,
              playerCount,
              boneyardMode,
              seriesLength,
              difficulty,
              ...(casual ? { casual: true } : {}),
              ...(reel ? { fixture: "score-reel" } : {}),
            });
          }}
          onJoin={(name, code) => void begin({ type: "join", name, code })}
          onQuick={(name, size) => void begin({ type: "quick", name, size })}
          onQuickPlay={(name, seriesLength) => void begin({ type: "quick-play", name, seriesLength })}
          onGuest={(name) => void account.ensureGuest(name)}
          onAccount={() => account.openSheet("profile")}
          onBoard={() => account.showBoard("rating")}
          onLook={() => account.openSheet("look")}
          onRefresh={() => void account.refresh()}
          onPreview={scoreMathOn() ? () => setPreview(true) : null}
          introBusy={splash}
          needsAge={shouldAskAge({
            hasAccount: Boolean(account.user),
            ageOk: Boolean(account.user?.ageOk),
            checked: account.ageChecked,
            remembered: false,
          })}
          ageChecked={account.ageChecked}
          onAge={account.setAgeChecked}
          onNeedAge={account.askAge}
          onDelete={account.deleteAccount}
        />
        {splash ? <Splash onDone={finishSplash} /> : null}
        <AccountLayer account={account} />
      </>
    );
  }

  return (
    <>
      <CheckoutBanner />
      <Game
        view={view}
        chat={chat}
        error={error}
        status={status}
        selectedTile={selectedTile}
        chatOpen={chatOpen}
        dismissedHand={dismissedHand}
        leaveArmed={leaveArmed}
        onSelect={setSelectedTile}
        onToggleChat={() => setChatOpen((open) => !open)}
        onDismiss={() => setDismissedHand(handKey(view))}
        onLeaveArm={() => setLeaveArmed(true)}
        onLeave={matchIsOver ? finishMatch : leave}
        onLeaveMatch={finishMatch}
        onCancelQuick={() => {
          send({ type: "cancel-quick" });
          leave();
        }}
        iris={iris}
        onSend={(message) => send(message)}
        accountUser={account.user}
        onAccount={account.openSheet}
      />
      <AccountLayer account={account} />
    </>
  );
}

function handleMessage(
  raw: string,
  setView: (view: PlayerView) => void,
  setChat: (value: ChatLine[] | ((lines: ChatLine[]) => ChatLine[])) => void,
  setError: (value: string | null) => void,
): ServerMessage | null {
  let message: ServerMessage;
  try {
    message = JSON.parse(raw) as ServerMessage;
  } catch {
    return null;
  }
  if (message.type === "welcome") {
    setChat(message.chat);
    setError(null);
  } else if (message.type === "state") {
    setView(message.view);
    setError(null);
  } else if (message.type === "chat") {
    setChat((lines) => [...lines, message.line].slice(-40));
  } else if (message.type === "error") {
    setError(playerError(message.message));
  }
  return message;
}

function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="choices">
      {options.map((option) => (
        <button
          type="button"
          key={String(option.value)}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FeelSeatsScreen() {
  const view = useMemo(() => crowdView(), []);
  return (
    <div className="feel-play-root" data-screen="feel-seats" data-players={view.players.length}>
      <Game
        view={view}
        chat={[]}
        error={null}
        status="live"
        selectedTile={null}
        chatOpen={false}
        dismissedHand={null}
        leaveArmed={false}
        onSelect={() => undefined}
        onToggleChat={() => undefined}
        onDismiss={() => undefined}
        onLeaveArm={() => undefined}
        onLeave={() => undefined}
        onLeaveMatch={() => undefined}
        onCancelQuick={() => undefined}
        iris={false}
        onSend={() => undefined}
        accountUser={null}
        onAccount={() => undefined}
      />
    </div>
  );
}

function FeelPlayScreen() {
  const beat = useFeelPlay();
  return (
    <div className="feel-play-root" data-screen="feel-play" data-feel-scene={beat.scene}>
      <Game
        view={beat.view}
        chat={[]}
        error={null}
        status="live"
        selectedTile={null}
        chatOpen={false}
        dismissedHand={null}
        leaveArmed={false}
        onSelect={() => undefined}
        onToggleChat={() => undefined}
        onDismiss={() => undefined}
        onLeaveArm={() => undefined}
        onLeave={() => undefined}
        onLeaveMatch={() => undefined}
        onCancelQuick={() => undefined}
        iris={false}
        onSend={() => undefined}
        accountUser={null}
        onAccount={() => undefined}
      />
    </div>
  );
}

export function Game({
  view,
  chat,
  error,
  status,
  selectedTile,
  chatOpen,
  dismissedHand,
  leaveArmed,
  onSelect,
  onToggleChat,
  onDismiss,
  onLeaveArm,
  onLeave,
  onLeaveMatch,
  onCancelQuick,
  iris,
  onSend,
  accountUser,
  onAccount,
}: {
  view: PlayerView;
  chat: ChatLine[];
  error: string | null;
  status: string;
  selectedTile: string | null;
  chatOpen: boolean;
  dismissedHand: string | null;
  leaveArmed: boolean;
  onSelect: (tileId: string | null) => void;
  onToggleChat: () => void;
  onDismiss: () => void;
  onLeaveArm: () => void;
  onLeave: () => void;
  onLeaveMatch: () => void;
  onCancelQuick: () => void;
  iris: boolean;
  onSend: (message: object) => void;
  accountUser: AccountUser | null;
  onAccount: () => void;
}) {
  const link = tableLink(view.roomCode, window.__UHOH__?.publicUrl, location.origin);
  const cosmetics = useMatchCosmetics();
  const tableArt = view.tableId ? `/store/${view.tableId}.webp?v=7` : null;
  const tileSkin = cosmetics.skin || "ivory";
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.tileSkin = tileSkin;
    return () => {
      if (root.dataset.tileSkin === tileSkin) delete root.dataset.tileSkin;
    };
  }, [tileSkin]);
  void dismissedHand;
  const [drag, setDrag] = useState<{ tileId: string; aimEndId: string | null } | null>(null);
  const [mutedSpeakers, setMutedSpeakers] = useState<string[]>([]);
  const heard = chat.filter((line) => !mutedSpeakers.includes(line.playerId));
  const bubble = useTalkBubble(heard);
  const unread = useUnread(heard, chatOpen);
  const play = (tileId: string, endId: string) => {
    if (coach) {
      markHint(coach);
      setCoach(null);
    }
    onSend({ type: "intent", intent: { type: "play", tileId, endId } satisfies Intent });
  };
  const around = seatAround(view.players);
  const opponents = (["left", "top", "right"] as const).flatMap((edge) => {
    const seat = around.find((item) => item.edge === edge);
    return seat ? [{ player: seat.player, edge }] : [];
  });
  const you = around.find((seat) => seat.edge === "bottom") ?? null;
  const yourTurn = view.turnPlayerId === view.yourId && view.phase !== "over" && view.phase !== "lobby" && view.phase !== "between";
  const [scoreChoice, setScoreChoice] = useState<ScoreHintChoice>(scoreHintChoice);
  const scoreNumbers = showScoreNumbers(view.easyPractice, view.botGames, scoreChoice);
  const severalEnds = view.legalPlays.some((play) => view.legalPlays.filter((other) => other.tileId === play.tileId).length > 1);
  const [coach, setCoach] = useState<"tap" | "drag" | null>(null);
  const coachTurn = useRef(false);
  useEffect(() => {
    const next = playHint(yourTurn, view.legalPlays.length > 0, severalEnds);
    setCoach((current) => current ?? next);
  }, [yourTurn, view.legalPlays, severalEnds]);
  useEffect(() => {
    if (coachTurn.current && !yourTurn && coach) {
      markHint(coach);
      setCoach(null);
    }
    coachTurn.current = yourTurn;
  }, [yourTurn, coach]);
  const notice = useFleetingNotice(view);
  const [muted, setMute] = useState(isMuted);
  const [replayToken, setReplayToken] = useState(0);
  useEffect(() => {
    if (demoRequested()) setReplayToken(1);
  }, []);
  useEffect(() => {
    const play = view.lastPlay;
    // 20+ is the UH-OH moment, which plays the slam, the glass, and the cha-ching together.
    if (!play || bigMomentLevel(play.awarded)) return;
    const opponent = play.playerId !== view.yourId;
    const cues = cuesForPlay(play.awarded, play.tileId).map((cue) =>
      opponent && (cue.id === "clack" || cue.id === "clack-heavy") ? { ...cue, delay: cue.delay + motionMs(420) / 1000 } : cue,
    );
    playCues(cues);
  }, [view.lastPlay?.seq]);
  useEffect(() => {
    if (yourTurn) playCues(cuesForTurn());
  }, [yourTurn, view.turnPlayerId, view.handNumber]);

  const playing = view.status !== "lobby";
  const win = useHandCelebration(view);
  const chase = useScoreChase(view);
  const feelPlay = feelTableRequested();
  const showingResult = win.sheet && !feelPlay;
  const showCounts = Boolean(view.lastHand && win.stage === "pips");
  const gameFocus = win.stage === "banner" && win.banner?.kind === "game" ? win.banner.winnerId : null;
  return (
    <WinScoreContext.Provider value={win.scores}>
    <ScoreChaseContext.Provider value={chase}>
    <main
      className={`felt-app${chatOpen ? " chat-open" : ""}${iris ? " iris-play" : ""}${showingResult ? " showing-result" : ""}`}
      data-skin="ivory"
      data-tile-skin={tileSkin}
      data-win-stage={win.stage}
      data-win-kind={win.stage === "banner" && win.banner ? win.banner.kind : undefined}
      data-screen={feelPlay ? "feel-play" : undefined}
    >
      <div className="felt-column">
      <header className="playbar">
        <PlayMark />
        {playing ? (
          <button type="button" className="code-chip play-code" data-room-code={view.roomCode} onClick={() => copyText(link)}>
            {view.roomCode}
          </button>
        ) : null}
        <p className="series-line" data-series-target={view.winsNeeded}>
          {playing ? (
            <>
              {view.settings.seriesLength === 1
                ? `Single game · H${view.handNumber} · `
                : `Bo${view.settings.seriesLength} to ${view.winsNeeded} · G${view.gameNumber} · H${view.handNumber} · `}
              <SeriesTarget view={view} />
            </>
          ) : (
            "Lobby"
          )}
        </p>
        {accountUser ? (
          <AccountChip compact user={accountUser} onOpen={onAccount} />
        ) : (
          <button type="button" className="text-button play-signin" onClick={onAccount}>
            Sign in
          </button>
        )}
        <button
          type="button"
          className="icon-button mobile-only"
          aria-label={chatOpen ? "Close chat" : unread ? "Talk, new messages" : "Talk"}
          onClick={onToggleChat}
        >
          <TalkIcon />
          {unread ? <span className="unread-dot" data-unread="true" /> : null}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMute(next);
            unlockSound();
          }}
        >
          <SpeakerIcon muted={muted} />
        </button>
        <button
          type="button"
          className={`icon-button${leaveArmed ? " armed" : ""}`}
          aria-label={leaveArmed ? "Leave now" : "Leave"}
          onClick={leaveArmed ? onLeave : onLeaveArm}
        >
          {leaveArmed ? "Leave" : <LeaveIcon />}
        </button>
      </header>

      {status !== "live" ? <p className="banner">Reconnecting…</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {view.ended ? (
        <section className="ended-screen" data-screen="player-left">
          <div className="hand-summary-scroll">
            <p className="result-kicker">Game ended - {view.ended.name} left</p>
            <p className="series-tally" data-games-tally={gameTallyText(view.players.map((player) => player.gamesWon))} data-series-target={view.winsNeeded} data-format={view.settings.seriesLength === 1 ? "single" : "series"}>
              {view.settings.seriesLength === 1 ? "Single game" : `Series · Games ${gameTallyText(view.players.map((player) => player.gamesWon))} · first to ${view.winsNeeded}`}
            </p>
            <ScoreList view={view} />
            {view.recap ? <RankRecapView recap={view.recap} names={playerNames(view)} faces={playerFaces(view)} /> : null}
          </div>
          <div className="match-over-actions">
            <button type="button" className="primary" data-action="leave-match" onClick={onLeaveMatch}>
              Leave Match
            </button>
          </div>
        </section>
      ) : null}
      {win.sheet && view.lastHand && !view.ended && !feelPlay ? (
        <HandSummary
          view={view}
          onContinue={() => onSend({ type: "continue" })}
          onRematch={() => onSend({ type: "rematch" })}
          onLeaveMatch={onLeaveMatch}
        />
      ) : null}

      {view.status === "lobby" && view.quick ? (
        <QuickWait
          players={view.players}
          playerCount={view.settings.playerCount}
          waitUntil={view.quick.waitUntil}
          canFill={view.quick.canFill}
          botFillAt={view.quick.botFillAt ?? null}
          serverNow={view.serverNow}
          onCancel={onCancelQuick}
          onFill={() => onSend({ type: "fill-quick" })}
          onFillBots={() => onSend({ type: "fill-bots" })}
          onKeep={() => onSend({ type: "keep-waiting" })}
          autoStartAt={view.quick.autoStartAt ?? null}
          seriesLength={view.settings.seriesLength}
          youAreHost={view.yourId === view.hostId}
          onSeries={(seriesLength) => onSend({ type: "set-series", seriesLength })}
        />
      ) : view.status === "lobby" ? (
        <Lobby view={view} link={link} onStart={() => onSend({ type: "start" })} onSend={onSend} />
      ) : (
        <>
          <div className="table-frame" data-opponents={opponents.length}>
            <div className="table-middle">
              <Table
                view={view}
                selectedTile={selectedTile}
                dragTileId={drag?.tileId ?? null}
                aimEndId={drag?.aimEndId ?? null}
                onPlay={play}
                onSelect={onSelect}
                replayToken={replayToken}
                tableArt={tableArt}
                showScores={scoreNumbers}
              />
              {/* Last player who went out. Never the seat whose turn it is. */}
              <ControlToken playerId={view.lastDominoId} stamp={view.lastDominoKey ?? ""} />
              <DrawFlight draw={view.lastDraw} handKey={`${view.gameNumber}:${view.handNumber}`} />
              {opponents.map((seat) => (
                <EdgeSeat
                  key={seat.player.id}
                  edge={seat.edge}
                  player={seat.player}
                  bubble={bubbleText(bubble, seat.player.id)}
                  notice={notice?.playerId === seat.player.id ? notice.text : null}
                  view={view}
                  pips={showCounts ? view.lastHand?.pipCounts[seat.player.id] ?? null : null}
                  low={showCounts && view.lastHand?.reason === "locked" && view.lastHand.winnerIds.includes(seat.player.id)}
                  forward={gameFocus === seat.player.id}
                />
              ))}
            </div>
          </div>
          <div className="hand-tray">
            <div className="tray-notices">
              <div className="you-float">
                {you ? (
                  <>
                  <span className="token-slot" data-token-slot={you.player.id} data-edge="bottom" aria-hidden="true" />
                  <SeatChip
                    player={you.player}
                    view={view}
                    pips={showCounts ? view.lastHand?.pipCounts[you.player.id] ?? null : null}
                    low={showCounts && view.lastHand?.reason === "locked" && view.lastHand.winnerIds.includes(you.player.id)}
                    forward={gameFocus === you.player.id}
                    talk={bubbleText(bubble, you.player.id)}
                  />
                  </>
                ) : null}
              </div>
              {(view.phase === "play" || view.phase === "draw" || view.phase === "knock") && view.turnPlayerId ? (
                <p className="your-turn" data-turn-pill="true" data-you={yourTurn ? "true" : "false"}>
                  {coach ? hintText(coach) : yourTurn ? "Your turn" : `${view.players.find((player) => player.id === view.turnPlayerId)?.name ?? "Their"}'s turn`}
                  {coach ? (
                    <button
                      type="button"
                      className="hint-dismiss"
                      onClick={() => {
                        markHint(coach);
                        setCoach(null);
                      }}
                    >
                      Got it
                    </button>
                  ) : null}
                </p>
              ) : null}
              {view.phase === "play" && view.turnDeadline ? <TurnBar view={view} /> : null}
              {view.easyPractice ? (
                <button
                  type="button"
                  className="text-button score-hint-toggle"
                  data-action="score-hints"
                  aria-pressed={scoreNumbers}
                  onClick={() => {
                    const next = scoreNumbers ? "off" : "on";
                    setScoreChoice(next);
                    setScoreHintChoice(next);
                  }}
                >
                  {scoreNumbers ? "Score hints on" : "Score hints off"}
                </button>
              ) : null}
              <StatusLine view={view} />
              {notice && you && notice.playerId === you.player.id ? (
                <p className="seat-notice local-notice">{notice.text}</p>
              ) : null}
              <p className="sr-only" role="status">{view.prompt}</p>
              {demoRequested() ? (
                <button type="button" className="uhoh-test" data-demo="uhoh" onClick={() => setReplayToken((value) => value + 1)}>
                  UH-OH
                </button>
              ) : null}
            </div>
            <div className="tray-row">
              <Hand
                view={view}
                selectedTile={selectedTile}
                onSelect={onSelect}
                onPlay={play}
                showScores={scoreNumbers}
                onDragTile={(tileId, aimEndId) => setDrag(tileId ? { tileId, aimEndId } : null)}
              />
              <YardPile
                view={view}
                onDraw={() => onSend({ type: "intent", intent: { type: "draw" } })}
                onKnock={() => onSend({ type: "intent", intent: { type: "knock" } })}
              />
            </div>
          </div>
        </>
      )}
      </div>

      <ChatPanel
        open={chatOpen}
        view={view}
        chat={heard}
        onClose={onToggleChat}
        onPreset={(packId, tauntId) => onSend({ type: "chat", kind: "preset", packId, tauntId })}
        onMuted={(playerId) => setMutedSpeakers((current) => (current.includes(playerId) ? current : [...current, playerId]))}
      />
      {win.stage === "call" && win.call ? <FeelCall kind={win.call} reduced={win.reduced} onSkip={win.skip} /> : null}
      {win.stage === "pips" && view.lastHand ? (
        <FeelTally
          key={`${view.gameNumber}:${view.handNumber}:${view.lastHand.reason}`}
          reason={view.lastHand.reason}
          pipCounts={view.lastHand.pipCounts}
          winnerIds={view.lastHand.winnerIds}
          awards={view.lastHand.leftoverAwards}
          reduced={win.reduced}
        />
      ) : null}
      <WinnerPopLayer view={view} stage={win.stage} reduced={win.reduced} frozenAt={win.frozenAt} />
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
          players={view.players.map((player) => ({ id: player.id, name: player.name, avatarId: player.avatarId }))}
          games={view.players.map((player) => player.gamesWon)}
          winsNeeded={view.winsNeeded}
          winnerId={win.banner.winnerId}
          line={winLineFor(
            win.banner.avatarId,
            matchLineSeed(view.roomCode, view.lastHand?.gameNumber ?? view.gameNumber, view.lastHand?.handNumber ?? view.handNumber, win.banner.winnerId),
          )}
          motion={win.reduced || win.frozenAt != null ? "off" : "on"}
          instant={win.reduced || win.frozenAt != null}
          onContinue={win.skip}
        />
      ) : null}
    </main>
    </ScoreChaseContext.Provider>
    </WinScoreContext.Provider>
  );
}

function Lobby({
  view,
  link,
  onStart,
  onSend,
}: {
  view: PlayerView;
  link: string;
  onStart: () => void;
  onSend: (message: object) => void;
}) {
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "expert">("medium");
  const [shareNote, setShareNote] = useState<string | null>(null);
  const host = view.yourId === view.hostId;
  const openSeats = view.settings.playerCount - view.players.length;
  const mode = view.settings.boneyardMode === "draw_one" ? "Draw one, then pass if it doesn't fit." : "Draw until you can play.";
  return (
    <section className="lobby">
      <p className="eyebrow">Share this table</p>
      <p className="big-code" data-room-code={view.roomCode}>
        {view.roomCode}
      </p>
      <label className="link-row">
        Link
        <input readOnly value={link} data-share-link={link} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <div className="share-actions">
        <button type="button" className="primary" data-action="text-link" onClick={() => void textLink(link, setShareNote)}>
          Text a friend
        </button>
        <button type="button" className="secondary" data-action="copy-link" onClick={() => copyText(link)}>
          Copy link
        </button>
      </div>
      {shareNote ? <p className="hint">{shareNote}</p> : null}
      <p className="eyebrow">At the table</p>
      <ul className="seat-list">
        {view.players.map((player) => (
          <li key={player.id} className={player.bot ? "bot-seat" : ""}>
            <span className="who">
              <AvatarFace id={player.avatarId} bot={player.bot} skill={cpuSkill(player.difficulty)} frameId={player.frameId} />
              <span>
                {player.isYou ? `${player.name} (you)` : player.name}
                {player.accountBot ? <BotBadge /> : null}
                {player.bot ? (
                  <small className="bot-label">CPU · {cpuMark(player.difficulty)}</small>
                ) : player.rank ? (
                  <RankLine
                    tierId={player.rank.tierId}
                    tierName={player.rank.tierName}
                    step={player.rank.step}
                    rating={player.rank.rating}
                    provisional={player.rank.provisional}
                    compact
                  />
                ) : null}
              </span>
            </span>
            {player.bot && !player.accountBot && host ? (
              <button
                type="button"
                className="text-button"
                data-action="remove-bot"
                onClick={() => onSend({ type: "remove-bot", playerId: player.id })}
              >
                Remove
              </button>
            ) : (
              <span>{player.connected ? "here" : "away"}</span>
            )}
          </li>
        ))}
        {Array.from({ length: openSeats }, (_, index) => (
          <li key={`empty-${index}`} className="empty-seat">
            Waiting for a player
          </li>
        ))}
      </ul>
      {host ? (
        <button
          type="button"
          className="secondary"
          data-action="casual"
          data-casual={view.settings.casual ? "true" : "false"}
          onClick={() => onSend({ type: "set-casual", casual: !view.settings.casual })}
        >
          {view.settings.casual ? "Casual · ratings stay put" : "Ranked table"}
        </button>
      ) : (
        <p className="hint">{view.settings.casual ? "Casual table. Ratings stay put." : "Ranked table."}</p>
      )}
      {host && openSeats > 0 ? (
        <div className="bot-add">
          <fieldset>
            <legend>Computer</legend>
            <Choice
              value={difficulty}
              options={[
                { value: "easy", label: "Easy" },
                { value: "medium", label: "Medium" },
                { value: "hard", label: "Hard" },
                { value: "expert", label: "Expert" },
              ]}
              onChange={setDifficulty}
            />
          </fieldset>
          <button
            type="button"
            className="primary"
            data-action="add-bot"
            onClick={() => onSend({ type: "add-bot", difficulty })}
          >
            Add a computer
          </button>
        </div>
      ) : null}
      <p className="rules-note">
        {view.settings.seriesLength === 1 ? "Single game." : `Best of ${view.settings.seriesLength}.`} {mode} First to {view.settings.targetScore}. {view.prompt}
      </p>
      {view.canStart ? (
        <button type="button" className="primary" data-action="start" onClick={onStart}>
          Deal the first hand
        </button>
      ) : null}
    </section>
  );
}

function EdgeSeat({
  edge,
  player,
  bubble,
  notice,
  view,
  pips,
  low,
  forward,
}: {
  edge: Exclude<SeatEdge, "bottom">;
  player: PlayerView["players"][number];
  bubble: string | null;
  notice: string | null;
  view: PlayerView;
  pips: number | null;
  low: boolean;
  forward: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [gap, setGap] = useState(3);
  const along = edge === "top" ? 26 : 28;
  const count = player.tileCount;
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => {
      const sample = rail.querySelector<HTMLElement>(".sliver");
      const alongSize = sample
        ? edge === "top"
          ? sample.getBoundingClientRect().width
          : sample.getBoundingClientRect().height
        : along;
      const head = rail.querySelector<HTMLElement>(".edge-head");
      const reserve = edge === "top" || !head ? 0 : head.getBoundingClientRect().height + 6;
      const span = edge === "top" ? rail.clientWidth : Math.max(0, rail.clientHeight - reserve);
      const next = sliverGap(count, span, Math.max(1, alongSize), 3);
      setGap((current) => (Math.abs(current - next) < 0.2 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [along, count, edge]);
  return (
    <div
      ref={railRef}
      className={`rail edge edge-${edge}${player.isTurn ? " turn" : ""}`}
      data-edge={edge}
      data-player-id={player.id}
      data-tiles={count}
      data-skin={player.tileSkin || "ivory"}
    >
      {edge === "top" ? null : (
        <div className={`edge-head edge-head-${edge}`}>
          {edge === "left" ? (
            <EdgeBadge player={player} view={view} pips={pips} low={low} forward={forward} talk={bubble || notice} />
          ) : null}
          <span className="token-slot" data-token-slot={player.id} data-edge={edge} aria-hidden="true" />
          {edge === "right" ? (
            <EdgeBadge player={player} view={view} pips={pips} low={low} forward={forward} talk={bubble || notice} />
          ) : null}
        </div>
      )}
      <div className="edge-slivers" data-gap={gap.toFixed(2)} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <i
            key={index}
            className="sliver"
            style={index === 0 ? undefined : edge === "top" ? { marginLeft: gap } : { marginTop: gap }}
          />
        ))}
      </div>
      {edge === "top" ? (
        <div className="edge-head edge-head-top">
          <EdgeBadge player={player} view={view} pips={pips} low={low} forward={forward} talk={bubble || notice} />
          <span className="token-slot" data-token-slot={player.id} data-edge={edge} aria-hidden="true" />
        </div>
      ) : null}
      <span className="sr-only">
        {player.name}, {count} tiles
      </span>
    </div>
  );
}

function EdgeBadge({
  player,
  view,
  pips,
  low,
  forward,
  talk,
}: {
  player: PlayerView["players"][number];
  view: PlayerView;
  pips: number | null;
  low: boolean;
  forward: boolean;
  talk: string | null;
}) {
  const clock = useServerNow(view.serverNow);
  const live = useShownScore(player.id, player.score);
  const over = live.score >= view.settings.targetScore;
  return (
    <div className={`seat-chip edge-badge${player.isTurn ? " turn" : ""}${live.hot ? " win-hot" : ""}${forward ? " win-forward" : ""}`} data-player-id={player.id}>
      <AvatarFace
        id={player.avatarId}
        bot={player.bot}
        skill={cpuSkill(player.difficulty)}
        frameId={player.frameId}
        timer={turnRatio(player.isTurn, view, clock)}
      />
      <span className="game-col">
        <strong className={live.pulse ? "is-scoring" : undefined} data-win-score={player.id} data-over={over ? "true" : "false"}>
          {live.score}
        </strong>
        <GamePips won={player.gamesWon} needed={view.winsNeeded} />
      </span>
      {pips != null ? <em className={`seat-pips${low ? " low" : ""}`}>{low ? `${pips} LOW HAND` : pips}</em> : null}
      {talk ? <TalkLine text={talk} /> : null}
    </div>
  );
}

/** The target lights when a counted chip crosses it, in step with the readout. */
function SeriesTarget({ view }: { view: PlayerView }) {
  const players = [...view.players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown = players.map((player) => useShownScore(player.id, player.score).score);
  const hot = shown.some((score) => score >= view.settings.targetScore);
  return <em data-hot={hot ? "true" : "false"}>{view.settings.targetScore}</em>;
}

function SeatChip({
  player,
  view,
  pips = null,
  low = false,
  forward = false,
  talk = null,
}: {
  player: PlayerView["players"][number];
  view: PlayerView;
  pips?: number | null;
  low?: boolean;
  forward?: boolean;
  talk?: string | null;
}) {
  const clock = useServerNow(view.serverNow);
  const live = useShownScore(player.id, player.score);
  return (
    <div
      className={`seat-chip${player.isTurn ? " turn" : ""}${player.isYou ? " you" : ""}${player.bot ? " bot" : ""}${live.hot ? " win-hot" : ""}${forward ? " win-forward" : ""}`}
      data-account-bot={player.accountBot ? "true" : "false"}
      data-player-id={player.id}
      data-turn={player.isTurn ? "true" : "false"}
      data-turn-timer={player.isTurn && view.phase === "play" ? "true" : "false"}
    >
      <AvatarFace
        id={player.avatarId}
        bot={player.bot}
        skill={cpuSkill(player.difficulty)}
        frameId={player.frameId}
        timer={turnRatio(player.isTurn, view, clock)}
      />
      <span className="chip-text">
        <span className="chip-name">
          {player.isYou ? "You" : player.name}
          {player.accountBot ? <BotBadge /> : null}
          {!player.connected && !player.bot ? <em className="away"> away</em> : null}
        </span>
        <span className="chip-meta">
          <strong
            className={live.pulse ? "is-scoring" : undefined}
            data-win-score={player.id}
            data-over={live.score >= view.settings.targetScore ? "true" : "false"}
          >
            {live.score}
          </strong>
          <GamePips won={player.gamesWon} needed={view.winsNeeded} />
          {pips != null ? <em className={`seat-pips${low ? " low" : ""}`}>{low ? `${pips} LOW HAND` : pips}</em> : null}
          {player.rank && !player.bot ? (
            <RankLine
              tierId={player.rank.tierId}
              tierName={player.rank.tierName}
              step={player.rank.step}
              rating={player.rank.rating}
              provisional={player.rank.provisional}
              compact
            />
          ) : null}
          {player.isYou ? null : <span className="sr-only">{player.tileCount} tiles</span>}
        </span>
      </span>
      {talk ? <TalkLine text={talk} /> : null}
    </div>
  );
}

/** One line, clipped to the badge. It never hangs over the chain. */
function TalkLine({ text }: { text: string }) {
  return (
    <p className={`talk-line${isReaction(text) ? " talk-reaction" : ""}`} data-talk="1">
      {text}
    </p>
  );
}

function YardPile({
  view,
  onDraw,
  onKnock,
}: {
  view: PlayerView;
  onDraw: () => void;
  onKnock: () => void;
}) {
  if (view.canKnock) {
    return (
      <button type="button" className="bone-pile knock" data-action="knock" onClick={onKnock}>
        Knock
      </button>
    );
  }
  const draw = view.canDraw;
  return (
    <button
      type="button"
      className={`bone-pile${draw ? " pulse" : ""}`}
      data-action={draw ? "draw" : "boneyard"}
      data-boneyard={view.boneyardCount}
      disabled={!draw}
      aria-label={draw ? `Draw from the boneyard, ${view.boneyardCount} left` : `${view.boneyardCount} in the boneyard`}
      onClick={draw ? onDraw : undefined}
    >
      <span className="pile" aria-hidden="true">
        <i className="tile-back" />
        <i className="tile-back" />
        <i className="tile-back" />
      </span>
      <strong>{view.boneyardCount}</strong>
      {draw ? <em>Draw</em> : null}
    </button>
  );
}

function StatusLine({ view }: { view: PlayerView }) {
  const math = scoreMathOn() && view.openEquation ? view.openEquation.replaceAll(" ", "") : null;
  if (!math) return null;
  return (
    <p className="status-line" data-phase={view.phase}>
      <span className="status-math">{math}</span>
    </p>
  );
}

function useFleetingNotice(view: PlayerView): { playerId: string; text: string } | null {
  const token = noticeToken(view);
  const [notice, setNotice] = useState<{ playerId: string; text: string } | null>(null);
  useEffect(() => {
    const next = fleetingNotice(view);
    if (!next) {
      setNotice(null);
      return;
    }
    setNotice(next);
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [token]);
  return notice;
}

function noticeToken(view: PlayerView): string {
  if (view.phase === "draw" || view.phase === "knock") {
    return `blocked:${view.gameNumber}:${view.handNumber}:${view.turnPlayerId ?? ""}`;
  }
  if (view.phase !== "play") return "";
  const draw = view.lastDraw;
  if (!draw) return "";
  return `draw:${view.gameNumber}:${view.handNumber}:${draw.playerId}:${draw.count}:${draw.tileIds?.join(",") ?? ""}`;
}

function fleetingNotice(view: PlayerView): { playerId: string; text: string } | null {
  if (view.phase === "draw" || view.phase === "knock") {
    return { playerId: view.yourId, text: "No dominoes to play" };
  }
  if (view.phase !== "play" || !view.lastDraw) return null;
  const draw = view.lastDraw;
  if (draw.playerId === view.yourId && draw.tileIds && draw.tileIds.length === 1) {
    return { playerId: draw.playerId, text: `Drew ${pretty(draw.tileIds[0] ?? "")}` };
  }
  return { playerId: draw.playerId, text: `Drew ${draw.count}` };
}

/** Brand mark in the top bar. It is not the last-domino token and it does not move. */
function PlayMark() {
  return (
    <svg className="play-mark" viewBox="0 0 16 24" data-mark="brand" aria-hidden="true">
      <rect x="0.75" y="0.75" width="14.5" height="22.5" rx="2" />
      <line x1="1" y1="12" x2="15" y2="12" />
      <circle cx="8" cy="6.2" r="1.5" />
      <circle cx="5.2" cy="17.6" r="1.3" />
      <circle cx="10.8" cy="17.6" r="1.3" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h3l4-3v12l-4-3H4z" />
      {muted ? (
        <path d="M16 9.5 20.5 14.5M20.5 9.5 16 14.5" />
      ) : (
        <path d="M16 9.2a3.2 3.2 0 0 1 0 5.6M18.2 7a6 6 0 0 1 0 10" />
      )}
    </svg>
  );
}

function TalkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6.5h14v9H8.5L5 18.5z" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 6H6.5v12H10" />
      <path d="M10 12h8M15 8.5 18.5 12 15 15.5" />
    </svg>
  );
}

function scoreMathOn(): boolean {
  return window.__UHOH__?.showScoreMath !== false;
}

/** Extra time for a big score holds the clock at a full turn, then it counts down. */
function shownLeft(deadline: number, now: number, budget: number): number {
  const left = Math.max(0, deadline - now);
  return budget > 0 ? Math.min(left, budget) : left;
}

function cpuMark(level: string | null): string {
  const skill = cpuSkill(level);
  return skill ? `${skill.label} ${skill.rating}` : "Medium 1200";
}

/** Portrait ring for the seat that is on the clock. A computer with no clock gets a full ring. */
function turnRatio(isTurn: boolean, view: PlayerView, clock: number): number | null {
  const live = view.phase === "play" || view.phase === "draw" || view.phase === "knock";
  if (!isTurn || !live) return null;
  if (!view.turnDeadline || view.turnBudgetMs <= 0) return 1;
  return shownLeft(view.turnDeadline, clock, view.turnBudgetMs) / view.turnBudgetMs;
}

function useServerNow(serverNow: number): number {
  const offset = useRef(serverNow - Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    offset.current = serverNow - Date.now();
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return now + offset.current;
}

function TurnBar({ view }: { view: PlayerView }) {
  const now = useServerNow(view.serverNow);
  if (!view.turnDeadline) return null;
  const left = shownLeft(view.turnDeadline, now, view.turnBudgetMs);
  const ratio = view.turnBudgetMs > 0 ? left / view.turnBudgetMs : 0;
  return (
    <div className="turn-bar" data-turn-timer="true" aria-label={`${Math.ceil(left / 1000)} seconds`}>
      <span style={{ transform: `scaleX(${ratio})` }} />
      <em>{Math.ceil(left / 1000)}</em>
    </div>
  );
}

function ScoreList({ view }: { view: PlayerView }) {
  return (
    <ul className="score-list" data-games-tally={gameTallyText(view.players.map((player) => player.gamesWon))} data-series-target={view.winsNeeded}>
      {view.players.map((player) => (
        <li key={player.id} data-player-id={player.id}>
          <span>{player.isYou ? "You" : player.name}</span>
          <span className="score-figures">
            <GamePips won={player.gamesWon} needed={view.winsNeeded} />
            <strong>{player.score}</strong>
          </span>
        </li>
      ))}
    </ul>
  );
}

function HandSummary({
  view,
  onContinue,
  onRematch,
  onLeaveMatch,
}: {
  view: PlayerView;
  onContinue: () => void;
  onRematch: () => void;
  onLeaveMatch: () => void;
}) {
  const hand = view.lastHand;
  const now = useServerNow(view.serverNow);
  if (!hand) return null;
  const names = new Map(view.players.map((player) => [player.id, player.isYou ? "You" : player.name]));
  const winners = hand.winnerIds.map((id) => names.get(id) ?? "Someone");
  const gameOver = Boolean(hand.gameWinnerId);
  const seriesOver = Boolean(hand.seriesWinnerId);
  const seconds = view.continueDeadline ? Math.max(0, Math.ceil((view.continueDeadline - now) / 1000)) : null;
  const places = [...hand.placements].sort((a, b) => a.place - b.place || a.playerId.localeCompare(b.playerId));
  const last = view.lastPlay;
  const wentOut = hand.reason === "domino";
  const lastFace = last ? faceOf(last.tileId) : null;
  return (
    <section className="hand-summary" data-screen={seriesOver ? "series" : gameOver ? "game" : hand.reason === "locked" && hand.winnerIds.length > 1 ? "tied-lock" : "hand"}>
      <p className="result-kicker">{view.settings.seriesLength === 1 && (seriesOver || gameOver) ? "Single game" : seriesOver ? "Series over" : gameOver ? "Game over" : "Hand over"}</p>
      <p className="series-tally" data-games-tally={gameTallyText(view.players.map((player) => player.gamesWon))} data-series-target={view.winsNeeded} data-format={view.settings.seriesLength === 1 ? "single" : "series"}>
        {view.settings.seriesLength === 1 ? "Single game" : `Series · Games ${gameTallyText(view.players.map((player) => player.gamesWon))} · first to ${view.winsNeeded}`}
      </p>
      <div className="winner-row">
        <h2>{winners.join(" and ")} {hand.winnerIds.length > 1 ? "split it" : "won the hand"}</h2>
        {view.dailyNotes && view.dailyNotes.length > 0 ? (
          <div className="daily-lines">
            {view.dailyNotes.map((line, index) => (
              <p key={`${line}-${index}`} className="daily-line">{line}</p>
            ))}
          </div>
        ) : null}
        {last && lastFace ? (
          <p className="last-tile-line" data-last-tile={last.tileId} data-last-player={last.playerId}>
            <span>{wentOut ? "Went out with" : "Last played"}</span>
            <Domino a={lastFace.low} b={lastFace.high} orientation="vertical" />
            {wentOut ? null : <span>{names.get(last.playerId) ?? "Someone"}</span>}
          </p>
        ) : null}
      </div>
      {gameOver && view.playAccuracy ? (
        <div className="accuracy-result" data-accuracy={view.playAccuracy.percent}>
          <p className="accuracy-line">Play Accuracy: {view.playAccuracy.percent}%</p>
          {view.playAccuracy.missPoints > 0 && view.playAccuracy.missTileId ? (
            <p className="accuracy-miss" data-miss-tile={view.playAccuracy.missTileId}>
              {accuracyMissLine(view.playAccuracy.missTileId, view.playAccuracy.missPoints)}
            </p>
          ) : null}
        </div>
      ) : null}
      <ScoreList view={view} />
      <p>{hand.summary}</p>
      <p className="round-note">Leftovers round to the nearest 5. A tie rounds each share the same way.</p>
      <ol className="place-list">
        {places.map((place) => (
          <li key={place.playerId}>
            {place.place}
            {place.tied ? " (tie)" : ""} · {names.get(place.playerId) ?? "Someone"} · {place.pips} pips
            {hand.leftoverAwards[place.playerId] ? ` · +${hand.leftoverAwards[place.playerId]}` : ""}
          </li>
        ))}
      </ol>
      <div className="reveal-row">
        {hand.remaining
          .filter((seat) => !hand.winnerIds.includes(seat.playerId) || hand.reason === "score")
          .map((seat) => (
            <div key={seat.playerId} className="reveal">
              <p>{names.get(seat.playerId) ?? "Someone"} · {seat.pips}</p>
              <div className="reveal-tiles">
                {seat.tiles.map((tile) => (
                  <Domino key={tile.id} a={tile.low} b={tile.high} orientation="vertical" />
                ))}
              </div>
            </div>
          ))}
      </div>
      {gameOver && view.recap ? <RankRecapView recap={view.recap} names={names} faces={playerFaces(view)} /> : null}
      {view.betweenHands ? (
        <div className="match-over-actions">
          <button type="button" className="primary" data-action="continue" onClick={onContinue}>
            Continue{seconds !== null ? ` · ${seconds}` : ""}
          </button>
        </div>
      ) : view.phase === "over" || view.status === "complete" ? (
        <div className="match-over-actions">
          {view.canRematch ? (
            <button
              type="button"
              className="primary"
              data-action="rematch"
              onClick={() => {
                pulse("rematch");
                onRematch();
              }}
            >
              Play again
            </button>
          ) : view.status === "complete" ? (
            <p className="hint">Play again is ready when the host starts it and everyone is still here.</p>
          ) : null}
          <button type="button" className="secondary" data-action="leave-match" onClick={onLeaveMatch}>
            Leave Match
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ChatPanel({
  open,
  view,
  chat,
  onClose,
  onPreset,
  onMuted,
}: {
  open: boolean;
  view: PlayerView;
  chat: ChatLine[];
  onClose: () => void;
  onPreset: (packId: string, tauntId: string) => void;
  onMuted: (playerId: string) => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.length, open]);
  const lines = view.taunts.filter((taunt) => !taunt.reaction);
  const reactions = view.taunts.filter((taunt) => taunt.reaction);

  return (
    <>
    {open ? <button type="button" className="chat-scrim" aria-label="Close chat" onClick={onClose} /> : null}
    <aside className={`chat-panel${open ? " open" : ""}`} data-screen="talk">
      <header>
        <h2>Table talk</h2>
        <button type="button" className="text-button mobile-only" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="taunt-grid">
        {lines.map((taunt) => (
          <button type="button" key={`${taunt.packId}:${taunt.id}`} onClick={() => onPreset(taunt.packId, taunt.id)}>
            {taunt.text}
          </button>
        ))}
      </div>
      <div className="reaction-row">
        {reactions.map((taunt) => (
          <button type="button" key={`${taunt.packId}:${taunt.id}`} onClick={() => onPreset(taunt.packId, taunt.id)}>
            {taunt.text}
          </button>
        ))}
      </div>
      <div className="table-safety">
        <h3>Players</h3>
        {note ? <p className="hint">{note}</p> : null}
        {view.players
          .filter((player) => !player.isYou)
          .map((player) => {
            const computer = player.bot && !player.accountBot;
            return (
              <div key={player.id} className="safety-row">
                <span>{player.name}</span>
                {computer ? <span className="hint">Computer</span> : null}
                {computer ? null : reporting === player.id ? (
                  <>
                    {(["rude", "cheat", "other"] as const).map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        className="text-button"
                        data-action="report-player"
                        data-reason={reason}
                        disabled={busyId === player.id}
                        onClick={() => {
                          setBusyId(player.id);
                          void fetch("/api/safety/report", {
                            method: "POST",
                            credentials: "same-origin",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ playerId: player.id, reason }),
                          })
                            .then(async (response) => {
                              const body = (await response.json().catch(() => ({}))) as { error?: string };
                              setNote(response.ok ? "Reported." : body.error ?? "That report did not send.");
                              if (response.ok) setReporting(null);
                            })
                            .finally(() => setBusyId(null));
                        }}
                      >
                        {reason === "rude" ? "Rude" : reason === "cheat" ? "Cheating" : "Other"}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button type="button" className="text-button" data-action="report-player" onClick={() => setReporting(player.id)}>
                      Report
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      data-action="block-player"
                      disabled={busyId === player.id}
                      onClick={() => {
                        setBusyId(player.id);
                        void fetch("/api/safety/block", {
                          method: "POST",
                          credentials: "same-origin",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ playerId: player.id }),
                        })
                          .then(async (response) => {
                            const body = (await response.json().catch(() => ({}))) as { error?: string };
                            if (!response.ok) {
                              setNote(body.error ?? "That block did not stick.");
                              return;
                            }
                            onMuted(player.id);
                            setNote(`${player.name} is blocked. Their talk stays hidden, and you will not be seated together.`);
                          })
                          .finally(() => setBusyId(null));
                      }}
                    >
                      Block
                    </button>
                  </>
                )}
              </div>
            );
          })}
      </div>
      <div className="chat-log" ref={listRef}>
        {chat.length === 0 ? <p className="muted">The table is quiet. For now.</p> : null}
        {chat.map((line) => (
          <p key={line.id} className={line.playerId === view.yourId ? "mine" : ""}>
            <span>{line.playerId === view.yourId ? "You" : line.name}</span>
            {line.text}
          </p>
        ))}
      </div>
    </aside>
    </>
  );
}

function useTalkBubble(chat: ChatLine[]): ChatLine | null {
  const [bubble, setBubble] = useState<ChatLine | null>(null);
  const seenId = useRef<number | null>(null);
  useEffect(() => {
    const last = chat.at(-1);
    if (!last || last.id === seenId.current) return;
    const firstLook = seenId.current === null;
    seenId.current = last.id;
    if (firstLook) {
      const at = last.at ? Date.parse(last.at) : Number.NaN;
      if (!Number.isFinite(at) || Date.now() - at > 4_000) return;
    }
    setBubble(last);
    const timer = window.setTimeout(() => {
      setBubble((current) => (current?.id === last.id ? null : current));
    }, 2_400);
    return () => window.clearTimeout(timer);
  }, [chat]);
  return bubble;
}

function useUnread(chat: ChatLine[], chatOpen: boolean): boolean {
  const seen = useRef(0);
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (chatOpen) {
      seen.current = chat.length;
      setUnread(false);
      return;
    }
    setUnread(chat.length > seen.current);
  }, [chat, chatOpen]);
  return unread;
}

/** Emoji reactions are short and have no letters, so they can leave the tile alone quickly. */
function isReaction(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 8 && !/[0-9A-Za-z]/.test(trimmed);
}

function bubbleText(bubble: ChatLine | null, playerId: string): string | null {
  if (!bubble || bubble.playerId !== playerId) return null;
  return bubble.text;
}

function handKey(view: PlayerView): string {
  return view.lastHand ? `${view.lastHand.gameNumber}-${view.lastHand.handNumber}` : "";
}

function playerNames(view: PlayerView): Map<string, string> {
  return new Map(view.players.map((player) => [player.id, player.isYou ? "You" : player.name]));
}

function playerFaces(view: PlayerView): Map<string, string> {
  return new Map(view.players.map((player) => [player.id, player.avatarId]));
}

function pretty(tileId: string): string {
  const [low, high] = tileId.split("-");
  return `${high}–${low}`;
}

function accuracyMissLine(tileId: string, points: number): string {
  const face = faceOf(tileId);
  return `The ${face.high}–${face.low} cost you ~${points} points.`;
}

function faceOf(tileId: string): { low: number; high: number } {
  const [low, high] = tileId.split("-").map((part) => Number(part));
  return {
    low: Number.isFinite(low) ? low! : 0,
    high: Number.isFinite(high) ? high! : 0,
  };
}

/** A rules sentence can be shown. An exception cannot. */
function playerError(message: string): string {
  if (/cannot read|undefined|typeerror|syntaxerror|is not a function|reading '|broke the board/i.test(message)) {
    return "That play didn't land. The hand is still going.";
  }
  return message;
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }
}

async function textLink(link: string, note: (value: string | null) => void) {
  pulse("share");
  const payload = { title: "UhOh Dominoes", text: shareText(link), url: link };
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      note(null);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = smsHref(link);
    return;
  }
  copyText(link);
  note("Link copied. Paste it into a text.");
}

function socketUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function roomFromLocation(): string | null {
  const path = location.pathname.match(/^\/r\/([A-Za-z0-9]{4,8})$/);
  if (path?.[1]) return path[1].toUpperCase();
  const query = new URLSearchParams(location.search).get("room");
  return query ? query.toUpperCase() : null;
}
