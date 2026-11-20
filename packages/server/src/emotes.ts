/**
 * One switch for emotes. Leave it unset, or set EMOTES_ENABLED=false, and the
 * game hides them. Set EMOTES_ENABLED=true (or 1, on, yes) and restart to bring
 * them back. Catalog rows and owned_items stay either way.
 */
export function emotesEnabled(env: { EMOTES_ENABLED?: string | undefined } = process.env): boolean {
  const raw = env.EMOTES_ENABLED;
  if (raw == null || raw.trim() === "") return false;
  return /^(1|true|on|yes)$/i.test(raw.trim());
}
