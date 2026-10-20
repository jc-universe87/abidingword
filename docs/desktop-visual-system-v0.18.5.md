# Desktop visual system (v0.18.5)

v0.18.4 gave the three-pane workspace one hierarchy. v0.18.5 makes that the
system for the whole desktop app, so Library, Source Reader, Settings, the
presentation editor, Presenter View, the church-template screens and every
dialog read as one calm product. The information architecture is unchanged.

**Principle: the software should disappear.** Scripture, the person's writing
and their sources are the content; everything else (panels, controls,
labels, states) is quiet, consistent and predictable.

## 1. Audit (before any change, at `fd96d00`)

Method: a count of the interface classes in every component
(`src/features/*`, `src/design-system`, `src/app`, `src/layouts`; ~21 000
lines), and the review screenshots of every surface in Light and Dark at 980
and 1440 px, German and Korean at 980 px
(`tests/screenshots/review.mjs`, §9).

| Area | Text sizes in use | semibold/bold | serif headings | borders | filled ("Forest block") selections | notes |
|---|---|---|---|---|---|---|
| Study (workspace, lists, new study) | 9 (0.875–1.875 rem) | 5 | 9 | 80 | 3 | v0.18.4 levels in the canvas; lists and forms still ad hoc (1.25/1.375/1.875 serif) |
| Teaching | 5 | 8 | 0 | 59 | 0 | v0.18.4 system; Teaching links and assistant panel still ad hoc |
| Scripture | 9 | 14 | 4 | 71 | 2 | Marks filters are filled Forest pills; search/marks headings serif 1.5 |
| Library + Source Reader | 10 | 14 | 8 | 82 | 3 | Library title serif 1.875, each source title serif 1.25; *Remove…* on every row; Reader's *Reading / Original* a filled Forest block; reader chrome two full-width bars |
| Settings | 9 | 9 | 4 | 30 | 0 | eight serif section titles one under another; every field label semibold; outlined fields, help on every label |
| Presentation + templates | **11** (0.6875–1.5 rem) | **26** | 1 | **104** | 0 | each slide a bordered card; readonly teaching text in a filled box that looks editable; Presenter's current slide in a burgundy tint, *Next* in burgundy |
| Design system | 3 | 0 | 1 | 14 | 1 | `Dialog` title serif 1.25; backdrop colour hard-coded; `Notice` info/error only; `Button` primary/secondary/quiet |

Across the app: **14 text sizes** (0.6875, 0.75, 0.8125, 0.875, 0.9375, 1,
1.0625, 1.125, 1.25, 1.375, 1.5, 1.875 rem plus `base`/`xl`), five ways of
showing a selection (filled Forest block, burgundy tint, bold, underline bar,
outlined pill), and hovers written as a fixed surface colour
(`hover:bg-bg-secondary`), which disappear on a pane of that colour.

By surface:

- **A. Workspace** — the v0.18.4 system; remaining: Scripture *Marks* filters
  (filled pills), search and marks headings (serif 1.5).
- **B. Library** — clear list, but the page title is larger than the Study
  title, every source title is serif, *Remove…* stands at full strength on
  every row, search and filters are form-like boxes; empty and loading states
  are plain lines.
- **C. Source Reader** — the book dominates (good). Chrome: *Back* + serif
  title + up to seven toolbar buttons in one bar, a second bar for PDF pages
  and zoom; *Reading / Original* is a filled block; metadata is quiet;
  annotations visible but calm.
- **D. Settings** — understandable order; eight serif section headings form
  a wall; field labels all semibold; every field has its own help mark; the
  AI section reads as a form (service, key, model, advanced) rather than
  "connect a service".
- **E. Presentation** — the editor is a column of bordered cards (slide
  rows) with thumbnails and three icon buttons each; the opened slide's
  teaching text is in a filled box (readonly, but looks like a field); labels
  in four sizes. Presenter View: its own surface (right), but its current
  slide and *Next* use burgundy, a colour used nowhere else for that.
- **F. Church templates** — dialogs with many bordered groups; report levels
  (taken over / needs a look / cannot be reproduced) are distinguishable but
  each in its own box; the designer is a long form of labelled controls.
- **G. Dialogs** — one `Dialog` component (5 uses) and three bespoke
  panels in Presenter View; consistent focus handling; serif titles; actions
  right; destructive actions inline as red text in several places.
- **H/I. Lists** — study list, projects and search results use serif 1.25
  titles per row; teaching picker and Materials are v0.18.4.
- **J. States** — loading and empty states are muted lines of different
  sizes; errors use `Notice` or a red line.

Risks found: German compounds in Settings navigation and template dialogs;
Korean line height in dense lists; `font-semibold` labels in Korean (heavier
than the 500 base). Accessibility: focus ring consistent (brass, 3:1 on all
surfaces); some hovers invisible (above); icon-only toolbar buttons have
names and titles.

## 2. Principles

1. **Content first.** Scripture, the person's writing and their sources carry
   the colour, the serif and the size. Chrome is sans, muted, one step back.
2. **One way to say one thing.** One hover tint, one selected state per kind
   of control, one field, one dialog, one destructive confirmation.
3. **State is never colour alone.** Selected = weight + bar or fill + border;
   errors = message + `aria-invalid`; warnings carry words.
4. **The pane decides, not the window.** Layout inside a pane uses container
   queries (`@md:`), so three open panes at 1100 px behave like a narrow window.
5. **Fewer, calmer variants.** Nothing was added that has only one use.

## 3. Typography

| Level | Class | Face / size / weight | Used for |
|---|---|---|---|
| A | `type-title` | serif 1.625 rem 600 | page titles (Library, Settings, Search, Marks) |
| — | `type-worktitle` | serif 1.25 rem | the work's title, dialog titles, form titles, a source's title in the reader |
| B | `type-section` | sans 1.0625 rem 600 | a major working section (Settings sections, Library sections) |
| — | `type-item` | sans 1.0625 rem 500, strong | a list item's name (sources, studies, templates, Bibles) |
| — | `type-group` | sans 0.9375 rem 600 | a small group heading inside a section or panel |
| C | `type-subhead` | sans 0.9375 rem 500, strong | field labels, legends |
| D | `type-meta` | sans 0.875 rem 400, muted (Korean 500) | metadata, hints, counts |
| — | `.reading` | reading serif 1.125 rem | Scripture and long reading text |
| — | `caps-label` | small caps | pane names |

Serif set directly (`font-display`, outside the A and work-title classes):
**2** places (was 28 at `fd96d00`); text sizes per area fell from 9–11 to
4–7 (Settings 9 → 5, Presentation 11 → 7, Library 10 → 7). Semibold/bold uses: 27 (was 76), most now in the slide
renderer and Presenter View, where slide text is bold by design.

## 4. Surfaces

| Surface | Token / class | Light | Dark |
|---|---|---|---|
| Work (Study, Teaching, pages) | `bg-pane-work` | brightest | deepest |
| Primary reference (Scripture) | `bg-pane-scripture` | one step back | one step up |
| Secondary reference (Sources) | `bg-pane-sources` | two steps back | two steps up |
| Inset field | `bg-field` (= the Scripture step) | | |
| Hover | `bg-hover` = text-strong 6 % (8 % dark) | | |
| Selected | `bg-selected` = text-strong 10 % (13 % dark) | | |
| Dialog, sheet, floating panel, action panel | `bg-raised` | = work (lightest) | `bg-secondary` (lifted) |
| Popover / menu | `.aw-popover` (raised + border + soft shadow) | | |
| Backdrop | `--aw-backdrop` | forest 42 % | black 55 % |
| PDF page | `.aw-paper` | always white; highlight tokens pinned to their light values | |

Hover and selected are mixes of the text colour, so they show on every pane in
all six families × Light/Dark (tested: `appearance-themes.test.tsx`).

## 5. Fields

| Kind | Class | Look |
|---|---|---|
| Compact field (text, number, search, select) | `.aw-input` | field fill + 1 px border, border darkens on hover; 2.5 rem min |
| Large writing (Study, Teaching) | `TeachingField`, block editor (v0.18.4) | soft fill, outline on hover/use |
| Note beside a source or verse | `.aw-writing` | field fill + border, reading face |
| Readonly (text from the teaching) | `.aw-readonly` | no fill, a rule beside it |
| Disabled | `:disabled` | 60 % opacity, not-allowed cursor |
| Error | `aria-invalid="true"` | danger border + the message |
| Focus | global brass ring (v0.18.2) | unchanged |

## 6. Actions

`Button` variants: **primary** (Forest fill; one per view), **secondary**
(outline), **quiet** (text; hover tint), **danger** (danger outline/text;
every delete/remove confirmation). Icon-only actions: `.aw-icon-button`,
40 px (44 px where touch matters), always with `aria-label` and `title`.
A destructive action on a row is a muted icon that turns danger on hover; the
confirmation sits inline on the hover surface with a danger bar, the danger
action, and *Keep* focused.

## 7. Selected states

| Control | Class | Selected shown by |
|---|---|---|
| View switch (Bible / Marks / Concordance; Study / Teaching; Reading / Original) | `.aw-tab` + `aria-pressed` | weight 600 + 2 px bar under |
| List row (contents entry, current slide, marked heading) | `.aw-row` + `aria-current` / `aria-selected` / `data-selected` | selected tint + inset 2 px bar |
| Option among several (filters, kinds, examples, template boxes) | `.aw-choice` + `aria-pressed` / `aria-checked` / checked input | selected tint + strong border + 600 |
| Pane toggle in the app bar | `aria-pressed:bg-selected` | tint + pressed state |
| Presenter current slide | presenter text colour at 10 % + inset bar + 600 | same idea in the presenter's own colours |

No filled Forest blocks remain as selections (the static count went from 9 to 3; the 3 left are primary *buttons*, not selections).

## 8. Dialogs and panels

`Dialog`: `bg-raised`, large radius, `type-worktitle` title, body gap 0.75 rem,
actions at the end (primary last), `max-w-lg` (wide `max-w-5xl`), Escape
closes, focus moves in and returns to the opener, the body scrolls.
`Sheet` uses the same surface and backdrop. Selection panels (mark words,
Add to Study, verse note) share `.aw-action-panel`: raised, border, a brass
line along the top. Presenter View's panels keep the presenter's own colours
with the shared shadow and title weight.

## 9. Responsive rules and screenshots

Review harness (development only): `tests/screenshots/review.mjs <out>`
captures 12 scenes (workspace, Teaching, Library, Reader, PDF, Settings, AI
Assistant, presentation editor, Presenter, template import, designer, a
dialog) in Light and Dark at 980 and 1440 px plus German and Korean at 980 px
(56 images); `REVIEW_WIDTHS=1100,1280,1600,1920` adds the width pass (1100 and
1280 with all three panes open are the constrained arrangement).

Findings fixed in the width pass: the presentation editor's slide rows used a
window breakpoint (`sm:`), so with three panes at 1100 px the words of a slide
were one letter wide; now `@container` + `@md:`. Library's back bar now spans
the page like Settings'.

## 10. Accessibility

- Every button in the workspace (Teaching open), Library and AI Assistant
  settings has an accessible name (`visual-system.test.tsx`).
- Selection always has a non-colour cue (weight, bar, border, `aria-*`).
- The v0.18.2 focus ring is untouched; no new `outline-none` without a
  visible replacement.
- Status colours (success, warning, danger) reach 4.5:1 on every pane and the
  raised surface in all 12 palettes (`appearance-themes.test.tsx`).
- Touch targets stay 44 px where they were; drag in the slide list keeps its
  keyboard alternative (move up/down).

## 11. Changes by screen

- **Workspace / Study / Teaching** — lists use `type-item`; new-study and
  Add-to-Study chips are `.aw-choice`; form labels `type-subhead`.
- **Library** — title A, sections B, sources `type-item` + `type-meta`; Remove
  is a muted icon with a danger confirmation; fields `.aw-input`; full-width
  back bar.
- **Source Reader** — Reading/Original and Contents/Marks are `.aw-tab` (no
  filled block); one quiet header line; contents rows `.aw-row`; PDF notes in
  brand burgundy with brass focus on an `.aw-paper` page; note fields
  `.aw-writing`; selection panels `.aw-action-panel`.
- **Settings** — no serif section wall (B, sans); summaries `type-meta`; AI
  Assistant fields `.aw-input`, labels C, examples `.aw-choice`, *Remove key*
  quiet with danger hover; Bible texts and templates confirm with danger.
- **Presentation editor** — slides are rows (no card borders; the open one on
  the hover tint), teaching text readonly, warnings in words in the warning
  colour, slide rows follow the pane.
- **Presenter View** — *Next* in the presenter text colour (not burgundy);
  current slide row/tile in the shared selected pattern; arrangement outlines
  visible in Dark; empty state uses the shared title and button.
- **Church templates** — manager is a list; import report levels: taken over
  (success), needs a look (warning), cannot be reproduced (muted), each with
  its words; designer labels C, box picker `.aw-choice`.
- **Dialogs** — raised surface, shared backdrop, `type-worktitle` titles.
- **Status** — `Notice` has info / success / warning / error tones.

## 12. Known exceptions

- Slide rendering (`SlideView`) and the audience screen use the template's
  fonts, weights and colours — they are the church's design, not app chrome.
- The PDF page stays white in Dark (paper); its notes use fixed brand colours.
- Brass bars on quoted words (marks, Add to Study) mean "the words you
  marked", matching the brass highlight.
- Presenter View keeps its own palette (it may differ from the app's when the
  speaker chooses another), with the shared patterns drawn in that palette.
- `font-semibold` remains on concordance hit words and search highlights
  (the emphasis is the content).
