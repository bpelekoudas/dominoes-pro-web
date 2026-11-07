/**
 * Seat-by-seat update queue for the soak.
 *
 * A public update has to be checked even when one socket has already received
 * the next one. Overwriting the only stored view dropped scoring plays and,
 * during reconnect, compared a hand to a seat id that had been cleared.
 */

export function publicSignature(view) {
  // Phase is private. The seat who must draw or knock sees "draw" or "knock"
  // while everyone else still sees "play" for that same update.
  return JSON.stringify({
    status: view.status,
    game: view.gameNumber,
    hand: view.handNumber,
    turn: view.turnPlayerId,
    yard: view.boneyardCount,
    play: view.lastPlay?.seq ?? 0,
    event: view.lastEvent,
    scores: view.players.map((player) => [player.id, player.score, player.gamesWon, player.tileCount]),
    end: view.lastHand ? `${view.lastHand.gameNumber}-${view.lastHand.handNumber}` : null,
    open: view.openTotal,
  });
}

export function createSeatSync() {
  return { queue: [], tailSig: "", playerId: null, latest: null, welcomeGen: 0 };
}

/**
 * @returns {"welcome" | "queued" | "duplicate" | "lobby" | "foreign" | "other"}
 */
export function ingest(seat, message) {
  if (message.type === "welcome") {
    seat.playerId = message.playerId;
    seat.welcomeGen += 1;
    return "welcome";
  }
  if (message.type !== "state") return "other";
  const view = message.view;
  if (seat.playerId && view.yourId !== seat.playerId) return "foreign";
  seat.latest = view;
  const signature = publicSignature(view);
  // Lobby snapshots arrive before every seat is connected, so a later joiner
  // never sees the earlier ones. Checking starts at the deal, which everyone gets.
  if (view.phase === "lobby" || view.status === "lobby") {
    seat.tailSig = signature;
    return "lobby";
  }
  if (signature === seat.tailSig) return "duplicate";
  seat.queue.push(view);
  seat.tailSig = signature;
  return "queued";
}

/** The oldest update every seat has, or null when someone is behind or unidentified. */
export function alignedFronts(seats) {
  if (seats.some((seat) => seat.queue.length === 0)) return null;
  if (seats.some((seat) => !seat.playerId || seat.queue[0].yourId !== seat.playerId)) return null;
  const signature = publicSignature(seats[0].queue[0]);
  if (seats.some((seat) => publicSignature(seat.queue[0]) !== signature)) return null;
  return seats.map((seat) => seat.queue[0]);
}

export function shiftFronts(seats) {
  for (const seat of seats) seat.queue.shift();
}

export function handCountsMatch(fronts) {
  for (const view of fronts) {
    const mine = view.you?.hand?.length ?? -1;
    const reported = view.players.find((player) => player.id === view.yourId);
    if (!reported || reported.tileCount !== mine) return false;
  }
  return true;
}

/**
 * Pips on the open ends, walked from the tiles.
 * A double's stored outward and the server's ends list are not read.
 * A terminal double counts both halves once. An empty long side of a
 * spinner that still has the other long side empty counts both halves
 * once. After both long sides are played, an arm nobody has played adds nothing.
 */
export function exposedTotal(board) {
  const center = board?.center;
  if (!center) return 0;
  const spinner = center.low === center.high;
  const face = (dir) => (spinner || dir === "west" || dir === "north" ? center.low : center.high);
  const west = board.arms?.west ?? [];
  const east = board.arms?.east ?? [];
  const opened = spinner && west.length > 0 && east.length > 0;
  const dirs = opened ? ["west", "east", "north", "south"] : ["west", "east"];
  let total = 0;
  for (const dir of dirs) {
    const arm = board.arms?.[dir] ?? [];
    if (arm.length === 0) {
      if (opened) continue;
      const bare = spinner && west.length === 0 && east.length === 0;
      total += !spinner || bare ? face(dir) : face(dir) * 2;
      continue;
    }
    let match = face(dir);
    let exposed = 0;
    for (const tile of arm) {
      if (tile.low !== match && tile.high !== match) {
        throw new Error(`The ${dir} arm breaks at ${tile.tileId ?? "a tile"}.`);
      }
      if (tile.low === tile.high) {
        exposed = tile.low * 2;
        match = tile.low;
      } else if (tile.low === match) {
        exposed = tile.high;
        match = tile.high;
      } else {
        exposed = tile.low;
        match = tile.low;
      }
    }
    total += exposed;
  }
  return total;
}

/** Points this public update should add for one player, given what was already checked. */
export function scoreMove(player, view, before, prevPlaySeq, endedNow) {
  let expected = 0;
  if (endedNow) expected += view.lastHand?.leftoverAwards?.[player.id] ?? 0;
  if (view.lastPlay && view.lastPlay.seq > prevPlaySeq && view.lastPlay.playerId === player.id) {
    expected += view.lastPlay.awarded;
  }
  return { before, expected, delta: player.score - before };
}
