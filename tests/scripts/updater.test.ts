import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNewer,
  assetsOf,
  buildManifest,
  chooseBase,
  compareVersions,
  devVersion,
  endpointFor,
  installerName,
  installerUrl,
  overlayConfig,
  readChannel,
  releaseTag,
  validateChannel,
  verifyRelease,
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

describe("automatic test-build versions", () => {
  it("is the base plus the run number, and a later run is always newer", () => {
    expect(devVersion("0.5.0", 14)).toBe("0.5.0-dev.14");
    expect(devVersion("0.5.0", "100")).toBe("0.5.0-dev.100");
    expect(compareVersions(devVersion("0.5.0", 14), devVersion("0.5.0", 15))).toBe(-1);
    expect(compareVersions(devVersion("0.5.0", 99), devVersion("0.5.0", 100))).toBe(-1);
    for (const bad of ["0", "-1", "1.5", "abc", "", "007"]) expect(() => devVersion("0.5.0", bad)).toThrow(/run number/);
    expect(() => devVersion("0.5.0-dev.1", 3)).toThrow(/X\.Y\.Z/);
  });

  it("continues from the published base, never below a higher one published by hand", () => {
    expect(chooseBase("0.5.0", null)).toBe("0.5.0");
    expect(chooseBase("0.5.0", { version: "0.5.0-dev.13" })).toBe("0.5.0");
    expect(chooseBase("0.5.0", { version: "0.6.0-dev.2" })).toBe("0.6.0");
    expect(chooseBase("0.6.0", { version: "0.5.0-dev.30" })).toBe("0.6.0");
    expect(chooseBase("0.5.0", { version: "0.7.0" })).toBe("0.5.0"); // a release is not a dev base; check-newer then refuses loudly
    expect(() => chooseBase("0.5.0-dev.1", null)).toThrow(/X\.Y\.Z/);
  });

  it("makes the next automatic build newer than the published one", () => {
    const published = { version: "0.5.0-dev.13" };
    const next = devVersion(chooseBase("0.5.0", published), 14);
    expect(() => assertNewer(next, published)).not.toThrow();
    const afterHandBump = devVersion(chooseBase("0.5.0", { version: "0.6.0-dev.2" }), 15);
    expect(() => assertNewer(afterHandBump, { version: "0.6.0-dev.2" })).not.toThrow();
  });
});

describe("verifying a finished publish (from GitHub's API, not the download cache)", () => {
  const version = "0.5.0-dev.14";
  const name = installerName(version);
  const expected = buildManifest({ channel, version, notes: "n", signature: "SIG==", pubDate: "2026-01-01T00:00:00Z" });
  const assets = [
    { name, size: 1234, state: "uploaded" },
    { name: `${name}.sig`, size: 460, state: "uploaded" },
  ];
  const ok = { version, expected, published: structuredClone(expected), assets, installerSize: 1234 };

  it("accepts the manifest this run wrote and a fully uploaded installer and signature", () => {
    expect(() => verifyRelease(ok)).not.toThrow();
    // Key order in the downloaded JSON does not matter.
    const reordered = JSON.parse(JSON.stringify(expected, ["platforms", "windows-x86_64", "url", "signature", "pub_date", "notes", "version"]));
    expect(() => verifyRelease({ ...ok, published: reordered })).not.toThrow();
  });

  it("refuses a pointer that still offers the previous build", () => {
    const stale = { ...(expected as object), version: "0.5.0-dev.13" };
    expect(() => verifyRelease({ ...ok, published: stale })).toThrow(/offers 0\.5\.0-dev\.13, not 0\.5\.0-dev\.14/);
    expect(() => verifyRelease({ ...ok, published: null })).toThrow(/offers nothing/);
  });

  it("refuses a pointer whose content is not the manifest this run wrote", () => {
    const tampered = structuredClone(expected) as { platforms: Record<string, { signature: string }> };
    tampered.platforms["windows-x86_64"]!.signature = "OTHER==";
    expect(() => verifyRelease({ ...ok, published: tampered })).toThrow(/not the manifest this run wrote/);
  });

  it("refuses a missing, short or unfinished installer or signature", () => {
    expect(() => verifyRelease({ ...ok, assets: [assets[1]!] })).toThrow(/has no Abiding-Word_0\.5\.0-dev\.14_x64-setup\.exe/);
    expect(() => verifyRelease({ ...ok, assets: [assets[0]!] })).toThrow(/\.sig/);
    expect(() => verifyRelease({ ...ok, assets: [{ ...assets[0]!, size: 99 }, assets[1]!] })).toThrow(/99 bytes/);
    expect(() => verifyRelease({ ...ok, assets: [{ ...assets[0]!, state: "starter" }, assets[1]!] })).toThrow(/not fully uploaded/);
  });

  it("takes the asset list from a whole release or from a list", () => {
    expect(assetsOf({ assets })).toEqual(assets);
    expect(assetsOf(assets)).toEqual(assets);
    expect(assetsOf({})).toEqual([]);
  });

  it("runs from the command line the way the workflow runs it", () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-release-"));
    try {
      const file = (n: string, content: string) => {
        writeFileSync(join(dir, n), content);
        return join(dir, n);
      };
      const installer = file(name, "x".repeat(1234));
      const run = (published: unknown) =>
        spawnSync(
          process.execPath,
          [
            "scripts/updater.mjs",
            "verify-release",
            "--version", version,
            "--expected", file("latest.json", JSON.stringify(expected)),
            "--published", file("published.json", JSON.stringify(published)),
            "--assets", file("release.json", JSON.stringify({ assets })),
            "--installer", installer,
          ],
          { encoding: "utf8" },
        );
      expect(run(expected).status).toBe(0);
      const stale = run({ ...(expected as object), version: "0.5.0-dev.13" });
      expect(stale.status).toBe(1);
      expect(stale.stderr).toMatch(/updater: .*offers 0\.5\.0-dev\.13/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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

  it("grants the main window only the permissions it needs (its own commands, updater, the open and save dialogs, and opening http(s) links), and no wider CSP", () => {
    const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual([
      // The app's own commands the main window may call (v0.18.3, permissions/windows.toml).
      "main-window",
      "core:default",
      "dialog:allow-open",
      // Choosing where a presentation export is saved (v0.18).
      "dialog:allow-save",
      "updater:default",
      // A clicked web link opens in the default browser: only http and https, and no other opener permission.
      { identifier: "opener:allow-open-url", allow: [{ url: "https://*" }, { url: "http://*" }] },
    ]);
    const csp: string = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp;
    expect(csp).toContain("connect-src ipc: http://ipc.localhost");
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });

  it("gives the audience screen's window nothing but its five read commands and listening for the slide to show", () => {
    const capability = JSON.parse(read("src-tauri/capabilities/audience.json"));
    expect(capability.windows).toEqual(["audience"]);
    // No emit, no window control, no dialogs (v0.18.3).
    expect(capability.permissions).toEqual(["audience-window", "core:event:allow-listen", "core:event:allow-unlisten"]);
  });

  describe("the publish workflow", () => {
    const wf = read(".github/workflows/publish-windows-test-update.yml");
    const job = (name: string) => {
      const start = wf.indexOf(`\n  ${name}:\n`);
      expect(start).toBeGreaterThan(-1);
      const next = wf.slice(start + 1).search(/\n {2}[a-z]+:\n/);
      return next === -1 ? wf.slice(start) : wf.slice(start, start + 1 + next);
    };

    it("starts only by hand or after CI succeeded on a push to main", () => {
      const on = wf.slice(wf.indexOf("\non:\n"), wf.indexOf("\npermissions:"));
      expect(on).toContain("workflow_dispatch:");
      expect(on).toMatch(/workflow_run:\s+workflows: \["CI"\]\s+types: \[completed\]\s+branches: \[main\]/);
      expect(on).not.toMatch(/\bpull_request/);
      expect(on).not.toMatch(/\n {2}push:/);
      const gate = job("gate");
      for (const guard of [
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'push'",
        "github.event.workflow_run.head_branch == 'main'",
        "github.event.workflow_run.head_repository.full_name == github.repository",
      ]) {
        expect(gate).toContain(guard);
      }
    });

    it("publishes the exact commit CI passed on, only while it is still the newest on main", () => {
      expect(job("gate")).toContain("CI_SHA: ${{ github.event.workflow_run.head_sha }}");
      expect(job("gate")).toContain('commits/main" --jq .sha');
      for (const name of ["build", "publish"]) {
        expect(job(name)).toContain("ref: ${{ needs.gate.outputs.sha }}");
      }
      expect(job("publish")).toContain("steps.fresh.outputs.current == 'true'");
      expect(job("build")).toContain("needs.gate.outputs.proceed == 'true'");
    });

    it("keeps signing secrets out of every job but publish, and out of the build", () => {
      expect(wf.match(/secrets\.[A-Z_]+/g)?.sort()).toEqual([
        "secrets.TAURI_SIGNING_PRIVATE_KEY",
        "secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
        "secrets.UPDATES_REPO_TOKEN",
      ]);
      expect(job("gate")).not.toContain("secrets.");
      expect(job("build")).not.toContain("secrets.");
      expect(job("build")).not.toContain("environment:");
      expect(job("publish")).toContain("environment: windows-test-updates");
      expect(job("build")).toContain("persist-credentials: false");
      expect(job("publish")).toContain("persist-credentials: false");
      expect(job("publish")).toContain("npm ci --ignore-scripts");
    });

    it("has no step that sees both the signing key and the updates token", () => {
      const steps = job("publish").split(/\n {6}- /);
      for (const step of steps) {
        const sign = /secrets\.TAURI_SIGNING_PRIVATE_KEY/.test(step);
        const token = /secrets\.UPDATES_REPO_TOKEN/.test(step);
        expect(sign && token).toBe(false);
      }
    });

    it("uses the triggering run's data only as an env value or in the gate's guard, never inside a script", () => {
      for (const line of wf.split("\n").filter((l) => l.includes("github.event.workflow_run") && !l.trim().startsWith("#"))) {
        const trimmed = line.trim();
        const asEnv = /^[A-Z_]+: \$\{\{ github\.event\.workflow_run\.[a-z_]+ \}\}$/.test(trimmed);
        const asGuard = /^\(?(github\.event_name == 'workflow_run' &&|github\.event\.workflow_run\.[a-z_.]+ == [^ ]+( &&|\)))$/.test(trimmed);
        expect(asEnv || asGuard, line).toBe(true);
      }
      expect(wf).not.toMatch(/github\.event\.workflow_run\.(head_commit|display_title|pull_requests)/);
      expect(wf).not.toMatch(/github\.head_ref/);
    });

    it("confirms a publish through GitHub's API, and lets only that confirmation fail the run", () => {
      const publish = job("publish");
      const steps = publish.split(/\n {6}- /);
      const step = (title: string) => steps.find((s) => s.includes(`name: ${title}`)) ?? "";
      const api = step("Confirm the upload through GitHub's API");
      const cdn = step("Check the public download URL (informational)");
      const summary = step("Summary");
      // The API confirmation reads releases with the job token (no secret) and can fail the run.
      expect(api).toContain("GH_TOKEN: ${{ github.token }}");
      expect(api).not.toContain("secrets.");
      expect(api).toContain("releases/assets/$id");
      expect(api).toContain("verify-release");
      expect(api).toMatch(/exit 1/);
      // The public (CDN) check is for the record only: it can never fail the run.
      expect(cdn).toContain("continue-on-error: true");
      expect(cdn).not.toMatch(/exit 1|exit [2-9]/);
      expect(cdn).toContain("endpointFor");
      // The sign and publish steps themselves are untouched by the verification.
      expect(publish.indexOf("name: Publish (installer first")).toBeLessThan(publish.indexOf(api.slice(0, 40)));
      // The summary reports the four facts.
      for (const fact of ["Source commit", "Version", "Release tag", "latest.json"]) expect(summary).toContain(fact);
      expect(summary).toContain("(GitHub API)");
    });

    it("keeps one publish at a time and the version from the run number", () => {
      expect(wf).toMatch(/concurrency:\s+group: windows-test-update\s+cancel-in-progress: false/);
      expect(wf).toContain("choose-version");
      expect(wf).toContain('RUN_NUMBER: ${{ github.run_number }}');
    });
  });

  it("never mentions a private key value in the workflows or scripts", () => {
    for (const file of [".github/workflows/publish-windows-test-update.yml", "scripts/updater.mjs"]) {
      const text = read(file);
      expect(text).not.toMatch(/RWR[A-Za-z0-9+/]{20,}/); // minisign key material
      expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });
});
