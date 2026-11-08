import { afterEach, describe, expect, it, vi } from "vitest";
import { lockPortrait, needsPortraitOverlay } from "./portrait-lock";

describe("portrait overlay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays off for a phone, the Fold, and a desktop held the normal way", () => {
    expect(needsPortraitOverlay(412, 915)).toBe(false);
    expect(needsPortraitOverlay(390, 844)).toBe(false);
    expect(needsPortraitOverlay(344, 882)).toBe(false);
    expect(needsPortraitOverlay(751, 832)).toBe(false);
    expect(needsPortraitOverlay(832, 751)).toBe(false);
    expect(needsPortraitOverlay(1440, 900)).toBe(false);
    expect(needsPortraitOverlay(1920, 1080)).toBe(false);
    expect(needsPortraitOverlay(800, 800)).toBe(false);
  });

  it("covers a phone turned sideways, including the Fold cover", () => {
    expect(needsPortraitOverlay(915, 412)).toBe(true);
    expect(needsPortraitOverlay(844, 390)).toBe(true);
    expect(needsPortraitOverlay(882, 344)).toBe(true);
  });

  it("ignores a browser that refuses to lock", async () => {
    const lock = vi.fn(() => Promise.reject(new Error("not allowed")));
    vi.stubGlobal("screen", { orientation: { lock } });
    expect(() => lockPortrait()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(lock).toHaveBeenCalledWith("portrait");
  });

  it("does nothing when the browser has no orientation lock", () => {
    vi.stubGlobal("screen", {});
    expect(() => lockPortrait()).not.toThrow();
  });
});
