# Abiding Word — Reading and Original (formatted source viewer)

> Status: in development, after the frozen Library v0.4 (`library-v0.4`
> tag). v0.4 itself had no Original view; this document describes what was
> added afterwards. Only PDF has an Original view so far.

## The idea

A source can be looked at in two ways:

| | Reading | Original |
|---|---|---|
| What | the extracted text, as Abiding Word stores it | the actual document, laid out as the file lays it out |
| Used for | search, citations, Scripture links, quick reading | checking the source: columns, footnotes, images, design |
| Authority | **canonical** for search, citations and provenance | a human inspection surface only |

The representation model is frozen:

```
SOURCE
  → original managed file
  → formatted/original view   (this document; PDF so far)
  → normalized extracted segments
  → search / citations / passage links
```

A file's **format decides its viewer and import strategy**. Format never
becomes Scripture identity. A page shown in Original is not a
`SourceSegment`, and does not replace `SourceSegment`, `source_passages` or
`finding_sources`: those stay the citation and search backbone. Selecting
text in Original is for copying only; it is not used for citations or
annotations.

## What the user sees

- **Full reader.** A header that never scrolls (Back, the title, and
  **Reading | Original** when the source has an original view) above the
  content. Reading scrolls inside its own body; Original has its own toolbar
  and scroller. Back returns to where the reader was opened from.
- **Original (PDF).** Real pages with images, columns and footnotes as the
  PDF provides them, always on white (the document is never recoloured, in
  the dark theme too). Controls: previous/next page, a page box with "of N",
  zoom in/out, **Fit width** (the default) and **Fit page**. Text can be
  selected and copied when the PDF has a text layer.
- **Sources pane.** The same **Reading | Original** switch is inside the
  pane, so the actual PDF can be inspected with Scripture and the Study still
  on screen. The pane is a column like the full reader: **Back to Sources**,
  **Open full reader** and the switch sit in a header that never scrolls,
  above the text (which scrolls in its own body) or the PDF (which has its own
  toolbar and scroller). The PDF toolbar wraps in a narrow pane; the words
  beside the Fit icons collapse to icons (names and tooltips stay) when the
  pane is narrow, and the pages follow the pane's width when it is resized
  (re-measured once the drag settles, so pages are not redrawn on every
  frame; far-away pages are still not drawn). **Open full reader** is "expand
  this", not a way into the PDF.
- **Moving across a zoomed page.** The pages sit on a canvas that is at least
  as wide as the view and as wide as its widest page. A page that fits is
  centred and nothing scrolls sideways (Fit width never overflows); a page
  wider than the view fills the canvas and scrolls from its true left edge to
  its true right edge, with the same margin on both sides. (Earlier each page
  was an auto-margined block directly inside the scroller; auto margins on an
  overflowing child collapse to zero, so the page hugged the left edge with
  no margin on the right.) Zooming keeps the point at the centre of the view
  where it was; Fit width and Fit page recalculate. Native scrolling
  (scrollbar, trackpad, touch, and Shift+wheel in WebView2/Chromium) is used,
  and dragging the page background pans it. A press on the words themselves
  is left alone, so text selection is unchanged. Pane and full reader share
  this code.
- A source without an original view (EPUB, Markdown, text) shows no Reading |
  Original switch at all, and Original is never offered for something that
  cannot be shown.
- If a PDF cannot be drawn, a plain translated notice appears and Reading
  stays available.

## State: where the reader is

The place is a small value, `ReaderPosition { mode: "reading" | "original",
page: number | null }`, held by the shell for the session (no database
column; reopening the app starts in Reading).

- Each reader tells the shell where it is when it hands over: the pane at
  **Open full reader**, the full reader at **Back**. The shell opens the next
  reader there: Original page 151 in the pane is Original page 151 in the full
  reader, and Back to the workspace continues the pane at the page the full
  reader ended on, in the same view.
- In Reading, the page is the marked passage's page if it is in view, else the
  page at the top of the view; coming back, the text is opened where that page
  begins.
- Opening a *different* source (or the same one at a new citation) is a fresh
  start in Reading: PDF state never carries over to another source.

## Physical pages

Mapping between the two views uses the **physical page** (the Nth page of
the file), which is what `source_segments.page_number` already records. It
never uses the printed page label.

- Opening a source at a passage (citation, search result, Scripture
  mention) and choosing Original opens that passage's physical page. If the
  passage is out of view in Reading, the page at the top of the view is used.
- Back to Reading from Original opens the text where that page begins
  (`sourceGetSegments { aroundPage }`; the first segment on the page, or the
  next page that has text). If it is still the page it opened at, the same
  window and marked passage are kept. No mapping is invented for formats or
  pages that have no physical page.

## How the file reaches the viewer

The web view never receives a path, and never receives the file whole.

- Two core commands take a **source id only**: `library_original_info`
  (kind and size) and `library_original_read` (one byte range, as raw bytes
  over Tauri's binary IPC, not JSON or base64).
- The core finds the source's own live primary file (a removed source or a
  removed file is refused), then `library/original.rs` checks that the
  recorded path is exactly `<category>/<source id>/<file name>` with plain
  components (no `..`, no absolute path, not another source's folder), that
  the file with links resolved lies inside the managed `sources/` folder,
  and that it is a regular file. Anything else is a coded error with no
  path (`library.originalUnsupported`, `.originalMissing`,
  `.originalUnavailable`).
- A read is at most 4 MiB and returns nothing past the end of the file.
- No custom URL protocol, no `file://`, no asset scope, no new Tauri
  permission and no change to the content-security policy.

## Large PDFs

PDF imports may be up to 200 MB. PDF.js is given a
`PDFDataRangeTransport` that reads ranges (1 MiB slices at most) through
the commands above, with streaming and auto-fetch off, so only the parts of
the file that the pages on screen need are read. A generated 2,000-page,
25.6 MB PDF opened and drew page 1,500 after reading about 7 MB in 111
requests of at most 64 KB. Only pages near the screen are drawn; far pages
are empty sheets of the right size and give back their canvas (and what
PDF.js kept for them) when scrolled away. A 600-page document never holds
600 canvases.

## The renderer

PDF.js (`pdfjs-dist`), its **legacy build** and its worker, both bundled
with the app and loaded on first use; nothing comes from a network. The
standard build needs very recent JavaScript features (it failed on a current
Chromium without them), and the app runs in whatever web view the system
has, so the legacy build is used. The viewer talks to a small `PdfEngine`
interface (`src/lib/pdfEngine.ts`), so it can be tested without a canvas and
the renderer can be replaced.

## Known limitations

- Not bundled, because the content-security policy has no `connect-src` for
  them and it is not widened: PDF.js's CMap, standard-font and WebAssembly
  data. A few PDFs (JPEG 2000 images, some non-embedded CJK fonts) show those
  parts approximately.
- Pages above the current one that turn out to differ in size from the first
  page can shift the layout slightly as they load.
- No search inside Original (search is over the extracted text), no
  annotations, forms, OCR or editing.
- Reading mode is not remembered between visits.
- Contents exist only where the source carries them (see above); an EPUB
  entry's precision is the nearest extracted segment, and a fragment that is
  not found leads to the start of its chapter.

## Contents (table of contents) for long books

A source that carries its own table of contents gets one **Contents** button,
the same in the Sources pane and the full reader (in the header, next to the
Reading | Original switch). It opens a panel inside the reader: a compact
left **drawer** when the reader is wide, a full-width **sheet** when it is
narrow (chosen from the reader's own measured width, below 560 px, not from
the window). The list is nested as the source nests it, scrolls on its own,
opens on the current entry, and names the current entry in text ("Current
section" for assistive technology, a marker and bold for sight) as well as
`aria-current`. Tab reaches every entry; Enter or Space opens one; Escape
or **Close contents** closes the panel and returns focus to the Contents
button. Choosing an entry closes the panel and goes there. A heading that has
no destination of its own is shown as plain text above its children.

Contents belong to the source, not to the way it was opened: the same button
is there from the library, a passage mention, a finding's citation or a search
hit (opening at a cited place only chooses where to start; the whole source
stays readable and reachable through Contents). Reading the contents
is built not to hang and not to mistake failing for "none":

- *None* (a PDF with no outline, an EPUB with no table of contents) is a valid,
  final answer. A read that *fails* is different: it is tried again (after
  0.3 s, 1 s and 3 s) and, if it still cannot be read, remembered as a failure,
  never as "no contents", so the next opening starts afresh.
- PDF.js cannot be told that a byte range could not be read and would wait for
  it for ever, so a slice that fails is first read again, then the opening is
  failed from outside; a read that stalls with no error is failed after 25 s and
  its loading cancelled. (Before this, one failed read left the outline load
  pending for ever: no error, no retry, no Contents.)
- Destinations are looked up a few at a time, in order, sharing repeated pages;
  an outline whose entries all have destinations but none could be resolved is a
  failure, while one of only web links is simply empty.
- In Original, the viewer's own open document also reports the outline, so
  Contents can still appear when the reader's separate read failed, with no
  second opening.
- The log file says where a failure happened (`at "info"`, `"read"`, `"open"`,
  `"outline"` or `"resolve"`) with the error's message and never any document
  text: "Contents could not be read (at "read"): …".

**Nothing is generated.** A source without contents shows no Contents button.
Contents are never inferred from fonts, headings or AI.

- **PDF.** The document's embedded outline (bookmarks) is read by PDF.js
  through the `PdfEngine` (`outline`), reading only the outline objects, never
  page content, and nested as the PDF nests it. Each entry's destination is
  resolved with PDF.js, not assumed to hold a page number: a *named*
  destination is looked up in the document's name tree, an *explicit*
  destination's page reference is turned into a page index with
  `getPageIndex`, and a plain index is accepted only inside the document. The
  result is a **physical** page (1-based), the same numbering the viewer and
  Reading use. Web links and broken or out-of-range destinations lead nowhere
  and are left out (a group keeps its place if any child leads somewhere).
  Entries are capped at 5,000 and 12 levels deep.
  - *In Original*: the viewer moves to the page, keeping the zoom mode.
  - *In Reading*: the mode is **kept**; Reading shows the text of that page
    (or the next page that has text). Contents never switches the view.
- **EPUB.** The publication's own navigation is read **on demand from the
  managed EPUB** by the core (`library_source_contents`): the EPUB 3
  navigation document (`nav` with `epub:type="toc"`), else the EPUB 2 NCX
  (the spine's `toc`). The hierarchy is kept (`ol > li > ol`, `navPoint`
  nesting). Each entry becomes `{id, title, target, children}`; the target is
  the **position of a segment** of the extracted text, found by running the
  same segmentation as import: a chapter file leads to its first segment, a
  `#fragment` to the segment where that element's `id` falls, and an unknown
  fragment falls back to the start of the chapter file. Nothing is stored (no
  migration): if the file's segmentation no longer matches what was imported,
  the contents are dropped rather than risk pointing at the wrong place.
  Choosing an entry opens Reading at that segment (heading above it included)
  and focuses the paragraph.
  - Only **internal** targets count. `https:`, `javascript:`, `data:`,
    `file:`, `mailto:`, absolute paths, backslashes, and any path that climbs
    out of the book are ignored, as is a target that is not in the reading
    order. No raw markup or file path reaches the interface. A broken
    navigation file gives no contents; the book still imports and reads.
  - EPUB has no Original view yet, so its contents navigate Reading. A future
    EPUB renderer can reuse the same tree.

## Future: navigating long books (not built)

Contents (above) is built. Still to come:

- **PDF:** clickable internal links and page/destination links beyond
  outline entries; footnote and endnote links; back/forward
  reading-location history.
- **EPUB:** internal hyperlinks; footnote and endnote links; back/forward
  reading-location history; a formatted EPUB view.
- **Generated contents** from headings as a fallback for a source that has
  none: a possible later step, not current behaviour.

## Bible documents and structured Bibles (principle only)

A **Bible document** and a **structured Bible** are different things.

A Bible PDF can already be a *document*: the original is kept, the PDF viewer
shows it, and normalised text is extracted where extraction works. That does
**not** make it a translation in the Bible selector. Extracted PDF text is
never silently treated as structured Scripture.

A structured Bible needs: reliable book boundaries, chapter boundaries and
verse boundaries; canonical verse identities; verification; provenance; a
versification system; handling of split and joined verses; and an honest
account of uncertainty where extraction is imperfect.

Future path (not built):

```
PDF Bible original
        ↓
normalised extraction
        ↓
detected candidate Bible structure
        ↓
user verification / correction
        ↓
structured Scripture
        ↓
versification-aware mapping
```

## Future formats (not built)

| Format | Later viewer |
|---|---|
| PDF | this viewer |
| EPUB | an EPUB renderer |
| DOCX | formatted rendering or conversion |
| HTML | sanitised rich HTML |
| Markdown | rendered Markdown |
| TXT | normalised/plain reader |
| images, scans | page/image viewer with an OCR layer |

`originalView` on a source (`{ kind: "pdf" }` or null) is how the interface
learns that a viewer exists: from the stored file's format, never from a
file name.

## Manual testing on Windows

1. Open a PDF from the Library; scroll far down in Reading; Back stays visible.
2. Reading → Original shows the real pages; next/previous, page box, zoom,
   Fit width, Fit page work.
3. Open a citation or search result on a later page; Original opens that page;
   back to Reading lands near that page's text.
4. In the dark theme the PDF page itself stays white.
5. A Markdown source shows no Original.

In the normal workspace (Scripture | Study | Sources):

6. Open a PDF in Sources; Reading | Original is in the pane. Click Original:
   the PDF appears inside Sources, Scripture and the Study stay visible.
7. Scroll a few pages; make Sources narrower, then wider; the pages follow.
8. Original → Reading lands near that page; back to Original keeps the page.
9. Open full reader: same source, Original, same page. Back: the pane is at
   that page again.
10. Back to Sources, Open full reader and the Reading | Original switch stay
    visible throughout; check the dark theme; a Markdown/TXT source shows no
    Original.

### Contents

1. Open a long PDF with bookmarks; **Contents** is in the header. A PDF
   without bookmarks has no Contents button.
2. Open Contents: the hierarchy is visible, the current entry is marked.
3. Choose a chapter, then a nested section: Original lands on the right page
   with the zoom unchanged; in Reading, the text of that page.
4. Close and reopen Contents (Escape, **Close contents**): focus returns to
   the Contents button.
5. Repeat in the Sources pane (narrow: full-width sheet; wide: left drawer)
   and in the full reader; horizontal zoom and pan still work.
6. Open an EPUB with a table of contents: choose a chapter, a nested entry:
   Reading jumps there. An EPUB without one has no Contents button.
7. Tab through the entries, Enter to open one, Escape to close.

