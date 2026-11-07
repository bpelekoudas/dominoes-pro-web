/** Seven hex characters, baked into the client and the service-worker cache name. */
export const BUILD_SHA_PATTERN = /^[0-9a-f]{7}$/;

/** Every deploy changes sw.js because the cache name contains the build. */
export function stampShell(source: string, sha: string): string {
  if (!BUILD_SHA_PATTERN.test(sha)) throw new Error(`Build stamp must be 7 hex characters, got ${sha}`);
  if (!source.includes("__BUILD_SHA__")) throw new Error("sw.js has no build placeholder");
  return source.replaceAll("__BUILD_SHA__", sha);
}
