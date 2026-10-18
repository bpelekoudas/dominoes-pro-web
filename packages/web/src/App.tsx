import { useEffect, useRef, useState } from "react";
import type { Intent, PlayerView } from "@uhoh/rules";
import { tableLink } from "./link.js";
import { Logo } from "./logo.js";
import { seatAround, type SeatEdge } from "./seats.js";
import { Hand, Table } from "./table";

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

export function App() {
  const [view, setView] = useState<PlayerView | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [dismissedHand, setDismissedHand] = useState<string | null>(null);
  const [leaveArmed, setLeaveArmed] = useState(false);
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
        if (mine !== attempt) return;
        const message = handleMessage(String(event.data), setView, setChat, setError);
        if (message?.type === "welcome") {
          pending = null;
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

    if (localStorage.getItem(TOKEN_KEY)) connect();
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

  const openSocket = (first: object) => {
    setError(null);
    connectRef.current(first);
  };

  const leave = () => {
    leaveRef.current = true;
    localStorage.removeItem(TOKEN_KEY);
    socketRef.current?.close();
    setView(null);
    setChat([]);
    setLeaveArmed(false);
    setStatus("idle");
    if (location.pathname !== "/") history.replaceState(null, "", "/");
  };

  if (!view) {
    return (
      <Home
        presetCode={roomFromLocation() ?? ""}
        error={error}
        connecting={status === "connecting"}
        onCreate={(name, playerCount, boneyardMode, seriesLength) =>
          openSocket({ type: "create", name, playerCount, boneyardMode, seriesLength })
        }
        onSolo={(name, playerCount, boneyardMode, seriesLength) =>
          openSocket({ type: "solo", name, playerCount, boneyardMode, seriesLength })
        }
        onJoin={(name, code) => openSocket({ type: "join", name, code })}
      />
    );
  }

  return (
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
      onLeave={leave}
      onSend={(message) => send(message)}
    />
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

function Home({
  presetCode,
  error,
  connecting,
  onCreate,
  onSolo,
  onJoin,
}: {
  presetCode: string;
  error: string | null;
  connecting: boolean;
  onCreate: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength) => void;
  onSolo: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength) => void;
  onJoin: (name: string, code: string) => void;
}) {
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(2);
  const [boneyardMode, setBoneyardMode] = useState<BoneyardMode>("draw_until");
  const [seriesLength, setSeriesLength] = useState<SeriesLength>(3);
  const [code, setCode] = useState(presetCode);

  return (
    <main className="home" data-skin="ivory">
      <header className="brand">
        <Logo />
        <p className="lede">A private table for friends. The server deals, checks every tile, and keeps score.</p>
      </header>
      {error ? <p className="banner error">{error}</p> : null}
      {connecting ? <p className="banner">Connecting…</p> : null}
      <label className="name-field">
        Your name
        <input value={name} maxLength={16} autoComplete="nickname" onChange={(event) => setName(event.target.value)} />
      </label>
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onCreate(name, playerCount, boneyardMode, seriesLength);
        }}
      >
        <h2>Start a table</h2>
        <fieldset>
          <legend>Players</legend>
          <Choice
            value={playerCount}
            options={[
              { value: 2, label: "2" },
              { value: 3, label: "3" },
              { value: 4, label: "4" },
            ]}
            onChange={setPlayerCount}
          />
        </fieldset>
        <fieldset>
          <legend>Boneyard</legend>
          <Choice
            value={boneyardMode}
            options={[
              { value: "draw_until", label: "Draw until" },
              { value: "draw_one", label: "Draw one" },
            ]}
            onChange={setBoneyardMode}
          />
        </fieldset>
        <fieldset>
          <legend>Series</legend>
          <Choice
            value={seriesLength}
            options={[
              { value: 3, label: "Best of 3" },
              { value: 5, label: "Best of 5" },
              { value: 7, label: "Best of 7" },
            ]}
            onChange={setSeriesLength}
          />
        </fieldset>
        <button className="primary" type="submit" disabled={connecting || !name.trim()}>
          Create room
        </button>
        <button
          className="primary computer"
          type="button"
          disabled={connecting || !name.trim()}
          onClick={() => onSolo(name, playerCount, boneyardMode, seriesLength)}
        >
          Play vs computer
        </button>
        <p className="solo-note">
          You and {playerCount === 2 ? "one computer" : playerCount === 3 ? "two computers" : "three computers"}. The
          hand starts right away, using the players, boneyard, and series above.
        </p>
      </form>
      <form
        className="card join-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onJoin(name, code);
        }}
      >
        <h2>Join with a code</h2>
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
        <button className="primary" type="submit" disabled={connecting || !name.trim()}>
          Sit down
        </button>
      </form>
    </main>
  );
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
  onSend,
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
  onSend: (message: object) => void;
}) {
  const link = tableLink(view.roomCode, window.__UHOH__?.publicUrl, location.origin);
  const showResult = view.lastHand && dismissedHand !== handKey(view) && !view.lastPlay;
  const [drag, setDrag] = useState<{ tileId: string; aimEndId: string | null } | null>(null);
  const bubble = useTalkBubble(chat);
  const unread = useUnread(chat, chatOpen);
  const play = (tileId: string, endId: string) => onSend({ type: "intent", intent: { type: "play", tileId, endId } satisfies Intent });
  const around = seatAround(view.players);
  const left = around.find((seat) => seat.edge === "left") ?? null;
  const top = around.find((seat) => seat.edge === "top") ?? null;
  const right = around.find((seat) => seat.edge === "right") ?? null;
  const you = around.find((seat) => seat.edge === "bottom") ?? null;
  const yourTurn = view.turnPlayerId === view.yourId && view.phase !== "over" && view.phase !== "lobby";

  const playing = view.status !== "lobby";
  return (
    <main className={`felt-app${chatOpen ? " chat-open" : ""}`} data-skin="ivory">
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
          className={`icon-button${leaveArmed ? " armed" : ""}`}
          aria-label={leaveArmed ? "Leave now" : "Leave"}
          onClick={leaveArmed ? onLeave : onLeaveArm}
        >
          {leaveArmed ? "Leave" : <LeaveIcon />}
        </button>
      </header>

      {status !== "live" ? <p className="banner">Reconnecting…</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {showResult && view.lastHand ? (
        <div className="banner result">
          <p className="result-kicker">Hand over</p>
          <p>{view.lastHand.summary}</p>
          <button type="button" className="text-button" onClick={onDismiss}>
            Hide
          </button>
        </div>
      ) : null}

      {view.status === "lobby" ? (
        <Lobby view={view} link={link} onStart={() => onSend({ type: "start" })} onSend={onSend} />
      ) : (
        <>
          <div className="table-frame" data-opponents={around.length - 1}>
            {top ? <SeatRail edge="top" player={top.player} bubble={bubbleText(bubble, top.player.id)} /> : null}
            <div className="table-middle">
              {left ? <SeatRail edge="left" player={left.player} bubble={bubbleText(bubble, left.player.id)} /> : null}
              <Table
                view={view}
                selectedTile={selectedTile}
                dragTileId={drag?.tileId ?? null}
                aimEndId={drag?.aimEndId ?? null}
                onPlay={play}
                onSelect={onSelect}
              />
              {right ? <SeatRail edge="right" player={right.player} bubble={bubbleText(bubble, right.player.id)} /> : null}
            </div>
          </div>
          {view.canRematch ? (
            <div className="actions">
              <button type="button" className="primary" onClick={() => onSend({ type: "rematch" })}>
                Play another series
              </button>
            </div>
          ) : null}
          <div className="hand-tray">
            <div className="tray-notices">
              <div className="you-float">
                {you ? <SeatChip player={you.player} /> : null}
                {you && bubbleText(bubble, you.player.id) ? (
                  <p className="talk-bubble">{bubbleText(bubble, you.player.id)}</p>
                ) : null}
              </div>
              <div className="tray-copy">
                {yourTurn ? <p className="your-turn">Your turn</p> : null}
                <StatusLine view={view} />
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
        onText={(text) => onSend({ type: "chat", kind: "text", text })}
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
  const [difficulty, setDifficulty] = useState<"easy" | "normal">("normal");
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
              {player.bot ? <BotMark /> : null}
              <span>
                {player.isYou ? `${player.name} (you)` : player.name}
                {player.bot ? (
                  <small className="bot-label">Computer · {player.difficulty === "easy" ? "Easy" : "Normal"}</small>
                ) : null}
              </span>
            </span>
            {player.bot && host ? (
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
      {host && openSeats > 0 ? (
        <div className="bot-add">
          <fieldset>
            <legend>Computer</legend>
            <Choice
              value={difficulty}
              options={[
                { value: "easy", label: "Easy" },
                { value: "normal", label: "Normal" },
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
}: {
  edge: Exclude<SeatEdge, "bottom">;
  player: PlayerView["players"][number];
  bubble: string | null;
}) {
  return (
    <div
      className={`rail rail-${edge}${player.isTurn ? " turn" : ""}`}
      data-edge={edge}
      data-player-id={player.id}
      data-tiles={player.tileCount}
    >
      <div className={`backs backs-${edge}`} aria-hidden="true">
        {Array.from({ length: player.tileCount }, (_, index) => (
          <i key={index} className="tile-back" />
        ))}
      </div>
      <SeatChip player={player} />
      {bubble ? <p className="talk-bubble">{bubble}</p> : null}
    </div>
  );
}

function SeatChip({ player }: { player: PlayerView["players"][number] }) {
  const initial = player.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`seat-chip${player.isTurn ? " turn" : ""}${player.isYou ? " you" : ""}${player.bot ? " bot" : ""}`}
      data-player-id={player.id}
      data-turn={player.isTurn ? "true" : "false"}
    >
      <span className="avatar" aria-hidden="true">
        {player.bot ? <BotMark /> : initial}
      </span>
      <span className="chip-text">
        <span className="chip-name">
          {player.isYou ? "You" : player.name}
          {!player.connected && !player.bot ? <em className="away"> away</em> : null}
        </span>
        <span className="chip-meta">
          <strong>{player.score}</strong>
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
  if (!math && !text) return null;
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

function BotMark() {
  return (
    <svg className="bot-mark" viewBox="0 0 24 36" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="33" rx="3" />
      <line x1="2" y1="18" x2="22" y2="18" />
      <circle cx="12" cy="9" r="2.2" />
      <circle cx="8.2" cy="27" r="2" />
      <circle cx="15.8" cy="27" r="2" />
    </svg>
  );
}

function scoreMathOn(): boolean {
  return window.__UHOH__?.showScoreMath !== false;
}

function ChatPanel({
  open,
  view,
  chat,
  onClose,
  onPreset,
  onText,
}: {
  open: boolean;
  view: PlayerView;
  chat: ChatLine[];
  onClose: () => void;
  onPreset: (packId: string, tauntId: string) => void;
  onText: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.length, open]);

  return (
    <>
    {open ? <button type="button" className="chat-scrim" aria-label="Close chat" onClick={onClose} /> : null}
    <aside className={`chat-panel${open ? " open" : ""}`}>
      <header>
        <h2>Table talk</h2>
        <button type="button" className="text-button mobile-only" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="taunts">
        {view.taunts.map((taunt) => (
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
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          onText(text);
          setDraft("");
        }}
      >
        <input
          value={draft}
          maxLength={80}
          placeholder="Say it in 80 characters"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="primary">
          Send
        </button>
      </form>
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

function nameOf(view: PlayerView, playerId: string): string {
  return view.players.find((player) => player.id === playerId)?.name ?? "Someone";
}

function pretty(tileId: string): string {
  const [low, high] = tileId.split("-");
  return `${high}–${low}`;
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
