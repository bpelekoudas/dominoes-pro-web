import { describe, expect, it } from "vitest";
import { cardForSeat } from "./player-card-model.js";

describe("player card from a seat", () => {
  it("keeps your own badge on your profile, and sorts everyone else", () => {
    expect(cardForSeat({ isYou: true, bot: false, name: "Ada", avatarId: "2hot4tv", accountId: "me" }).kind).toBe("self");
    expect(
      cardForSeat({ isYou: false, bot: true, name: "Double Six", avatarId: "homescreen", difficulty: "medium" }),
    ).toEqual({ kind: "computer", name: "Double Six", avatarId: "homescreen", skill: "Medium", rating: 1200 });
    expect(cardForSeat({ isYou: false, bot: false, name: "Bo", avatarId: "hipster", accountId: null }).kind).toBe("guest");
    expect(
      cardForSeat({ isYou: false, bot: false, name: "Ada", avatarId: "2hot4tv", accountId: "user-1" }),
    ).toMatchObject({ kind: "account", userId: "user-1", name: "Ada" });
  });
});
