/**
 * Whole-word check for nicknames and table talk.
 * Short pieces such as "ass" are left out so "pass" and "classic" stay usable.
 */

const TERMS = [
  "fuck",
  "fuk",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "slut",
  "whore",
  "dick",
  "cock",
  "pussy",
  "asshole",
  "bastard",
  "rape",
  "rapist",
  "kys",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
  "!": "i",
};

function hits(token: string, term: string): boolean {
  if (token === term) return true;
  if (term.length < 4 || !token.startsWith(term)) return false;
  return /^(s|es|ed|ing|er|ers|y)$/.test(token.slice(term.length));
}

/** True when the text is a slur or a spaced-out or number-swapped copy of one. */
export function blockedSpeech(input: string): boolean {
  const spaced = input
    .toLowerCase()
    .replace(/[013457@$!]/g, (glyph) => LEET[glyph] ?? glyph)
    .replace(/[^a-z]+/g, " ")
    .replace(/(.)\1+/g, "$1")
    .trim();
  if (!spaced) return false;
  const words = spaced.split(/\s+/);
  const tokens = [...words];
  let singles = "";
  const flush = () => {
    if (singles.length >= 3) tokens.push(singles);
    singles = "";
  };
  for (const word of words) {
    if (word.length === 1) singles += word;
    else flush();
  }
  flush();
  return tokens.some((token) => TERMS.some((term) => hits(token, term)));
}
