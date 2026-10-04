/**
 * The interface's own check on a web address before it is handed to the
 * system browser. The core already refuses everything but an explicit http(s)
 * address (see `safe_external_url` in the core); this is a second, independent
 * rule behind it, so nothing else can reach the opener whatever a caller sends.
 *
 * Allowed: `http://` and `https://`, plain ASCII with a host, no user name or
 * password, no spaces, control characters, backslashes or markup characters.
 * Everything else (`javascript:`, `data:`, `file:`, `blob:`, `ftp:`, `mailto:`,
 * custom schemes, `//host/…`, relative or malformed addresses) gives null.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url.length === 0 || url.length > 2048) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[^\x21-\x7e]/.test(url) || /[\\<>"{}|^`]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "" || parsed.hostname === "") return null;
  return url;
}

/** Where a link goes, for the log: the host only, never the path or query. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unreadable)";
  }
}
