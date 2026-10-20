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

(See the sections below; filled in with the system as built.)
