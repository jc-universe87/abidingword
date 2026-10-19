# Abiding Word — instructions for Claude sessions

This file holds the standing development-workflow rules. The detail behind
each rule is in `docs/` (start with `docs/updates.md`).

## Windows test updates are automatic

Windows is the primary visual acceptance platform. **Every successful update
to `main` automatically publishes a signed Development/Test Windows update**
(`.github/workflows/publish-windows-test-update.yml`, started by the normal
*CI* workflow succeeding on a push to `main`). **Do not finish a merge/release
task without checking that the updater channel contains that green `main`
commit.**

- Feature branches, pull requests and failed CI runs never publish. Stable
  releases are never automatic. Never expose the signing key, its password or
  `UPDATES_REPO_TOKEN` to anything but the `publish` job's signing / publishing
  steps; the `build` job must stay secret-free.
- The manual *Publish Windows test update* button (`workflow_dispatch`) stays
  as the recovery path. A failed publish never blocks or reverts `main`.
- Do not change the updater public key, regenerate signing keys, or alter
  existing milestone tags. Do not tag a milestone unless told to.

## Completion checklist after merging to `main`

Every report after a merge must include:

1. the merged `main` SHA;
2. the `main` CI result for that exact SHA;
3. the *Publish Windows test update* run result for that SHA;
4. the published dev version (`X.Y.Z-dev.N`);
5. whether `test-channel/latest.json` in `jc-universe87/abidingword-updates`
   points to that version
   (`https://github.com/jc-universe87/abidingword-updates/releases/download/test-channel/latest.json`).

If the publish run failed, say so with the reason, retry it with *Run
workflow* once the cause is fixed, and report the retry. A merge is not
finished while the channel lacks the green commit.

## Checks before pushing

- Interface: `npm run typecheck`, `npm run lint`, `npm run i18n:check`,
  `npm test`, `npm run build`.
- Native core (from `src-tauri/`): `cargo fmt -- --check`,
  `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`.
- Rust CI builds without debug information (`CARGO_PROFILE_*_DEBUG=0` in
  `ci.yml`): the runner's disk fills up otherwise.

## Shared, project-adapted agent standards

@AGENTS.md

The imported guidance is pinned and reviewable in `docs/agent-commons-adoption.md`. This supplement does not alter the Windows test-update, CI, signing, or approval rules above.
