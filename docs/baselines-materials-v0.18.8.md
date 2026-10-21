# Baseline structures and Teaching Materials (v0.18.8)

This version strengthens the central flow, **Bible Study → Bible Teaching →
Materials**, without prescribing a method. The built-in templates are
**starting points, not rules**: the person can save any of them as their own
and change it freely. The owner will refine the baselines later. They are
data, so that refinement costs a resource edit and nothing more.

## 1. The baselines

### Where they live (all data)

| What | File | Translated text |
|---|---|---|
| Built-in Bible Study templates | `resources/templates/*.json` (one file each) | `studies.builtin.templates.<key>.*` in `src/i18n/locales/*/studies.json` |
| Built-in Bible Teaching templates | `resources/teaching-templates.json` | names: `studies.teaching.kind.*`; steps: `studies.teaching.starts.<kind>.<key>` |

A Study template file has `key`, `name`, `description`, `studyType`, an
optional `offered` (false: kept only for old studies, never offered), and
ordered `sections`. Each section has `key` (stable, `[a-z0-9-]`), `title`,
`guidance`, `phase` (one of the six or none), and `optional` (offered later
under *Add a part*) or `retired`.

A Teaching template entry has `key`, `kind` (the format) and ordered
`points`, each with a `key` and a step `kind`.

What is still code, deliberately:
* the default *Notes* part of a study without a template;
* which formats are points, questions or steps (`canvasShape`), the format's
  own semantics;
* the order of the quick choices on the new-study form.

Since v0.18.8 the "not offered" flag of the old teaching study is in its file
(`"offered": false`), no longer in a list in the code.

### Built-in Bible Study baselines

The v0.17 structures, unchanged except for one phase:

| Template | Starts with (phase) | Offered later |
|---|---|---|
| Passage | Text · Observations · Context (Text) · Meaning (Understanding) · Theology · Application | Structure, Key Words (Text) · Related Scripture, Open Questions (Understanding) |
| Word | Word · Occurrences (Text) · Semantic Range · Key Passages · Conclusions (Understanding) | Immediate Contexts (Understanding) · Theological Significance (Theology) |
| Topical | Question / Topic · Key Passages (Text) · Main Themes · Conclusions (Understanding) · Application | Biblical Context, Difficult Passages (Understanding) · Theology |
| Biblical theology | Theme (Text) · Old Testament · New Testament (Understanding) · Fulfilment · Synthesis (Theology) | Gospels, Epistles, Canonical Development (Understanding) |
| Systematic theology | Doctrine · Key Biblical Texts (Text) · Biblical Synthesis · Conclusions (Theology) · Application | Historical Theology, Confessional Witness, Alternative Positions (Theology) |
| Teaching preparation (retired, `offered: false`) | kept for studies made with it | — |

**The one change:** in a *word* study, *Key Passages* now belongs to
Understanding instead of Text. In a word study the key passages are read to
understand the word, and the old phase made the outline go back to Text
after Understanding. This affects new word studies only. Existing studies
keep the phase migration 0013 gave them.

No template uses every phase. None is padded to complete the sequence.

### Built-in Bible Teaching baselines

The v0.17 structures, unchanged:
* **Sermon, Talk, Youth, Other:** main points between an introduction and a
  conclusion, starting with no points. No "three points" or any other
  sermon shape is imposed.
* **Group Bible study:** questions, each with where it may lead and
  follow-up questions, between an opening and a closing; it starts with no
  questions.
* **Children:** Welcome (teaching) · Bible story (Bible reading) · Question
  · Activity · Prayer (teaching).
* **Lesson:** Teaching · Discussion (question) · Activity.

### Deliberately not decided

The owner will refine these baselines later. This version does **not**:
* give sermons or talks starting points;
* add questions to the group study baseline;
* change any Study template's parts or guidance (beyond the one phase above);
* add new templates;
* decide denominational or hermeneutical defaults.

### Refining a baseline later

1. Edit the JSON resource (parts, order, phases, guidance, steps).
2. Add or adjust the translations in the six `studies.json` files.
   `npm run i18n:check` and `tests/ui/baselines.test.tsx` show what is
   missing.
3. Nothing else. No schema change and no migration are needed. Built-ins are
   reinstalled from their files at startup, and only new work is shaped by
   them.

**Existing work never changes.** A study or teaching copies its template's
structure when it is made. A person's own copy of a built-in is a separate
template and does not follow later changes to the built-in. This is tested
in `tests/ui/baselines.test.tsx`.

## 2. Previews

Where a template is chosen, one quiet line says what it starts with. The
line is built from the template's own parts by one function per kind, so a
preview can never say something the template does not:
* `studyStartSummary` for studies ("Starts with: Text · Observations ·
  Context · Meaning · Theology · Application.");
* `startSummary` for teachings (the format, then "Starts with: Welcome ·
  Bible story · …").

It appears:
* on the new-study form, under the choice, once the templates are loaded (so
  it never names a part a study will not have);
* in Settings → Templates, for every Study and Teaching template, built-in
  or the person's own;
* on the new-teaching form.

## 3. From a study to a teaching

*Prepare a Bible Teaching*, at the end of a study or on its Bible Teaching
side, opens one form. There is no wizard:
1. **What would you like to prepare?** Choose the format: Sermon, Group
   Bible study, Youth, Children, Lesson, Talk or Other.
2. **Start from** appears only when the person has their own templates for
   that format. It lists the built-in one ("Sermon (built-in)") and those
   templates. A template is offered only for the format it states it is
   for; its format is never guessed from its name. Without such templates,
   nothing more is asked.
3. A title (suggested), then **Start**.

The template's points become the teaching's own, and nothing links them
afterwards. The study is not changed.

## 4. Materials

Materials stay **derived** from the Bible Teaching: the manuscript or guide,
the question sheet (group and leader versions) and the worksheet or
listening notes. There is no second, editable copy. To change a material,
the person changes the teaching.

### One material model, every way out

```
Bible Teaching ──derive()──▶ material document (blocks)
                               ├── preview on screen
                               ├── print / save as PDF
                               ├── Markdown file and copied text
                               └── Word document (.docx, written by the core)
```

`derive()` (`src/features/materials/derive.ts`) is the only place content is
chosen. Every renderer draws its blocks one by one:
* question numbers are part of the model, so Word, Markdown and print never
  renumber;
* verse numbers ("16", or "4:1" where a chapter begins) are worked out once,
  in the model;
* the leader's version is a different model, chosen by the leader option.
  No renderer decides what is private.

### Include Bible passage

**Offered on:** the manuscript or guide, the question sheet (both versions)
and the worksheet or listening notes, whenever the teaching names a passage.
It is off by default and is a choice made per view. It is not remembered,
because there is no material preference store to put it in, and none was
invented for this.

**Which Bible:** the passage is read from the Bible chosen in the Scripture
pane, named on the option ("Include Bible passage (BSB)"). With no Bible
chosen, the option is shown disabled, with a note on what to do.

**Which passages:** the teaching's own passages, in their order. A point's
passage and the study's related passages are not added.

**Only that Bible, never another.** The core command `material_scripture`
(`db::bibles::material_passages`):
* reads only the chosen Bible;
* checks each passage against the canon's verse counts;
* names every verse that Bible lacks (*"The LUT has no text for verse 15:2;
  it is left out, not taken from another Bible."*);
* says plainly when it has no text for the passage at all, and keeps the
  reference.

Nothing is fetched from the internet, and nothing is filled in.

**Formatting:**
* verses appear in order, with superscript numbers, as one block set apart
  from the teaching's own words (a quiet rule on the left);
* the label is the reference plus the Bible's short name;
* if the Bible has a copyright or licence notice, it appears under the last
  passage;
* paragraphs are not invented, because the verse store has none, and Psalm
  titles are not included.

**Your Bible stays yours.**
* The text of an imported Bible goes only into the material the person makes
  for their own use, on their own computer.
* Nothing is uploaded, published or shared by the app, and no Bible text is
  bundled beyond the free texts already shipped.
* A saved file is the person's file. The app makes no claim about whether it
  may be passed on.

### Word documents (.docx)

**Save as a Word document…** sits beside *Print or save as PDF…*, *Save as a
text file…* and *Copy the text*.

**How it is written:** the core writes it (`src-tauri/src/materials/docx.rs`).
* It is a minimal OOXML package: content types, relationships, the
  document, named styles and core properties.
* It uses the `zip` crate already in the project; there is **no new
  dependency**.
* It needs no Word, no LibreOffice and no Python, and works offline.
* It is deterministic: the same material gives the same bytes.

**What goes in it:** real, editable structure.

| Block | In Word |
|---|---|
| title | style *Title* |
| reference line | *Bible reference* |
| passage text | *Label* (reference · Bible) + *Scripture* (superscript verse numbers) + *Note* for what is lacking and the notice |
| notice ("leader's version, not for handing out") | *Notice* (ruled on the left) |
| central message | *Label* + *Message* |
| heading | *Heading 1* (in Word's navigation; the step kind after a "·") |
| text | *Normal*, line breaks kept |
| field | *Label* + *Normal* |
| question | *Question*: "1.⇥text", the model's number, not Word list numbering, kept with what follows |
| room to write | three ruled *Writing line* paragraphs (still editable) |
| room to draw | one framed table cell that does not split across pages |

Headings, labels and questions keep with the next paragraph, so pages do not
break right after a heading.

**Saving** follows the same rules as the Markdown file (`chosen_path` and
`save_chosen` in `commands/materials.rs`):
* `.docx` is added to a name without it;
* a file is replaced only when it is the very one the save dialog named and
  asked about (adding the extension never replaces someone else's file);
* the file is written completely before it takes the old one's place, and
  nothing is left behind on failure;
* errors are plain ("Please choose where to save the file.", "A file named …
  already exists.").

**What it is not:** a Word-template designer, or a pixel copy of the
screen. Fidelity in Microsoft Word itself is to be confirmed in Windows
acceptance. The tests check the package and its XML, not Word's rendering.

### Per material

| Material | In it | Never in it |
|---|---|---|
| Manuscript / leader's guide / teacher's guide | everything the teaching holds, in its order; the passage text if chosen; personal notes only when *Include my notes* is chosen | — |
| Question sheet (group) | title, reference, passage text if chosen, the questions word for word with room to write, the opening and closing only when chosen | where a question may lead, follow-up questions, notes for leading, what the group should discover, personal notes |
| Question sheet (leader's version) | marked as the leader's at the top; all of the above, with the leader's notes in place of room to write | personal notes |
| Worksheet (lesson) | the one thing to remember, questions and activities with room to write or draw, Bible readings named | answers to listen for, what an activity needs, teacher's notes |
| Listening notes (sermon, talk) | the points in order with room under each, room for the listener's own notes | the explanations, applications and illustrations, personal notes |

## 5. Save as my template

This was rechecked now that Materials matter more. It still keeps
**structure only**. It copies no passage, Scripture text, writing, answers,
notes, citations or material choices, and no exported files. Material
choices (leader's version, include passage, notes) are view choices, never
stored with the teaching, so they cannot become structure.

## 6. Deferred

* `.awstructure`, a file to share Study and Teaching templates, is designed
  (docs/user-templates-v0.18.7.md) and deliberately not built.
* Remembering material choices per teaching or per person.
* Paragraphs and Psalm titles in passage text.
* Word-specific styling choices, page numbers and headers.
* A PDF written by the core (macOS has no print in its web view).

## 7. Tests

**Baselines** (`tests/ui/baselines.test.tsx`):
* files parse, keys are unique and stable, phases are valid, kinds are
  known, every language has the text;
* no forced phases;
* previews come from the data;
* a changed baseline shapes only new work and leaves existing studies,
  teachings and personal copies alone;
* Study → Teaching: format first, matching personal templates only, the
  study unchanged.

**Passage text:**
* `src-tauri/tests/material_scripture.rs`: the bundled Korean and German
  Bibles, verse order across a chapter break, a long passage, lacking verses
  named, no other Bible used, an unknown Bible refused;
* `tests/ui/material-scripture.test.tsx`: on and off, only the teaching's
  own passage, the pane's Bible only, honest notes, long passages.

**DOCX** (`src-tauri/tests/material_docx.rs`), on the golden documents in
`src-tauri/tests/fixtures/materials/documents.json`. These are kept equal to
what `derive()` makes by `tests/ui/material-docx-fixtures.test.ts`, so the
Word tests always use the real model. They check:
* the package and well-formed XML;
* all the model's text in order and no other words;
* nothing for the leader on group sheets;
* the model's question numbers;
* the Scripture block;
* Korean and German text;
* a long multi-page manuscript, whole;
* saving that replaces only what was asked and leaves no part-written file.

**Consistency** (`tests/ui/materials.test.tsx`): the Word save sends the very
document the preview shows, and Markdown carries the same text and numbers.
