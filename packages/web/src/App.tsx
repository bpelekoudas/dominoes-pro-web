import { useEffect, useRef, useState } from "react";
import type { Intent, PlayerView } from "@uhoh/rules";
import { Hand, Table } from "./table";

interface ChatLine {
  id: number;
  playerId: string;
  name: string;
  kind: "preset" | "text";
  text: string;
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

  const send = (message: object) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  useEffect(() => {
    let stopped = false;
    let retry = 400;
    let socket: WebSocket | null = null;
    let timer = 0;

    const connect = () => {
      if (stopped || leaveRef.current) return;
      const token = localStorage.getItem(TOKEN_KEY);
      const room = roomFromLocation();
      if (!token && !room) {
        setStatus("idle");
        return;
      }
      if (!token) {
        setStatus("idle");
        return;
      }
      setStatus("connecting");
      socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 400;
        setStatus("live");
        socket?.send(JSON.stringify({ type: "reconnect", token }));
      };
      socket.onmessage = (event) => handleMessage(String(event.data), setView, setChat, setError);
      socket.onclose = () => {
        if (stopped || leaveRef.current) return;
        setStatus("connecting");
        timer = window.setTimeout(connect, retry);
        retry = Math.min(retry * 2, 4000);
      };
    };

    if (localStorage.getItem(TOKEN_KEY)) connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    setSelectedTile(null);
  }, [view?.turnPlayerId, view?.handNumber, view?.gameNumber, view?.you.hand.length]);

  const openSocket = (first: object) => {
    leaveRef.current = false;
    setError(null);
    setStatus("connecting");
    const socket = new WebSocket(socketUrl());
    socketRef.current = socket;
    socket.onopen = () => {
      setStatus("live");
      socket.send(JSON.stringify(first));
    };
    socket.onmessage = (event) => {
      const message = handleMessage(String(event.data), setView, setChat, setError);
      if (message?.type === "welcome") {
        localStorage.setItem(TOKEN_KEY, message.token);
        const url = `/r/${message.roomCode}`;
        if (location.pathname !== url) history.replaceState(null, "", url);
      }
    };
    socket.onclose = () => {
      if (!leaveRef.current && localStorage.getItem(TOKEN_KEY)) setStatus("connecting");
    };
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
  onJoin,
}: {
  presetCode: string;
  error: string | null;
  connecting: boolean;
  onCreate: (name: string, playerCount: number, boneyardMode: BoneyardMode, seriesLength: SeriesLength) => void;
  onJoin: (name: string, code: string) => void;
}) {
  const [name, setName] = useState("");
  const [playerCount, setPlayerCount] = useState(2);
  const [boneyardMode, setBoneyardMode] = useState<BoneyardMode>("draw_until");
  const [seriesLength, setSeriesLength] = useState<SeriesLength>(3);
  const [code, setCode] = useState(presetCode);

  return (
    <main className="home">
      <header className="brand">
        <p className="eyebrow">Straight dominoes</p>
        <h1>Uh Oh</h1>
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
              { value: "draw_until", label: "Draw until you can play" },
              { value: "draw_one", label: "Draw one, then pass" },
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
  const link = `${location.origin}/r/${view.roomCode}`;
  const showResult = view.lastHand && dismissedHand !== handKey(view) && !view.lastPlay;
  const play = (tileId: string, endId: string) => onSend({ type: "intent", intent: { type: "play", tileId, endId } satisfies Intent });

  return (
    <main className={`felt-app${chatOpen ? " chat-open" : ""}`}>
      <header className="topbar">
        <div>
          <p className="brand-lockup">Uh Oh</p>
          <button type="button" className="code-chip" data-room-code={view.roomCode} onClick={() => copyText(link)}>
            {view.roomCode}
          </button>
        </div>
        <div className="series-note">
          <span>
            Best of {view.settings.seriesLength} · first to {view.winsNeeded}
          </span>
          <span>
            {view.status === "lobby"
              ? "Lobby"
              : `Game ${view.gameNumber} · Hand ${view.handNumber} · to ${view.settings.targetScore}`}
          </span>
        </div>
        <div className="top-actions">
          <button type="button" className="text-button mobile-only" onClick={onToggleChat}>
            {chatOpen ? "Close" : "Talk"}
          </button>
          <button type="button" className="text-button" onClick={leaveArmed ? onLeave : onLeaveArm}>
            {leaveArmed ? "Leave now" : "Leave"}
          </button>
        </div>
      </header>

      {status !== "live" ? <p className="banner">Reconnecting…</p> : null}
      {error ? <p className="banner error">{error}</p> : null}
      {showResult && view.lastHand ? (
        <div className="banner result">
          <p>{view.lastHand.summary}</p>
          <button type="button" onClick={onDismiss}>
            Hide
          </button>
        </div>
      ) : null}

      {view.status === "lobby" ? (
        <Lobby view={view} link={link} onStart={() => onSend({ type: "start" })} />
      ) : (
        <>
          <ScoreRow view={view} />
          <p className="prompt" data-phase={view.phase}>
            {view.prompt}
          </p>
          <Ends view={view} />
          {view.board?.center?.isSpinner ? (
            <p className="spinner-note">
              {view.board.spinnerOpen ? "Spinner is open on four sides." : "Play both long sides before the cross opens."}
            </p>
          ) : null}
          <Table view={view} selectedTile={selectedTile} onPlay={play} onSelect={onSelect} />
          {selectedTile ? <p className="hint">Tap a lit end to play that tile.</p> : null}
          <div className="actions">
            {view.canDraw ? (
              <button type="button" className="primary" data-action="draw" onClick={() => onSend({ type: "intent", intent: { type: "draw" } })}>
                {view.settings.boneyardMode === "draw_one" ? "Draw one" : "Draw until you can play"}
              </button>
            ) : null}
            {view.canKnock ? (
              <button type="button" className="primary knock" data-action="knock" onClick={() => onSend({ type: "intent", intent: { type: "knock" } })}>
                Knock
              </button>
            ) : null}
            {view.canRematch ? (
              <button type="button" className="primary" onClick={() => onSend({ type: "rematch" })}>
                Play another series
              </button>
            ) : null}
          </div>
          {view.lastDraw ? (
            <p className="draw-note">
              {view.lastDraw.playerId === view.yourId
                ? view.lastDraw.tileIds && view.lastDraw.tileIds.length === 1
                  ? `You drew ${pretty(view.lastDraw.tileIds[0] ?? "")}.`
                  : `You drew ${view.lastDraw.count} tile${view.lastDraw.count === 1 ? "" : "s"}.`
                : `${nameOf(view, view.lastDraw.playerId)} drew ${view.lastDraw.count}.`}
            </p>
          ) : null}
          <Hand view={view} selectedTile={selectedTile} onSelect={onSelect} onPlay={play} />
        </>
      )}

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

function Lobby({ view, link, onStart }: { view: PlayerView; link: string; onStart: () => void }) {
  const mode = view.settings.boneyardMode === "draw_one" ? "Draw one, then pass if it doesn't fit." : "Draw until you can play.";
  return (
    <section className="lobby">
      <p className="eyebrow">Share this table</p>
      <p className="big-code" data-room-code={view.roomCode}>
        {view.roomCode}
      </p>
      <label className="link-row">
        Link
        <input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button type="button" className="primary" onClick={() => copyText(link)}>
        Copy link
      </button>
      <ul className="seat-list">
        {view.players.map((player) => (
          <li key={player.id}>
            <span>{player.isYou ? `${player.name} (you)` : player.name}</span>
            <span>{player.connected ? "here" : "away"}</span>
          </li>
        ))}
        {Array.from({ length: view.settings.playerCount - view.players.length }, (_, index) => (
          <li key={`empty-${index}`} className="empty-seat">
            Waiting for a player
          </li>
        ))}
      </ul>
      <p className="rules-note">
        {mode} First to {view.settings.targetScore}. {view.prompt}
      </p>
      {view.canStart ? (
        <button type="button" className="primary" data-action="start" onClick={onStart}>
          Deal the first hand
        </button>
      ) : null}
    </section>
  );
}

function ScoreRow({ view }: { view: PlayerView }) {
  return (
    <div className="score-row">
      {view.players.map((player) => (
        <article key={player.id} className={`score-card${player.isTurn ? " turn" : ""}${player.isYou ? " you" : ""}`}>
          <header>
            <span>{player.isYou ? "You" : player.name}</span>
            {!player.connected ? <em>away</em> : null}
          </header>
          <strong>{player.score}</strong>
          <footer>
            <span>{player.tileCount} tiles</span>
            <span>
              {player.gamesWon} {player.gamesWon === 1 ? "game" : "games"}
            </span>
          </footer>
        </article>
      ))}
      <article className="score-card bone">
        <header>
          <span>Boneyard</span>
        </header>
        <strong>{view.boneyardCount}</strong>
        <footer>
          <span>{view.settings.boneyardMode === "draw_one" ? "Draw one" : "Draw until"}</span>
        </footer>
      </article>
    </div>
  );
}

function Ends({ view }: { view: PlayerView }) {
  if (!view.openEquation) return null;
  const scored = view.lastPlay && view.lastPlay.awarded > 0;
  return (
    <div className={`ends${scored ? " scored" : ""}`}>
      <span>Open ends</span>
      <strong>{view.openEquation}</strong>
      {view.lastPlay ? (
        <em className="score-flag" data-awarded={view.lastPlay.awarded}>
          {view.lastPlay.awarded > 0 ? `Scored ${view.lastPlay.awarded}` : "No score"}
        </em>
      ) : null}
    </div>
  );
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
    <aside className={`chat-panel${open ? " open" : ""}`}>
      <header>
        <h2>Table talk</h2>
        <button type="button" className="text-button mobile-only" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="chat-log" ref={listRef}>
        {chat.length === 0 ? <p className="muted">The table is quiet. For now.</p> : null}
        {chat.map((line) => (
          <p key={line.id} className={line.playerId === view.yourId ? "mine" : ""}>
            <span>{line.playerId === view.yourId ? "You" : line.name}</span>
            {line.text}
          </p>
        ))}
      </div>
      <div className="taunts">
        {view.taunts.map((taunt) => (
          <button type="button" key={`${taunt.packId}:${taunt.id}`} onClick={() => onPreset(taunt.packId, taunt.id)}>
            {taunt.text}
          </button>
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
  );
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
