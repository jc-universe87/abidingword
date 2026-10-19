# Workspace hierarchy (v0.18.4)

A local visual refinement of the three-pane Bible · Study/Teaching · Sources
workspace, from the owner's Windows screenshots: too much bold, too many
competing sizes, borders everywhere, and no clear first place for the eye.
Nothing about what the workspace does changed; one name did (*Materials*, §6).

**Principle.** The Study or Teaching in the middle is the person's current
work and leads; Scripture supports it, then Sources. The order is carried by
surface, space and type, not by colour. Serif is the voice of Scripture, of
the person's own writing and of one primary title; structure speaks in the
interface sans and is told apart by weight and colour.

## 1. Pane surfaces

Semantic tokens in `src/design-system/tokens.css` ("Workspace panes"), used by
`WorkspaceLayout.tsx` (`bg-pane-work`, `bg-pane-scripture`, `bg-pane-sources`):

| Token | Light | Dark |
|---|---|---|
| `--aw-pane-work` | the brightest surface (the family's page colour lifted toward white; *Clear*: white) | the deepest surface (the page) |
| `--aw-pane-scripture` | the page colour (*Clear*: half a step back) | half a step lighter than the page |
| `--aw-pane-sources` | the family's secondary colour | the family's secondary colour |
| `--aw-field` | the Scripture step: a text field is one step back from the work it sits in | same |

The rule in both themes: the work pane has the most contrast with its text,
each supporting pane is a step closer to the middle. It is defined for all six
families × Light/Dark and checked by `tests/ui/appearance-themes.test.tsx`:
order of luminance, each step between 1.04:1 and 1.25:1 (visible, never a
strong panel), and on every pane body text > 9:1, muted text > 5:1, links
≥ 4.5:1 and the focus ring ≥ 3:1.

## 2. Typography: four levels

Classes in `src/design-system/index.css`:

| Level | Class | Treatment | Used for |
|---|---|---|---|
| A | `type-title` | serif 1.625 rem, 600 | a Study's title, the Bible chapter heading |
| A′ | `type-worktitle` | serif 1.25 rem, 600 | the open Bible Teaching's title (once), the new-teaching form |
| B | `type-section` | sans 1.0625 rem, 600 | every major working section, one treatment: Study parts (*Text*, *Observations*), *Central message* / *Was die Gruppe entdecken soll*, *Introduction* / *Einstieg*, *Main points* / *Fragen und Antworten*, *Conclusion*, *Notes*, *Other notes* |
| C | `type-subhead` | sans 0.9375 rem, 500 | *About this teaching*, fields inside a point (*Explanation*, *Application*), Sources pane headings (at 600) |
| D | `type-meta` | sans 0.875 rem, 400, muted (Korean 500) | translation line, counts, *Point 1*, summaries, source details, *Go to passage*, *Chapter*, menu descriptions |

Reading text stays `reading` (serif 1.125 rem); a point's or question's title
is the person's writing in that voice at 600. Pane names keep `caps-label`.

In the twelve workspace components: **before** 8 text sizes (0.8125, 0.875,
0.9375, 1, 1.0625, 1.25, 1.375, 1.5 rem) and 7 serif headings; **after** the
four levels plus reading text, and 1 serif heading outside the type classes
(a Study's own *heading* block, which is the person's writing).

## 3. Less bold, fewer borders

- Sources: a source's name is medium in body colour (was semibold Forest, one
  after another); its details are `type-meta`; the rules between sources are
  gone (spacing instead); places under a source in body colour; hover is a
  6 % tint that shows on any pane.
- View switches (*Bible Study | Bible Teaching*; *Bible | Marks |
  Concordance*): `.aw-tab` — no boxed group, no filled Forest block. The
  chosen one is `aria-pressed`, semibold, strong colour and has a short bar
  beneath (never colour alone).
- Passages under a Study's title: links, not boxes; the primary one of several
  sits on a soft fill.
- Teaching fields: a soft fill (`bg-field`) instead of an outline; the outline
  appears on hover and in use; the focus ring is unchanged. Titles (teaching,
  points) are a line to write on.
- Study paragraphs and notes keep their resting underline (they must look
  editable before they are touched — an earlier decision, kept); a note's
  passage is a link, not a box; a point's left rule is neutral and 2 px (was
  3 px brass).
- Scripture: the arrows have no box; *Go to passage* and *Chapter* are quiet
  labels; the chapter heading is level A, the translation line level D. The
  Bible text itself is unchanged in size and voice.
- *About this teaching* opens on a soft fill, not a frame.

## 4. The open Bible Teaching starts higher

Before, in order: Study/Teaching switch, details, passages, *Prepare another*,
the title in a box, *About this teaching* with its summary, *Presentation* on
its own line, then the work. Now the teaching itself is two lines:

1. its title (wraps in a narrow pane, stays one line of text: Enter does not
   break it) with **Materials** at the right — below the title when the pane is
   narrow;
2. *About this teaching* with its summary (shortened to one line; the full
   details are one click away, and the button's name holds the whole summary)
   and *Prepare another Bible Teaching* (with the picker when there are
   several), quiet.

Measured on the owner's kind of window: the first section starts about 80 px
higher at 980 px and about 110 px higher at 1440 px. The picker is now part of
the open teaching, so it is drawn anew when another is chosen; the keyboard is
put back on it, and *Prepare another* gets the focus once the teaching has
loaded.

## 5. Constrained widths

Checked at 980, 1280, 1440 and 1920 px with all three panes open (Sources
open at 980, as in the owner's screenshots), in English, German and Korean.
At 980 the centre is about 360 px: section labels wrap before the fields, the
teaching's title wraps, Materials moves below it, the *About* summary is
shortened instead of pushing *Prepare another* onto its own line. The
remaining wrapping is the Study header's passages row (each passage is a
44 px target) and, in German, *Konkordanz* on a second line in a 300 px
Scripture pane.

## 6. Materials (Unterlagen)

A Bible Teaching can become slides, a manuscript, a worksheet, a question
sheet. "Presentation" was therefore the wrong umbrella. The teaching has one
quiet entry point, **Materials**, a menu (`ActionMenu` with a visible label and
item descriptions) listing what it can become. Today that is one item:

| | en | de | ko | fr | es | pt |
|---|---|---|---|---|---|---|
| Umbrella | Materials | Unterlagen | 가르침 자료 | Supports | Materiales | Materiais |
| Item | Presentation | Präsentation | 프레젠테이션 | Présentation | Presentación | Apresentação |

with the description "Slides for the screen, made from this teaching" in each
language. *Presentation* stays the name of that output (its page, *Presenter
View*, exports and templates are unchanged). Manuscript, worksheet and
question sheet are not offered until they exist; they belong under the same
menu when they do (product backlog). Materials is never the library: that is
*Sources*. Keys: `studies.teaching.materials.{open,presentation,presentationHint}`.

Renamed: the Teaching header button (was `presentation.open`, now unused in the
interface), the guide (`11-presenting.md` step 1, glossary in
`09-questions-and-word-list.md`), the interface tests and the screenshot
script. Back from the presentation returns the focus to Materials.

## 7. Tests

- `tests/ui/workspace-hierarchy.test.tsx` (new): pane surfaces; quiet,
  pressed view switches; the two-line header and nothing between it and the
  central message; the title stays one line; Materials with Presentation as its
  only item, keyboard (Escape back to the button) and focus on return;
  Materials in de/ko/fr/es/pt.
- `tests/ui/appearance-themes.test.tsx`: the pane order, step size and
  contrast for all twelve palettes.
- Presentation, ordering, templates, appearance and teaching tests open the
  presentation through Materials; the teaching test follows the picker as it
  is drawn anew.

## 8. Screenshots

`docs/images/workspace-v0.18.4/` (sample content from the guide harness;
the German teaching is a group Bible study as in the owner's case):

- `compare-de-light-980.png`, `compare-de-dark-980.png`,
  `compare-light-1440.png`, `compare-dark-1440.png` — before (5e1bfe6) and
  after, side by side;
- `teaching-de-light-980.png`, `teaching-de-dark-980.png`,
  `teaching-light-1440.png`, `teaching-dark-1440.png`,
  `teaching-light-1280.png`, `teaching-light-1920.png`,
  `teaching-ko-light-980.png`, `study-light-1440.png`;
- `families-light.png`, `families-dark.png` — the other five backgrounds.

## 9. Independent review

See §10.

## 10. Review findings and fixes

(Filled in after the review.)

## 11. Remaining visual concerns

- The Source reader (a source opened inside the Sources pane), the Library,
  Settings and the presentation editor were not part of this pass.
- The Study header still wraps to several rows in a 360 px centre pane.
- The guide's own screenshots (`docs/guide/images/`) were taken before this
  pass; regenerate them with `tests/screenshots/capture.mjs` once the owner
  accepts the look.
