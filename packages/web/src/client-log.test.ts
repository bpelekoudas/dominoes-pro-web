import { describe, expect, it } from "vitest";
import { clientLog, clientLogLines, resetClientLog } from "./client-log";

describe("client log", () => {
  it("keeps the last 50 lines", () => {
    resetClientLog();
    for (let i = 0; i < 60; i += 1) clientLog(`line ${i}`);
    const kept = clientLogLines();
    expect(kept).toHaveLength(50);
    expect(kept[0]).toContain("line 10");
    expect(kept[49]).toContain("line 59");
  });
});
