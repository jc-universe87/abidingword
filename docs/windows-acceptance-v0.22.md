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
`backups\pre-migration\abiding-word-v15-<time>.db` with SQLite's
`VACUUM INTO` (a single, complete file: changes still in the WAL file are
included), then checks that the copy opens, passes an integrity check and is
schema 15. Startup stops with a plain message if the copy or a migration
fails, and a failed migration is rolled back completely. The migrations run
once, in order, each in its own transaction.

**Verified on a real file** (`src-tauri/tests/windows_rollback.rs`): a
schema-15 database in WAL mode with sources, a Bible Study, a note with a
citation, a Bible Teaching and a Bible text, its last change only in the WAL
file, upgraded through 0016–0018: the pre-migration copy holds every row
(the WAL change included), passes `integrity_check` and is schema 15; the
upgraded database keeps every row, passes `integrity_check` and
`foreign_key_check`; dev.41's migrations refuse it; the pre-migration copy
(WAL/SHM removed) and a folder copy each restore exactly the dev.41 data.

**Data compatibility.**

- Bible texts, studies, notes, highlights, library sources, citations,
  teaching, presentations, templates and settings are kept.
- Bibles added in dev.41 have **no word index** after the update. The bundled
  Bibles carry Strong's numbers only; they are not indexed unless the owner
  asks (Settings → Bible texts → Details → Word information). Nothing has to
  be re-imported.
- dev.41 has **no** *Back up everything* or project files (they arrived in
  v0.19): before updating, the only backup is a copy of the data folder.
  Backups and project files made by the new version cannot be used by
  dev.41 at all.

**Upgrade and rollback risk.**

- A database upgraded to schema 18 is refused by dev.41 ("written by a newer
  version"): going back means restoring the folder copy made before the
  update (B2), or the automatic pre-migration copy (§3, R). **Work done after
  the update is lost by going back**: neither copy has it, and dev.41 cannot
  read anything the new version saves.
- The database runs in WAL mode: beside `abiding-word.db` there may be
  `abiding-word.db-wal` and `abiding-word.db-shm`. Restoring an older
  database file while the newer one's `-wal` file is left beside it gives a
  damaged database (tested: "database disk image is malformed"). The
  rollback steps remove both files first; a folder copy made with the app
  closed is consistent as a whole.
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

- [ ] **B0** Keep the **0.5.0-dev.41 installer** (from the test-channel
  release) where you can find it: going back means installing it again; the
  updater does not offer older versions.
- [ ] **B1** Close Abiding Word completely (check that no Abiding Word
  window is left, and none in the Task Manager).
- [ ] **B2** Copy the whole folder `%APPDATA%\Abiding Word` (all of it,
  including any `abiding-word.db-wal` / `-shm` files) to a USB stick or another
  drive. dev.41 has no *Back up everything*: this copy is the backup.
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
  everything…** — the first full backup in the new version (for the new
  version only; dev.41 cannot open it).
- [ ] **N2** A Bible Study's Help panel opens (with the assistant off it
  says so plainly).

### New in v0.22: original-language research

Download for these steps (from the links in Add a Bible → *Hebrew and Greek
editions…*): the eBible.org Robinson–Pierpont `grcmt_usfm.zip`, the SBL
`grcsbl_usfm.zip`, the eBible.org `hboWLC_usfm.zip`, the MorphGNT repository
and the OSHB repository (`.zip`).

- [ ] **G1** Add a Bible → open *Hebrew and Greek editions for
  original-language research*: five editions; each **Open …** button opens the
  browser at the publisher's page; nothing downloads by itself.
- [ ] **G2** Choose `grcmt_usfm.zip`. Under *Original-language research*:
  written word, lexical number, grammar; the grammar line says the edition
  names Robinson's codes. Add it.
- [ ] **G3** Choose `grcsbl_usfm.zip`: *Add a search by lexical number* is
  offered **unticked**, with a size. Leave it unticked, add the Bible:
  Settings shows *No word index*. Then Settings → Details → Word information →
  **Look for word information…**, tick, **Save word index**: it shows the
  number of words. **Remove word index…** removes it; the text stays.
- [ ] **G4** Choose the MorphGNT `.txt` files (all 27): added with dictionary
  forms; concordance **Lemma** `λογος` finds λόγος with its forms; Greek
  accents display correctly.
- [ ] **G5** Choose the OSHB `wlc\*.xml` files **with** `VerseMap.xml`. The
  review notes: about 1,977 verses renumbered, 7 joined, 120 Psalm titles,
  and 116 parts of Hebrew verses placed where the text marks them; one
  warning: Nehemiah 7:68 not found (the Leningrad Codex does not have that
  verse). Without `VerseMap.xml`: Joel 4 is refused with a note saying what
  to add. Add it with the map.
- [ ] **G6** In the OSHB Bible read Genesis 1, Psalm 11 and Psalm 51 (each
  shows its title above verse 1, not inside it), Psalm 13:5–6, Isaiah 63:19 –
  64:2 (64:1 begins with לוּא, "Oh that thou wouldest rend") and 1 Kings 18:33–34: Hebrew right to left,
  vowel points and accents shown, maqaf and sof pasuq attached.
- [ ] **G6b** Choose `hboWLC_usfm.zip` **with** `VerseMap.xml`: the review
  **warns** that 1 Kgs 18:34, 20:3, 22:21, Ps 13:6 and Isa 63:19 are kept whole
  (these files do not mark where an English verse begins inside them), and
  notes that Psalm titles inside verse 1 stay in verse 1. Cancel.
- [ ] **G7** Select a Hebrew word → **Word details**: lexical number (no
  lemma), grammar in words; **Find this lexical number** → concordance shows
  its occurrences highlighted. Then a Greek word in `grcmt`.
- [ ] **G8** Concordance on the SBL Bible (after G3 save): the mode is called
  **Lexical number**; `g3056`, `3056` and `G3056` give the same result.
- [ ] **G9** Choose a Bible `.zip` together with an unrelated `.xml` file: the
  review says one file was left out and, opened, names it.
- [ ] **G10** Keyboard only: Tab through the Add a Bible review choices and
  the Settings word panel; Space ticks; Escape cancels the review.
- [ ] **G11** Narrow the window to its smallest; switch light/dark: the
  review and Settings panels stay readable.
- [ ] **G12** Switch the interface to Deutsch and 한국어: the new texts are
  translated (German uses *du*).

### If anything goes wrong — rollback

> **Work done after the update is lost by going back.** dev.41 can read
> neither the updated database nor the new version's backups or project
> files. Before going back, write down or copy out (as text) anything you
> must keep.

- [ ] **R1** Close Abiding Word completely (as B1).
- [ ] **R2** Uninstall the new version; install **0.5.0-dev.41** (B0). Do
  not start it yet.
- [ ] **R3** Rename `%APPDATA%\Abiding Word` to `Abiding Word (after update)`
  (kept, in case you need it), then copy the B2 folder back as
  `%APPDATA%\Abiding Word`.
  *If you have no B2 copy:* in `%APPDATA%\Abiding Word\database`, move
  `abiding-word.db` aside (e.g. rename it `abiding-word-updated.db`),
  **delete `abiding-word.db-wal` and `abiding-word.db-shm` if they are
  there**, then copy `backups\pre-migration\abiding-word-v15-….db` into that
  folder and rename the copy `abiding-word.db`. (Library or Bible files added
  after the update stay in `sources` unused. A library book or Bible
  *removed* after the update has lost its file: it is listed again but
  cannot be opened — the B2 folder copy does not have this problem.)
- [ ] **R4** Start dev.41: the data is as at B3.

Report each failed step with what was on screen, and the newest file in
`%APPDATA%\Abiding Word\logs`.
