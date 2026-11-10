import { describe, expect, it } from "vitest";
import { matchCardBox } from "./match-card";

const screens = [
  { name: "S26", height: 914 },
  { name: "iPhone", height: 844 },
  { name: "small", height: 740 },
  { name: "Fold cover", height: 882 },
  { name: "Fold inner", height: 832 },
];

/** Standings, the summary line, and the place list. Two, three, and four seats. */
const bodies = [
  { seats: 2, height: 320 },
  { seats: 3, height: 420 },
  { seats: 4, height: 560 },
];

/** Continue or Play again, plus Leave. */
const actions = [
  { state: "hand", height: 132 },
  { state: "match", height: 196 },
];

describe("match card", () => {
  for (const screen of screens) {
    for (const body of bodies) {
      for (const action of actions) {
        it(`keeps the ${body.seats}-seat ${action.state} card on a ${screen.name}`, () => {
          const box = matchCardBox({
            visualTop: 0,
            visualHeight: screen.height,
            safeTop: 0,
            safeBottom: 0,
            bodyHeight: body.height,
            actionsHeight: action.height,
          });
          expect(box.top).toBeGreaterThanOrEqual(0);
          expect(box.bottom).toBeLessThanOrEqual(screen.height);
          expect(box.actionsTop).toBeGreaterThanOrEqual(box.top);
          expect(box.bottom).toBeGreaterThanOrEqual(box.actionsTop);
          expect(box.bottom - box.actionsTop).toBe(action.height);
        });
      }
    }
  }

  it("stays above the system nav when the layout viewport runs under it", () => {
    const box = matchCardBox({
      visualTop: 0,
      visualHeight: 850,
      safeTop: 0,
      safeBottom: 48,
      bodyHeight: 700,
      actionsHeight: 132,
    });
    expect(box.bottom).toBe(802);
    expect(box.bottom).toBeLessThanOrEqual(850);
    expect(box.actionsTop).toBeGreaterThanOrEqual(box.top);
    expect(box.scrolls).toBe(true);
  });

  it("scrolls the standings and keeps the buttons when four seats do not fit", () => {
    const box = matchCardBox({
      visualTop: 0,
      visualHeight: 740,
      safeTop: 24,
      safeBottom: 0,
      bodyHeight: 900,
      actionsHeight: 196,
    });
    expect(box.scrolls).toBe(true);
    expect(box.top).toBeGreaterThanOrEqual(24);
    expect(box.bottom).toBe(740);
    expect(box.bottom - box.actionsTop).toBe(196);
  });
});
