# Windows acceptance: v0.23 on top of 0.5.0-dev.42

The Development/Test build on the owner's Windows computer is
**0.5.0-dev.42** (schema 18). The branch `claude/beautiful-curie-vm0eve` adds
v0.23 on top of it: the Study editor fit for Korean text and Bibles from
documents. This list is for use **after** the owner has chosen to merge and a
signed test update has been published by the normal process. Nothing here
builds, signs or publishes.

## 1. What changes for existing data

| Migration | What it does to an existing database | Risk |
|---|---|---|
| 0019 `bible_documents` | three new, empty tables, an index and a full-text index | additive; no existing row or column changes |

As for every migration, the app first copies the database to
`backups\pre-migration\abiding-word-v18-<time>.db` and checks it. A dev.42
database upgraded to schema 19 is refused by dev.42 ("written by a newer
version"): going back means restoring that copy or a folder copy, and work
done after the update is lost by going back. Tested automatically:
`tests/bible_documents.rs::a_dev42_database_upgrades_and_keeps_everything`.

Before updating, make a folder copy (**Settings → Data and backup → Back up
everything…**).

## 2. Checklist

Prepare a few files: a Bible you own as a PDF with selectable text, an EPUB,
a Word document, a scanned PDF (any scanned book will do for the scanned
check), and optionally a Bible split into one file per book.

**A — Study editor (Korean)**

- [ ] A1. Interface language 한국어. Open a Bible Study; type several
      lines of Korean text in a part, including a long line that wraps. The
      last line is fully visible; no inner scroll bar.
- [ ] A2. Make the window narrow, then wide again; the part grows and shrinks
      without clipping and the caret stays where it was.
- [ ] A3. Fold and unfold the part; switch the interface to Deutsch and back;
      change the text size in Appearance. No clipping after each.
- [ ] A4. Close and reopen the Study: the text was saved.

**B — Adding a Bible from a document**

- [ ] B1. Settings → Bible texts → Add a Bible… → Choose Bible files… → choose
      the text PDF. The review says "PDF, N pages, their text can be read",
      how many verses were detected, which books, and what was left out.
- [ ] B2. If it offers *By book, chapter and verse*: open *Check the books found* and
      check two or three chapters against the PDF (first verse, last verse,
      a verse that crosses a page). Add it; go to one of those passages in
      the Scripture pane; the text matches the PDF word for word.
- [ ] B3. Add the same PDF again as *As a document to read* (with another
      short name). It appears in the translation menu; choosing it shows the
      PDF pages; switch to *Text*; search a word; leave and come back — the
      same page opens.
- [ ] B4. On that document Bible: *What can I do with this Bible?* → *Look
      for verses…* → the review appears; *Keep it as a document* changes
      nothing.
- [ ] B5. EPUB and Word documents: add each; the *Original* tab shows the
      formatting; footnotes in the Word document are not part of verses.
- [ ] B6. Scanned PDF: the review says the pages are scanned and there is no
      text; only *As a document to read* is possible; it shows the pages.
- [ ] B7. Cancel on the review: nothing appears in Bible texts, and
      `%APPDATA%\…\sources\bibles\` has no new folder.
- [ ] B8. Bible split into several files (if available): choose them
      together; they are read in name order and listed under *What the files hold*.
- [ ] B9. Remove a document Bible: it disappears and its folder under
      `sources\bibles\` is gone; your original files are untouched.
- [ ] B10. With the interface in Deutsch and 한국어, open the review screen:
      the text is readable and nothing is cut off.

**C — Nothing else changed**

- [ ] C1. Existing Bibles, studies, notes, highlights and library sources are
      all there after the update.
- [ ] C2. Adding a USFM Bible (`.zip`) still works as before.

## 3. Automated checks already run on the branch

Run in the development container (Linux), not on Windows: `cargo fmt`,
`cargo clippy -D warnings`, `cargo test` (including the USFM, OSHB, MorphGNT
and dev.42-upgrade tests), `npm run typecheck`, `lint`, `i18n:check`,
`npm test`, `npm run build`. The PDF rendering in the reader and the
Korean text fit were checked in Chromium screenshots; WebView2 on Windows is
the acceptance platform for both (A, B3, B10).
