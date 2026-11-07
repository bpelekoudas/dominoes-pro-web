import { describe, expect, it } from "vitest";
import { boardAward } from "./score.js";
import { tileById } from "./tiles.js";
import { emptyBoard, openEnds, openEquation, openScore, openTotal, placeTile, tilesOnBoard } from "./board.js";
import { layoutBoard } from "./layout.js";

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
    // West tip 4 and terminal 3–3 counts 6. The two unplayed short sides add nothing.
    expect(openTotal(board)).toBe(10);
    expect(awarded(board)).toBe(10);
    expect(openEnds(board).map((end) => [end.id, end.scorePips])).toEqual([
      ["west", 4],
      ["east", 6],
      ["north", 0],
      ["south", 0],
    ]);
    expect(openEquation(board)).toBe("4 + 6 = 10");
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
    // West 4 and the east double-five counts 10. The unplayed short sides add nothing.
    expect(openTotal(board)).toBe(14);
    expect(openEquation(board)).toBe("4 + 10 = 14");
  });

  it("leaves an unplayed short side out even after the other short side is played", () => {
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
      ["south", 5, 0],
    ]);
    expect(openTotal(board)).toBe(6);
    expect(openEquation(board)).toBe("2 + 1 + 3 = 6");
    expect(awarded(board)).toBe(0);
  });

  it("counts only the outer ends once both long sides of the spinner are filled", () => {
    // 5:0 - 0:4 - [4:4] - 4:6 - 6:2
    const bothArms = play([
      ["lead", "4-4"],
      ["west", "0-4"],
      ["west", "0-5"],
      ["east", "4-6"],
      ["east", "2-6"],
    ]);
    expect(bothArms.spinnerOpen).toBe(true);
    expect(openTotal(bothArms)).toBe(7);
    expect(openEquation(bothArms)).toBe("5 + 2 = 7");
    expect(awarded(bothArms)).toBe(0);

    // 0:4 - [4:4] - 4:6 - 6:2
    const oneArmBlank = play([
      ["lead", "4-4"],
      ["west", "0-4"],
      ["east", "4-6"],
      ["east", "2-6"],
    ]);
    expect(openTotal(oneArmBlank)).toBe(2);
    expect(openEquation(oneArmBlank)).toBe("0 + 2 = 2");

    // Left outer 5, right outer 3, down arm 4:3 outer 3, up side empty.
    const downOnly = play([
      ["lead", "4-4"],
      ["west", "4-5"],
      ["east", "4-6"],
      ["east", "3-6"],
      ["south", "3-4"],
    ]);
    expect(downOnly.spinnerOpen).toBe(true);
    expect(downOnly.arms.north).toHaveLength(0);
    expect(openEnds(downOnly).map((end) => [end.id, end.scorePips])).toEqual([
      ["west", 5],
      ["east", 3],
      ["north", 0],
      ["south", 3],
    ]);
    expect(openTotal(downOnly)).toBe(11);
    expect(openEquation(downOnly)).toBe("5 + 3 + 3 = 11");
    expect(awarded(downOnly)).toBe(0);
  });

  it("scores 5–5 with a down arm and an empty up side as 10, and awards 10", () => {
    // Left outer 3, right outer 5, down 5:2 outer 2, up side of the 5–5 unplayed.
    // The live bug showed 3+5+5+2=15 and credited 5. Both came from splitting
    // the sum and the award. This board is 3+5+2=10, which scores 10.
    const board = play([
      ["lead", "5-5"],
      ["west", "3-5"],
      ["east", "5-6"],
      ["east", "4-6"],
      ["east", "4-5"],
      ["south", "2-5"],
    ]);
    expect(board.center?.tileId).toBe("5-5");
    expect(board.spinnerOpen).toBe(true);
    expect(board.arms.north).toHaveLength(0);
    expect(board.arms.south.map((tile) => tile.tileId)).toEqual(["2-5"]);
    expect(openEnds(board).find((end) => end.id === "north")?.scorePips).toBe(0);

    const scored = openScore(board);
    expect(scored.parts).toEqual([3, 5, 2]);
    expect(scored.total).toBe(10);
    expect(scored.equation).toBe("3 + 5 + 2 = 10");
    expect(scored.awarded).toBe(10);
    expect(openTotal(board)).toBe(scored.total);
    expect(openEquation(board)).toBe(scored.equation);
    expect(awarded(board)).toBe(scored.awarded);
    expect(scored.awarded).not.toBe(5);
    expect(boardAward(5)).toBe(0);
    expect(boardAward(15)).toBe(15);
  });

  it("still counts a spinner with only one long side as a double", () => {
    const board = play([
      ["lead", "4-4"],
      ["east", "4-6"],
    ]);
    expect(board.spinnerOpen).toBe(false);
    expect(openEnds(board).map((end) => [end.id, end.scorePips])).toEqual([
      ["west", 8],
      ["east", 6],
    ]);
    expect(openTotal(board)).toBe(14);
    expect(openEquation(board)).toBe("8 + 6 = 14");
  });

  it("scores the live turned-up 6-0 board as 8 and awards nothing", () => {
    // The saved hand behind the reported screenshot. The 6 on the arm that
    // has turned upward is the 6-0 itself, played onto a blank.
    const before = play([
      ["lead", "4-4"],
      ["west", "4-6"],
      ["west", "3-6"],
      ["east", "3-4"],
      ["south", "1-4"],
      ["west", "0-3"],
      ["south", "1-1"],
      ["south", "0-1"],
      ["north", "2-4"],
      ["north", "0-2"],
      ["east", "2-3"],
    ]);
    expect(before.arms.south.map((tile) => tile.tileId)).toEqual(["1-4", "1-1", "0-1"]);
    const beforeScore = openScore(before);
    expect(beforeScore.parts).toEqual([0, 2, 0, 0]);
    expect(beforeScore.equation).toBe("0 + 2 + 0 + 0 = 2");
    expect(beforeScore.awarded).toBe(0);

    const shot = placeTile(before, "west", tileById("0-6"));
    const scored = openScore(shot);
    expect(scored.parts).toEqual([6, 2, 0, 0]);
    expect(scored.equation).toBe("6 + 2 + 0 + 0 = 8");
    expect(scored.awarded).toBe(0);
    expect(openEnds(shot).find((end) => end.id === "south")?.scorePips).toBe(0);

    const westTip = layoutBoard(shot).tiles.filter((tile) => tile.arm === "west").at(-1)!;
    expect(westTip.tileId).toBe("0-6");
    expect(westTip.direction).toBe("north");
    expect(westTip.a).toBe(6);

    // Playing a 6-0 onto that 6, the other reading of the same picture, leaves 2.
    const onTheSix = placeTile(shot, "west", tileById("0-6"));
    const replaced = openScore(onTheSix);
    expect(replaced.equation).toBe("0 + 2 + 0 + 0 = 2");
    expect(replaced.awarded).toBe(0);
  });

  it("scores the live double-blank board as 5 + 2 and awards nothing", () => {
    // Room with scores 100 and 75. The 2 is the tile past the 0-3, off the right of the picture.
    const board = play([
      ["lead", "0-0"],
      ["east", "0-3"],
      ["west", "0-5"],
      ["east", "2-3"],
    ]);
    expect(board.center?.tileId).toBe("0-0");
    expect(board.spinnerOpen).toBe(true);
    expect(board.arms.west.map((tile) => tile.tileId)).toEqual(["0-5"]);
    expect(board.arms.east.map((tile) => tile.tileId)).toEqual(["0-3", "2-3"]);
    const scored = openScore(board);
    expect(scored.parts).toEqual([5, 2]);
    expect(scored.equation).toBe("5 + 2 = 7");
    expect(scored.total).toBe(7);
    expect(scored.awarded).toBe(0);
  });

  it("scores the live one-arm double-six as 2 + 12 and does not also add the 6", () => {
    // Scores 65 and 75. The double-six still has one long side empty, so that side is 12 once.
    const board = play([
      ["lead", "6-6"],
      ["west", "1-6"],
      ["west", "1-3"],
      ["west", "2-3"],
    ]);
    expect(board.center?.tileId).toBe("6-6");
    expect(board.spinnerOpen).toBe(false);
    expect(board.arms.east).toHaveLength(0);
    const scored = openScore(board);
    expect(scored.parts).toEqual([2, 12]);
    expect(scored.equation).toBe("2 + 12 = 14");
    expect(scored.total).toBe(14);
    expect(scored.awarded).toBe(0);
    expect(scored.parts).not.toContain(6);
  });

  it("counts a double at the end of an arm once, not as 12 and as 6", () => {
    const board = play([
      ["lead", "3-3"],
      ["west", "2-3"],
      ["east", "3-6"],
      ["east", "6-6"],
    ]);
    expect(board.spinnerOpen).toBe(true);
    expect(board.arms.east.at(-1)?.tileId).toBe("6-6");
    const scored = openScore(board);
    expect(scored.parts).toEqual([2, 12]);
    expect(scored.equation).toBe("2 + 12 = 14");
    expect(scored.awarded).toBe(0);
  });
});
