# Study flow and teaching materials (v0.18.6)

Two product problems, solved together because they are one journey:

1. A Bible Study looked like a flat list of equal folding parts rather than a
   movement from the text to teaching.
2. *Materials* was only a wrapper around the presentation, while a Bible
   Teaching should produce several useful things to teach with.

**Principle.** The software should disappear: a pastor or teacher should feel
they are *reading Scripture → understanding it → thinking theologically →
applying it → thinking about people → preparing to teach*, not operating
database sections. The flexible Study model stays; nothing becomes a wizard.

Base: `db70242` (v0.18.5). No migration; no stored data changes shape.

## 1. Study journey

### Mapping (src/features/studies/journey.ts)

Six phases: **text, understanding, theology, application, audience,
teaching**. A part's phase comes from the built-in part it was made from (its
stable `key`, which stays when the part is renamed), read by the kind of study
where the same part means something else:

| Phase | Built-in parts |
|---|---|
| Text | text, observations, context, structure (passage study), key-words, word, occurrences, topic, key-passages, key-texts, doctrine, theme |
| Understanding | meaning, exegesis, main-idea, related-scripture, open-questions, semantic-range, immediate-contexts, main-themes, biblical-context, difficult-passages, old/new-testament, gospels, epistles, canonical-development, conclusions (word and topical studies) |
| Theology | theology, fulfilment, synthesis, biblical-synthesis, historical-theology, confessional-witness, alternative-positions, theological-significance, conclusions (systematic theology) |
| Application | application |
| Audience | audience |
| Teaching | teaching, teaching-outline, illustrations, purpose; in a study made to prepare a teaching also its purpose, audience, structure and application |

Rules, all tested (`tests/ui/study-journey.test.tsx`):

- Parts are grouped **where they stand**: consecutive parts of one phase form
  a run. Nothing is reordered; the meaning of a part is never changed.
- A part of the person's own (no key) joins the phase of the part before it.
- A part of an earlier phase placed later (an optional part added at the end)
  starts a run of its own: the grouping shows the study as it is.
- A study with fewer than three phases (a study of the person's own shape, a
  short word study) shows no phases at all — no forced categories.
- An older passage study with all nine former parts (Text, Context,
  Observations, Structure, Exegesis, Theology, Application, Audience,
  Teaching) reads as all six phases.

### Visual treatment

Chosen after looking at the review set, deliberately few techniques:

- **A one-line study outline** under the header: *Text · Understanding ·
  Theology · Application …* (only the phases the study has). It is the
  journey at a glance and the way through a long study.
- **Space and a firmer rule** where a phase begins, on the phase's first part
  (extra space and the border colour instead of the subtle one between parts
  of a phase). Readable in monochrome. The parts stay one list of siblings, so
  moving or folding a part never rebuilds its neighbours.
- **A phase name above its parts only where it adds something**: not when the
  first part's own title already says it (*Theology* above *Theology*; *Text*
  above *Text, Observations, Context*). In a passage study this leaves one
  label, *Understanding* above *Meaning*.
- **The part being worked in** carries a thin brass line in the gutter (brass
  is the colour of work in progress); a folded part's title is quieter (500,
  body colour) than an open one's (600, strong), so active work, open parts
  and folded parts are distinct without colour.

Not used: cards, a colour per phase, icons, a stepper, completion
percentages, locked order.

### Long studies

The outline is **sticky**: it stays at the top of the pane while the study
scrolls. It marks the current phase (`aria-current="step"`, weight and bar
like every tab): the phase of the part being worked in while that part is on
screen, otherwise the last phase whose start has passed the upper third of
the pane, and the last phase at the very end. A click scrolls to the phase and
moves focus to its first part's heading. In a narrow pane the line scrolls
sideways (a thin scrollbar shows there is more) and keeps the current phase in
sight rather than wrapping. Position is read on scroll, on resize and when the
study changes size (a part folded, writing pasted), one animation frame at a
time; nothing is measured while nothing moves.

Not built: an outline sidebar, "fold this phase" buttons (no owner need yet;
*Fold all* stays).

### Study → Teaching

At the end of the study, after *Add a part · Note*: one quiet line, *"When you
are ready, this study can become a Bible Teaching: a sermon, a group Bible
study or a lesson."* with **Prepare a Bible Teaching →**. Once one exists it
says *"Prepared from this study: …"* (or how many) with **Open the Bible
Teaching**. It is an invitation, never a step the study must take.

### Accessibility

Part headings stay `h2` (no change to heading navigation). The outline is a
`navigation` landmark ("Study outline"); its buttons are named *"Go to
Theology"* so they never share a name with the part's own fold button (found by
the tests: two "Text" buttons). A phase's name, where shown, is read first
inside its first part's region. Keyboard: the outline buttons are ordinary buttons; folding works
part by part as before.

## 2. Materials

### Information architecture

**A material is something to teach with; a file format is only how it is
delivered.** The data model keeps them apart (`OutputKind` in
`features/materials/derive.ts`: presentation, manuscript, questions,
worksheet; the format is chosen when saving). (The older `TeachingMaterial`
type is a different thing: stories and pictures kept in a teaching.)

The **Materials** menu (*Unterlagen, 가르침 자료, Supports, Materiales,
Materiais*) stays compact beside the teaching's title. It lists what can be
prepared from this teaching, each with one line saying what it is; then, under
*Presentation files* and only once slides exist, **Save the presentation as a
file…** (PowerPoint, PDF slides, speaker sheet, Markdown, delivery package),
which opens the same export dialog as the presentation editor (whose own
button is unchanged).

| Kind of teaching | Offered |
|---|---|
| Sermon, talk, youth, other, not said | Presentation · Manuscript · Listening notes |
| Group Bible study | Presentation · Leader’s guide · Question sheet |
| Lesson, children | Presentation · Teacher’s guide · Worksheet |

Nothing is offered for symmetry: a group study's question sheet already is its
sheet to write on, so it gets no separate worksheet; a sermon has no questions
for a question sheet.

### Opening a material

It opens **at once as the page it will be** (white paper in Light and Dark, the
reading face), with *Back to the teaching*, one line saying it is put together
from the teaching ("change the teaching, and this changes with it"), the
actions, and a few plain choices. No setup screen, no layout settings.

- **Print or save as PDF…** — the system's print dialog; only the material is
  printed (a copy of the page is put at the top of the document while the
  dialog is open; `@media print` hides the app and lets the page run on).
  Checked with Chromium's PDF output: English and Korean sheets, nothing of the
  app on them, and a long manuscript over five pages.
- **Save as a text file…** — Markdown, through the save dialog; the core's new
  `material_save_markdown` writes only the chosen file (`.md` added when
  missing, written atomically, a 4 MB guard), main window only.
- **Copy the text** — Markdown on the clipboard, for a document or an email.

DOCX was not built: no existing writer, and a fragile Word file would add risk
for little; copying into Word and the PDF cover the need for now.

### Manuscript semantics and source of truth

**Decision: derived, not a second document.** The Teaching remains the
structured source; a material is put together from it each time it is shown,
by fixed rules, and cannot be edited on its own. This avoids two diverging
versions of a sermon. To change a manuscript, change the teaching. (Editable
material-only wording would need explicit semantics; deferred.)

Rules (tested):

- The teaching's order and its own words, trimmed; nothing summarised,
  rewritten or filled in. An empty part, and a point with nothing in it, are
  left out; numbers keep the teaching's numbering.
- Sermon or talk: title, passages, central message, introduction, each point
  (its passages; the explanation as plain text; *Illustration or example* and
  *Application* named), conclusion.
- Group study (*leader’s guide*) and lesson (*teacher’s guide*): the same,
  every field under its own name (*Where it may lead*, *What you need*…), a
  step's kind beside its heading.
- *Notes for yourself* only when **My notes for myself** is ticked. Audience
  and purpose are never in it (they describe the teaching, they are not said).
- Kept stories and pictures are not included (their standing — checked,
  unverified, generated — would need showing; deferred rather than risk
  presenting an unverified story as fact).

### Question sheet: participant and leader

- **By default it is for the group:** the title, the passage and the
  questions word for word, numbered, with room to write. Nothing else.
- What each question may lead to, follow-up questions, notes for leading and
  what the group should discover appear **only on the leader's version**, an
  explicit choice that puts *"Leader’s version: with notes for leading. Not for
  handing out."* at the top. The opening and closing (the leader's words) join
  the group's sheet only when ticked.
- Notes for oneself are on no sheet, ever.
- **Numbers are the same on every sheet:** only questions with wording are
  numbered, on the group's sheet, the leader's version and the leader's guide
  alike, so "question 2" means the same thing to the leader and the group. A
  question not yet worded is not put to the group; its notes stay with the
  leader, unnumbered, under *Notes for a question not yet worded*.

### Worksheet scope

- **Lesson / children:** the passage, *the one thing to remember*, each
  question step with lines, each activity with a box to draw or write, each
  Bible-reading step's title and passage. Never the answers to listen for or
  what the teacher needs.
- **Sermon / talk (listening notes):** the points' titles in order with lines
  under each, and a box for the listener's own notes. Not the explanation,
  application or central message (they are to be heard).
- Not built: a desktop-publishing editor, pictures on sheets, fill-in blanks.

### Provenance

Every material says it is put together from the person's teaching; no
assistant is involved; derivation is deterministic and tested ("invents
nothing": every line shown is the person's own writing, apart from the
interface's own labels and the numbers).

## 3. Languages

All new text in six languages; German *du*; Korean polite forms and
natural church words. Terms in `docs/i18n.md`. "Markdown" appears only as the
save dialog's file type.

## 4. Source preservation

- No migration, no change to stored Study, Teaching or Presentation data.
- Opening a material never changes the teaching (tested: the teaching is equal
  before and after).
- The presentation is not duplicated: Materials opens its existing editor and
  export dialog.
- Collapse state, study views and everything else stored are untouched.

## 5. Screenshots

Review harness scenes (development only): `r-study-deep` (a long study partway
down, one part being worked in), `r-materials`, `r-manuscript`,
`r-question-sheet`, `r-question-leader`, `r-worksheet`, in Light and Dark at
980 and 1440 px and German and Korean at 980 px
(`node tests/screenshots/review.mjs <dir>`). Before/after from `db70242` and
contact sheets: [`images/study-flow-v0.18.6/`](images/study-flow-v0.18.6/README.md).

## 6. Human-first UX review

Done against the real review screenshots, for each primary task:

| Task | Useful result | Before configuration? | Next action | Findings and fixes |
|---|---|---|---|---|
| See the shape of a study | The outline line; phases set apart | Yes | Click a phase | Labels first repeated the part's name three times at the top ("Text / TEXT / Text") → named only where it adds something. Boundaries were invisible without a label → firmer rule. |
| Find one's place deep in a study | Sticky outline marks the phase | Yes | Click another phase | The marked phase followed reading position, not the part being worked in → the active part wins while on screen. At 980 px the line was cut mid-word → kept the current phase in sight. |
| Move on to teaching | One quiet line at the end | Yes | *Prepare a Bible Teaching* / *Open* | — |
| See what can be prepared | Materials menu, each with one line | Yes | Choose one | No technical names in the menu; files grouped apart and named *presentation* files. |
| Get a manuscript or sheet | The page itself, immediately | Yes (choices beside it) | *Print or save as PDF* (primary) | German button wrapped its ellipsis onto its own line → "Save as a text file…" (Markdown only in the dialog). In a narrow pane the page started low → actions and choices on one wrapping row; the sheet's padding follows the pane. |
| Keep leader notes private | Group sheet by default | Yes | Tick *Leader’s version* | The leader's version says so at its top. |
| Nothing written yet | A plain sentence | — | Write in the teaching | Save and print disabled. |

Not verified: a non-technical owner using it without instructions (the
owner's visual review is the next step); printing inside the packaged Windows
app (the browser engine path is verified; WebView2's dialog is expected to
offer *Microsoft Print to PDF*).

## 7. Tests

`tests/ui/study-journey.test.tsx` (14), `tests/ui/materials.test.tsx` (20),
the updated Materials test in `workspace-hierarchy.test.tsx`; Rust:
`commands::materials` (4), the capabilities test (the new command is
main-window only and privileged).

## 8. Limitations

- The passage's text is not on sheets (only its reference).
- Printing uses the web view's print dialog; macOS's web view has none (the
  text file and copy work everywhere).
- Phases are known for built-in parts; the person's own templates' parts take
  the phase of the part before them.
- No DOCX; no material-only editing; no stories or pictures in materials.

## 9. Independent review

A separate review of the whole diff (`db70242..HEAD`) found three genuine bugs
and nine smaller points; all were fixed, with regression tests where testable.

| # | Finding | Fix |
|---|---|---|
| 1 | **Printing stopped after the first page**: the app's `html`/`body` are a fixed-height, non-scrolling frame; print never undid that. | Print rules reset height and overflow (and the background) while a material prints. Checked: a long manuscript prints over five A4 pages. |
| 2 | **Moving a part remounted it** (and every part in its phase): the parts were wrapped per phase, keyed by the phase's first part, so a move closed the part's options and dropped keyboard focus. | Parts are siblings keyed by their own id again; where a phase begins is marked on its first part (space, rule, name). Test: a moved part is the same element and keeps focus on *Move up*. |
| 3 | **Question numbers differed** between the group's sheet, the leader's version and the leader's guide when a question had notes but no wording yet. | Only worded questions are numbered, everywhere; the rest stay with the leader, unnumbered. Test. |
| 4 | A web view that never reports the end of printing left Print unable to print again. | Each click is a new print request. Test. |
| 5 | The print test's own checks ran inside the mocked dialog, where a failure would have been caught. | What was printed is recorded and checked afterwards. |
| 6 | Back from preparing a teaching, the study still offered to prepare one. | The list is read again on returning to the study. Test. |
| 7 | A study without an outline still had phase spacing and unnamed groups. | Nothing of the phases shows unless the outline does. |
| 8 | The marked phase did not follow folding or pasting. | Also measured when the study changes size (one frame at a time). |
| 9 | In a narrow pane the outline's hidden scrollbar hid later phases. | A thin scrollbar. |
| 10 | A name typed with another extension (`Sermon.txt`) could replace `Sermon.txt.md` without the dialog having asked. | Refused with the existing "a file named … already exists" message. Rust test. |
| 11 | A line of the person's own starting `#`, `-`, `>` or `1.` became Markdown syntax. | Escaped, so words stay words. Test. |
| 12 | Unused strings left over. | Removed from all six languages. |

Verified fine by the review: phases never reorder; group sheet holds no
leader content by default; the worksheet never shows answers to listen for or
what a teacher needs; Materials offered by kind; the presentation is not
duplicated; the sheet stays white in Dark; the Rust guard, atomic write and
main-window-only permission; German *du* and Korean particles.
