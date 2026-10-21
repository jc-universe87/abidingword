# User-designed templates (v0.18.7)

A template is a **starting structure**. It is copied into new work when that
work is made, and is never linked to it afterwards. A template is never a
workflow: every part, point and step can be worked on in any order, renamed,
moved or removed later. This version lets the person design their own
templates for Bible Study and Bible Teaching, save the structure of existing
work as a template, and makes the phases of a study come from the study's own
structure rather than from rules in the interface.

Three things are called templates. They stay separate:

| | Bible Study template | Bible Teaching template | Church template |
|---|---|---|---|
| What it holds | ordered parts: heading, guidance, key, phase, "add later" | format, and the points, questions or steps a teaching starts with (with step kinds) | the look of slides: colours, fonts, layouts, logo |
| Where it lives | `study_templates` (built-in and own) | own: `teaching_templates`; built-in: `resources/teaching-templates.json` | `presentation_templates` |
| Where it is managed | Settings → Templates → Bible Study | Settings → Templates → Bible Teaching | Presentation → Church templates |
| Where it is used | New study ("What would you like to study?") | New teaching ("What would you like to prepare?") | a presentation |
| File | none (deferred, below) | none (deferred, below) | `.awtemplate` |
| Korean | 공부 틀 | 가르침 틀 | 교회 서식 (unchanged) |

## Data model

### Bible Study templates (extended)

`study_templates.definition` stays `{"sections": [...]}`. Each section now has
an optional **`phase`**: `text`, `understanding`, `theology`, `application`,
`audience` or `teaching` (`StudyPhase` in `src-tauri/src/domain/studies.rs`,
`STUDY_PHASES` in `src/types/studies.ts`). A part may have none.

A study copies each part's phase into **`study_sections.phase`** (migration
0013), next to its key. The study's outline is drawn from those copies only.

* Built-in templates say a phase for every part
  (`resources/templates/*.json`). The values are those v0.18.6 derived from
  key and kind of study, so nothing changes on screen. Example: `structure` is
  `text` in a passage study and `teaching` in the retired teaching study.
* The person's own parts get a stable key `own-<random>` when made in the
  template editor or by "Save as my template". The key never matches a
  built-in key, and gives the part no meaning: it only lets a study tell that
  a suggested part is already there. Two parts of one template can never
  share a key: the core refuses it (`templates.duplicateKey`).
* A part added to a study from the template's parts for later brings its key
  and phase (`CreateStudySection.key`, `.phase`). A part with the person's own
  heading brings neither. A key is at most 64 lowercase letters, digits and
  hyphens (`validate::part_key`, also for Teaching template points). A study
  never has two live parts with one key (`sections.duplicateKey`).
* The parts offered for later come from the study's template as it is now.
  When a study's own template has been deleted, nothing is offered in its
  place. It never falls back to a built-in template, whose parts would bring
  meanings the study never had.
* A part's phase can be changed in the study (part options → "Outline"), via
  `study_section_update` (`phase: ""` clears it). Renaming keeps it.

### Bible Teaching templates (new)

Table `teaching_templates` (migration 0014): `id, name, description, kind,
definition, created_at, updated_at, deleted_at, revision`. `definition` is
`{"points": [{"key"?, "title", "kind"?}]}`.

* `kind` is the format (`sermon`, `bible_study`, `youth`, `children`,
  `lesson`, `talk`, `other`). It decides the canvas, as before: points,
  questions or steps (`canvasShape`).
* A point's `title` may be empty: a point to be named in each teaching.
* `kind` on a point is a step kind (`text`, `scripture`, `question`,
  `activity`, `image`). Audio is accepted by the core and kept when a
  teaching is saved as a template. It is not offered for new steps.
* `key` records the built-in starting step a point came from. While its
  title is that step's title in any language, or empty, it is shown in the
  interface language.
* At most 20 points: the same limit as a teaching's starting points. "Save
  as my template" says so, and does not save, for a teaching with more. The
  same goes for a study with no parts or more than 40.
* Commands: `teaching_template_list`, `_create`, `_update`, `_delete`
  (soft). They are granted to the main window only (`permissions/windows.toml`).

The **built-in Bible Teaching templates** are application text, not stored:
`resources/teaching-templates.json`, one per format, taken from the v0.17
starting structures. Children start with Welcome, Bible story, Question,
Activity, Prayer. A lesson starts with Teaching, Discussion, Activity. The
other formats start empty. Their titles are the `studies.teaching.starts.*`
keys in every language. To refine a baseline later, change that file and its
translations. No redesign is needed, and teachings already made are never
affected. Because built-ins are never in the database, nothing in the app or
the core can change them.

A teaching is made from a template by the existing `teaching_create`, with
the template's points as its starting points. Nothing records which template
was used, so editing or deleting a template never changes a teaching.

## Behaviour

### Built-in and the person's own

* **Built-in** (both kinds): listed with "Built-in", with one action, **Save
  as my template**. It makes the person's own copy in their language and opens
  it to be changed. A built-in Study template can't be changed by the core
  (`templates.builtinReadOnly`). A built-in Teaching template is not stored at
  all.
* **The person's own**: **Edit**, **Duplicate**, **Delete…** (with a
  confirmation that says work already made is not affected). Deleting is
  soft.
* **Use**: a template is chosen where work begins, in "What would you like to
  study?" and "What would you like to prepare?". The person's own Teaching
  templates appear there under "Your templates".

### The study outline (Part D)

`phaseRuns(sections)` in `src/features/studies/journey.ts` reads each part's
own phase. The v0.18.6 key and type maps are gone.

* A part **without a phase** never begins a phase. It sits with the part
  before it, without being given that part's meaning (its `phase` stays
  null). It is not an outline entry.
* A phase **met again later** (a template that reads the text twice, say)
  starts a run of its own where it stands. Its outline entry goes to its
  first place.
* The **order is the person's**. Nothing is moved into phase order.
* The outline shows only when the study has at least three different phases.
  A template without phases, or with too few, shows the study as plain parts.
* Phases are named in words, never shown by colour alone. A phase start also
  has a firmer rule and more space above it.

### Save as my template (Part H)

**From a study** (Study details → Copy → Save as my template). Kept: every
part, in order, with its heading and guidance as the person sees them (a
built-in heading in their language), its key and its phase. Also kept: the
kind of study. Not kept: writing, notes, findings, passages, details, purpose,
status, related studies. The form says this before saving. The study is
neither changed nor linked to the template.

**From a teaching** (About this teaching → Save as my template). Kept: the
format, the number and order of points, questions or steps, and each step's
kind. A lesson's steps keep their titles ("Welcome", "Game"), because they
name what happens. The points of a sermon and the questions of a group study
*are* the teaching, so they start untitled (`templateFromTeaching`). Not kept:
audience, purpose, central message, introduction, conclusion, notes,
explanation, application, illustration, passages, study findings, kept
material, presentations. The form says what is kept for its format, and what
is not.

### Add a step ▸ kind (Part K)

In a teaching in steps (lesson, children), **Add a step** opens a short menu:
Teaching, Bible reading, Question, Activity, Picture. The new step is of that
kind, and its fields are labelled for that kind. It is a real menu: Enter or
Space opens it on its first item, the arrow keys move, Escape closes it. Audio
is not offered.

### Materials (Part L)

Materials need nothing new from templates. They are derived from what the
teaching has. A step with no title and no writing is left out. A field with
nothing in it is left out. A group study whose questions are still untitled
has a question sheet that says it is empty. A sermon made from three untitled
points has an empty manuscript. Nothing is invented for a concept a custom
template leaves out. This is tested in `tests/ui/teaching-templates.test.tsx`.

## Examples

**A custom Bible Study template "Lectio".** Read slowly (Text) · Pray (no
phase) · What it says of God (Theology) · Live it (Application) · Read it
again (Text). A study made with it shows the outline Text · Theology ·
Application. "Pray" sits under "Read slowly" without becoming Text. "Read it
again" starts a second Text run where it stands.

**A custom Bible Teaching template "Youth evening".** Format Children; steps
Game (Activity) · Bible story (Bible reading) · *untitled* (Question). New
teaching → "Your templates" → Youth evening shows "Starts with: Game · Bible
story · Step 3." Start makes a lesson plan with those three steps.

## Data safety and migrations

* **0013 `study_phases`**: one new column. A damaged own template (not
  valid JSON, or a section that is not an object) is left exactly as it is,
  so it can never stop the upgrade. This is tested. Existing parts made from a
  built-in part get the phase v0.18.6 showed for them, by key and kind of
  study, in plain SQL. The person's own templates get the same phases inside
  their JSON, in the same order (`json_each` / `json_group_array`). Unkeyed
  parts stay without a phase. No text, block, note, key, id or position
  changes.
* **0014 `teaching_templates`**: one new table. Nothing existing changes.
* Both run in the usual migration transaction, after the verified backup the
  app makes before any migration.
* Tests: `src-tauri/tests/database.rs` (0013 backfill, own templates),
  `tests/migration_v14.rs` (a v12 database with real parts and a teaching,
  backup, second start), `tests/studies.rs` (phases from built-ins, add with
  key and phase, change and clear phase, editing or deleting a template
  leaves a study alone, duplicate keys refused), `tests/teaching_templates.rs`
  (CRUD, refusals, a teaching made from a template unchanged by its edit and
  delete).
* Stable ids are untouched. Built-in keys stay as they were.

## Accessibility

* Every reorder is done with **Move up** / **Move down** buttons named after
  the part ("Move Bible story up"). Focus stays with the moved part's arrow,
  or the other arrow at the top or bottom. Nothing is drag-only.
* Rows keep one identity while they move (no remount), so a field being typed
  in never loses its place.
* The phase select is labelled "Where part 2 belongs in the study outline"
  (template) or "Where Application belongs in the study outline" (study). The
  step kind select is "Kind of step: Game".
* Targets are at least 44 px (`min-h-11`, `size-11`) in the study and
  teaching. The template editors keep the Settings field size (40 px) with
  44 px buttons.
* Choices of template are radio buttons in a fieldset ("What would you like to
  prepare?"). The description of the chosen one is tied to it with
  `aria-describedby`.

## Terminology (all six languages; German "du")

| English | German | Korean | French | Spanish | Portuguese |
|---|---|---|---|---|---|
| Save as my template | Als meine Vorlage speichern | 내 공부 틀로 저장 / 내 가르침 틀로 저장 | Enregistrer comme mon modèle | Guardar como mi plantilla | Salvar como meu modelo |
| Bible Teaching template | Vorlage für eine Bibellehre | 가르침 틀 | modèle d’enseignement | plantilla de enseñanza | modelo de ensino |
| Your templates | Deine Vorlagen | 내 가르침 틀 | Vos modèles | Tus plantillas | Seus modelos |
| Outline (phase) | Im Aufbau | 흐름 | Dans le plan | En el recorrido | No percurso |
| Not in the outline | Nicht im Aufbau | 흐름에 넣지 않음 | Hors du plan | Fuera del recorrido | Fora do percurso |
| What would you like to prepare? | Was möchtest du vorbereiten? | 무엇을 준비할까요? | Que voulez-vous préparer ? | ¿Qué quieres preparar? | O que você quer preparar? |

No words like schema, instance, definition or clone appear in the interface.
In Korean, 템플릿, 프로젝트, 섹션 and 블록 are not used for these. Native
review of the new strings is left for the language pass (docs/i18n.md).

## Portability (Part M): deferred

A file for Study and Teaching templates is not in this version. It would be
small: one JSON document with a version number and a list of structures, with
no assets. But it needs an import review for keys colliding with templates
already there, and a decision on whether built-in keys survive import. It
must **not** reuse `.awtemplate`, which is the church (presentation) template
package. The planned name is `.awstructure` (JSON), with
`{"format": "abiding-word-structure", "version": 1, "studyTemplates": [...],
"teachingTemplates": [...]}`. On import, every own key would be re-made
(`own-*`), so nothing could collide.

## Independent review

The review found no high-severity issue. Every finding was fixed and is
tested where it can be:

* the 0013 upgrade no longer aborts on a damaged own template, and keeps
  part order explicitly (`json_group_array(... ORDER BY idx)`);
* "Save as my template" states the limits (20 points or steps; 1–40 parts)
  rather than failing;
* focus goes back to the toggle when either save form closes, to *New
  template…* after a delete, and to *Delete…* when a template is kept; after
  removing a part in an editor it goes to the next part;
* Add a step gives focus back to itself when adding fails;
* a part's phase shows at once, and only the latest answer is applied;
* the phase select in a study is 44 px, as are the template editors'
  arrows;
* "Save as my template" in Study details sits after the Duplicate panel;
* the core checks keys (format, length, one per study);
* no built-in parts are offered to a study whose own template was deleted;
* the read-only refusal says "Save as my template";
* the "not kept" sentence was reworded;
* audio step kinds are kept;
* the unused `STARTING_STEPS` copy is gone;
* the new-teaching form says when your templates can't be loaded.

## Limitations

* Study template parts can't be duplicated one by one in the editor. Add a
  part and type its heading.
* Which template a teaching came from is not recorded. This is deliberate,
  since nothing links them.
* The built-in Teaching baselines are the v0.17 structures. Refining their
  contents (for example a sermon starting with three points) is the owner's
  call, and a change to `resources/teaching-templates.json` only.
* "Use" is not a button in Settings. A template is used where work is begun,
  where the study or teaching it goes into is known.
