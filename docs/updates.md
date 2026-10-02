# Abiding Word — Windows test updates

Windows is the primary visual and manual acceptance platform. To avoid
downloading and running an installer for every iteration, an installed
**test build** can update itself to a newer, **explicitly published** and
**signed** test build. Nothing is published by a push or a pull request.

Linux/WebKitGTK (Chromebook) remains supported and is checked at selected
checkpoints; it is not part of this channel and is not needed for every
iteration.

## What the user sees

1. Install a test build once (from the *Publish Windows test update* run,
   or any build made after the channel is set up).
2. A while after the app has started (never during startup) it looks for a
   newer test build. If there is one, a slim notice appears under the app
   bar: "An update is available: version …" with **Update now** and
   **Later**. Later hides it for that version.
3. **Update now** downloads and installs it. The Windows installer shows a
   simple progress window (`passive` mode), closes the app, installs and
   starts the new version. A percentage is shown only when the download
   size is known.
4. Settings → Updates shows the running version, the channel
   (Development / test) and **Check for updates**.

If the network or GitHub is unavailable nothing is shown for the automatic
check and the app works exactly as before. Scripture, Studies and the
Library never depend on the update check.

## How it is built (and kept safe)

- Official **Tauri 2 updater** plugin. Updates are **signed**; the app has
  only the **public** key and refuses anything not signed by the matching
  private key. HTTPS only (the plugin rejects other transports).
- **`requireSignedVersion`**: the signature is bound to the exact version
  (`tauri signer sign --app-version`), and the app rejects an update whose
  `latest.json` announces a different version than the one signed. A
  tampered manifest therefore cannot pair a new version number with an
  older signed installer.
- **Ordinary builds have no updater.** `tauri.conf.json` contains no
  updater section. The workflow merges one in at build time
  (`scripts/updater.mjs overlay`): the public key, the endpoint, the build's
  version and `installMode: passive`. The app registers the plugin only if
  that section exists (`AppInfo.updatesEnabled`), so local development,
  CI and the ordinary *Native builds* installers never check for updates
  and work unsigned.
- Capabilities: only `updater:default` was added to the main window
  (check, download, install). The content-security policy is unchanged; the
  update traffic is made by the native updater, not by the web view.
- The **app identifier is unchanged** (`app.abidingword.desktop`), so an
  update installs over the existing installation.

### Why not `bundle.createUpdaterArtifacts`

`createUpdaterArtifacts: true` makes `tauri build` itself sign, so the
private key would have to be present while the repository's code (build
scripts, npm scripts) compiles, and every unsigned local or CI build would
fail. Instead the installer is built without secrets and then signed by
`tauri signer sign` in a separate job. The result is the same signed
artifact and `.sig` file.

### Workflow: `publish-windows-test-update.yml`

Manual only (`workflow_dispatch`). Two jobs:

| Job | Secrets | Does |
|---|---|---|
| `build` | none | version → NSIS installer built with the updater overlay → artifact |
| `publish` (environment `windows-test-updates`) | signing key, updates-repo token | signs the installer, writes `latest.json`, checks it is newer, publishes |

Signing secrets are only passed to the single signing step; the token only
to the publishing step. Pull requests never run it. Restrict the
`windows-test-updates` environment to the branches you publish from.

The existing *Native builds* workflow is unchanged: it still produces
ordinary unsigned installers for every platform.

## Channel layout

Update files are hosted in a **public** GitHub repository (`updatesRepository`
in `src-tauri/updater/test-channel.json`). This source repository is
private, and an installed app cannot authenticate to a private repository, so
update files cannot be served from it.

- Each publish creates a **pre-release** `test-v<version>` holding
  `Abiding-Word_<version>_x64-setup.exe` and its `.sig`.
- A single pre-release **`test-channel`** holds only `latest.json`,
  replaced on every publish (installer first, pointer second).
- Test builds embed exactly one endpoint:
  `https://github.com/<updatesRepository>/releases/download/test-channel/latest.json`.
  The endpoint is fixed in the build; it is not an input of the workflow.
- Stable releases (later) are separate: a stable build will embed a
  different endpoint (for example `…/releases/latest/download/latest.json`,
  which GitHub never resolves to a pre-release). Test builds read only
  `test-channel`; stable builds never see test updates. Moving from the
  test channel to stable is a manual install of the stable build.
- None of this touches the milestone tags (`studies-v0.3`, `library-v0.4`)
  or any tag in this repository.

## Version scheme

Test builds are `X.Y.Z-dev.N`, for example `0.5.0-dev.12`.

- The workflow input is the base version (`0.5.0`); **N is the workflow
  run number**, which only ever increases, so each publish is newer than the
  last. SemVer compares `dev.9 < dev.10` numerically and any
  `X.Y.Z-dev.N` below `X.Y.Z`.
- The committed version stays `0.1.0` in `package.json`, `Cargo.toml` and
  `tauri.conf.json`; CI injects the build version into the Tauri config
  (the app's version comes from there). No extra commits are needed per
  build, and updates never depend on Git commit hashes.
- Windows MSI cannot represent `-dev.N`, so test updates use the **NSIS**
  installer only. (Ordinary Native builds still make the MSI at `0.1.0`.)
- The workflow refuses to publish a version that is not newer than the one
  in `latest.json`.

## One-time setup (owner)

Nothing in this repository can do these steps for you.

1. **Generate the signing key pair locally** (never in CI, never committed):

   ```sh
   npx tauri signer generate -w ~/.tauri/abiding-word-test.key
   ```

   Choose a password when asked. This writes the private key
   (`abiding-word-test.key`) and the public key (`abiding-word-test.key.pub`).
   Keep the private key and password safe: if they are lost, installed test
   builds can never update again.
2. **Create the public updates repository** (for example
   `abidingword-updates`) with a README so it has a first commit. It holds
   only signed installers and `latest.json`.
3. **Commit the public key and repository name** in
   `src-tauri/updater/test-channel.json`: `pubkey` = the whole contents of
   the `.pub` file, `updatesRepository` = `owner/name`. (The workflow fails
   with a clear message while either is empty.)
4. **Create the GitHub Environment** `windows-test-updates` (Settings →
   Environments) in this repository, limit *Deployment branches* to the
   branches you publish from, and add these **environment secrets**:
   - `TAURI_SIGNING_PRIVATE_KEY` — the contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (omit only if none)
   - `UPDATES_REPO_TOKEN` — a fine-grained personal access token limited to
     the updates repository with *Contents: read and write*
5. **Bootstrap**: run *Publish Windows test update* once, then install the
   resulting `…_x64-setup.exe` (from the updates repository's release) on the
   Windows laptop. That installation is the one that later updates itself.
   Run the workflow again to publish the next test build.

(If this source repository is ever made public, the same repository can host
the files; set `updatesRepository` to it and use the built-in token.)

## Manual acceptance on Windows

- Install the bootstrap build; Settings → Updates shows its version and
  *Development / test*.
- Publish a second build; within a minute of starting, or via **Check for
  updates**, the notice appears; **Later** hides it; **Update now** shows the
  installer progress, restarts into the new version, and Settings shows the
  new version.
- With the network off the app starts normally and nothing is reported on
  startup; a manual check reports a plain "Could not check for updates".
