# Agent Commons — Abiding Word pilot adoption

**Adoption status:** draft for review; nothing here changes the application, builds, or release configuration.

| Field | Value |
| --- | --- |
| Upstream | Private Agent Commons working library, v0.3 |
| Exact upstream revision | `db870a7282fb67ce5fbff43906674a595e26b630` |
| Target repository | `jc-universe87/abidingword` (public) |
| Target branch | `docs/agent-commons-v03-pilot` (review branch) |
| Scope | Non-personal agent instructions and five task skills only |
| Distribution | Checked-in, independently readable files; no runtime fetch or background sync |

## Why a checked-in copy?

Claude Code cloud sessions working in Abiding Word cannot be assumed to read a separate, private repository. Its practical source of instructions is what exists in this workspace. The standing `CLAUDE.md` **keeps all existing rules** and imports root `AGENTS.md`; the task procedures live in `.claude/skills/`.

## Imported and adapted

- Root `AGENTS.md`: concise, Abiding Word-specific distillation of epistemic integrity, source preservation, human authority, human-first UX, engineering quality, and project-specific rules.
- `.claude/skills/prepare-coding-brief/SKILL.md`, `verify-claim/SKILL.md`, `review-change/SKILL.md`, `review-human-ux/SKILL.md`: copied from pinned generic source.
- `.claude/skills/native-i18n-polish/SKILL.md`: **adapted** to this project's actual locales and `docs/i18n.md` (particularly neutral `pt`, not `pt-BR`).

No personal theological profile, private writing-voice material, Kim Family PNGs, sponsorship/account preferences, secrets, model-provider registry, other-product branding, or private runtime content is imported into this public repository.

## Authority and change boundaries

1. Platform constraints, current authorised task instructions, and **existing Abiding Word-specific architecture, migrations, release security and language contracts** take precedence over generic reusable examples.
2. The feature branch and draft PR are not permissions to merge, deploy, change signing keys, tag milestones, or publish releases.
3. On this project, CI runs on pull requests. Successful updates to `main` have a separate automatic Windows test-publication path; **do not merge the pilot merely to test that it loaded**.
4. Nothing automatically syncs from Agent Commons. A future insight can improve it deliberately, but this project changes only after a reviewed, pinned update.

## Fresh Claude Code cloud acceptance (after opening the review branch)

Ask the new session, **without first quoting the instructions back to it**:

> Identify the files that provide your Abiding Word development instructions and the exact Agent Commons revision vendored here. Which skill would you use to prepare a new coding brief, to review a source claim, and to polish translations? What is the exact Portuguese locale code? What happens after a successful merge to main? Do not modify any files.

Pass only if it names the **actual workspace files**, the pinned revision, the `pt` locale and main-merge release risk, and does not pretend it accessed any absent private references.

For a functional skill exercise, ask it to apply `review-human-ux` to one **existing screenshot** and to distinguish observations from untested assumptions. No application code changes are needed.

## Deliberate updates later

1. Identify new evidence or a proposed clarification; record the originating upstream revision and **exact diff**.
2. Screen every file for private family, account or other-project content before copying to the public repository.
3. Compare against active `CLAUDE.md`, `docs/concept.md`, `docs/architecture.md`, `docs/i18n.md`, `docs/updates.md`, and the current code. Flag conflicts and any weakened or removed rule.
4. Change only needed instructions/skills on a separate branch and update this pin. Open a reviewable PR. Do not silently auto-update all projects.
5. Re-run the fresh-session acceptance and relevant checks. A textual inspection is **not** equivalent to a successful Claude Code cloud loading test.

## Pilot change verification

Review the actual PR diff for: **no application code changes**, no CI or updater changes, no private files, no locale changes, and no removal of the existing `CLAUDE.md` content. Frontend/Rust execution checks are outside scope for a documentation-only change unless the reviewer chooses to run them; report any unrun checks accurately.
