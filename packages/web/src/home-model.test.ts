import { describe, expect, it } from "vitest";
import { dailyChallengeMark, dailyLoginMark, formatBones, ratingLabel, shouldAskAge } from "./home-model.js";

describe("player home labels", () => {
  it("shows real balances and dashes when a number is missing", () => {
    expect(formatBones(2450)).toBe("2,450");
    expect(formatBones(0)).toBe("0");
    expect(formatBones(null)).toBe("—");
    expect(formatBones(undefined)).toBe("—");
  });

  it("shows a rating only when the account has one", () => {
    expect(ratingLabel(1240)).toBe("RATING 1240");
    expect(ratingLabel(null)).toBeNull();
  });

  it("asks for age only before an account exists, and hides the question once it is answered", () => {
    expect(shouldAskAge({ hasAccount: false, ageOk: false, checked: false, remembered: false })).toBe(true);
    expect(shouldAskAge({ hasAccount: true, ageOk: false, checked: false, remembered: false })).toBe(false);
    expect(shouldAskAge({ hasAccount: false, ageOk: true, checked: false, remembered: false })).toBe(false);
    expect(shouldAskAge({ hasAccount: false, ageOk: false, checked: true, remembered: false })).toBe(false);
    expect(shouldAskAge({ hasAccount: false, ageOk: false, checked: false, remembered: true })).toBe(false);
  });

  it("does not invent daily progress", () => {
    expect(dailyLoginMark(3)).toBe("DAY 3 / 7");
    expect(dailyLoginMark(null)).toBe("DAY — / 7");
    expect(dailyChallengeMark(1)).toBe("DAILY 1/3");
    expect(dailyChallengeMark(null)).toBe("DAILY —/3");
  });
});
