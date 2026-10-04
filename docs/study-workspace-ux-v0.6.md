# Study Workspace UX Simplification (v0.6, Phase 1)

Status: in review. Branch `feature/study-workspace-ux-v0.6`, not merged.

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
- **Contents line** (Findings plus sections) remains, smaller and quieter,
  and only appears when a study has three or more entries.
- **Project page**: project title and studies first; "New study" button when
  studies exist (form hidden until asked, focus returns to the button when
  put away); in an empty project the creation prompt is shown directly.

## What did not change

No schema, migration, API, StudyType/Template, status, description, details
JSON, passage role, relation or finding concept was removed or merged. The
simplification is in the interface only.

## Deferred

Redesign of Findings and Sections (Phase 2), including a better contents
line and how findings relate to sections, is deliberately not part of this
milestone.
