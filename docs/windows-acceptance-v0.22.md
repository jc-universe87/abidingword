# Windows acceptance: v0.20 – v0.22 on top of 0.5.0-dev.41

The last Development/Test build installed on the owner's Windows computer is
**0.5.0-dev.41**, built from `f19abbb` (v0.18.10). The branch
`claude/beautiful-curie-vm0eve` adds v0.19 – v0.22 on top of it. This page is
the readiness review and the manual checklist for the owner, to be used only
after the owner has chosen to merge and a signed test update has been
published by the normal process (nothing here builds, signs or publishes).

## 1. What changes for existing data

| Migration | Version | What it does to an existing database | Risk |
|---|---|---|---|
| 0016 `unresolved_citations` | v0.19 | rebuilds `finding_sources` (a citation may now stand without its library source); every consistent row copied unchanged, the source's file hash recorded | the only table rebuild; covered by `tests/citations.rs`, `tests/portability.rs`, tolerant of old inconsistent rows (`ef5983f`) |
| 0017 `word_annotations` | v0.21 | four new, empty tables for Bible word annotations | additive only; Bibles keep their text, no words until added (§2) |
| 0018 `grammar_provenance` | v0.22 | three new, empty columns; `morph_scheme 'oshb' → 'raw'` (only rows written by v0.21, which no released build has) | additive; on a dev.41 database it changes no row |

Before any migration runs, the app copies the database to
`backups\pre-migration\abiding-word-v15-<time>.db` (verified copy; startup
stops with a plain message if the copy or a migration fails, and a failed
migration is rolled back completely). The migrations run once, in order, each
in its own transaction.

**Data compatibility.**

- Bible texts, studies, notes, highlights, library sources, citations,
  teaching, presentations, templates and settings are kept.
- Bibles added in dev.41 have **no word index** after the update. The bundled
  Bibles carry Strong's numbers only; they are not indexed unless the owner
  asks (Settings → Bible texts → Details → Word information). Nothing has to
  be re-imported.
- `.awbackup` files and project files from dev.41 can be opened by the new
  version (older schema, migrated on restore). Files made by the new version
  **cannot** be opened by dev.41 (refused as "saved by a newer version").

**Upgrade and rollback risk.**

- A database upgraded to schema 18 is refused by dev.41 ("written by a newer
  version"): going back means restoring the pre-migration copy (§3, step R).
  Work done after the update is not in that copy — export it first (step R1).
- The updater public key, endpoints, signing setup and version numbers are
  unchanged by this branch; `ci.yml` and the publish workflow are untouched.
- New native commands (v0.21–v0.22) are granted to the main window only
  (`permissions/windows.toml`, checked by `tests/capabilities.rs`).
- v0.22 reads user-chosen OSIS (OSHB) and MorphGNT files; a malformed file is
  refused with a message, never half-read. A crash found in testing (a
  Hebrew character cut at the 20,000th byte of an OSIS header) is fixed and
  covered by a test.

## 2. Readiness

The branch is **ready for the owner to commission a Development/Test build**
once it is merged, with the caveats above: the three migrations are additive
or covered rebuilds with automatic backup, all checks pass on the branch
(see the handover), and no updater, signing or release setting changed.
Not verified here: the Windows installer itself, WebView2 rendering of Hebrew
(RTL, vowel points, cantillation) and polytonic Greek with the system fonts,
and real Windows file dialogs — those are what the checklist below is for.

## 3. Manual checklist (owner, on Windows)

### Before updating

- [ ] **B1** In dev.41: Settings → Data and backup → **Back up everything…**;
  save the `.awbackup` outside the data folder (e.g. a USB stick).
- [ ] **B2** Close Abiding Word. Copy the folder `%APPDATA%\Abiding Word` to
  the same place (a second, independent copy).
- [ ] **B3** Note the Bibles installed and one study with notes and a
  citation, to compare after the update.

### Update

- [ ] **U1** Install the test update through Settings → Updates (or the test
  channel installer). Start the app.
- [ ] **U2** It opens without a message. `%APPDATA%\Abiding Word\backups\pre-migration`
  contains a new `abiding-word-v15-….db`.
- [ ] **U3** Settings → About shows the new dev version.

### Existing data (compare with B3)

- [ ] **D1** Every Bible is listed; a chapter reads as before; the
  concordance (Word, Phrase) finds the same counts as before.
- [ ] **D2** Studies, notes, highlights, citations (open one into its source),
  teaching and presentations are there and open.
- [ ] **D3** Settings → Bible texts → Details shows **Word information: No
  word index.** for each Bible; nothing was added by itself.

### New in v0.19 – v0.21 (short)

- [ ] **N1** Settings → Data and backup: export a project, then **Back up
  everything…** (keep the file for R1).
- [ ] **N2** A Bible Study's Help panel opens (with the assistant off it
  says so plainly).

### New in v0.22: original-language research

Download for these steps (from the links in Add a Bible → *Hebrew and Greek
editions…*): the eBible.org Robinson–Pierpont `grcmt_usfm.zip`, the SBL
`grcsbl_usfm.zip`, the MorphGNT repository and the OSHB repository (`.zip`).

- [ ] **G1** Add a Bible → open *Hebrew and Greek editions for
  original-language research*: five editions; each **Open …** button opens the
  browser at the publisher's page; nothing downloads by itself.
- [ ] **G2** Choose `grcmt_usfm.zip`. Under *Original-language research*:
  written word, lexical number, grammar; the grammar line says the edition
  names Robinson's codes (or, if not, offers an **unticked** choice). Add it.
- [ ] **G3** Choose `grcsbl_usfm.zip`: *Add a search by lexical number* is
  offered **unticked**, with a size. Leave it unticked, add the Bible:
  Settings shows *No word index*. Then Settings → Details → Word information →
  **Look for word information…**, tick, **Save word index**: it shows the
  number of words. **Remove word index…** removes it; the text stays.
- [ ] **G4** Choose the MorphGNT `.txt` files (all 27): added with dictionary
  forms; concordance **Lemma** `λογος` finds λόγος with its forms; Greek
  accents display correctly.
- [ ] **G5** Choose the OSHB `wlc\*.xml` files **with** `VerseMap.xml`: the
  review notes the Hebrew numbering was changed (about 1,970 verses, 4 joined,
  Psalm titles kept). Without `VerseMap.xml`: Joel 4 is refused with a note
  saying what to add. Add it with the map.
- [ ] **G6** Read Genesis 1 and Psalm 51 in the OSHB Bible: Hebrew right to
  left, vowel points and accents shown, maqaf and sof pasuq attached; Psalm 51
  shows its title above verse 1.
- [ ] **G7** Select a Hebrew word → **Word details**: lexical number (no
  lemma), grammar in words; **Find this lexical number** → concordance shows
  its occurrences highlighted. Then a Greek word in `grcmt`.
- [ ] **G8** Concordance on the SBL Bible (after G3 save): the mode is called
  **Lexical number**; `g3056`, `3056` and `G3056` give the same result.
- [ ] **G9** Keyboard only: Tab through the Add a Bible review choices and
  the Settings word panel; Space ticks; Escape cancels the review.
- [ ] **G10** Narrow the window to its smallest; switch light/dark: the
  review and Settings panels stay readable.
- [ ] **G11** Switch the interface to Deutsch and 한국어: the new texts are
  translated (German uses *du*).

### If anything goes wrong — rollback

- [ ] **R1** If the new version still runs: Settings → Data and backup →
  **Back up everything…** (work done since the update).
- [ ] **R2** Uninstall, reinstall **0.5.0-dev.41**.
- [ ] **R3** Close it. In `%APPDATA%\Abiding Word\database`, replace
  `abiding-word.db` with the `backups\pre-migration\abiding-word-v15-….db`
  copy (renamed to `abiding-word.db`), or restore the folder copy from B2.
- [ ] **R4** Start dev.41: the data is as at B3. Work saved in R1 can only be
  opened again after updating (dev.41 refuses newer backups).

Report each failed step with what was on screen, and the newest file in
`%APPDATA%\Abiding Word\logs`.
