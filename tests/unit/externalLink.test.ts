import { describe, expect, it } from "vitest";
import { hostOf, safeExternalUrl } from "@/lib/externalLink";

describe("the interface's rule for a link that leaves the app", () => {
  it("accepts an explicit http or https address", () => {
    for (const url of ["https://example.org/", "http://example.org/a/b?x=1&y=2#frag", "HTTPS://Example.ORG/x", "https://sub.example.org:8443/x", "http://192.168.0.1/"]) {
      expect(safeExternalUrl(url)).toBe(url);
    }
    expect(safeExternalUrl("  https://example.org/a  ")).toBe("https://example.org/a");
  });

  it("refuses everything else", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "blob:https://example.org/uuid",
      "ftp://example.org/file",
      "mailto:someone@example.org",
      "tel:+10000000",
      "custom-scheme://open",
      "//example.org/protocol-relative",
      "/absolute/path",
      "relative/page.html",
      "example.org",
      "https://",
      "https://exa mple.org/",
      "https://user:pass@example.org/",
      "https://example.org\\evil.example/",
      "https://example.org/<script>",
      "https://exämple.org/",
      "",
    ]) {
      expect(safeExternalUrl(url), url).toBeNull();
    }
    expect(safeExternalUrl(undefined)).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
    expect(safeExternalUrl(`https://example.org/${"a".repeat(2100)}`)).toBeNull();
  });

  it("names only the host in a log line", () => {
    expect(hostOf("https://example.org:8443/secret/path?token=abc")).toBe("example.org:8443");
    expect(hostOf("not a url")).toBe("(unreadable)");
  });
});
