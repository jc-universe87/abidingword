# v0.18.1 — Slide ordering and church presentation templates

Status: built on `claude/beautiful-curie-vm0eve`, reviewed, **not merged**,
awaiting real Windows/Office acceptance (§14). Follows
[`presentation-delivery-v0.18.md`](presentation-delivery-v0.18.md).

User guide: [Presenting your teaching](guide/11-presenting.md) (sections
*Making the slides* and *Your church's slide design*).

---

## 1. Scope and principles

Two things a church needs before the presentation layer is used every
Sunday:

1. **Ordering** slides by dragging, with a keyboard path that does the same.
2. **Church templates**: the church's own design, imported from PowerPoint
   (Keynote and Google Slides through their PowerPoint export), reused, or
   made in a small designer.

Principles kept:

- **The Teaching stays the source of truth.** A template holds a design
  only — never sermon content — and choosing, changing or dropping one
  changes no slide and no teaching (tested).
- **One definition, one geometry.** The same template and the same
  presentation feed the live view (editor previews, Presenter View,
  audience screen, a passage shown for a moment), PowerPoint and PDF. The
  page is laid out **once, in the core** (`presentation/layout.rs`); the
  interface draws the core's pages instead of re-implementing the layout.
- **If something cannot be reproduced reliably, it is reported** — never
  dropped silently, never approximated without saying so.
- **Fonts are never bundled or silently replaced.** Long text is never
  silently shrunk: only a box that the template says may shrink does.
- The Presenter View's own chrome keeps the app's look; only the audience's
  slides wear the church design.
- Not a PowerPoint clone: no animations, transitions, masters editing,
  drawing tools.

## 2. Slide ordering

`useListDrag` (pointer events with capture, so mouse, pen and touch behave
the same) on a **handle** only — text fields in an open slide never start a
drag. While dragging: the row fades, a line shows where it will land
(midpoints of the rows), the list or window scrolls near its edge
(56 px band). **Esc** cancels. A drop is one `presentation_item_reorder`
call (order only; no content touched); dropping in place does nothing.
Focus returns to the moved slide and a polite status announces its new
place. The **Move earlier / Move later** buttons ("Move slide 3 earlier")
remain the non-drag path. Tests: `tests/ui/presentation-ordering.test.tsx`.

## 3. The template model

`abiding-word/presentation-template`, version 1
(`src-tauri/src/presentation/template.rs`, mirrored in
`src/types/presentationTemplate.ts`). Units are **points** on the
template's page: 960 × 540 (16:9), 720 × 540 (4:3), or any 100–4000.

| Part | Content |
|---|---|
| `colors` | background, text, muted, accent (hex) |
| `fonts` | `heading`, `body`, `others[]`: each a `FontChoice { family, replacement }` — `replacement` is only ever set by the person |
| `background` | colour and/or picture (`assetId`, `crop` as shares of the image) |
| `logo`, `footer` | template-wide; a layout may hide them |
| `roles` | a `RoleLayout` per kind of slide: `title`, `section`, `heading`, `scripture`, `quote`, `question`, `image`, `text`, `pause`, `custom` (fallback for others; never for `pause`) |
| `assets` | the pictures used (SHA-256 id, media type, size, original name) |

A `RoleLayout` has its own background, pictures (`decorations`, crop and
opacity), filled bands (`rects`, fill opacity, outline), fixed texts
(`labels`, e.g. a footer from PowerPoint), the three text boxes `title`,
`reference` (the passage line or a quotation's author) and `body`, an
`image` frame, and `hideLogo` / `hideFooter`.

A `TextFrame` is a box (x, y, w, h) with font (`heading`, `body` or a
family name), size, `minSize`, bold, italic, colour (`text`/`muted`/
`accent` or hex), align, valign, insets, line spacing and **fit**:
`shrink` (smaller, down to `minSize`) or `none` (overflow is reported).

The built-in **Light / Dark / Warm** backgrounds are the same model with no
roles (`template::builtin`): their output is unchanged (all v0.18 tests pass
unmodified).

`validate()` refuses impossible sizes, frames outside the page, unknown
colours, non-hex values and newer versions.

## 4. Storage and migration

Migration **0012** (additive; the app's verified backup runs before any
migration, as for 0001–0011):

- `presentation_templates` (`id` UUID, `name`, `description`,
  `definition` JSON, `source_format` `pptx`/`package`/`designer`,
  `source_name`, `report` JSON, `created_at`, `updated_at`, `deleted_at`,
  `revision`);
- `presentations.template_id` (nullable, references a template).

Deleting a template is a soft delete and clears `template_id` on the
presentations using it (they fall back to their built-in `theme`, which is
kept). `tests/migration_v12.rs` upgrades a schema-11 database with data and
checks nothing is lost.

Pictures live in the app's managed data folder,
`sources/presentation-templates/{sha256}.{ext}` (`TemplateStore`):
content-addressed (one copy however many templates use it), written
atomically, checked against its SHA-256 when read, PNG/JPEG/GIF/WebP only,
at most 40 MB each. A template never points at a file elsewhere on the
computer. Template pictures appear in the presentation document's `images`
(id = SHA-256), so PowerPoint, PDF and the delivery package carry them.

## 5. One layout for every output

`layout::page(slide, doc, design, shaper, locale) -> Page` returns the
audience page: background colour, then blocks in drawing order —
background picture, bands, pictures, fixed texts, the slide's texts and
image, logo, footer. A text block carries its box, size, colour, family,
alignment, line height, **the lines already wrapped** (with the fonts the
PDF embeds) and an `overflow` flag.

- **Slots** (`layout::slots`): what a kind of slide puts in title, passage
  line and body (a quotation is `“…”` with `— author`; only title, section
  and Scripture slides name their passage).
- **Placement** (`layout::place`): the passage line goes in the layout's
  own passage box, else in the title box when the slide has no heading,
  else in the text box when the slide has no text — a church's "Bible
  verse" layout often has only a title and a text box.
- When a slide's content has no box in its layout, the **built-in
  arrangement** is used in the template's colours and fonts.
- **Fit**: `shrink` steps the size down to `minSize`; `none` keeps the size
  and sets `overflow`. Nothing else ever changes a size.

Consumers:

- **PDF** draws the blocks (pictures clipped and cropped, transparency via
  ExtGState, italic by skew, the template's fonts embedded when installed
  and licensed for embedding).
- **PowerPoint** writes the same boxes as shapes: anchor, insets,
  `normAutofit` for shrink / `noAutofit` for none, line spacing as a
  percentage of PowerPoint's single spacing (×1.2), latin/ea/cs typefaces,
  `srcRect` crops, `alphaModFix`, theme major/minor fonts, slide size.
  PowerPoint wraps the text itself.
- **The interface** calls `presentation_layout` (the presentation's
  design) or `presentation_template_preview` (an unsaved design: import
  review, designer) and draws the returned pages (`TemplateSlide.tsx`):
  absolute boxes in units of the page width, each line at the core's
  position. Pages are fetched once per distinct slide and kept
  (`useDesignPages`); fonts for layout are read once per set of families.
  Without a template the interface keeps drawing the built-in arrangement
  as in v0.18.

A passage shown during the talk is laid out as a Scripture slide of the
template (`AudienceSlide.referenceLabel`).

## 6. Importing from PowerPoint

`presentation/pptx_import.rs`, command `presentation_template_import_pptx`.
It reads a **design**, not a deck: the file's slides are counted and
reported ("the design only"), never imported.

Safety: only the parts a design needs are unpacked (`[Content_Types]`,
relationships, presentation, masters, layouts, themes, media, core
properties); each part at most `PART_MAX`, all together at most
`UNPACKED_MAX`; the file itself at most 400 MB; relationship targets are
resolved inside the package; external targets are ignored; entities are
decoded once.

What is read, master by master, layout by layout (master shapes are
inherited unless the layout hides background graphics):

| Source | Becomes | Report |
|---|---|---|
| slide size | page size | ratio (16:9, 4:3, 16:10, other) |
| theme colours through the master's colour map; `lumMod/lumOff`, `tint`, `shade`, `alpha` | template colours and every colour used | — |
| theme major/minor fonts | `heading` / `body` fonts (boxes using them stay linked) | font status |
| background: solid, picture (with crop), theme fill reference | background | supported; tiled picture → *needs a look* |
| gradient / pattern background | its first colour | *needs a look* |
| pictures (crop, transparency), also inside groups (scaled) | decorations | supported; rotated/flipped, shaped, SVG-only, video/sound, EMF/WMF/TIFF → reported |
| rectangles with fill/outline (transparency) | bands | supported; other shapes, gradient fills, rotated → *cannot be reproduced* |
| shadows, glow, 3D | — | *needs a look* (not drawn) |
| title / body / subtitle / object placeholders, inheriting layout → master → master text styles → default text style | `title`, `body`, `reference` (a second, smaller text box) | alignment, anchor, insets, spacing, bold/italic, colour, size; justified → left (*needs a look*); grow-with-text → fixed (*needs a look*); no-wrap, vertical text reported |
| PowerPoint autofit | `normAutofit` → shrink; otherwise none | — |
| picture placeholder | image frame | supported |
| footer placeholder (text from the layout or master) | label | supported |
| fixed text boxes | labels | supported |
| tables, charts, SmartArt, embedded objects, ink, lines, WordArt, content placeholders for media | — | *cannot be reproduced* |
| embedded fonts | — | *needs a look* (never taken over) |

**Role suggestions** (`suggest`): only where clear — layout names in six
languages ("Bible Verse", "Bibelvers", "성경", "Verset"…; quote, question,
picture, section) and PowerPoint's own layout types (title, section header,
picture with caption, blank, title and content). A suggestion is kept only
if the layout has the box that kind needs. Everything else stays unmapped
(built-in arrangement). The person confirms or changes every mapping.

**Fonts** are checked against the computer's installed fonts
(`font_catalog`: family names id 16/1, weight, slant, embedding rights,
read once): *installed*, *installed without this style*, or *missing*; a
missing font gets an **offered** suggestion (the same family without the
style word, or a metric-compatible family such as Carlito for Calibri) —
never applied. Boxes set in a font that is not installed get a *wrap risk*
item. The person's replacement is stored in the template and used by the
live view and PDF; PowerPoint keeps the original family name.

The result (`ImportedTemplate`: definition, source layouts, suggestions,
report) is reviewed in the interface; nothing is saved until **Keep this
template**. The report is stored with the template.

Progress: the import reports *layout n of total* as it reads (real counts).

**OpenDocument (.odp)** is not read: a second importer for a format churches
rarely send, with its own masters and styles, would not be reliable enough
for this release. LibreOffice saves PowerPoint; the interface says so.

## 7. Template files

`.awtemplate` = `abiding-word/presentation-template-package` version 1:
JSON with name, description, definition and each picture base64 by its
SHA-256. Import verifies every picture against its id and refuses newer
versions. Fonts are named, never included.

## 8. The interface

- **Design** chooser in the presentation's settings: built-in backgrounds
  and church templates in one list; *Manage templates…*.
- **Manage templates**: import from PowerPoint (with how to export from
  Keynote, Google Slides, LibreOffice), add a template file, new, edit,
  save as file, delete (with confirmation).
- **Import review**: report in three groups (symbol + heading + words,
  never colour alone), fonts table with replacement choices and offered
  suggestions, role mapping with "(suggested)" and a live preview of each
  kind laid out by the core.
- **Designer**: name, size (16:9/4:3, boxes rescaled), colours, fonts,
  background picture, logo (position by number), footer, and per kind of
  slide its own boxes: drag to move, corner to resize, **arrow keys**
  (Shift ×5) or numbers for every value; size, alignment, vertical
  position, colour, bold, italic, shrink.
- **Overflow**: a dashed outline with "Text too long" on the slide picture
  (editor only — never on the audience screen), a line under the slide's
  name, a count above the list, and a sentence after export.

## 9. Accessibility

Keyboard path for every pointer action (move buttons; arrow keys and number
fields in the designer); handles named for screen readers; status messages
for moves; report levels and font status by symbol and words; dialogs trap
and return focus; the drag handle is hidden from screen readers in favour of
the buttons.

## 10. Languages

All new text in English, German (informal *du*), Korean, French, Spanish
and Portuguese (`presentation.templates.*`, `presentation.editor.design*`).
Sample slides for previews use each language's own wording and Bible text.

## 11. Performance

Fonts are scanned once per run; layout fonts are kept per set of families;
pages are fetched once per distinct slide; previews wait 120 ms after the
last change; the importer reports real progress (no invented percentages).

## 12. Tests and the corpus

`src-tauri/tests/fixtures/templates/` — synthetic files written by
`scripts/fixtures/make_template_fixtures.py` (deterministic), modelled on
what each application saves:

| File | Models | Exercises |
|---|---|---|
| `powerpoint-16x9.pptx` | PowerPoint | Calibri theme, logo in a scaled group, footer inherited from the master, Scripture layout with cropped photo, transparent band with shadow, Montserrat SemiBold shrinking verse box, passage box, quote and picture layouts, SmartArt, justified and grow-with-text boxes, blank layout without master graphics, three old slides |
| `libreoffice-4x3.pptx` | LibreOffice Impress | 4:3, two masters (light; dark with gradient and inverted colour map), DejaVu Sans / Liberation Serif, Korean footer in Noto Sans CJK KR, duplicate layout names |
| `google-slides.pptx` | Google Slides | 720 × 405, Arial for both fonts, Google's layout names, tiled picture, rounded shape, EMF picture |
| `keynote.pptx` | Keynote | 1920 × 1080, Helvetica Neue, Quote layout with Georgia and vertical attribution, rotated shape, line, SVG picture with PNG fallback, crop and transparency, embedded fonts, no-wrap statement |

Rust: `tests/template_import.rs` (geometry, colours, inheritance, report
codes, fonts with a synthetic catalogue, suggestions, acceptance pruning
unused pictures, determinism, progress, refusal of non-presentations);
`tests/presentations.rs` (template applied: German long text shrinking,
Korean long text overflowing and reported, same page twice, PowerPoint
with size/fonts/crop/autofit/spacing and byte-identical output, PDF page
size and footer, a passage shown as a Scripture slide, page JSON);
`tests/migration_v12.rs`. Interface: `tests/ui/presentation-templates.test.tsx`,
`tests/ui/presentation-ordering.test.tsx`.

## 13. Known limits

- ODP is not read (§6). Google Drive direct import is not offered.
- Gradients, patterns, effects, rotated items, non-rectangular shapes,
  tables, charts and SmartArt are reported, not drawn.
- In PowerPoint a replaced font keeps the original family name (PowerPoint
  substitutes on computers without it); the live view and PDF use the
  replacement.
- The live view positions lines exactly as the PDF; glyph widths come from
  the browser's font, so a line's length can differ by a few pixels where
  the font is not the same file.
- PowerPoint's own `normAutofit` decides its shrink; it may differ slightly
  from the core's step-down.

## 14. Windows / Office acceptance checklist

On Windows with Office installed, using a real church template if
possible, plus the corpus files:

**Import**

1. Import a church `.pptx` saved by PowerPoint (16:9). The review lists
   what was taken over / needs a look / cannot be reproduced; nothing in
   the design is missing without being listed.
2. Fonts: Calibri shows *Installed*; a font not on the computer shows *Not
   installed* with a suggestion; nothing is replaced until chosen.
3. The suggested layouts are sensible (Bible verse → Scripture); change one,
   leave one on the built-in arrangement; *Keep this template*.
4. Repeat with a 4:3 file, a file saved by LibreOffice, one downloaded from
   Google Slides and one exported from Keynote.
5. Add the same template from a saved `.awtemplate` on a second computer
   or user account: pictures arrive, fonts are reported.

**Live**

6. Choose the template: editor previews, Presenter View (current, next,
   Overview), audience screen on a second display and *Show in this window*
   all show the church design; a Bible passage shown during the talk uses
   the Scripture layout. The Presenter View's own panels keep the app look.
7. Switch back to *Light*: slides and teaching unchanged.

**PowerPoint**

8. Export PowerPoint and open it in PowerPoint for Windows: **no repair
   prompt**; slide size, background photo crop, logo, footer, band
   transparency, fonts, alignment and box positions match the live view.
9. Open the same file in LibreOffice Impress, Keynote and Google Slides
   (upload): it opens; differences are only those each application makes.

**PDF**

10. Export PDF: same page size and positions as the live view; fonts
    embedded where licensed; the footer text is selectable.

**Languages and long text**

11. A German teaching with a long verse (Luther): in a shrinking verse box
    it gets smaller but stays readable; in a box that may not shrink the
    editor says *Text too long* and export reports it.
12. A Korean teaching: Korean text shows in the live view, PowerPoint (East
    Asian typeface set) and PDF (with an installed Korean font such as
    Malgun Gothic).

**Ordering and accessibility**

13. Drag slides with mouse, touch screen and pen; Esc cancels; the list
    scrolls at its edge. Do the same with the keyboard (Move earlier /
    later) and with a screen reader (NVDA/Narrator announce the new place).
14. In the designer, move and resize boxes with mouse and with the arrow
    keys / number fields; the report and font status are understandable
    without colour.
