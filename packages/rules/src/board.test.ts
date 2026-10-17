import { describe, expect, it } from "vitest";
import { boardAward } from "./score.js";
import { tileById } from "./tiles.js";
import { emptyBoard, openEnds, openTotal, placeTile, tilesOnBoard } from "./board.js";

function play(ids: Array<[string, string]>): ReturnType<typeof emptyBoard> {
  let board = emptyBoard();
  for (const [endId, tileId] of ids) {
    board = placeTile(board, endId, tileById(tileId));
  }
  return board;
}

function awarded(board: ReturnType<typeof emptyBoard>): number {
  return boardAward(openTotal(board));
}

describe("board scoring, 5 versus 10", () => {
  it("scores an opening double-five as 10 and does not score a total of 5", () => {
    const fiveFive = play([["lead", "5-5"]]);
    expect(openTotal(fiveFive)).toBe(10);
    expect(awarded(fiveFive)).toBe(10);

    const fiveBlank = play([["lead", "0-5"]]);
    expect(openTotal(fiveBlank)).toBe(5);
    expect(awarded(fiveBlank)).toBe(0);

    const twoThree = play([["lead", "2-3"]]);
    expect(openTotal(twoThree)).toBe(5);
    expect(awarded(twoThree)).toBe(0);
  });

  it("scores an opening 6–4 as 10 and does not score an opening 6–6", () => {
    const sixFour = play([["lead", "4-6"]]);
    expect(openTotal(sixFour)).toBe(10);
    expect(awarded(sixFour)).toBe(10);
    expect(sixFour.center?.westValue).toBe(4);
    expect(sixFour.center?.eastValue).toBe(6);

    const sixSix = play([["lead", "6-6"]]);
    expect(openTotal(sixSix)).toBe(12);
    expect(awarded(sixSix)).toBe(0);
    expect(sixSix.center?.isSpinner).toBe(true);
  });

  it("counts both halves of a double on an open end", () => {
    const board = play([
      ["lead", "5-5"],
      ["east", "0-5"],
    ]);
    // Bare side of the 5–5 still counts 10, plus the blank.
    expect(openTotal(board)).toBe(10);
    expect(awarded(board)).toBe(10);

    const extended = placeTile(board, "east", tileById("0-3"));
    expect(openTotal(extended)).toBe(13);
    expect(boardAward(13)).toBe(0);

    const withDouble = placeTile(extended, "east", tileById("3-3"));
    // Terminal 3–3 counts 6, and the untouched 5–5 still counts 10.
    expect(openTotal(withDouble)).toBe(16);
    expect(boardAward(16)).toBe(0);
  });

  it("awards 15 in full when the ends add up to 15", () => {
    const board = play([
      ["lead", "3-6"],
      ["east", "6-6"],
    ]);
    expect(openTotal(board)).toBe(15);
    expect(awarded(board)).toBe(15);
  });

  it("does not award 0, 5, or any total that is not a multiple of 5", () => {
    expect(boardAward(0)).toBe(0);
    expect(boardAward(5)).toBe(0);
    expect(boardAward(9)).toBe(0);
    expect(boardAward(10)).toBe(10);
    expect(boardAward(15)).toBe(15);
    expect(boardAward(20)).toBe(20);
    expect(boardAward(25)).toBe(25);
  });
});

describe("spinner", () => {
  it("keeps the cross closed until both long sides have a tile", () => {
    let board = play([["lead", "5-5"]]);
    expect(board.spinnerOpen).toBe(false);
    expect(openEnds(board).map((end) => end.id)).toEqual(["west", "east"]);
    expect(() => placeTile(board, "north", tileById("0-5"))).toThrow(/not open/);

    board = placeTile(board, "east", tileById("0-5"));
    expect(board.spinnerOpen).toBe(false);
    expect(openEnds(board).map((end) => end.id)).toEqual(["west", "east"]);
    expect(() => placeTile(board, "north", tileById("1-5"))).toThrow(/not open/);

    board = placeTile(board, "west", tileById("4-5"));
    expect(board.spinnerOpen).toBe(true);
    expect(openEnds(board).map((end) => end.id)).toEqual(["west", "east", "north", "south"]);
  });

  it("counts the two new ends on the play that opens the spinner", () => {
    const board = play([
      ["lead", "5-5"],
      ["east", "0-5"],
      ["east", "0-3"],
      ["east", "3-3"],
      ["west", "4-5"],
    ]);
    expect(board.spinnerOpen).toBe(true);
    // West tip 4, terminal 3–3 counts 6, and the two fresh spinner sides count 5 each.
    expect(openTotal(board)).toBe(20);
    expect(awarded(board)).toBe(20);
    expect(openEnds(board).map((end) => [end.id, end.scorePips])).toEqual([
      ["west", 4],
      ["east", 6],
      ["north", 5],
      ["south", 5],
    ]);
  });

  it("lets a later double be the spinner when the lead was not a double", () => {
    const board = play([
      ["lead", "1-6"],
      ["east", "6-6"],
    ]);
    expect(board.center?.isSpinner).toBe(true);
    expect(board.center?.tileId).toBe("6-6");
    expect(board.spinnerOpen).toBe(false);
    expect(openTotal(board)).toBe(13);
    expect(board.arms.west.map((tile) => tile.tileId)).toEqual(["1-6"]);
    expect(board.arms.east).toHaveLength(0);
  });

  it("does not replace the spinner when a second double is played", () => {
    const board = play([
      ["lead", "6-6"],
      ["east", "5-6"],
      ["west", "4-6"],
      ["east", "5-5"],
    ]);
    expect(board.center?.tileId).toBe("6-6");
    expect(board.spinnerOpen).toBe(true);
    expect(tilesOnBoard(board)).toEqual(["6-6", "4-6", "5-6", "5-5"]);
    const eastTip = board.arms.east[board.arms.east.length - 1]!;
    expect(eastTip.tileId).toBe("5-5");
    // West 4, east double-five counts 10, north 6, south 6.
    expect(openTotal(board)).toBe(26);
  });

  it("scores an empty cross side once, not as another full double", () => {
    const board = play([
      ["lead", "5-5"],
      ["east", "1-5"],
      ["west", "2-5"],
      ["north", "3-5"],
    ]);
    expect(openEnds(board).map((end) => [end.id, end.match, end.scorePips])).toEqual([
      ["west", 2, 2],
      ["east", 1, 1],
      ["north", 3, 3],
      ["south", 5, 5],
    ]);
    expect(openTotal(board)).toBe(11);
    expect(awarded(board)).toBe(0);
  });
});
