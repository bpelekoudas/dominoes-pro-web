/** The address friends should open. Aliases redirect here. */
export const CANONICAL_ORIGIN = "https://uhohdominoes.com";
export const CANONICAL_HOST = "uhohdominoes.com";

/** Hosts that still reach the app, but are not the address we publish. */
const ALIAS_HOSTS = new Set(["www.uhohdominoes.com", "uhoh-dominoes.onrender.com"]);

/** Origins allowed to call the API and open the socket, besides the request's own host. */
export const PUBLISHED_ORIGINS = [
  CANONICAL_ORIGIN,
  "https://www.uhohdominoes.com",
  "https://uhoh-dominoes.onrender.com",
] as const;

export function hostnameOf(host: string | undefined): string {
  const first = (host ?? "").split(",")[0]?.trim() ?? "";
  return first.replace(/:\d+$/, "").toLowerCase();
}

/**
 * Base URL copied into a room link or a magic link.
 * PUBLIC_URL wins when it is set (a tunnel, for example).
 * The public domain and its aliases publish the canonical address.
 * Any other host, such as localhost, publishes the host the request arrived on.
 */
export function publicBase(input: {
  publicUrl?: string | undefined;
  proto?: string | undefined;
  host?: string | undefined;
}): string {
  const configured = (input.publicUrl ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = (input.host ?? "").split(",")[0]?.trim() ?? "";
  if (!host) return "";
  const name = hostnameOf(host);
  if (name === CANONICAL_HOST || ALIAS_HOSTS.has(name)) return CANONICAL_ORIGIN;
  const proto = input.proto === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

/**
 * Paths the soak and Render's health check call on the Render hostname.
 * Everything else on an alias host redirects to the canonical address.
 */
export function staysOnAlias(url: string): boolean {
  const path = (url.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
  return path === "/health" || path === "/ws" || path.startsWith("/ws/") || path === "/api" || path.startsWith("/api/");
}

/** 301 target for an alias host, or null when the request should be served. */
export function aliasRedirect(host: string | undefined, url: string): string | null {
  if (!ALIAS_HOSTS.has(hostnameOf(host))) return null;
  if (staysOnAlias(url)) return null;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${CANONICAL_ORIGIN}${path}`;
}

/** Page address for the canonical link and the Open Graph URL. Room paths stay on the room. */
export function canonicalPage(urlPath: string): string {
  const pathOnly = (urlPath.split("?")[0] ?? "/").replace(/\/{2,}/g, "/");
  const room = /^\/r\/([A-Za-z0-9]{4,8})\/?$/.exec(pathOnly);
  if (room?.[1]) return `${CANONICAL_ORIGIN}/r/${room[1].toUpperCase()}`;
  return `${CANONICAL_ORIGIN}/`;
}

export function withCanonical(html: string, page: string): string {
  return html
    .replace('rel="canonical" href="https://uhohdominoes.com/"', `rel="canonical" href="${page}"`)
    .replace('property="og:url" content="https://uhohdominoes.com/"', `property="og:url" content="${page}"`);
}
