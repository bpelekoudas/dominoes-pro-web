export interface Taunt {
  id: string;
  text: string;
  /** A short reaction, shown on its own row. */
  reaction?: boolean;
}

export interface TauntPack {
  id: string;
  name: string;
  /**
   * Null packs are at the table for everyone.
   * A character id is reserved for packs that a player owns later.
   * The server asks for taunts with the character ids that player owns.
   */
  characterId: string | null;
  taunts: Taunt[];
}

export const TAUNT_PACKS: readonly TauntPack[] = [
  {
    id: "table",
    name: "Table talk",
    characterId: null,
    taunts: [
      { id: "uh-oh", text: "Uh oh." },
      { id: "bones", text: "Bones don't lie." },
      { id: "frame", text: "You gonna play that, or frame it?" },
      { id: "boneyard", text: "Boneyard called. They want their luck back." },
      { id: "nothing", text: "That's a whole lot of nothing." },
      { id: "count", text: "Count it again. Slowly." },
      { id: "spinner", text: "Spinner's open. Keep up." },
      { id: "pips", text: "I felt that in my pips." },
      { id: "locked", text: "Locked up and still pretty." },
      { id: "save", text: "Save some tiles for the rest of us." },
      { id: "bag", text: "150's coming. Pack a bag." },
      { id: "draw", text: "Draw again. I can wait." },
      { id: "count-em", text: "Count 'em up!" },
      { id: "calling", text: "Boneyard's calling you" },
      { id: "baby", text: "Domino, baby!" },
      { id: "sure", text: "You sure about that?" },
      { id: "weep", text: "Read 'em and weep" },
      { id: "nice", text: "Nice tile... for me" },
      { id: "uh-oh-2", text: "Uh oh..." },
      { id: "lucky", text: "Lucky draw" },
      { id: "taught", text: "Who taught you to play?" },
      { id: "gg", text: "GG" },
      { id: "eyes", text: "👀", reaction: true },
      { id: "smirk", text: "😏", reaction: true },
      { id: "sweat", text: "😅", reaction: true },
      { id: "target", text: "🎯", reaction: true },
      { id: "clap", text: "👏", reaction: true },
      { id: "grimace", text: "😬", reaction: true },
    ],
  },
  {
    id: "sample-character",
    name: "Future character",
    characterId: "future-character",
    taunts: [{ id: "later", text: "This pack shows up when that character is owned." }],
  },
];

export interface AvailableTaunt {
  packId: string;
  id: string;
  text: string;
  reaction?: boolean;
}

/** Packs with no character, plus packs for characters this player owns. */
export function tauntsForPlayer(ownedCharacterIds: readonly string[] = []): AvailableTaunt[] {
  const owned = new Set(ownedCharacterIds);
  const available: AvailableTaunt[] = [];
  for (const pack of TAUNT_PACKS) {
    if (pack.characterId !== null && !owned.has(pack.characterId)) continue;
    for (const taunt of pack.taunts) {
      available.push({ packId: pack.id, id: taunt.id, text: taunt.text, reaction: taunt.reaction });
    }
  }
  return available;
}

export function resolveTaunt(
  packId: string,
  tauntId: string,
  ownedCharacterIds: readonly string[] = [],
): AvailableTaunt | null {
  return (
    tauntsForPlayer(ownedCharacterIds).find((taunt) => taunt.packId === packId && taunt.id === tauntId) ??
    null
  );
}

export const CHAT_TEXT_LIMIT = 80;
