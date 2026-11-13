/** Shown when a character has no lines of their own. */
export const GENERIC_WIN_LINE = "Match over!";

/**
 * A pack the store can sell or equip later. The default pack for a
 * character is the one used until a player owns another.
 */
export interface WinLinePack {
  id: string;
  avatarId: string;
  lines: readonly string[];
}

/** Source slugs that do not match the avatar id. */
const SLUG_TO_AVATAR: Record<string, string> = {
  gasparilla: "gaperilla",
};

const LINES: Record<string, readonly string[]> = {
  "2hot4tv": ["Uh-Oh, you KNOW!", "From Philly to Okinawa, I own all you!"],
  golfer: ["Fore! As in, four of you just lost.", "Hole in one. Hand in none."],
  barista: ["Your order's up: one tall loss, extra bitter.", "I grind beans, and I grind you."],
  fisherman: ["Caught a big one. It was all three of you.", "This one's not a fish story."],
  floridaman: ["Florida Man wins dominoes. Sources confirm.", "Gator said I'd win. Gator's never wrong."],
  fratbro: ["Rack 'em up, boys. Oh wait, I already racked you.", "Bro. Bro. BRO. I won, bro."],
  gasparilla: ["Yo ho ho, hand over the bones!", "Surrender yer tiles and walk the plank."],
  grungerocker: ["Welcome to the jungle, baby!", "That's my encore. Goodnight, losers!"],
  hipster: ["I was winning before it was cool.", "You've probably never heard of this strategy."],
  lumberjack: ["Timber! Watch 'em fall.", "Chopped you down to size."],
  mexicancowboy: ["¡Ándale! Back to the ranch, amigos.", "I've roped bigger bulls than you."],
  nascar: ["Checkered flag! Y'all were just lapped.", "I'd like to thank my sponsors, and your bad plays."],
  retiredman: ["Fifty years of dominoes, kid. Sit down.", "Time for my nap. You earned yours too."],
  scarface: ["Say hello to my little domino!", "The world is mine, and so is this table."],
  techmogul: ["Disrupted. Pivot to a new hobby.", "I'd acquire you, but you're not worth it."],
  pitmaster: ["Smoked ya low and slow.", "That's what twelve hours of patience looks like."],
  abuela: ["Ay, mijo. Go practice and come back.", "I taught your grandfather this game."],
  biker: ["Ride or die. You died.", "Eat my dust, and my double-six."],
  gymbro: ["Just put in a full set of wins. Get on my level.", "No pain, no game."],
  trucker: ["10-4, good buddy. Haulin' this W home.", "Breaker one-nine, we've got a wreck at the table."],
  surfer: ["Rode that wave all the way in, brah.", "Total wipeout, dudes. Hang loose."],
  cowgirl: ["Yeehaw! Y'all just got lassoed.", "Saddle up, partner. Try again."],
  rapper: ["Drop the mic. Pick up the bones.", "Count it up. Every pip's mine."],
  bingograndma: ["BINGO! Oh, wrong game. Still won.", "Lucky dauber never fails, sweetie."],
  mallcop: ["Case closed. Move along, folks.", "You have the right to remain losing."],
  tailgatedad: ["Who's hungry? Not for losses, I hope!", "That's a W for the home team!"],
};

export const WIN_LINE_PACKS: readonly WinLinePack[] = Object.entries(LINES).map(([slug, lines]) => {
  const avatarId = SLUG_TO_AVATAR[slug] ?? slug;
  return { id: `${avatarId}-default`, avatarId, lines };
});

const BY_AVATAR = new Map(WIN_LINE_PACKS.map((pack) => [pack.avatarId, pack]));

/** Stable pick for this match. The same hand always gets the same line. */
export function matchLineSeed(roomCode: string, gameNumber: number, handNumber: number, winnerId: string): number {
  const text = `${roomCode}:${gameNumber}:${handNumber}:${winnerId}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** One of the character's default lines. Anyone without a pack gets the generic line. */
export function winLineFor(avatarId: string | null | undefined, seed: number): string {
  const pack = avatarId ? BY_AVATAR.get(avatarId) : undefined;
  if (!pack || pack.lines.length === 0) return GENERIC_WIN_LINE;
  const index = (seed >>> 0) % pack.lines.length;
  return pack.lines[index] ?? GENERIC_WIN_LINE;
}

/** A character's own line, or null when they only have the generic match line. */
export function characterWinLine(avatarId: string | null | undefined, seed: number): string | null {
  const line = winLineFor(avatarId, seed);
  return line === GENERIC_WIN_LINE ? null : line;
}
