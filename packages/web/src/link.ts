/** Room link. The server's public URL wins over the page origin. */
export function tableLink(code: string, publicUrl: string | undefined, origin: string): string {
  const configured = (publicUrl ?? "").trim().replace(/\/+$/, "");
  return `${configured || origin}/r/${code}`;
}
