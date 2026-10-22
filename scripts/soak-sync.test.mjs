import assert from "node:assert/strict";
import test from "node:test";
import {
  alignedFronts,
  createSeatSync,
  handCountsMatch,
  ingest,
  publicSignature,
  scoreMove,
  shiftFronts,
} from "./soak-sync.mjs";

function player(id, score, tileCount) {
  return { id, score, gamesWon: 0, tileCount };
}

function view(yourId, handLength, fields) {
  return {
    status: "playing",
    phase: "play",
    gameNumber: 1,
    handNumber: 1,
    turnPlayerId: "b",
    boneyardCount: 14,
    lastPlay: null,
    lastEvent: null,
    lastHand: null,
    openTotal: 0,
    yourId,
    you: { hand: Array.from({ length: handLength }, (_, index) => ({ id: `${yourId}-${index}` })) },
    players: [player("a", 0, 7), player("b", 0, 7)],
    ...fields,
  };
}

function play(seq, playerId, awarded) {
  return { seq, playerId, awarded, total: awarded, tileId: "0-0", endId: "lead" };
}

test("a scoring play is checked when one seat already has the next update", () => {
  const a = createSeatSync();
  const b = createSeatSync();
  ingest(a, { type: "welcome", playerId: "a" });
  ingest(b, { type: "welcome", playerId: "b" });

  const scored = {
    players: [player("a", 10, 6), player("b", 0, 7)],
    lastPlay: play(1, "a", 10),
    lastEvent: { kind: "play", playerId: "a" },
    turnPlayerId: "b",
    openTotal: 10,
  };
  const answered = {
    players: [player("a", 10, 6), player("b", 0, 6)],
    lastPlay: play(2, "b", 0),
    lastEvent: { kind: "play", playerId: "b" },
    turnPlayerId: "a",
    openTotal: 8,
    boneyardCount: 14,
  };

  // A hears the 10-point play and the answer before B hears the play.
  ingest(a, { type: "state", view: view("a", 6, scored) });
  ingest(a, { type: "state", view: view("a", 6, answered) });
  ingest(b, { type: "state", view: view("b", 7, scored) });

  const checked = [];
  const prevScores = {};
  let prevPlaySeq = 0;
  const drain = () => {
    while (true) {
      const fronts = alignedFronts([a, b]);
      if (!fronts) return;
      assert.equal(handCountsMatch(fronts), true);
      assert.equal(publicSignature(fronts[0]), publicSignature(fronts[1]));
      const seen = fronts[0];
      for (const person of seen.players) {
        const move = scoreMove(person, seen, prevScores[person.id] ?? 0, prevPlaySeq, false);
        assert.equal(move.delta, move.expected, `${person.id} moved by ${move.delta}, expected ${move.expected}`);
        prevScores[person.id] = person.score;
      }
      if (seen.lastPlay && seen.lastPlay.seq > prevPlaySeq) prevPlaySeq = seen.lastPlay.seq;
      checked.push(seen.lastPlay.seq);
      shiftFronts([a, b]);
    }
  };

  drain();
  assert.deepEqual(checked, [1]);
  ingest(b, { type: "state", view: view("b", 6, answered) });
  drain();
  assert.deepEqual(checked, [1, 2]);
  assert.equal(prevScores.a, 10);
  assert.equal(prevScores.b, 0);
});

test("keeping only the latest view hides that 10 point play", () => {
  const latest = view("a", 6, {
    players: [player("a", 10, 6), player("b", 0, 6)],
    lastPlay: play(2, "b", 0),
    lastEvent: { kind: "play", playerId: "b" },
    turnPlayerId: "a",
  });
  const move = scoreMove(latest.players[0], latest, 0, 0, false);
  assert.equal(move.delta, 10);
  assert.equal(move.expected, 0);
});

test("a hand is compared to its owner, and a blank seat id is not ready", () => {
  const dealt = view("a", 7, {});
  assert.equal(handCountsMatch([dealt, view("b", 7, {})]), true);
  const short = view("a", 6, { players: [player("a", 0, 7), player("b", 0, 7)] });
  assert.equal(handCountsMatch([short]), false);

  const waiting = createSeatSync();
  ingest(waiting, { type: "state", view: dealt });
  assert.equal(alignedFronts([waiting, createSeatSync()]), null);
  ingest(waiting, { type: "welcome", playerId: "a" });
  const other = createSeatSync();
  ingest(other, { type: "welcome", playerId: "b" });
  ingest(other, { type: "state", view: view("b", 7, {}) });
  const fronts = alignedFronts([waiting, other]);
  assert.ok(fronts);
  assert.equal(handCountsMatch(fronts), true);
});

test("a resent snapshot does not line up a second copy on only one seat", () => {
  const a = createSeatSync();
  const b = createSeatSync();
  const dealt = (id) => view(id, 7, {});
  ingest(a, { type: "welcome", playerId: "a" });
  ingest(b, { type: "welcome", playerId: "b" });
  ingest(a, { type: "state", view: dealt("a") });
  ingest(b, { type: "state", view: dealt("b") });
  assert.ok(alignedFronts([a, b]));
  shiftFronts([a, b]);
  // Reconnect sends the same public update twice to the seat that came back.
  assert.equal(ingest(a, { type: "state", view: dealt("a") }), "duplicate");
  assert.equal(ingest(a, { type: "state", view: dealt("a") }), "duplicate");
  assert.equal(ingest(b, { type: "state", view: dealt("b") }), "duplicate");
  assert.equal(alignedFronts([a, b]), null);
  assert.equal(a.queue.length, 0);
  assert.equal(b.queue.length, 0);
});

test("a lobby update the joiner never saw does not block the deal", () => {
  const host = createSeatSync();
  const joiner = createSeatSync();
  ingest(host, { type: "welcome", playerId: "a" });
  ingest(joiner, { type: "welcome", playerId: "b" });
  const seated = [player("a", 0, 0), player("b", 0, 0)];
  ingest(host, {
    type: "state",
    view: view("a", 0, { phase: "lobby", status: "lobby", players: [player("a", 0, 0)], gameNumber: 0, handNumber: 0 }),
  });
  ingest(host, {
    type: "state",
    view: view("a", 0, { phase: "lobby", status: "lobby", players: seated, gameNumber: 0, handNumber: 0 }),
  });
  ingest(host, { type: "state", view: view("a", 7, { players: [player("a", 0, 7), player("b", 0, 7)] }) });
  ingest(joiner, { type: "state", view: view("b", 7, { players: [player("a", 0, 7), player("b", 0, 7)] }) });
  const fronts = alignedFronts([host, joiner]);
  assert.ok(fronts);
  assert.equal(fronts[0].handNumber, 1);
  assert.equal(handCountsMatch(fronts), true);
  assert.equal(host.queue.length, 1);
});

test("another player's hand is not queued as this seat's update", () => {
  const seat = createSeatSync();
  ingest(seat, { type: "welcome", playerId: "a" });
  assert.equal(ingest(seat, { type: "state", view: view("b", 7, {}) }), "foreign");
  assert.equal(seat.queue.length, 0);
});
