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
- **Sources pane.** It stays a text reader. A PDF there has **Open
  original**, which opens the full reader on Original; **Open full reader**
  opens it on Reading.
- A source without an original view (EPUB, Markdown, text) shows no Reading |
  Original switch at all, and Original is never offered for something that
  cannot be shown.
- If a PDF cannot be drawn, a plain translated notice appears and Reading
  stays available.

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
