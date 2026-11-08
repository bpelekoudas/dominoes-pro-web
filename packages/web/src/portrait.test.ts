import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyBoard, placeTile } from "../../rules/src/board.js";
import { tileById } from "../../rules/src/tiles.js";
import { feltScale, frameInsets } from "./board-scale";
import { lockPortrait, needsPortraitOverlay, shouldRefitFelt } from "./portrait-lock";

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
    expect(shouldRefitFelt({ width: 915, height: 412 })).toBe(false);
    expect(shouldRefitFelt({ width: 412, height: 915 })).toBe(true);
    expect(shouldRefitFelt({ width: 751, height: 832 })).toBe(true);
  });

  it("keeps the portrait tile scale when the phone turns away and back mid-hand", () => {
    let board = placeTile(emptyBoard(), "lead", tileById("6-6"));
    board = placeTile(board, "east", tileById("5-6"));
    board = placeTile(board, "west", tileById("4-6"));
    board = placeTile(board, "north", tileById("3-6"));
    board = placeTile(board, "south", tileById("2-6"));
    const portrait = { w: 390, h: 560 };
    const landscape = { w: 780, h: 160 };
    const before = feltScale({
      board,
      felt: portrait,
      screenWidth: 412,
      previous: null,
      newHand: true,
      frame: frameInsets(null, portrait),
    });
    const sideways = feltScale({
      board,
      felt: landscape,
      screenWidth: 915,
      previous: before.scale,
      newHand: false,
      frame: frameInsets(null, landscape),
    });
    expect(sideways.scale).toBeLessThan(before.scale * 0.75);
    const held = shouldRefitFelt({ width: 915, height: 412 }) ? sideways.scale : before.scale;
    const after = feltScale({
      board,
      felt: portrait,
      screenWidth: 412,
      previous: held,
      newHand: false,
      frame: frameInsets(null, portrait),
    });
    expect(after.scale).toBeCloseTo(before.scale, 5);
    const stuck = feltScale({
      board,
      felt: portrait,
      screenWidth: 412,
      previous: sideways.scale,
      newHand: false,
      frame: frameInsets(null, portrait),
    });
    expect(stuck.scale).toBeLessThan(before.scale * 0.75);
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
