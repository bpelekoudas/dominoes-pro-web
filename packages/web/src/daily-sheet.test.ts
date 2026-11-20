import { describe, expect, it } from "vitest";
import { afterDailyClaim, nextDailyHistory } from "./daily-sheet.js";

describe("daily login sheet", () => {
  it("sends the player home after a new claim and keeps a repeat claim on the sheet", () => {
    expect(afterDailyClaim({ ok: true, already: false })).toBe("home");
    expect(afterDailyClaim({ ok: true, already: true })).toBe("stay");
    expect(afterDailyClaim({ ok: false, already: false })).toBe("stay");
  });

  it("returns home from back, close, a tap outside, and the Android back key", () => {
    const open = nextDailyHistory({ open: false, pushed: false }, "open");
    expect(open).toEqual({ open: true, pushed: true, goBack: false });
    for (const event of ["back", "close", "outside"] as const) {
      expect(nextDailyHistory(open, event)).toEqual({ open: false, pushed: false, goBack: true });
    }
    expect(nextDailyHistory(open, "hardware")).toEqual({ open: false, pushed: false, goBack: false });
    expect(nextDailyHistory(open, "claimed")).toEqual({ open: false, pushed: false, goBack: true });
  });

  it("does not step history twice when the sheet was already closed", () => {
    const closed = { open: false, pushed: false };
    expect(nextDailyHistory(closed, "back").goBack).toBe(false);
    expect(nextDailyHistory(closed, "hardware").goBack).toBe(false);
  });
});
