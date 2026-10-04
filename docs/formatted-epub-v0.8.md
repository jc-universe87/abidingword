# Formatted EPUB Original view (v0.8, Phase 1)

Status: part of v0.8.

An EPUB now has the same **Reading | Original** switch as a PDF.
*Reading* is the extracted text (search, citations, provenance: unchanged).
*Original* is the book as published: headings, emphasis, quotations, lists,
tables, images, its own typography, internal links and footnotes. The person
needs to know nothing of spine items, XHTML, anchors or styles.

## Layers (unchanged)

original file → formatted view → normalized text → structured Scripture.
Original is a **reading representation only**. Search, citations, provenance
and anything future (AI, comparison) stay on the normalized segments. Nothing
is duplicated or stored: the formatted view is rebuilt from the managed file
each time it is asked for. No schema, migration or stored data changed.

## Architecture

```
managed EPUB (zip)
  └─ core (Rust, adapters/epub_view.rs)
       ├─ library_epub_structure(source)  → reading order: document id, first segment,
       │                                     segment count, element id → segment
       └─ library_epub_item(source, id)   → one document as a sanitised tree + safe CSS
  └─ interface
       ├─ useEpubStructure     (once per source)
       ├─ EpubViewer           one document at a time, toolbar "Part n of N"
       └─ epubDocument.tsx     tree → elements, inside a shadow root
```

- **One reading-order document at a time**, continuously scrolled, with
  Previous / Next part. A very large book is never one DOM. Documents are cached
  (six) so going back to one is immediate.
- The package's own **item id** is the only name the interface uses for a
  document. It is looked up in the spine; anything else is refused. There is no
  path from the interface to a file.
- The seam for another format (DOCX now uses it: see
  [`formatted-docx-v0.8.md`](formatted-docx-v0.8.md)): a format's `originalView.kind`,
  a pair of core commands (structure, item) and a place type
  (`SourceLocation.item / fragment`). `SourceReader` asks the format for a
  place and a mapping to and from the extracted text; nothing in it is
  EPUB-specific except those calls. No Word-specific abstraction was built.

## Security boundary

EPUB content is **untrusted**. The boundary is between *the book's document*
and *the app*, drawn in three places:

1. **The core rebuilds the document from an allow-list** (`epub_view.rs`):
   - Elements: a fixed list of text, list, table, figure, image and link
     elements. Others are unwrapped (text kept) or, for `script`, `style`,
     `iframe`, `object`, `embed`, `svg`, `math`, `audio`/`video`, `form`
     controls and similar, **dropped with their content**.
   - Attributes: a fixed list. **No event handlers**, no `href`/`src`/`style`
     as written. Only a few ARIA roles, derived from `epub:type`.
   - Links: internal ones become targets (document id, element id); web,
     `javascript:`, paths leaving the book, and documents outside the reading
     order become plain text. A link to the web is kept only as a checked
     `http(s)` address that opens in the system browser on a click: see
     [Links to the web](#links-to-the-web-v08-closure). Nothing is opened by the page.
   - Images: only files inside the book, found by archive path (a path
     climbing out of the book is refused), of five image types, ≤ 6 MB each and
     40 MB per document, sent as `data:` URLs. Remote, missing or oversized
     pictures are replaced by their alternative text and counted ("1 picture
     could not be shown"); they are never silently omitted.
   - Styles: the book's style sheets (inside the book) and `<style>` /
     `style=""` reduced to a property allow-list. No `url()`, no at-rule
     (`@import`, `@font-face`, `@media`…), no positioning, `z-index`,
     `content`, `overflow`, `cursor`, `var()`. Selectors are character-checked;
     `html`/`body` become the element standing in for the body. Font sizes are
     wrapped in `clamp(0.7em, x, 3em)`.
2. **No HTML is parsed by the interface.** The tree is turned into elements
   one by one by React, again from allow-lists (tags, attributes, ARIA roles,
   image URLs `data:image/…;base64,…` only, style properties): a second,
   independent check behind the core's. Text is text. Links are anchors whose
   click is handled by the reader (never the web view's navigation).
3. **A shadow root isolates the page's style.** The book's CSS lives inside
   it: it cannot reach app chrome, and app styles do not reach in. It was
   chosen over a sandboxed iframe because the page then stays in the reader's
   accessibility tree and keyboard order (no focus trap), selection and copy
   work normally, and Back / Forward can find elements directly. An iframe
   would add a second web context with its own focus, scroll and CSP
   inheritance for no security gain once no markup is ever parsed.

Also: no script ever exists in the tree; no network request can be made by it
(images are data, styles are text); the page cannot call Tauri APIs (it has no
code); the CSP is unchanged (`img-src 'self' data:` already allowed data URLs).
Logs name the source and document id and the stage, never any text.

## CSS and dark mode

The page is always a **light sheet**, like a PDF page, whatever the app's
theme: a book with its own colours stays readable and faithful, an unstyled one
reads dark on white, images are never inverted. The surround follows the theme.
Publication typography is kept (family, size within bounds, indentation,
small-caps…); the reader supplies sane defaults for an unstyled book, and a few
last rules keep any page inside the reader (width, images, tables, `pre`).
Wide tables scroll inside themselves (a keyboard-focusable "Table" group).
`body` margins/background from the book apply to the sheet; the sheet's
column width and padding are fixed.

## Contents, links, Back / Forward

- **Contents** work unchanged. An entry's segment is mapped to its document and
  the nearest element before it (`placeOfPosition`); the jump goes through the
  reader's one history (v0.7).
- **Links** in a page lead to (document, element). Same-file, cross-file and
  nested relative paths are resolved in the core by the book's own structure;
  footnotes and the book's backlinks are just links; the app's Back works with
  or without them. The place left is the nearest element at or above the top of
  the view, with its pixel offset, so Back returns to where the marker was.
- **History** uses the v0.7 model; `SourceLocation` gained `item`, `fragment`,
  `itemOffset`. A place always carries both faces (document + element, and the
  matching segment), so an entry made in one view can be restored in the other.
  Previous / Next part and the Reading ↔ Original switch are not history.
- **Reading ↔ Original** keeps the place: the segment at the top of Reading
  becomes (document, element); the element at the top of Original becomes its
  segment. If an element has no segment of its own the document's first is
  used (never the top of the book).

## Accessibility

Headings, paragraphs, lists, tables, blockquotes, figures and links keep their
real elements; note markers keep `doc-noteref`/`doc-footnote`/`doc-backlink`.
Links are anchors reachable by Tab and Enter; tables that scroll are focusable
groups; the toolbar buttons and Back / Forward are buttons. Focus is never
trapped (no iframe). The page has a visible focus ring in a fixed colour.

## Links to the web (v0.8 closure)

A formatted EPUB or DOCX page can contain a link to the web, and a deliberate
click on it opens the address in the **system's default browser**. The rule is
one function (`safe_external_url`, shared by both formats) and is checked three
times:

1. **Core.** Only an explicit `http://` or `https://` address becomes an external
   link: plain ASCII, with a host (letters, digits, dots, hyphens; optional
   numeric port), no user name or password (`user@host` is refused), no spaces,
   control characters, backslashes or markup characters, at most 2,048
   characters. It crosses to the interface as a separate field of the safe tree
   (`x`, next to the internal target `l`), never as an `href`. Everything else
   keeps its words and is not a link: `javascript:`, `data:`, `file:`, `blob:`,
   `ftp:`, `mailto:`, `tel:` and any custom scheme, protocol-relative `//host/…`,
   relative or escaping paths, malformed or oversized addresses. A DOCX address
   comes from an `External` hyperlink relationship or a `HYPERLINK "…"` field;
   such a relationship is never read as a package path. In an EPUB it is an
   `<a href>`.
2. **Interface.** The renderer re-checks the address (`safeExternalUrl`) and only
   then draws an actionable link. Its `href` is `#` (the address is shown as the
   tooltip), so there is no middle-click or context-menu route out of the
   reader; a click or Enter hands the checked address to the app.
3. **Tauri.** The app uses the official `tauri-plugin-opener` with the single
   permission `opener:allow-open-url`, scoped to `https://*` and `http://*`. The
   page cannot reach it (it has no code); other schemes are refused by the
   permission even if something asked.

Opening is never automatic: nothing opens on import, render, scrolling or focus.
The click opens the browser and **nothing else changes**: the reader stays at the
same document and place, there is no Back / Forward entry, no web content is
embedded (no iframe, no second web view) and the web view never navigates. If
the system cannot open the address, a plain translated notice appears ("The link
could not be opened."); the log keeps the host only (never the path or query)
and no system message is shown. Links inside the document (bookmarks, notes,
chapters) are unaffected: they navigate inside Abiding Word and use the history.
Reading-view links and references are unchanged.

## Fallback

If the structure cannot be read (or the book has no text) there is simply no
Original switch. If a page cannot be built or fetched, a plain translated
notice appears ("This book's original view can't be shown. Reading still
works."), the technical detail goes to the log, and Reading is untouched.

## Performance (observed)

Measured with a synthetic 4,000-paragraph document (3 MB of XHTML) with 30
images (12 MB): the core builds it in ~45 ms (release; ~450 ms in a debug
build); the interface has all 4,000 paragraphs in the DOM ~0.8 s after
choosing Original (Chromium); following a link inside that page takes ~60 ms
(the page is not redrawn when the reader around it changes). Typical chapters
are far smaller. Images are the dominant payload (base64 over IPC).

## Known limits

- Inline SVG and MathML are not drawn (dropped). Embedded fonts are not
  loaded (`@font-face` is removed); a book's font names fall back to system
  fonts. `@media` blocks are dropped.
- Fixed-layout and vertical-writing (`writing-mode`) books are shown as
  ordinary flowing text.
- Only `http` and `https` addresses open (in the system browser, on a click);
  other schemes stay plain text. IDN addresses must be written in ASCII
  (punycode / percent-encoding) in the book to be recognised.
- No page numbers or pagination, no text-size control, no annotation.
- Visually reviewed in Chromium (light, dark, pane, full reader, narrow
  window); Windows (WebView2) and WebKitGTK were not available here.
