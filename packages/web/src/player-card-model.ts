import { cpuSkill } from "./avatars";

export type SeatCard =
  | { kind: "self" }
  | { kind: "guest"; name: string; avatarId: string }
  | { kind: "computer"; name: string; avatarId: string; skill: string; rating: number }
  | { kind: "account"; userId: string; name: string; avatarId: string };

/** Which card a seat tap should open. Your own badge stays on the profile sheet. */
export function cardForSeat(player: {
  isYou: boolean;
  bot: boolean;
  name: string;
  avatarId: string;
  accountId?: string | null;
  difficulty?: string | null;
  rank?: { rating: number } | null;
}): SeatCard {
  if (player.isYou) return { kind: "self" };
  if (player.bot) {
    const skill = cpuSkill(player.difficulty);
    return {
      kind: "computer",
      name: player.name,
      avatarId: player.avatarId,
      skill: skill?.label ?? "CPU",
      rating: skill?.rating ?? player.rank?.rating ?? 1200,
    };
  }
  if (player.accountId) {
    return { kind: "account", userId: player.accountId, name: player.name, avatarId: player.avatarId };
  }
  return { kind: "guest", name: player.name, avatarId: player.avatarId };
}
