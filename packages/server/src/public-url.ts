/**
 * Base URL copied into a room link.
 * PUBLIC_URL wins when it is set. Otherwise the host the request arrived on
 * (the forwarded host, once the proxy is trusted).
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
  const proto = input.proto === "https" ? "https" : "http";
  return `${proto}://${host}`;
}
