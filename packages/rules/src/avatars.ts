/** Portraits a player can wear. The house character is the default. */
export const AVATARS = [
  { id: "2hot4tv", name: "2 Hot 4 TV" },
  { id: "homescreen", name: "UH-OH" },
  { id: "barista", name: "Barista" },
  { id: "fisherman", name: "Fisherman" },
  { id: "floridaman", name: "Florida Man" },
  { id: "fratbro", name: "Frat" },
  { id: "gaperilla", name: "Pirate" },
  { id: "golfer", name: "Golfer" },
  { id: "grungerocker", name: "Rocker" },
  { id: "hipster", name: "Hipster" },
  { id: "lumberjack", name: "Lumberjack" },
  { id: "mexicancowboy", name: "Cowboy" },
  { id: "nascar", name: "Racer" },
  { id: "retiredman", name: "Retired" },
  { id: "scarface", name: "Scarface" },
  { id: "techmogul", name: "Mogul" },
  { id: "pitmaster", name: "Pitmaster" },
  { id: "abuela", name: "Abuela" },
  { id: "biker", name: "Biker" },
  { id: "gymbro", name: "Gym Bro" },
  { id: "trucker", name: "Trucker" },
  { id: "surfer", name: "Surfer" },
  { id: "cowgirl", name: "Cowgirl" },
  { id: "rapper", name: "Rapper" },
  { id: "bingograndma", name: "Bingo" },
  { id: "mallcop", name: "Mall Cop" },
  { id: "tailgatedad", name: "Tailgate" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

/** New players, guests, and empty seats wear 2 Hot 4 TV. */
export const DEFAULT_AVATAR: AvatarId = "2hot4tv";

/** Characters a computer can wear. The house portrait stays off the bot pool; the starter does not. */
const COMPUTER_AVATARS: AvatarId[] = AVATARS.filter((avatar) => avatar.id !== "homescreen").map((avatar) => avatar.id);

const IDS = new Set<string>(AVATARS.map((avatar) => avatar.id));

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && IDS.has(value);
}

/** A missing or unknown id wears the house portrait. */
export function resolveAvatar(value: string | null | undefined): AvatarId {
  return isAvatarId(value) ? value : DEFAULT_AVATAR;
}

export function avatarName(value: string | null | undefined): string {
  const id = resolveAvatar(value);
  return AVATARS.find((avatar) => avatar.id === id)?.name ?? "UH-OH";
}

/** A stable portrait for an older computer seat that was saved before avatars. */
export function avatarForSeed(seed: string, taken: Iterable<string> = []): AvatarId {
  const used = new Set(taken);
  const open = COMPUTER_AVATARS.filter((id) => !used.has(id));
  const pool = open.length > 0 ? open : COMPUTER_AVATARS;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 33) + seed.charCodeAt(index)) >>> 0;
  }
  return pool[hash % pool.length] ?? COMPUTER_AVATARS[0]!;
}

/** Pick a computer portrait that is not already at the table. */
export function pickDistinctAvatar(taken: Iterable<string>, random: () => number = Math.random): AvatarId {
  const used = new Set(taken);
  const open = COMPUTER_AVATARS.filter((id) => !used.has(id));
  const pool = open.length > 0 ? open : COMPUTER_AVATARS;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
  return pool[index] ?? COMPUTER_AVATARS[0]!;
}
