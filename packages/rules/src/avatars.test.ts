import { describe, expect, it } from "vitest";
import { avatarForSeed, DEFAULT_AVATAR, pickDistinctAvatar, resolveAvatar } from "./avatars.js";

describe("avatars", () => {
  it("falls back to the starter", () => {
    expect(resolveAvatar(null)).toBe(DEFAULT_AVATAR);
    expect(resolveAvatar("")).toBe("2hot4tv");
    expect(resolveAvatar("nope")).toBe("2hot4tv");
    expect(resolveAvatar("golfer")).toBe("golfer");
    expect(resolveAvatar("2hot4tv")).toBe("2hot4tv");
  });

  it("gives computers distinct portraits and skips the house one", () => {
    const taken = new Set<string>(["homescreen"]);
    const random = sequence(0, 0.1, 0.2);
    const first = pickDistinctAvatar(taken, random);
    taken.add(first);
    const second = pickDistinctAvatar(taken, random);
    expect(first).not.toBe("homescreen");
    expect(second).not.toBe("homescreen");
    expect(second).not.toBe(first);
  });

  it("keeps the same portrait for the same older computer seat", () => {
    const once = avatarForSeed("p_bones", ["homescreen"]);
    const twice = avatarForSeed("p_bones", ["homescreen"]);
    expect(once).toBe(twice);
    expect(once).not.toBe("homescreen");
    const other = avatarForSeed("p_pips", ["homescreen", once]);
    expect(other).not.toBe(once);
  });
});

function sequence(...values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1] ?? 0;
    index += 1;
    return value;
  };
}
