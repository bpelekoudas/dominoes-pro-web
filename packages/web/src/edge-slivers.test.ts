import { describe, expect, it } from "vitest";
import { sliverGap } from "./edge-slivers.js";

describe("sliverGap", () => {
  it("keeps a short stack spaced", () => {
    expect(sliverGap(7, 400, 18, 3)).toBe(3);
  });

  it("overlaps a long stack so the slivers stay inside the edge", () => {
    const count = 12;
    const tile = 18;
    const span = 120;
    const gap = sliverGap(count, span, tile, 3);
    expect(gap).toBeLessThan(0);
    const used = count * tile + (count - 1) * gap;
    expect(used).toBeCloseTo(span, 5);
  });
});
