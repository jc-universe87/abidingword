# Rich source reading & navigation (v0.7, Phase 1)

Status: in review. Branch `feature/source-navigation-v0.7`, not merged.

A person reading a commentary, monograph or article should be able to click a
footnote, read it, press Back and be exactly where they were, without knowing
anything about how the document stores its links. Scope of this phase: internal
links in PDF and EPUB, footnote/endnote navigation, Back / Forward. DOCX,
a formatted EPUB view and annotations are **not** part of it.

## The source model is unchanged

Original file → formatted view → normalized text → structured Scripture.
Source-document navigation is separate from Scripture navigation and does not
touch either Scripture or the Study. No schema, migration or stored data
changed.

## PDF links (Original view)

- The PDF's own link annotations are read through PDF.js (`PdfDocument.links`)
  and drawn as transparent, focusable buttons inside each page. Only links that
  point **inside the document** are offered; web links and other actions are
  not (see below).
- Each link is placed as a **share of its page** (left, top, width and height in
  percent), measured with the page's own viewport (rotation included). It is a
  child of the page, so it stays on its words at any zoom, pixel density,
  horizontal pan or scroll: there is no second coordinate system to drift.
- A link keeps its raw destination. It is resolved **when followed**
  (`PdfDocument.resolve`) with the same logic as Contents
  (`resolveDestination` in `pdfjsEngine.ts`, now shared): a named destination,
  an explicit destination array, or a page reference, resolved through PDF.js,
  never by guessing page numbers. A destination that says how far down the page
  it points (XYZ, FitH) is honoured.
- A link that leads nowhere does nothing visible; the reader stays where it is
  and one line goes to the log (no document text).
- Web links are **not** followed or opened: nothing in the app opens external
  addresses from a source, and the content-security policy was not widened.
  Making them an explicit, confirmed action is future work.

## EPUB links (Reading view)

- Links are read from the managed EPUB at runtime, like Contents
  (`library_source_links`, a read-only command): nothing is stored. The XHTML
  is already parsed into segments; the same pass now records, for each `<a href>`
  in a paragraph, the character range of its text (counted in UTF-16 units, as
  the interface does) and resolves its target **structurally**: the archive
  path of the document (relative and nested paths such as
  `../notes/endnotes.xhtml#n42` are resolved against the linking document), and
  the element id inside it, mapped to the segment that element falls in. No
  text matching.
- Only internal links are returned: external addresses, `javascript:`/`data:`,
  paths leaving the book, documents outside the reading order, and fragments
  that do not exist (a broken link) are left out, so a link shown always has
  somewhere to go. EPUB scripts are never run.
- In Reading, a link is an ordinary inline link (existing link colour,
  underlined) that wraps with the text. A footnote marker is just such a link;
  the book's own return link works too, and the app's Back works whether or not
  the book has one.
- If an anchor falls between segments, the next segment is the target (the
  existing anchor rule used for Contents).

## Back / Forward

- Two small icon buttons in the reader header (pane and full reader), labelled
  "Back to the previous place" / "Forward to the next place" (these are not the
  reader's own "Back" that leaves it). Disabled when there is nowhere to go.
- History records **deliberate** jumps only: following a link, choosing a
  Contents entry. Scrolling, switching Reading ↔ Original, paging and zoom do
  not.
- A place (`SourceLocation`, `readerHistory.ts`) is generic: a PDF page and how
  far down it, and the position of the extracted-text segment at the top of the
  view with its pixel offset. Back restores in the **mode the reader is in**
  (Original: page and position on the page, zoom unchanged; Reading: the segment
  at the same distance from the top). A jump never changes the mode.
- When a link is followed in Reading, "where the reader was" is the paragraph
  that holds the link, so Back returns to the marker even if it was partly
  scrolled.
- Standard browser semantics: a new jump after Back drops what was ahead; each
  Back / Forward remembers the place it left, so the other direction returns
  exactly there. At most 200 places are kept.
- History lives in memory for the session, per source: it is kept when the
  reader moves between the pane and the full reader (it travels with the
  reader's position), and a different source starts with none. It is not saved.

## Accessibility

Links and the two buttons are real controls, reachable by Tab and operated by
Enter (links) / Enter or Space (buttons); disabled buttons use `disabled`. PDF
link areas have a visible focus ring and hover tint in fixed colours (the page
is always white, whatever the theme). After a jump in Reading, focus moves to
the target paragraph; Back focuses the paragraph returned to. No keyboard
shortcut was added (the app deliberately has no Alt-key listeners).

## i18n

New text (`library.links.follow`, `library.history.*`) is in all six languages.
No technical terms (destination, fragment, anchor) appear in the interface.

## Diagnostics

The log notes that a link could not be followed ("destination not found",
"leads outside the text") and where reading links failed. Never document or
footnote text.

## Not in this phase

DOCX viewing, links and footnotes; a formatted EPUB view; links inside a PDF's
Reading text; opening web links; history saved across restarts or spanning
sources; document annotations.
