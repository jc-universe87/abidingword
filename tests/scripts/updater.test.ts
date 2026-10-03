import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertNewer,
  buildManifest,
  compareVersions,
  endpointFor,
  installerName,
  installerUrl,
  overlayConfig,
  readChannel,
  releaseTag,
  validateChannel,
  type Channel,
} from "../../scripts/updater.mjs";

// Tests run from the repository root.
const read = (path: string) => readFileSync(path, "utf8");

// A well-formed (but throwaway) public key: base64 of a minisign public-key file.
const PUBKEY = Buffer.from("untrusted comment: minisign public key: TEST\nRWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n").toString("base64");
const channel: Channel = { channel: "test", updatesRepository: "example-org/example-updates", pubkey: PUBKEY };

describe("test-build versions", () => {
  it("orders successive test builds numerically, and before the release", () => {
    expect(compareVersions("0.5.0-dev.9", "0.5.0-dev.10")).toBe(-1);
    expect(compareVersions("0.5.0-dev.2", "0.5.0-dev.1")).toBe(1);
    expect(compareVersions("0.5.0-dev.7", "0.5.0-dev.7")).toBe(0);
    expect(compareVersions("0.5.0-dev.99", "0.5.0")).toBe(-1);
    expect(compareVersions("0.6.0-dev.1", "0.5.0")).toBe(1);
    expect(compareVersions("0.1.0", "0.5.0-dev.1")).toBe(-1);
  });

  it("rejects a version the updater would not treat as new", () => {
    expect(() => assertNewer("0.5.0-dev.4", { version: "0.5.0-dev.4" })).toThrow(/not newer/);
    expect(() => assertNewer("0.5.0-dev.3", { version: "0.5.0-dev.4" })).toThrow(/not newer/);
    expect(() => assertNewer("0.5.0-dev.5", { version: "0.5.0-dev.4" })).not.toThrow();
    expect(() => assertNewer("0.5.0-dev.1", null)).not.toThrow();
  });

  it("refuses anything that is not X.Y.Z or X.Y.Z-dev.N", () => {
    for (const bad of ["0.5", "0.5.0-dev", "0.5.0-abc123", "v0.5.0", "0.5.0-dev.1+sha"]) {
      expect(() => compareVersions(bad, "0.5.0")).toThrow();
    }
  });
});

describe("the test channel", () => {
  it("holds only public information: a repository and an updater public key", () => {
    const committed = readChannel();
    expect(() => validateChannel(committed)).not.toThrow();
    expect(Object.keys(committed).sort()).toEqual(["channel", "pubkey", "updatesRepository"]);
    expect(Buffer.from(committed.pubkey, "base64").toString("utf8")).toMatch(/^untrusted comment: minisign public key/);
  });

  it("refuses to build while the repository or public key is missing", () => {
    expect(() => validateChannel({ ...readChannel(), updatesRepository: "" })).toThrow(/updatesRepository/);
    expect(() => validateChannel({ ...readChannel(), pubkey: "" })).toThrow(/pubkey/);
  });

  it("only accepts a public key, and a plain owner/name repository", () => {
    expect(() => validateChannel(channel)).not.toThrow();
    expect(() => validateChannel({ ...channel, updatesRepository: "https://evil.example/x" })).toThrow();
    expect(() => validateChannel({ ...channel, updatesRepository: "a/b/c" })).toThrow();
    expect(() => validateChannel({ ...channel, pubkey: "" })).toThrow();
    expect(() => validateChannel({ ...channel, pubkey: "not base64 at all" })).toThrow();
    const secret = Buffer.from("untrusted comment: rsign encrypted secret key\nRWRT").toString("base64");
    expect(() => validateChannel({ ...channel, pubkey: secret })).toThrow();
  });

  it("gives test builds one https endpoint of their own", () => {
    const url = new URL(endpointFor(channel));
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/example-org/example-updates/releases/download/test-channel/latest.json");
  });

  it("builds a signed-version, passive-install updater overlay", () => {
    const overlay = overlayConfig(channel, "0.5.0-dev.3") as {
      version: string;
      plugins: { updater: Record<string, unknown> };
      bundle?: unknown;
    };
    expect(overlay.version).toBe("0.5.0-dev.3");
    expect(overlay.plugins.updater).toEqual({
      pubkey: PUBKEY,
      endpoints: ["https://github.com/example-org/example-updates/releases/download/test-channel/latest.json"],
      requireSignedVersion: true,
      windows: { installMode: "passive" },
    });
    expect(JSON.stringify(overlay)).not.toMatch(/dangerous|private|secret/i);
  });

  it("writes a manifest whose installer URL is in the versioned release", () => {
    const manifest = buildManifest({ channel, version: "0.5.0-dev.3", notes: "n", signature: "  SIG==\n", pubDate: "2026-01-01T00:00:00Z" }) as {
      version: string;
      platforms: Record<string, { signature: string; url: string }>;
    };
    expect(manifest.version).toBe("0.5.0-dev.3");
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      signature: "SIG==",
      url: `https://github.com/example-org/example-updates/releases/download/${releaseTag("0.5.0-dev.3")}/${installerName("0.5.0-dev.3")}`,
    });
    expect(installerUrl(channel, "0.5.0-dev.3")).toBe(manifest.platforms["windows-x86_64"]!.url);
    expect(() => buildManifest({ channel, version: "0.5.0-dev.3", signature: " " })).toThrow(/empty/);
  });
});

describe("committed configuration", () => {
  it("leaves ordinary builds without an updater", () => {
    const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
    expect(tauri.plugins?.updater).toBeUndefined();
    expect(tauri.bundle.createUpdaterArtifacts).toBeUndefined();
    expect(read("src-tauri/updater/test-channel.json")).not.toMatch(/secret key|PRIVATE/i);
  });

  it("grants the window only the updater permissions it needs, and no wider CSP", () => {
    const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(capability.permissions).toEqual(["core:default", "dialog:allow-open", "updater:default"]);
    const csp: string = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp;
    expect(csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });

  it("never mentions a private key value in the workflows or scripts", () => {
    for (const file of [".github/workflows/publish-windows-test-update.yml", "scripts/updater.mjs"]) {
      const text = read(file);
      expect(text).not.toMatch(/RWR[A-Za-z0-9+/]{20,}/); // minisign key material
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });
});
