export type SeatEdge = "left" | "top" | "right" | "bottom";

export interface Seated<T> {
  player: T;
  edge: SeatEdge;
}

/**
 * You sit at the bottom. Play goes to your left, so the next seat is the
 * left rail. Four players fill left, top, and right. Three use the two
 * sides. Two sit across the table.
 */
export function seatAround<T extends { isYou: boolean }>(players: readonly T[]): Seated<T>[] {
  const youIndex = players.findIndex((player) => player.isYou);
  if (youIndex < 0) {
    return players.map((player) => ({ player, edge: "top" }));
  }
  const after: T[] = [];
  for (let step = 1; step < players.length; step += 1) {
    const player = players[(youIndex + step) % players.length];
    if (player) after.push(player);
  }
  const edges: Array<"left" | "top" | "right"> =
    after.length <= 1 ? ["top"] : after.length === 2 ? ["left", "right"] : ["left", "top", "right"];
  const seated: Seated<T>[] = after.map((player, index) => ({
    player,
    edge: edges[index] ?? "top",
  }));
  const you = players[youIndex];
  if (you) seated.push({ player: you, edge: "bottom" });
  return seated;
}
