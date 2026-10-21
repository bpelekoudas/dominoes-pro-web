import { useEffect, useRef, useState } from "react";
import type { Intent, PlayerView } from "@uhoh/rules";
import { tableLink } from "./link.js";
import { seatAround, type SeatEdge } from "./seats.js";
import { bigMomentLevel } from "../../rules/src/moment.js";
import { demoAward, demoRequested, FxGallery, fxGalleryRequested, UhOhPreview } from "./moment.js";
import { cuesForPlay, cuesForTurn } from "./cues";
import { primeMusic } from "./music";
import { isMuted, playCues, preloadSounds, setMuted, unlockSound } from "./sound";
import { Domino, Hand, Table } from "./table";
import { AccountChip, AccountLayer, useAccount, type AccountUser } from "./account";
import { RankLine, RankRecapView, RankDemo, rankDemoRequested } from "./rank";
import { ArcadeHome, MenuDemo, QuickWait, Splash, menuDemoRequested, reducedMotion } from "./arcade";
import { AvatarFace, BotBadge } from "./avatars";
import { useMatchCosmetics } from "./store";

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
type SeriesLength = 3 | 5 | 7;

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

    if (sessionStorage.getItem(RESUME_KEY) === "1" && localStorage.getItem(TOKEN_KEY)) connect();
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
        <ArcadeHome
          presetCode={roomFromLocation() ?? ""}
          error={error ?? account.error}
          connecting={status === "connecting"}
          initialName={account.user?.displayName ?? ""}
          user={account.user}
          onCreate={(name, playerCount, boneyardMode, seriesLength) =>
            void begin({ type: "create", name, playerCount, boneyardMode, seriesLength })
          }
          onSolo={(name, playerCount, boneyardMode, seriesLength, difficulty) =>
            void begin({ type: "solo", name, playerCount, boneyardMode, seriesLength, difficulty })
          }
          onJoin={(name, code) => void begin({ type: "join", name, code })}
          onQuick={(name, size) => void begin({ type: "quick", name, size })}
          onGuest={(name) => void account.ensureGuest(name)}
          onAccount={() => account.openSheet("profile")}
          onBoard={() => account.showBoard("rating")}
          onLook={() => account.openSheet("look")}
          onRefresh={() => void account.refresh()}
          onPreview={scoreMathOn() ? () => setPreview(true) : null}
        />
        {splash ? <Splash onDone={finishSplash} /> : null}
        <AccountLayer account={account} />
      </>
    );
  }

  return (
    <>
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
    setError(message.message);
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

function Game({
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
  const tableArt = view.tableId ? `/store/${view.tableId}.webp?v=6` : null;
  const tileSkin = cosmetics.skin || "ivory";
  void dismissedHand;
  const [drag, setDrag] = useState<{ tileId: string; aimEndId: string | null } | null>(null);
  const bubble = useTalkBubble(chat);
  const unread = useUnread(chat, chatOpen);
  const play = (tileId: string, endId: string) => onSend({ type: "intent", intent: { type: "play", tileId, endId } satisfies Intent });
  const around = seatAround(view.players);
  const left = around.find((seat) => seat.edge === "left") ?? null;
  const top = around.find((seat) => seat.edge === "top") ?? null;
  const right = around.find((seat) => seat.edge === "right") ?? null;
  const you = around.find((seat) => seat.edge === "bottom") ?? null;
  const yourTurn = view.turnPlayerId === view.yourId && view.phase !== "over" && view.phase !== "lobby" && view.phase !== "between";
  const [muted, setMute] = useState(isMuted);
  const [replayToken, setReplayToken] = useState(0);
  useEffect(() => {
    if (demoRequested()) setReplayToken(1);
  }, []);
  useEffect(() => {
    const play = view.lastPlay;
    // 20+ is the UH-OH moment, which plays the slam, the glass, and the cha-ching together.
    if (!play || bigMomentLevel(play.awarded)) return;
    playCues(cuesForPlay(play.awarded, play.tileId));
  }, [view.lastPlay?.seq]);
  useEffect(() => {
    if (yourTurn) playCues(cuesForTurn());
  }, [yourTurn, view.turnPlayerId, view.handNumber]);

  const playing = view.status !== "lobby";
  const showingResult = Boolean(
    view.lastHand && (view.betweenHands || view.phase === "over" || view.phase === "between") && !view.ended,
  );
  return (
    <main
      className={`felt-app${chatOpen ? " chat-open" : ""}${iris ? " iris-play" : ""}${showingResult ? " showing-result" : ""}`}
      data-skin="ivory"
      data-tile-skin={tileSkin}
    >
      <div className="felt-column">
      <header className="playbar">
        <PlayMark />
        {playing ? (
          <button type="button" className="code-chip play-code" data-room-code={view.roomCode} onClick={() => copyText(link)}>
            {view.roomCode}
          </button>
        ) : null}
        <p className="series-line">
          {playing
            ? `Bo${view.settings.seriesLength} · G${view.gameNumber} · H${view.handNumber} · to ${view.settings.targetScore}`
            : "Lobby"}
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
      {view.lastHand && (view.betweenHands || view.phase === "over" || view.phase === "between") && !view.ended ? (
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
        />
      ) : view.status === "lobby" ? (
        <Lobby view={view} link={link} onStart={() => onSend({ type: "start" })} onSend={onSend} />
      ) : (
        <>
          <div className="table-frame" data-opponents={around.length - 1}>
            {top ? (
              <SeatRail edge="top" player={top.player} bubble={bubbleText(bubble, top.player.id)} view={view} />
            ) : null}
            <div className="table-middle">
              {left ? (
                <SeatRail edge="left" player={left.player} bubble={bubbleText(bubble, left.player.id)} view={view} />
              ) : null}
              <Table
                view={view}
                selectedTile={selectedTile}
                dragTileId={drag?.tileId ?? null}
                aimEndId={drag?.aimEndId ?? null}
                onPlay={play}
                onSelect={onSelect}
                replayToken={replayToken}
                tableArt={tableArt}
              />
              {right ? (
                <SeatRail edge="right" player={right.player} bubble={bubbleText(bubble, right.player.id)} view={view} />
              ) : null}
            </div>
          </div>
          <div className="hand-tray">
            <div className="tray-notices">
              <div className="you-float">
                {you ? <SeatChip player={you.player} view={view} /> : null}
                {you && bubbleText(bubble, you.player.id) ? (
                  <p className="talk-bubble">{bubbleText(bubble, you.player.id)}</p>
                ) : null}
              </div>
              <div className="tray-copy">
                <p className={`your-turn${yourTurn ? "" : " reserved"}`}>Your turn</p>
                {yourTurn ? <TurnBar view={view} /> : <div className="turn-bar reserved" aria-hidden="true" />}
                <StatusLine view={view} />
                {demoRequested() ? (
                  <button type="button" className="uhoh-test" data-demo="uhoh" onClick={() => setReplayToken((value) => value + 1)}>
                    UH-OH
                  </button>
                ) : null}
              </div>
            </div>
            <div className="tray-row">
              <Hand
                view={view}
                selectedTile={selectedTile}
                onSelect={onSelect}
                onPlay={play}
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
        chat={chat}
        onClose={onToggleChat}
        onPreset={(packId, tauntId) => onSend({ type: "chat", kind: "preset", packId, tauntId })}
      />
    </main>
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
      <button type="button" className="primary" onClick={() => copyText(link)}>
        Copy link
      </button>
      <ul className="seat-list">
        {view.players.map((player) => (
          <li key={player.id} className={player.bot ? "bot-seat" : ""}>
            <span className="who">
              <AvatarFace id={player.avatarId} bot={player.bot && !player.accountBot} frameId={player.frameId} />
              <span>
                {player.isYou ? `${player.name} (you)` : player.name}
                {player.accountBot ? <BotBadge /> : null}
                {player.bot && !player.accountBot ? (
                  <small className="bot-label">Computer · {labelDifficulty(player.difficulty)}</small>
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
        Best of {view.settings.seriesLength}. {mode} First to {view.settings.targetScore}. {view.prompt}
      </p>
      {view.canStart ? (
        <button type="button" className="primary" data-action="start" onClick={onStart}>
          Deal the first hand
        </button>
      ) : null}
    </section>
  );
}

function SeatRail({
  edge,
  player,
  bubble,
  view,
}: {
  edge: Exclude<SeatEdge, "bottom">;
  player: PlayerView["players"][number];
  bubble: string | null;
  view: PlayerView;
}) {
  return (
    <div
      className={`rail rail-${edge}${player.isTurn ? " turn" : ""}`}
      data-edge={edge}
      data-player-id={player.id}
      data-tiles={player.tileCount}
    >
      {edge === "top" ? <SeatChip player={player} view={view} /> : null}
      <div className={`backs backs-${edge}`} aria-hidden="true">
        {Array.from({ length: player.tileCount }, (_, index) => (
          <i key={index} className="tile-back" />
        ))}
      </div>
      {edge === "top" ? null : <SeatChip player={player} view={view} />}
      {bubble ? <p className="talk-bubble">{bubble}</p> : null}
    </div>
  );
}

function SeatChip({ player, view }: { player: PlayerView["players"][number]; view: PlayerView }) {
  const clock = useServerNow(view.serverNow);
  const left = player.isTurn && view.turnDeadline ? shownLeft(view.turnDeadline, clock, view.turnBudgetMs) : 0;
  const ratio = view.turnBudgetMs > 0 ? left / view.turnBudgetMs : 0;
  return (
    <div
      className={`seat-chip${player.isTurn ? " turn" : ""}${player.isYou ? " you" : ""}${player.bot ? " bot" : ""}`}
      data-account-bot={player.accountBot ? "true" : "false"}
      data-player-id={player.id}
      data-turn={player.isTurn ? "true" : "false"}
      data-turn-timer={player.isTurn && view.turnDeadline ? "true" : "false"}
    >
      <AvatarFace
        id={player.avatarId}
        bot={player.bot && !player.accountBot}
        frameId={player.frameId}
        timer={player.isTurn && view.turnDeadline ? ratio : null}
      />
      <span className="chip-text">
        <span className="chip-name">
          {player.isYou ? "You" : player.name}
          {player.accountBot ? <BotBadge /> : null}
          {!player.connected && !player.bot ? <em className="away"> away</em> : null}
        </span>
        <span className="chip-meta">
          <strong>{player.score}</strong>
          {player.rank ? (
            <RankLine
              tierId={player.rank.tierId}
              tierName={player.rank.tierName}
              step={player.rank.step}
              rating={player.rank.rating}
              provisional={player.rank.provisional}
              compact
            />
          ) : null}
          {player.isYou ? null : <span className="tile-label">{player.tileCount} tiles</span>}
        </span>
      </span>
    </div>
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
  const note = drawNote(view);
  const prompt = view.prompt === "Your turn." ? null : view.prompt;
  const text = note ?? prompt;
  return (
    <p className="status-line" data-phase={view.phase}>
      {math ? <span className="status-math">{math}</span> : null}
      {text ? <span className="status-prompt">{text}</span> : null}
    </p>
  );
}

function drawNote(view: PlayerView): string | null {
  if (!view.lastDraw) return null;
  if (view.lastDraw.playerId === view.yourId) {
    if (view.lastDraw.tileIds && view.lastDraw.tileIds.length === 1) return `You drew ${pretty(view.lastDraw.tileIds[0] ?? "")}.`;
    return `You drew ${view.lastDraw.count} tile${view.lastDraw.count === 1 ? "" : "s"}.`;
  }
  return `${nameOf(view, view.lastDraw.playerId)} drew ${view.lastDraw.count}.`;
}

function PlayMark() {
  return (
    <svg className="play-mark" viewBox="0 0 16 24" aria-hidden="true">
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

function labelDifficulty(level: string | null): string {
  if (level === "easy") return "Easy";
  if (level === "hard") return "Hard";
  if (level === "expert") return "Expert";
  return "Medium";
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
    <ul className="score-list">
      {view.players.map((player) => (
        <li key={player.id}>
          <span>{player.isYou ? "You" : player.name}</span>
          <strong>{player.score}</strong>
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
      <p className="result-kicker">{seriesOver ? "Series over" : gameOver ? "Game over" : "Hand over"}</p>
      <div className="winner-row">
        <h2>{winners.join(" and ")} {hand.winnerIds.length > 1 ? "split it" : "won the hand"}</h2>
        {last && lastFace ? (
          <p className="last-tile-line" data-last-tile={last.tileId} data-last-player={last.playerId}>
            <span>{wentOut ? "Went out with" : "Last played"}</span>
            <Domino a={lastFace.low} b={lastFace.high} orientation="vertical" />
            {wentOut ? null : <span>{names.get(last.playerId) ?? "Someone"}</span>}
          </p>
        ) : null}
      </div>
      <p>{hand.summary}</p>
      <p className="round-note">Leftovers round down to the nearest 5.</p>
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
      <ScoreList view={view} />
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
            <button type="button" className="secondary" data-action="rematch" onClick={onRematch}>
              Play Again
            </button>
          ) : null}
          <button type="button" className="primary" data-action="leave-match" onClick={onLeaveMatch}>
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
}: {
  open: boolean;
  view: PlayerView;
  chat: ChatLine[];
  onClose: () => void;
  onPreset: (packId: string, tauntId: string) => void;
}) {
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
    }, 3_000);
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

function nameOf(view: PlayerView, playerId: string): string {
  return view.players.find((player) => player.id === playerId)?.name ?? "Someone";
}

function pretty(tileId: string): string {
  const [low, high] = tileId.split("-");
  return `${high}–${low}`;
}

function faceOf(tileId: string): { low: number; high: number } {
  const [low, high] = tileId.split("-").map((part) => Number(part));
  return {
    low: Number.isFinite(low) ? low! : 0,
    high: Number.isFinite(high) ? high! : 0,
  };
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value).catch(() => undefined);
  }
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
