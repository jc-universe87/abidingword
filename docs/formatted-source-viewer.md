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

## Future: navigating long books (not built)

Long academic books and commentaries must eventually be navigable from their
own table of contents, not only by scrolling pages.

- **PDF:** the document outline (bookmarks); clickable internal links and
  page/destination links; footnote and endnote links; back/forward
  reading-location history; a contents drawer.
- **EPUB:** the navigation document / table of contents; chapter navigation;
  internal hyperlinks; footnote and endnote links; back/forward
  reading-location history.

None of this exists yet; the viewer shows pages only.

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
