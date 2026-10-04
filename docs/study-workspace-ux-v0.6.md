# Study Workspace UX Simplification (v0.6, Phase 1)

Status: in review (Phase 1 approved; Phase 2 below). Branch `feature/study-workspace-ux-v0.6`, not merged.

## Principle: the software should disappear

The Study workspace is for studying Scripture, not configuring software. The
screen shows what the person is studying (title, passage, their writing) and
keeps everything else one deliberate step away. Internals stay expressive;
the surface stays simple. This is progressive disclosure, not removal.

## What changed

- **New study** asks one question, "What would you like to study?". The
  answer is a passage (passage and teaching studies, read with the existing
  reference parser) or free text (word, topic, theology, custom). A row of
  approaches chooses how: Passage study, Word study, Topic, Teaching
  preparation; under "More options": Biblical theology, Systematic theology,
  No template, and "My template" (when the user has templates). A built-in
  approach uses its own built-in template, so there is no Template menu.
- **Titles** are derived deterministically: a passage's localized label
  ("John 15:1–11"), "John 15:1–11 — Teaching" for teaching, the typed text
  for word/topic. An explicit title (More options) wins. The title stays
  editable in the study.
- **Study header** is the editable title, a quiet line with the kind of study
  and a "Study details" toggle, the passage(s), and related studies only when
  there are some.
- **Study details** (one disclosure; Escape closes it and returns focus to
  its toggle) holds: kind and template, changed date, finding counts (when
  any), status, purpose (optional), type-specific fields (word: word,
  language; teaching: audience, length, format), passage management (make
  primary, remove), related-study linking and removal, and duplication
  (structure only / structure and content, unchanged).
- **Passages**: the primary passage is a plain link to Scripture; related
  passages sit beside it; "Related passage" adds another. Primary is only
  marked (for screen readers) when there is more than one.
- **Related studies**: no section when none; listed compactly when present;
  linking and removing are in Study details.
- **Autosave** is invisible when idle; "Saving…" and "Saved" appear
  briefly; errors stay on screen. Saving itself (SaveTracker) is unchanged.
- **Contents** is superseded by Phase 2 (below).
- **Project page**: project title and studies first; "New study" button when
  studies exist (form hidden until asked, focus returns to the button when
  put away); in an empty project the creation prompt is shown directly.

## What did not change

No schema, migration, API, StudyType/Template, status, description, details
JSON, passage role, relation or finding concept was removed or merged. The
simplification is in the interface only.

## Phase 2: the study's working area

Same principle, applied to what is under the header. Data model, backend and
templates are untouched; this is presentation only.

- **One Add action.** A new study (no findings, no writing) says "Start your
  study" and offers "Add note" and "Add section" side by side. Once there is
  writing it is a single "Add" that opens the same two choices (Escape closes
  it and returns focus). The bottom "Add section" button, the five quick-add
  finding buttons and the "More…" menu are gone. "Note" is the user-facing
  word for a finding here; each language uses its established term for a
  generic Finding (docs/i18n.md: Eintrag, 기록, élément d’étude, apunte,
  registro), not the word reserved for Scripture notes.
- **Write first, classify second.** "Add note" opens a text box first, with
  the kind (default Observation, an existing type), section and a "Link
  current passage" checkbox (unticked: linking is never silent) under it.
- **Findings in the flow.** No Findings area for a study without findings.
  Otherwise each note is its text, with its kind as a small label and any
  linked passages and cited sources beneath. Kind, section, tags, linking,
  adding sources, move and delete are under each note's **Details**
  (`aria-expanded`; Escape closes and returns focus). With six or more
  findings one "Show findings" menu narrows by kind; fewer need none.
- **Contents** is one quiet control, shown only for a study with five or
  more sections. It opens a short list (Findings only when there are some);
  choosing an entry scrolls to the section and moves focus to its heading;
  Escape closes and restores focus. No permanent link row.
- **Sections** are a calm heading and their writing. Rename, move and delete
  are under a section's "…" options; the block types are under one "Add…";
  a section's guidance shows only while it is empty. A section added from Add
  is scrolled into view and focused. Existing template sections and block
  content are unchanged.
- **Long titles** wrap in full (the title field is an auto-growing text area;
  Enter finishes it instead of adding a line). A study also opens at its
  title instead of inheriting the previous list's scroll position.
- **Related studies** with several entries sit in one wrapping line.

### Known limits (not done in Phase 2)

- Block-level move/delete icons inside sections still appear on hover/focus.
- The Add action is at the top of the study only; in a very long study the
  user scrolls up to add a note.
- "Empty study" and section guidance follow the saved content on load and
  update when the study is reopened, not while typing.
- Findings still appear above the sections rather than beside the section
  they belong to.
