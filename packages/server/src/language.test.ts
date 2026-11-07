import { describe, expect, it } from "vitest";
import { blockedSpeech } from "./language.js";

describe("nickname and chat filter", () => {
  it("lets ordinary names through and stops a slur, including spaced and numbered copies", () => {
    expect(blockedSpeech("Ada")).toBe(false);
    expect(blockedSpeech("Bones")).toBe(false);
    expect(blockedSpeech("classic")).toBe(false);
    expect(blockedSpeech("pass")).toBe(false);
    expect(blockedSpeech("shit")).toBe(true);
    expect(blockedSpeech("sh1t")).toBe(true);
    expect(blockedSpeech("f u c k")).toBe(true);
    expect(blockedSpeech("fuuuck")).toBe(true);
    expect(blockedSpeech("shitty")).toBe(true);
  });
});
