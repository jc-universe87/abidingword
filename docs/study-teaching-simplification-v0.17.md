# Study & Teaching Workspace Simplification — v0.17

> [!NOTE]
> **This is a technical record for developers.** To learn how to *use*
> Abiding Word, see the User Guide: [Studies](guide/04-studies.md),
> [Preparing to teach](guide/10-teaching.md) and
> [Settings](guide/08-settings-updates-backups.md#templates).

**Status:** built on branch `claude/beautiful-curie-vm0eve` together with the
last v0.16 corrections; not merged, not tagged, no test build yet.

This milestone is about the **mental model** of Bible Study, Bible Teaching
and Templates. It adds no unrelated feature. It changes one thing in the
database (an additive column, §8) and otherwise presents the same data
differently.

---

## 1. The old mental-model problems

Windows acceptance of v0.16 and the person's own questions showed:

1. **Too many nouns before any study.** A new passage study opened with nine
   template *sections*, a global **Add** offering *Note / Section / Text
   block*, a *Text block* sub-menu with five *block* kinds, a separate
   "Study notes" area at the top, a kind filter, and a **Contents** (German
   *Inhalt*) menu listing the same sections again. The person did not know
   what *Inhalt* was for (it was a jump list of a long study's sections).
2. **"Finding" (German *Erkenntnis*, later *Eintrag*) meant nothing.** It is
   the internal name of a typed, citable note. People think in observations,
   questions, interpretations, applications.
3. **Two overlapping ways to write.** A *block* could be a *quotation* or a
   *question*; a *finding* could be a *quotation* or a *question*. Which one
   to use was never obvious.
4. **Templates were checklists.** Nine or ten permanent parts (Passage study:
   Text, Context, Observations, Structure, Exegesis, Theology, Application,
   Audience, Teaching) before anything was written, two of them really about
   teaching.
5. **Teaching was a tab, not a kind of work.** There was also a *Teaching /
   Sermon* **study** type with its own template, competing with Bible
   Teaching. All teaching kinds shared one canvas with renamed labels.
6. **Chrome above the work.** Breadcrumb row, title, switch row, passage row,
   Add row: at 1366×768 the first writing began around y ≈ 490.

## 2. The new mental model

One sentence each:

- **Bible Study** — understand the biblical text.
- **Bible Teaching** — prepare to communicate it.
- **Templates** — reusable starting structures for either.

Everything else (sources, the assistant, Scripture panes) supports those.

## 3. Bible Study

A study is **its Scripture** (the passages line under the title, the Bible
pane beside it) and **an ordered outline of parts** written in normal
Bible-study language: *Text, Observations, Context, Meaning, Theology,
Application*.

Each part holds the person's **writing** and their **notes**, and ends with
its own **+ Add**:

```
Context
  These chapters are one long evening conversation…   ← writing
  Observation · "Already clean" (15:3)…              ← a note in this part
  + Add ▸ Writing · Observation · Question · Interpretation · Application · More types
```

- No generic noun is chosen first: **Add → Observation** writes an
  observation *in that part*. *More types* adds Quotation, Doctrine,
  Illustration, Teaching idea, Unresolved issue, Conclusion.
- **Writing** adds a paragraph to the part. New block kinds (heading,
  remark, quotation, question) are no longer offered: quotations and
  questions are notes. Existing blocks of every kind are still shown and
  editable exactly as before.
- Parts **fold** to their heading (the heading is the button; folded, it says
  "3 notes"). **Fold all** turns the study into an outline. Folding is
  remembered per study on this computer (`study.collapsed.<id>`), never in
  the study data.
- **Add a part** (end of the study) offers the parts the study's template
  keeps for later (§6) and a field for one's own heading. A suggested part is
  created with its title and guidance *in the interface language*, as the
  person's own text.
- Notes in no part are listed under **Other notes** after the last part.
  **Note** at the end adds one there.
- With six or more notes, **Show notes** (in the header line) narrows every
  part to one kind.

### What was removed or demoted (A3)

| Before | Now |
|---|---|
| **Contents / Inhalt** menu (jump list of sections, plus "Study notes") | Removed. The parts are headings in the study; **Fold all** gives the outline; keyboard and screen-reader users move by heading as before. Nothing it pointed to was removed. |
| Global **Add → Note / Section / Text block → 5 kinds** | **+ Add** in each part; **Add a part** and **Note** at the end |
| "Start your study" prompt | The parts' guidance and "Write here…" say it |
| "Study notes" area at the top | **Other notes** at the end, only when there are some |
| Kind filter above the notes | **Show notes** in the header line |
| Note label "Observation · Context" inside Context | "Observation": the part is the heading it sits under |

## 4. Notes (the finding model)

The `findings` table, its kinds, passages, tags, **source citations with
quotes (v0.15)** and **teaching links (v0.16)** are unchanged. What changed
is the *user-facing* concept:

- The word *finding* is gone from the interface. English says **note**;
  German **Notiz**, Korean **기록**, French **note**, Spanish **apunte**,
  Portuguese **anotação**. Where possible no generic noun appears at all: the
  person sees *Observation*, *Question*… as the kinds of their notes.
- A note belongs to a **part** (`section_id`) or to none (**Other notes**).
- "Study entry / Studieneintrag" is no longer shown as a noun.

## 5. Study organisation: the audit

| Structure | What it is for | v0.17 treatment |
|---|---|---|
| `study_sections` | The study's ordered outline (the parts) | Shown as **parts**, foldable, each with its own Add |
| `study_blocks` | Free writing inside a part | Shown as writing; new ones are paragraphs only |
| `findings` | Typed, citable, reusable notes (provenance, teaching links) | Shown as **notes** in their part or under Other notes |
| `study_templates` | Starting outline for a new study | Small built-ins with optional / retired parts (§6) |
| primary / related passages | What the study is about | The passages line; the main one is changed in Study details |
| source links (v0.15) | Where a note's quote came from | Unchanged |
| study type | Kind of study, chooses the default template | Unchanged; the *teaching* type is no longer offered for new studies |

**Questions answered.**

- *What is a part for?* To give a study a shape the person can scan and
  fold — an outline of where things belong.
- *Block versus finding?* Writing (blocks) is the person's prose; notes
  (findings) are typed, citable, movable units that Bible Teaching can
  reuse. Both stay; the overlap (quotation/question blocks) is no longer
  offered for new writing.
- *Why are some things template sections and others findings?* Sections are
  structure; findings are content of a kind. The UI now presents findings
  *inside* the structure.
- *Does the user need both?* Yes, but not as two concepts: a part simply
  contains writing and notes, and **+ Add** offers both.
- *A flexible ordered outline with structured entries?* That is exactly what
  the existing tables already express. No destructive schema change was
  needed, so none was made.

## 6. Templates

A template is a **reusable starting structure**.

**Bible Study templates** (built-in, in `resources/templates/*.json`):

| Template | Starts with | Offered later (*Add a part*) | Retired |
|---|---|---|---|
| Passage study | Text · Observations · Context · Meaning · Theology · Application | Structure · Key Words · Related Scripture · Open Questions | Exegesis · Audience · Teaching |
| Word study | Word · Occurrences · Semantic Range · Key Passages · Conclusions | Immediate Contexts · Theological Significance | — |
| Topical study | Question / Topic · Key Passages · Main Themes · Conclusions · Application | Biblical Context · Difficult Passages · Theology | — |
| Biblical theology | Theme · Old Testament · New Testament · Fulfilment / Consummation · Synthesis | Gospels · Epistles · Canonical Development | Teaching |
| Systematic theology | Doctrine · Key Biblical Texts · Biblical Synthesis · Conclusions · Application | Historical Theology · Confessional Witness · Alternative Positions | — |

`TemplateSection` gained two flags (serialised only when true):

- `optional` — not made with a new study; suggested under *Add a part*.
  A person's own template may mark parts **Add later** in the template editor.
- `retired` — built-in only, never offered. Kept in the definition so that
  studies made with it still show the heading and guidance **translated**:
  `builtinText.ts` translates a stored section only while its key and English
  title match a built-in definition, so deleting a section from the JSON would
  have turned an old German study's "Exegese" back into "Exegesis".

Rules (core `db/studies.rs`, `db/templates.rs`; mirrored in the test API):
a new study copies only the starting parts; duplicating a template drops
retired parts and keeps optional ones; a template needs at least one starting
part; the user's `optional` flag round-trips; `retired` cannot be set on a
user template.

The built-in **Teaching / Sermon** *study* template (`teaching-study`) is no
longer listed or offered (`RETIRED_TEMPLATES` in `StudyTemplates.tsx`) but
stays installed for the studies made with it. On the new-study form,
**Teaching preparation** now makes a *passage* study and opens its Bible
Teaching side (`studyView.ts`), so a teaching is always derived from a study.

**Bible Teaching templates** are the teaching **formats** (§7): each kind's
canvas and the steps a lesson starts with. Settings → Templates shows them as
a second group. Custom teaching templates are deferred (§13).

## 7. Bible Teaching

Study asks *what does this mean?*; Teaching asks *how will I communicate
it?*. A teaching belongs to a study and **reuses** its notes, passages and
sources by live link (v0.16); nothing is copied.

### Format-specific canvases (one shared architecture)

All kinds share `teaching_preparations` and ordered `teaching_points`. The
canvas shape follows the kind (`canvasShape`):

| Kind | Around the main part | Main part | Each item |
|---|---|---|---|
| Sermon, Youth, Talk, Other | Central message · Introduction · Conclusion | Main points | title · explanation · application · illustration |
| Group Bible study | What the group should discover · Opening · Closing | Questions | question · where it may lead · follow-up questions · notes for leading |
| Children, Lesson | The one thing to remember | Lesson plan (steps) | a **kind of step** and the fields that kind needs |

Steps of a lesson have a kind (`teaching_points.kind`, §8):

| Step kind | Fields shown |
|---|---|
| Teaching (`text`) | what you will say |
| Bible reading (`scripture`) | how you will read or tell it (+ passages) |
| Question (`question`) | the question · answers to listen for |
| Activity (`activity`) | how it works · what you need |
| Picture (`image`) | what it shows and when (+ found/made images, kept as material) |
| Audio (`audio`) | accepted by the core, not offered yet |

Rules (`labels.ts`: `pointFields`, `showsFrame`):

- A field a format does not use is hidden **only while empty**; writing is
  never hidden. A lesson has no separate introduction/conclusion (its welcome
  and ending are steps) unless one was written before.
- Changing the kind of a teaching or of a step only changes names and which
  empty fields show.
- A new teaching starts with the format's steps, **named by the interface in
  the person's language** and sent to the core (`CreateTeaching.points`):
  children — Welcome (teaching), Bible story (Bible reading), Question,
  Activity, Prayer (teaching); lesson — Teaching, Discussion (question),
  Activity. Sermons and group studies start empty.
- "About this teaching" (kind, audience, purpose, what the whole teaching
  uses) is open right after creation and folded afterwards. The central
  message's explanation is its placeholder, not a line above it.

## 8. Data compatibility and migration

**Migration 0009** (`0009_teaching_step_kinds.sql`): one nullable column,
`ALTER TABLE teaching_points ADD COLUMN kind TEXT`. Values validated by the
core (`STEP_KINDS`: text, scripture, question, activity, image, audio).

- Existing points get `NULL` and show exactly as before.
- The usual upgrade path applies: integrity check, verified **backup before
  any pending migration**, each migration in one transaction.
- `tests/migration_v9.rs` writes a v8 database by plain SQL (a study made
  with the old nine-part template, a note in its *Audience* part, a user
  template, a sermon with points and kept material), upgrades it, and checks
  the backup, every study part, block, note, template, teaching, point and
  material, and that no second backup is made.

Everything else is presentation:

| Old data | Shown as |
|---|---|
| A study with the old nine parts | Its nine parts, unchanged, still translated (retired parts stay in the definitions) |
| Remark / heading / quotation / question blocks | Shown and editable as before; not offered for new writing |
| Findings with a section | Notes in that part |
| Findings without a section, or whose section was deleted | **Other notes** |
| `teaching` studies | Open as studies with their parts; the type is not offered for new studies |
| v0.16 teachings | Same canvas for sermons; group studies get the new question labels; lessons show their (kind-less) points as steps with all fields |

No study, part, block, note, citation, template or teaching is removed or
rewritten.

## 9. Scripture first

The passages sit on the line directly under the title, beside the
Bible Study / Bible Teaching switch; every part, note and step can link a
passage; references typed in writing are still detected. With less chrome
(§11) the passage line and the first part are both visible at once, next to
the Scripture pane.

## 10. Sources, provenance and the assistant

- **v0.15 provenance is untouched**: Add to Study still records quote, place
  and source snapshot; notes still show their citations and open the source
  at the cited words. "Whole study" is now called **Other notes** wherever a
  place is chosen.
- **The assistant** stays secondary (the floating panel from v0.16). Its
  context now names the teaching's own structure — "Question 2", "Step 3
  (activity)", and per field "where the discussion may lead (leader's notes)",
  "follow-up questions", "what is said or done" — and labels each study note
  with the part it was written in ("observation, in “Observations”"). No
  autonomous generation was added.

## 11. Workspace height (A4)

At 1366×768 the first part's heading moved from y ≈ 435 to ≈ 305 and the first
writing from ≈ 490 to ≈ 350:

- the breadcrumb row became one **←** button beside the title (its label says
  where it goes);
- the passages share the line with the Bible Study / Bible Teaching switch and
  Study details;
- the global Add row is gone;
- part headings are slightly smaller with less space above them;
- touch targets stay at least 44 px in the Study pane (a test forbids less).

## 12. Final v0.16 corrections built with this milestone

- **Settings, first view quieter (A1):** explanatory text moved behind **?**
  in every section (updates, privacy/where text goes, the service address,
  future plans, SearXNG); what needs action stays visible (missing key,
  failed check, "cannot make images", image key missing, update available).
- **Real-story search providers (A2):** one abstraction in the core
  (`research.rs`: request builder, reply reader, per-service key name
  `assistant.search.<kind>`, `assistant_search_test`). Recommended: Brave
  Search, Tavily, Exa; advanced: SearXNG (self-hosted), SerpApi. Keys travel
  only in a header, except SerpApi which takes its key only in the address:
  the transport logs the host alone and never follows a redirect. A generic
  "other compatible search service" was not added: there is no common
  request format to target beyond SearXNG's. Wording never calls a story
  true: *Sources found…*, *Needs checking…*, *source quality varies*.

## 13. Future compatibility and deliberate deferrals

- **Inline media:** a lesson is already an ordered list of typed steps
  (`teaching_points.kind`); `audio` is reserved. Images attach to a step as
  kept material (v0.16). A step-level media attachment can be added without
  touching what people wrote.
- **Presentation** remains an output of Bible Teaching, not a peer
  workspace: export/create slides, present directly, audience and presenter
  screens — all later. Ordered, id-stable points and media kept out of the
  manuscript text keep both paths migration-free.
- **Deferred:** user-defined Bible Teaching templates (custom formats and
  starting steps); an "Add a step ▸ kind" menu (a new step starts as
  teaching and its kind is one choice away); reordering notes between parts
  by drag; the assistant inside Bible Study itself; audio steps.

## 14. Tests

- Rust: `tests/migration_v9.rs` (upgrade from schema 8, step kinds, starting
  steps, limits); `tests/studies.rs` (`built_in_templates_start_small_…`:
  start / optional / retired, copies, a template of only optional parts is
  refused); search providers in `assistant/research.rs` (every reply format,
  where each key travels); the assistant labels notes with their part.
- Interface: per-part Add, folding (remembered), Fold all, Add a part with
  suggestions and own headings, Other notes, no Contents menu; teaching
  formats (children's starting steps and step-kind fields, hidden-only-while-
  empty fields, group-study labels); Prepare a teaching → Bible Teaching side;
  Settings → Templates in two groups; search providers and Check search;
  quieter Settings.
