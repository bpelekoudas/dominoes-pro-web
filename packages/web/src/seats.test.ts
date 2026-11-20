import { describe, expect, it } from "vitest";
import { seatAround } from "./seats.js";

function table(count: number, you: number) {
  return Array.from({ length: count }, (_, seat) => ({ id: String(seat), isYou: seat === you }));
}

describe("seatAround", () => {
  it("seats three opponents left, top, and right of you", () => {
    expect(seatAround(table(4, 0)).map((seat) => [seat.player.id, seat.edge])).toEqual([
      ["1", "left"],
      ["2", "top"],
      ["3", "right"],
      ["0", "bottom"],
    ]);
  });

  it("puts the next player on the left when you are not first", () => {
    expect(
      seatAround(table(4, 2))
        .filter((seat) => seat.edge !== "bottom")
        .map((seat) => [seat.player.id, seat.edge]),
    ).toEqual([
      ["3", "left"],
      ["0", "top"],
      ["1", "right"],
    ]);
  });

  it("seats two opponents on the sides", () => {
    expect(
      seatAround(table(3, 1))
        .filter((seat) => seat.edge !== "bottom")
        .map((seat) => seat.edge),
    ).toEqual(["left", "right"]);
  });

  it("seats one opponent across the table", () => {
    expect(seatAround(table(2, 0)).map((seat) => seat.edge)).toEqual(["top", "bottom"]);
  });
});
