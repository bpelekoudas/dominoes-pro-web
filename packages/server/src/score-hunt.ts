import { applyIntent, beginHand, createMatch, openScore, skipTurn, type LoggedIntent } from "@uhoh/rules";
import type { Store } from "./db.js";

/**
 * One-shot read of the two reported hands. Logs SCOREHUNT lines and returns.
 * The live database is the only copy of those rooms.
 */
export function huntReportedScores(store: Store): void {
  const db = store.db;
  const rooms = db.prepare(`SELECT id, code, status, player_count, boneyard_mode, created_at FROM rooms WHERE code = ?`).all("66LGKV");
  console.log(`SCOREHUNT room66 ${JSON.stringify(rooms)}`);
  const users = db
    .prepare(`SELECT id, display_name FROM users WHERE lower(display_name) LIKE '%andre%' OR lower(display_name) LIKE '%de''andre%'`)
    .all();
  console.log(`SCOREHUNT users ${JSON.stringify(users)}`);

  const andreIds = (users as Array<{ id: string }>).map((user) => user.id);
  const andreHands = andreIds.length
    ? (db
        .prepare(
          `SELECT DISTINCT hand_id FROM actions WHERE player_id IN (${andreIds.map(() => "?").join(",")})`,
        )
        .all(...andreIds) as Array<{ hand_id: string }>)
    : [];
  const andreHandIds = new Set(andreHands.map((row) => row.hand_id));
  console.log(`SCOREHUNT andreHands ${andreHandIds.size}`);

  const span = db.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM hands`).get() as {
    n: number;
    oldest: string | null;
    newest: string | null;
  };
  console.log(`SCOREHUNT span ${span.n} ${span.oldest ?? "-"} ${span.newest ?? "-"}`);

  const hands = db
    .prepare(
      `SELECT id, room_id, series_id, game_number, hand_number, deck_json, result_json, created_at
       FROM hands WHERE created_at >= ? ORDER BY created_at`,
    )
    .all("2026-10-23T06:00:00.000Z") as Array<{
    id: string;
    room_id: string;
    series_id: string;
    game_number: number;
    hand_number: number;
    deck_json: string;
    result_json: string | null;
    created_at: string;
  }>;

  const roomIds = new Set((rooms as Array<{ id: string }>).map((room) => room.id));
  const picked = hands.filter((hand) => interesting(hand, roomIds, andreHandIds));
  console.log(`SCOREHUNT hands ${hands.length} picked ${picked.length}`);
  const ended = picked.filter((hand) => {
    const scores = Object.values(parseResult(hand.result_json)?.scoresAfter ?? {});
    return (scores.includes(100) && scores.includes(75)) || (scores.includes(65) && scores.includes(75));
  });
  console.log(
    `SCOREHUNT endedPairs ${ended.length} ${ended
      .map((hand) => `${hand.created_at} ${clip(parseResult(hand.result_json)?.summary ?? "")}`)
      .join(" | ")}`,
  );

  const bySeries = new Map<string, typeof picked>();
  for (const hand of picked) {
    const key = `${hand.room_id}:${hand.series_id}`;
    const list = bySeries.get(key) ?? [];
    list.push(hand);
    bySeries.set(key, list);
  }

  const seriesList = [...bySeries.values()];
  let index = 0;
  let hits = 0;
  const step = () => {
    const started = Date.now();
    while (index < seriesList.length && Date.now() - started < 25) {
      const series = seriesList[index]!;
      index += 1;
      series.sort((a, b) => a.game_number - b.game_number || a.hand_number - b.hand_number || (a.created_at < b.created_at ? -1 : 1));
      hits += replaySeries(db, series);
    }
    if (index < seriesList.length) {
      setImmediate(step);
      return;
    }
    console.log(`SCOREHUNT done series ${seriesList.length} hits ${hits}`);
  };
  setImmediate(step);
}

function interesting(
  hand: { id: string; room_id: string; result_json: string | null; created_at: string },
  roomIds: Set<string>,
  andreHandIds: Set<string>,
): boolean {
  if (roomIds.has(hand.room_id) || andreHandIds.has(hand.id)) return true;
  const result = parseResult(hand.result_json);
  const text = `${hand.result_json ?? ""}`.toLowerCase();
  if (text.includes("andre")) return true;
  const scores = Object.values(result?.scoresAfter ?? {});
  if (scores.includes(100) && scores.includes(75)) return true;
  if (scores.includes(65) && scores.includes(75)) return true;
  // Whole Mountain-time day. A hand can start well before the screenshot.
  return hand.created_at >= "2026-10-23T06:00:00.000Z" && hand.created_at <= "2026-10-23T23:59:59.000Z";
}

function parseResult(raw: string | null): {
  summary?: string;
  scoresAfter?: Record<string, number>;
  boardPoints?: Record<string, number>;
  leftoverAwards?: Record<string, number>;
} | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      summary?: string;
      scoresAfter?: Record<string, number>;
      boardPoints?: Record<string, number>;
      leftoverAwards?: Record<string, number>;
    };
  } catch {
    return null;
  }
}

function replaySeries(
  db: Store["db"],
  series: Array<{ id: string; deck_json: string; game_number: number; hand_number: number; created_at: string }>,
): number {
  const actions = series.map((hand) => {
    const rows = db
      .prepare(`SELECT seq, player_id, payload_json FROM actions WHERE hand_id = ? ORDER BY seq`)
      .all(hand.id) as Array<{ seq: number; player_id: string; payload_json: string }>;
    return { hand, rows };
  });
  const ids = [...new Set(actions.flatMap((hand) => hand.rows.map((row) => row.player_id)))];
  if (ids.length < 2 || ids.length > 4) return 0;
  const orders = permutations(ids);
  const modes = ["draw_until", "draw_one"] as const;
  let reason = "no order matched";
  for (const mode of modes) {
    for (const order of orders) {
      const played = tryReplay(order, mode, actions);
      if (!played) {
        reason = "apply failed";
        continue;
      }
      const who = namesFor(db, order);
      for (const line of played.lines) console.log(`SCOREHUNT play ${who} ${line}`);
      return played.lines.length;
    }
  }
  console.log(`SCOREHUNT replay failed for ${series[0]?.id} ${series[0]?.created_at ?? ""} ${reason}`);
  return 0;
}

function namesFor(db: Store["db"], ids: string[]): string {
  return ids
    .map((id) => {
      const row = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(id) as { display_name?: string } | undefined;
      const name = (row?.display_name ?? "?").replace(/\s+/g, " ").slice(0, 24);
      return `${name}:${id.slice(0, 6)}`;
    })
    .join(",");
}

function tryReplay(
  order: string[],
  mode: "draw_until" | "draw_one",
  hands: Array<{
    hand: { game_number: number; hand_number: number; deck_json: string; created_at: string };
    rows: Array<{ player_id: string; payload_json: string }>;
  }>,
): { lines: string[] } | null {
  let match = createMatch(
    order.map((id) => ({ id, name: id.slice(0, 4) })),
    { boneyardMode: mode, seriesLength: 7, targetScore: 150 },
  );
  const lines: string[] = [];
  let previous = "";
  for (const hand of hands) {
    let deck: string[];
    try {
      deck = JSON.parse(hand.hand.deck_json) as string[];
      match = beginHand(match, deck);
    } catch {
      return null;
    }
    let follow = 0;
    for (const row of hand.rows) {
      let intent: LoggedIntent;
      try {
        intent = JSON.parse(row.payload_json) as LoggedIntent;
      } catch {
        return null;
      }
      const result =
        intent.type === "timeout" ? skipTurn(match, row.player_id) : applyIntent(match, row.player_id, intent);
      if (!result.ok) return null;
      match = result.match;
      if (intent.type !== "play" || !match.lastPlay || !match.hand) continue;
      const scored = openScore(match.hand.board);
      const arms = (["west", "east", "north", "south"] as const)
        .map((arm) => {
          const tiles = match.hand!.board.arms[arm];
          const shown = tiles
            .map((tile) => `${tile.tileId}${tile.low === tile.high ? "d" : ""}>${tile.outward}`)
            .join(",");
          return `${arm}:${shown || "-"}`;
        })
        .join(" ");
      const scores = Object.values(match.scores);
      const high = scores.some((score) => score >= 65);
      const pair = (scores.includes(100) && scores.includes(75)) || (scores.includes(65) && scores.includes(75));
      const shot = scored.equation === "5 + 2 = 7" || scored.equation === "2 + 12 = 14";
      const extraFace = scored.parts.includes(12) && scored.parts.includes(6);
      const line = `${hand.hand.created_at} g${hand.hand.game_number}h${hand.hand.hand_number} ${intent.tileId} on ${intent.endId} eq ${scored.equation} parts ${scored.parts.join(",")} award ${match.lastPlay.awarded} total ${match.lastPlay.total} scores ${JSON.stringify(match.scores)} spinner ${match.hand.board.center?.isSpinner ? 1 : 0} open ${match.hand.board.spinnerOpen ? 1 : 0} center ${match.hand.board.center?.tileId ?? "-"} ${arms}`;
      const keep = pair || (shot && high) || (match.lastPlay.awarded >= 20 && high) || (extraFace && match.lastPlay.awarded >= 20) || follow > 0;
      if (keep) {
        if (previous && (pair || shot || match.lastPlay.awarded >= 20)) lines.push(`BEFORE ${previous}`);
        lines.push(line);
      }
      follow = match.lastPlay.awarded >= 20 && high ? 2 : Math.max(0, follow - 1);
      previous = line;
    }
  }
  return { lines };
}

function permutations(ids: string[]): string[][] {
  if (ids.length <= 1) return [ids];
  const out: string[][] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const rest = ids.filter((_, item) => item !== index);
    for (const tail of permutations(rest)) out.push([ids[index]!, ...tail]);
  }
  return out;
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 180);
}
