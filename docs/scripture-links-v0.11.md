# Scripture links in Library sources (v0.11)

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use* Abiding Word, see the User Guide: **[Bible references in your books](guide/06-bible-references.md)**. Status lines below describe the time this record was written; the current state of every version is in the [milestone table](developers.md#milestones).

**Status: complete. Windows acceptance passed** on the Development/Test build
`0.5.0-dev.22`, built from the accepted `main` commit
`99118d526eb6c2bba79d6f3cac23b1a537b8e772` (the v0.11 merge plus the Contents
focus fix below). The milestone tag `scripture-links-v0.11` is created on that
commit and is on GitHub. **No database migration.** Deterministic only: no AI.

### Windows acceptance notes (`0.5.0-dev.22`)

- **Reading view links: accepted.** References in Reading are actionable in
  every format; Open in Bible, Back / Forward and Back to the Study's primary
  passage behave as designed, and the primary passage is never changed.
- **EPUB and Word (DOCX) Original links: accepted.**
- Keyboard and focus, Korean and the interface strings: accepted.
- **PDF Original is non-interactive, intentionally.** pdf.js draws the page as
  positioned text runs, and there is no exact mapping from those runs to the
  imported text, so no reference positions can be known. Guessed overlays are
  not drawn. This is a deliberate v0.11 limitation, **not a failed feature**:
  the Reading view is the PDF path for Scripture links (see *Supported views*).
- **German "Mal" (Maleachi): fixed after acceptance** on
  `fix/v0.11-german-malachi`. "Mal 4,3" was not recognised because "Mal" was
  left out of the German dictionary on purpose (it is an ordinary word: "mal
  sehen", "Mal 5 Minuten"). It is now accepted under a narrow rule, see
  *Language*.

Contents focus (fixed with v0.11): choosing a Contents entry in Reading moves
focus to the paragraph it lands on and keeps it there; closing the panel no
longer takes focus back to the Contents button a frame later.

v0.9 went from a Scripture passage to the Library sources about it. v0.11 goes
the other way: a Bible reference written in a source becomes a bridge back
into Scripture. The two complement each other; the v0.9 relevance model is
unchanged.

> A source reference changes what Scripture is **viewing**. It never changes
> what the Study is **about**.

## State model

Three things are kept apart:

| | What | Where it lives | Changed by |
|---|---|---|---|
| Study primary passage | e.g. John 15:1–11 | Study data (database) | only the user, in the Study's passages |
| Current Scripture location | what the Scripture pane shows | `ScriptureContext` (and the saved last passage, as before) | any navigation |
| Scripture navigation history | Back / Forward | `ScriptureContext`, session only | navigation |

The open Study tells Scripture its primary passage (`setStudyPassage`, from the
Study's own passage list, cleared when the Study closes). Navigation reads it
and never writes it. Opening a reference never adds a related passage, changes
the primary passage or the Study type, touches findings, or alters the source
relevance state. Tests compare the stored passages, studies and findings
before and after.

## Navigation history

`src/features/scripture/scriptureHistory.ts`: `back`, `current`, `forward`,
canonical passages only.

- Going somewhere new puts the place left on Back and clears Forward.
- Going where one already is makes no entry (no duplicate adjacent entries).
- A translation change is not navigation: no entry, and Back shows the earlier
  passage in the translation now chosen.
- Clicking a verse (verse tools) is not navigation.
- Bounded (100 entries); nothing is persisted.

The Scripture pane shows **Back** and **Forward** (icon buttons with translated
names and tooltips, disabled when there is nowhere to go) above the passage
picker.

## Back to the main passage

When a Study with a primary passage is open and the pane shows anything else,
a quiet button **Back to John 15:1–11** appears beside Back / Forward (its
accessible name contains the passage). It is a direct return, not a step:
from John 15 → Romans 6 → Galatians 2 → Ephesians 2, Back goes to Galatians 2,
**Back to John 15:1–11** goes straight to John 15:1–11. The return is ordinary
navigation, so the place left (Ephesians 2) stays reachable with Back. It is
hidden with no Study open, for a Study without a primary passage, and when the
pane already shows the primary passage; opening another Study changes its
target.

## Source references

A reference is drawn with a quiet dotted underline (solid on hover, a visible
focus ring). It is a real `<button>` (`aria-haspopup="menu"`, accessible name
"Romans 6:1–4 (Scripture reference)"); activating it opens a small menu with
one item, **Open in Bible**. A click alone never navigates, so reading is not
disturbed by a stray click. Escape closes the menu and returns focus to the
reference; Tab or a click elsewhere closes it. It is not a web link: nothing is
opened outside the app.

Open in Bible moves the Scripture pane to the canonical passage (verse, range,
chapter or cross-chapter range: whatever the parser produced) and opens the
pane if it was hidden. From the full-width reader, the source moves into the
Sources pane at the same place, beside Scripture.

The first version offers only Open in Bible. Add as related passage, Copy
reference and the like are later work.

## Language

> Since v0.13.1, bookless references (`15:4`, `15,4`, `v. 4`) are resolved
> from the source's own context; see [`reference-context-v0.13.1.md`](reference-context-v0.13.1.md).


Detection is by the **source's** language (`sources.language`, as confirmed at
import), never the interface language, with the existing per-language parsers
(English, German, Korean, French, Spanish, Portuguese; dictionaries are never
merged). "John 3:16", "Joh 3,16", "Jean 3,16", "Juan 3:16", "João 3:16" and
"요한복음 3장 16절" resolve to the same canonical passage; how it is labelled
follows the interface language.

German **"Mal"** (Maleachi) is the one abbreviation that is also an ordinary
word and is still accepted, under the strictest rule the parser has
(`Strictness::Verse`, the rule Korean uses for its one-syllable
abbreviations): it counts only with a **capital M** and a **verse**, standing
on its own. "Mal 4,3", "Mal 3,1-5", "Mal 3:1" and "Mal. 4,5" are Maleachi;
"Mal 4" (a chapter alone), "Mal 5 Minuten", "mal sehen", "noch mal 4 Dinge",
"noch mal 4,3 Liter" (lower case), "Einmal 4,3" (inside a word),
"Mal 3, 1 Stunde" (comma and space) and "Mal 9,3" (no such chapter) are not.
For a whole chapter write "Maleachi 4". Every other alias, and the other
languages, are unchanged. A German sentence that begins "Mal 2,5 …" with a
decimal number would still be read as Maleachi 2:5; that is accepted as rare.

## Supported views

| View | How | Notes |
|---|---|---|
| Reading (every format) | stored index | Explicit links in `source_passages` already keep `start_offset` / `end_offset` (UTF-16, as JavaScript strings count) into the segment's text, written by the same parser at import. `library_source_references(id)` returns them; nothing is parsed again. Internal links win where they overlap; a reference inside a link stays plain; text between is kept exactly. |
| Original, EPUB and Word | page text, by the core | The drawn page is a tree whose text nodes need not match segment text exactly (whitespace, notes, split paragraphs), so stored offsets are not reused. Instead each page's text nodes outside links (with a digit) are sent once to `library_detect_references(id, texts)`, read in the source's language, cached with the page (six pages). References are drawn around that same text inside the page's shadow root. Formatting, tables, notes, images and links are untouched; the file is never changed. A reference split across formatting (e.g. an italic book name) is not linked. |
| Original, PDF | **not linked** | Import text comes from the core's extractor; the Original view's text layer comes from pdf.js and is split into positioned runs that do not map to segments. There is no reliable mapping, so no overlay is drawn and no positions are guessed. PDF Original stays a faithful, non-interactive view; **Reading is the PDF path** for Scripture links. |

## Accessibility

References are keyboard reachable, with a visible focus state and the passage
in their accessible name; the menu takes focus, Escape returns it to the
reference. Back / Forward have translated names; Back to … names the passage.
Targets: the Scripture buttons are 40px; the menu item is at least 40px tall.

## Performance

Measured with `cargo test --test source_references -- --nocapture`:

| | debug | release |
|---|---|---|
| `library_source_references`, 3000 paragraphs, 6000 references | 25 ms | 11 ms |
| `library_detect_references`, one page of 1000 text pieces | 96 ms | 10 ms |

The Reading view reads the references once per source and splits only the
segments on screen; a formatted page is read once and cached.

## Strings

New keys in all six languages: `scripture.history.{group, back, forward,
backToStudy}` and `library.scriptureRef.{label, actions, open}` (Korean:
성경에서 열기, {{passage}}(으)로 돌아가기, 성경 이동 기록).

## Known limits

- PDF Original: no Scripture links, intentionally (no exact text-position mapping; no guessed overlays; Reading is the PDF path).
- In formatted pages, a reference split across formatting is not linked.
- Only Open in Bible; no "add as related passage" yet.
- History is per session and is not shared with the reader's own history.
