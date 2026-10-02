#!/usr/bin/env node
// Release-channel helpers for the Windows test-update workflow
// (.github/workflows/publish-windows-test-update.yml, docs/updates.md).
//
// Everything here is public information: the channel's update repository,
// the updater PUBLIC key, versions and file names. The private signing key
// is never read by this script; it only ever reaches `tauri signer sign`.
//
//   node scripts/updater.mjs overlay  --version V --out FILE
//   node scripts/updater.mjs manifest --version V --installer FILE --sig FILE --out FILE [--notes TEXT]
//   node scripts/updater.mjs check-newer --version V [--current FILE]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CHANNEL_FILE = join(here, "..", "src-tauri", "updater", "test-channel.json");

/** The tag whose release holds only `latest.json`: what installed test builds ask. */
export const POINTER_TAG = "test-channel";
export const PLATFORM = "windows-x86_64";

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
// Test builds are `X.Y.Z-dev.N`; a release (later) is plain `X.Y.Z`.
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/;

export function readChannel(path = CHANNEL_FILE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Throws a plain-language Error when the channel is not ready to publish to. */
export function validateChannel(channel) {
  if (!REPOSITORY.test(channel.updatesRepository ?? "")) {
    throw new Error(
      "updatesRepository is not set. Put the public repository that hosts test updates ('owner/name') in src-tauri/updater/test-channel.json (docs/updates.md).",
    );
  }
  const key = channel.pubkey ?? "";
  let decoded = "";
  try {
    decoded = Buffer.from(key, "base64").toString("utf8");
  } catch {
    /* handled below */
  }
  if (!/^untrusted comment: .*public key/i.test(decoded) || /secret key/i.test(decoded)) {
    throw new Error(
      "pubkey is not set to an updater PUBLIC key. Paste the contents of the .pub file made by `tauri signer generate` into src-tauri/updater/test-channel.json (docs/updates.md).",
    );
  }
  return channel;
}

/** The only update endpoint a test build knows. Always https. */
export function endpointFor(channel) {
  return `https://github.com/${channel.updatesRepository}/releases/download/${POINTER_TAG}/latest.json`;
}

export function releaseTag(version) {
  return `test-v${version}`;
}

export function installerName(version) {
  return `Abiding-Word_${version}_x64-setup.exe`;
}

export function installerUrl(channel, version) {
  return `https://github.com/${channel.updatesRepository}/releases/download/${releaseTag(version)}/${installerName(version)}`;
}

export function parseVersion(version) {
  const m = VERSION.exec(version);
  if (!m) throw new Error(`"${version}" is not X.Y.Z or X.Y.Z-dev.N`);
  return { major: +m[1], minor: +m[2], patch: +m[3], dev: m[4] === undefined ? null : +m[4] };
}

/** SemVer order for our two shapes: X.Y.Z-dev.N sorts before X.Y.Z; dev numbers compare as numbers. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const part of ["major", "minor", "patch"]) if (x[part] !== y[part]) return x[part] < y[part] ? -1 : 1;
  if (x.dev === y.dev) return 0;
  if (x.dev === null) return 1;
  if (y.dev === null) return -1;
  return x.dev < y.dev ? -1 : 1;
}

/** Refuses a version that would not be seen as an update by the version already published. */
export function assertNewer(version, current) {
  if (current && compareVersions(version, current.version) <= 0) {
    throw new Error(`${version} is not newer than the published ${current.version}; the updater would ignore it.`);
  }
}

/**
 * The Tauri config merged over tauri.conf.json for a test build. It adds
 * what makes a build updatable (public key, endpoint) and the build's own
 * version; the committed config has neither, so ordinary builds are
 * unaffected. `requireSignedVersion` makes the app refuse an update whose
 * signature was not made for exactly the version the manifest announces.
 */
export function overlayConfig(channel, version) {
  parseVersion(version);
  validateChannel(channel);
  return {
    version,
    plugins: {
      updater: {
        pubkey: channel.pubkey,
        endpoints: [endpointFor(channel)],
        requireSignedVersion: true,
        windows: { installMode: "passive" },
      },
    },
  };
}

/** The static manifest the updater reads (`latest.json`). */
export function buildManifest({ channel, version, notes, signature, pubDate = new Date().toISOString() }) {
  parseVersion(version);
  const sig = signature.trim();
  if (!sig) throw new Error("The signature is empty.");
  return {
    version,
    notes: notes ?? "",
    pub_date: pubDate,
    platforms: { [PLATFORM]: { signature: sig, url: installerUrl(channel, version) } },
  };
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!name?.startsWith("--") || argv[i + 1] === undefined) throw new Error(`Bad arguments near "${name}"`);
    out[name.slice(2)] = argv[i + 1];
  }
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  const f = flags(rest);
  const need = (name) => {
    if (!f[name]) throw new Error(`--${name} is required`);
    return f[name];
  };
  if (command === "overlay") {
    writeFileSync(need("out"), JSON.stringify(overlayConfig(readChannel(), need("version")), null, 2) + "\n");
  } else if (command === "manifest") {
    const channel = validateChannel(readChannel());
    const version = need("version");
    if (basename(need("installer")) !== installerName(version)) {
      throw new Error(`The installer must be named ${installerName(version)}.`);
    }
    const manifest = buildManifest({
      channel,
      version,
      notes: f.notes,
      signature: readFileSync(need("sig"), "utf8"),
    });
    writeFileSync(need("out"), JSON.stringify(manifest, null, 2) + "\n");
  } else if (command === "check-newer") {
    const current = f.current && existsSync(f.current) ? JSON.parse(readFileSync(f.current, "utf8")) : null;
    assertNewer(need("version"), current);
  } else {
    throw new Error("Usage: updater.mjs overlay | manifest | check-newer");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`updater: ${error.message}`);
    process.exit(1);
  }
}
