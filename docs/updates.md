# Abiding Word — Windows test updates

Windows is the primary visual and manual acceptance platform. To avoid
downloading and running an installer for every iteration, an installed
**test build** can update itself to a newer, **signed** test build.

**Every successful update to `main` automatically publishes a signed
Development/Test Windows update.** Whenever the normal *CI* workflow passes
for a commit on `main`, that exact commit is built, signed and published, so
the installed Windows test build can normally update to the latest green
`main`. Feature branches, pull requests and failed CI runs never publish, and
this is **never** a stable release. The manual *Publish Windows test update*
button remains for recovery.

> **Completion rule (for people and for Claude sessions).** Do not finish a
> merge or milestone task without checking that the updater channel contains
> that green `main` commit: report the merged `main` SHA, the `main` CI
> result, the *Publish Windows test update* run result, the published dev
> version and whether `test-channel/latest.json` points to it.

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

Two ways to start it:

1. **Automatically**: `workflow_run` on the *CI* workflow, `types: [completed]`,
   `branches: [main]`. Nothing else triggers it.
2. **By hand** (`workflow_dispatch`): Actions → *Publish Windows test update* →
   Run workflow, with a base version and optional notes. Use it to retry a
   failed publish or to publish a chosen ref.

Three jobs:

| Job | Secrets | Does |
|---|---|---|
| `gate` | none | automatic runs: confirms the CI run succeeded, was a **push** to **`main`** of this repository, and that its commit is still the newest on `main`; outputs the exact SHA |
| `build` | none | checks out that SHA → version → NSIS installer built with the updater overlay → artifact |
| `publish` (environment `windows-test-updates`) | signing key, updates-repo token | checks out the same SHA, signs the installer, writes `latest.json`, checks it is newer, re-confirms the SHA is still the newest `main` commit, publishes, then verifies the pointer |

Signing secrets are only passed to the single signing step; the token only to
the publishing step. No step sees both.

**Why feature branches and pull requests cannot reach the secrets.** A
`workflow_run` workflow always runs from the **default branch's** copy of the
file, so a branch or pull request cannot change what runs. It is started only
by a *CI* run that **succeeded**, whose event is **`push`**, on branch
**`main`**, of **this** repository (`head_repository.full_name`); a fork's pull
request is `event: pull_request` and is refused even from a branch named
`main`. The workflow never checks out pull-request code: it checks out only the
commit SHA that passed CI on `main`. Values taken from the triggering run reach
scripts only through `env:`, never by interpolation into a shell command. The
build job holds no secrets, and the `windows-test-updates` environment holds
them for the publish job alone. The `windows-test-updates` environment must
allow the **`main`** branch (Settings → Environments → *Deployment branches*);
if it does not, the publish job fails with GitHub's environment message.

**Exactness and ordering.** The commit published is
`github.event.workflow_run.head_sha`: the one CI passed on. CI cancels an
older run of the same branch when a newer push arrives, so only commits whose
CI completed are published. If `main` has moved on by the time a run starts
(gate) or by the time the build finishes (publish), that run publishes
nothing, because the newer commit's own CI run publishes instead; an older
commit therefore can never overwrite a newer one. Publishes are serialized
(`concurrency: windows-test-update`).

**Failure behaviour.** A publish failure shows as a failed *Publish Windows
test update* run only. CI and the code on `main` are unaffected, nothing in the
application depends on GitHub Releases, and **Run workflow** retries it. The
publish step is repeatable: if an earlier attempt created the versioned release
but stopped before the pointer moved, a retry replaces its files; once the
pointer offers a version, that version can not be republished (it must be newer).

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

Test builds are `X.Y.Z-dev.N`, for example `0.5.0-dev.14`.

- **N is the run number of the *Publish Windows test update* workflow**
  (`github.run_number`). It is assigned once per run, only ever increases and is
  shared by automatic and manual runs of that workflow, so each publish is
  newer than the last; runs that publish nothing only leave gaps. Git commit
  hashes are never part of the comparison (the source commit is recorded in the
  release notes of `test-v<version>`).
- The **base** (`X.Y.Z`): automatic runs use `DEFAULT_BASE_VERSION` (set at the
  top of the workflow, currently `0.5.0`) unless the published test build has a
  higher base, which is then kept (`scripts/updater.mjs choose-version`). A
  manual run uses the base typed into the input. To move to a new base, run the
  workflow by hand once with it, and raise `DEFAULT_BASE_VERSION` in a commit.
- Re-running a failed run keeps its run number, so it publishes the same
  version. SemVer compares `dev.9 < dev.10` numerically and any
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
   Environments) in this repository, limit *Deployment branches* to `main`
   (plus any other branch you will run the manual workflow from), and add
   these **environment secrets**:
   - `TAURI_SIGNING_PRIVATE_KEY` — the contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (omit only if none)
   - `UPDATES_REPO_TOKEN` — a fine-grained personal access token limited to
     the updates repository with *Contents: read and write*
5. **Bootstrap**: the first installation needs a published build. Merge to
   `main` (or run *Publish Windows test update* by hand), then install the
   resulting `…_x64-setup.exe` (from the updates repository's release) on the
   Windows laptop. That installation is the one that later updates itself;
   every later green `main` is offered to it automatically.

(If this source repository is ever made public, the same repository can host
the files; set `updatesRepository` to it and use the built-in token.)

## Manual acceptance on Windows

- Install the bootstrap build; Settings → Updates shows its version and
  *Development / test*.
- After the next green `main` is published (no manual step), within a minute of
  starting, or via **Check for updates**, the notice appears; **Later** hides it; **Update now** shows the
  installer progress, restarts into the new version, and Settings shows the
  new version.
- With the network off the app starts normally and nothing is reported on
  startup; a manual check reports a plain "Could not check for updates".
