# Formatted DOCX Original view (v0.8, Phase 2)

Status: part of v0.8.

A Word document (`.docx`) can now be added to the library and has the same
**Reading | Original** switch as a PDF or EPUB. *Reading* is the extracted
text (search, citations, provenance). *Original* is the document as written:
headings, emphasis, alignment, lists and nested lists, tables, pictures,
links to places in the document, footnotes and endnotes. The person needs to
know nothing of OOXML, runs, styles, numbering or relationships. The imported
file is never changed.

## What was already there, and what was not

There was **no DOCX importer** before this phase (a `.docx` was refused as an
unsupported file). The Reading side therefore had to exist first: a `DocxImporter`
(`adapters/docx.rs`) now produces the normalised segments, like the EPUB one. The
format column is plain text, so **no schema change or migration** was needed. The
only user-visible text added is the format name ("Word") and the lists of
readable file types that now include Word, in all six languages.

## Layers (unchanged)

original file → formatted view → normalized text → structured Scripture.
Original is a **reading representation only**. Search, citations, provenance
stay on the normalised segments. Nothing is stored: the formatted view is
rebuilt from the managed file each time it is asked for.

## Architecture

```
managed DOCX (zip of XML parts)
  └─ core (Rust)
       adapters/docx.rs       parse → model → ONE layout walk
         ├─ import            the segments of the extracted text
         ├─ contents          the headings, nested by level
         └─ structure         parts, and element id → segment, per part
       adapters/docx_view.rs  model → the same typed tree as an EPUB document
       library_docx_structure(source)  → parts: id, first segment, count, anchors
       library_docx_item(source, part) → one part as a sanitised tree
  └─ interface (shared with EPUB)
       EpubViewer · epubDocument.tsx · epubLocation.ts · readerHistory.ts
```

- **One walk decides everything that must agree.** `docx::lay_out` walks the model
  in document order once and assigns segments, element ids, list numbers, bookmark
  places and the split into parts. Import, Contents, the structure and the drawn
  tree all use it, so Reading and Original cannot drift apart. A test checks that
  every id the structure names is an element of the drawn part (otherwise a place
  would land at the top of its part).
- **Parts.** The body is cut into parts of bounded size (about 120–600 blocks,
  preferring a break before a top-level heading, never inside a list); a long
  document is never one DOM. Footnotes and endnotes form a last part ("notes").
  The interface's **Part n of N** toolbar, Previous / Next, caching and history
  are the EPUB viewer's, unchanged.
- **Same tree, same renderer.** `docx_view` builds the `Node` / `El` /
  `LinkTarget` tree the EPUB view uses (`EpubItem`: nodes, a small CSS string,
  missing-image count). The interface draws both with one renderer in a shadow
  root. Not forced into one abstraction beyond that: the DOCX-specific parts
  (styles, numbering, notes, merged cells) live in the core.
- The seam is `originalView.kind`: `"docx"` joins `"pdf"` and `"epub"`. The
  frontend added a `kind` to the viewer and the structure hook (which pair of
  commands to call); nothing else in `SourceReader` is format-specific.

## Elements and formatting

Kept, from the file's own structure and styles (never from raw markup):

- **Headings** from Word heading styles (`Heading n`) or outline levels (levels
  1–6; deeper map to 6); the style's own size, weight and colour are left to the
  reader's heading style. **Title** becomes a top heading (not part of Contents).
- **Paragraphs**, **Quote**, **Code** and **Caption** styles as a blockquote, a
  monospace paragraph and a caption; a picture followed by its Caption is a
  figure with a figure caption.
- **Run formatting**: bold, italic, underline, strikethrough, superscript,
  subscript, small caps / capitals, highlight, monospace fonts, a relative font
  size (clamped to 50–300 % of the body size) and a text colour only when it is
  readable on the white page. Hidden text is not drawn. Styles are resolved along
  `basedOn` chains (document defaults → paragraph style → character style →
  direct formatting, with the usual on/off toggles).
- **Paragraph layout** *where meaningful*: alignment (start/centre/end/justify,
  right-to-left paragraphs), indentation and hanging indents (clamped to
  0–360 px), spacing set directly on the paragraph (0–48 px), double line spacing.
- **Lists**: real `ol` / `ul`, nested to any level, with number format (decimal,
  letters, Roman numerals), start values and **restarts** (a new numbering
  instance with a start override begins again; the same list continues after an
  interruption). Counting follows Word: per list, deeper levels begin again under
  a new item. Lists inside table cells work. Other number formats (CJK, ordinal
  text) are shown as decimal.
- **Tables**: rows, cells, header rows (marked as such, or an all-bold first row),
  column spans, row spans (vertical merges), light cell fills, paragraphs and
  lists inside cells, nested tables (to a depth of six). A table wider than the
  page scrolls inside itself (a keyboard-focusable "Table" group); the document
  never widens.
- **Pictures**: PNG, JPEG, GIF, WebP and SVG found by the relationship that names
  them, sent as `data:` URLs; their shape follows the document's size, bounded by
  the page. Alt text is the picture's description.
- **Links and notes**: links to **bookmarks** (including Word's cross-reference and
  contents links, and `HYPERLINK \l` fields) lead inside the document; **footnote**
  and **endnote** markers lead to the note, which has a **↩** link back. Notes are
  numbered 1, 2, 3 (footnotes) and i, ii, iii (endnotes) in the order they are
  referred to, in the body and the notes, as Word does.
- **Page breaks, section breaks and rules**: a dashed separator (page break, or
  the end of a section) and a horizontal rule for a paragraph with only a bottom
  border.
- **Unicode**: any language; Greek, Hebrew (right-to-left) and Korean are tested.

## Ignored on purpose

Macros, embedded objects (OLE), SmartArt, charts, equations, text boxes and
shapes, comments, tracked-change markup (insertions are kept as text; deletions
and `mc:Fallback` duplicates are not drawn), fields other than links to a
bookmark, headers and footers, columns, floating layout, page size and margins,
document themes and fonts, table borders and widths, heading numbering,
paragraph borders other than a rule, and any extension we do not know. Ignoring
is silent and safe: an unknown element is skipped with its content.

## Security boundary

A DOCX is **untrusted**, and the boundary is the same three places as for EPUB:

1. **The core rebuilds the document from an allow-list.** The package is read
   with a pull parser; only the parts that matter are opened (document, styles,
   numbering, notes, relationships, core properties). Elements outside the
   allow-list are skipped with their content. Text is data: `<script>` typed in a
   paragraph is the text `<script>`. The only styling emitted is composed by the
   core from numbers and fixed keywords (alignment, bounded lengths, a hex colour,
   a light fill); nothing from the file reaches the interface as a style string.
2. **Relationships are followed only inside the package.** A target that is
   external (`TargetMode="External"`), has a scheme, a backslash or a NUL, or
   climbs above the package root is refused. An absolute in-package path
   (`/word/media/x.png`) is allowed; `/../x` is not. Pictures need a known type
   and ≤ 6 MB each (40 MB per part). Hyperlinks other than a checked `http(s)` address (see below), `javascript:` links,
   linked-not-embedded pictures and remote images are never loaded or opened:
   any other hyperlink keeps its text and is not a link; a picture is replaced by its
   description and counted ("1 picture could not be shown").
3. **No HTML is parsed by the interface, and a shadow root isolates the style**
   (shared with EPUB): React builds elements one by one from allow-lists (tags,
   attributes, roles, `data:image` URLs, style properties) and the page's style
   lives in its own shadow root. The CSP is unchanged.

Limits against hostile input: entries over 20 MB are refused, a document stops
after 250,000 paragraphs, tables nest to six levels, the tree stops at 400,000
nodes, style chains stop at 16 levels. Malformed XML in any part is read as far
as it goes; a damaged styles, numbering, notes or relationships part costs only
what it carries (the text still reads).

## Reading and Original

- **Segments**: one per paragraph of text (a very long one is split at sentence
  ends, as for EPUB) including table-cell and list paragraphs, then the notes. A
  heading is not a segment: it gives the following segments their section path
  (`Chapter › Section`, with the chapter being the last level-1 heading) and a
  place in Contents. Metadata comes from the file's own properties (title,
  author, language).
- **Reading ↔ Original** is exact to the paragraph: every text paragraph, list
  item and caption has an element id `p<segment>`, headings `h<n>`, bookmarks
  `bm-<name>`, note markers `fr<id>` / `er<id>` and notes `fn<id>` / `en<id>`.
  The segment at the top of Reading becomes that paragraph in Original, and the
  paragraph at the top of Original becomes its segment. The switch is not history.
  Near the very end of a document the last short passages cannot be scrolled to
  the top of Reading, so a switch from the notes may come back to the last body
  text (the same approximation as for EPUB).
- **Contents** come from the real heading hierarchy (styles and outline levels),
  mapped to segments; a typed or generated table of contents is not parsed. The
  panel and its keyboard behaviour are unchanged. A document without headings has
  no Contents button.
- **Back / Forward** use the one v0.7 history: bookmark links, footnote and
  endnote markers and their backlinks, and Contents all record the place left. The
  app's Back works whether or not the note has its own backlink.
- Citations and "open at this place" use the existing segment places.

## Accessibility

Headings, paragraphs, lists, tables (header cells with `scope`), blockquotes,
figures and links keep their real elements; note markers keep
`doc-noteref` / `doc-backlink`; page breaks are `doc-pagebreak`. Links are anchors
reachable by Tab and Enter. After a link followed **from the keyboard** into
another part, focus moves to the place it names (a temporary `tabindex="-1"`, or
the block around an empty bookmark), so Tab continues from there; a pointer click
does not move focus. No focus trap.

## Dark mode

As for EPUB: the page is always a light sheet, the surround follows the theme,
pictures are never inverted, and text colours that would be unreadable on white
are not honoured (and light fills only).

## Fallback

If the structure cannot be read (or the document has no text) there is no
Original switch. If a part cannot be built, a plain translated notice appears
("This document's original view can't be shown. Reading still works."), the
technical detail (source and part id, never text) goes to the log, and Reading
is untouched.

## Performance (observed)

Synthetic documents, debug build under WebKitGTK in the real app (a release build
is several times faster in the core): a 6,061-paragraph document (60 chapters,
31 parts) showed its first part in ~0.25 s; moving to another part ~0.3 s;
a scroll through the 14,000 px part was immediate. A table-heavy document
(150 tables, 18,000 cells) showed its first part in ~0.4 s. An image-heavy one
(30 pictures of 1,400 × 900, ~10 MB of PNG in one part) took ~2.2 s, dominated by
the picture data crossing to the interface. The core parses the document for each
part it is asked for (nothing is cached); that is the first thing to optimise if
huge documents prove slow.

## Known limits

- Fidelity is "faithful enough to read", not Word's layout: no page geometry,
  columns, headers/footers, text boxes, shapes, charts, equations or SmartArt.
- Heading numbers ("1.1") from multilevel list numbering are not shown; a heading
  that is also numbered is a heading.
- Numbering formats other than decimal, letters and Roman numerals show decimal.
- Table widths and borders are the reader's own; cell shading is only kept when
  light.
- Only `http` and `https` addresses open (in the system browser, on a click);
  other schemes stay plain text; see [Links to the web](formatted-epub-v0.8.md#links-to-the-web-v08-closure).
  Non-ASCII addresses must be percent-encoded / punycode in the file to open.
- A picture needs one of the five image types: EMF/WMF/TIFF/BMP pictures are shown
  as their description.
- Links inside Reading's text (the EPUB Reading links) are not provided for DOCX.
- Windows (WebView2) was not available for testing; see the release notes.
