# Study Workspace Refinement (v0.10)

Status: in review. Branch `feature/study-workspace-refinement-v0.10`, started from `main`
(`0a18c2b`), not merged. No database migration, no backend change.

## Where this stands

The large Study simplification **shipped in v0.6** ([study-workspace-ux-v0.6.md](study-workspace-ux-v0.6.md)):
one-question creation, a quiet header with a "Study details" disclosure, one Add
action, notes in the flow, a compact Contents. v0.10 is not a redesign. A code
audit after v0.6 found what was left, and this milestone refines exactly that, so
the workspace is quieter, clearer, easier on older users and less exposed to the
data model. Findings, blocks, sections, passages, relations, templates and
projects are all unchanged; only what is shown, and when, changes.

## What v0.10 refines

| Left after v0.6 | Now |
|---|---|
| Projects were the first screen | The Study pane starts on **Studies**. See "Projects" below. |
| A passage title and its passage chip repeated each other | Shown once. See "Passage line". |
| The study type was always in the header | Only in Study details. |
| Details mixed everything | Grouped: About this study, Passages, Related studies, Copy. |
| Add had two homes (study and section) | One **Add**: Note, Section, Text block. |
| "Note" meant three things | The Note text block is now **Remark**. |
| Note capture showed ten kinds, section and link at once | Four common kinds, **More types**, **Options**. |
| Findings sat apart from the section they belong to | Shown in their section; the rest under **Study notes**. |
| Hover-only block controls; hover-only edit cues | One visible "…" per block; a resting underline on editable text. |
| Small targets and text; viewport breakpoints in a resizable pane | 44px targets, 15px secondary text, container queries. |
| Every list row said Active; three filters always | Status only when not Active; filters from six studies; Show archived. |
| The relation picker was a sentence with five technical kinds | Choose a study; how they relate is one step further. |

## Product decisions

### Projects: optional, never a prerequisite

Projects remain (an advanced way to organise studies); nothing is removed, merged
or migrated. The rule for where a new study goes is deterministic
(`src/features/studies/projects.ts`):

1. **No project:** one is made when the first study is created, named "My studies"
   (in the interface language: Meine Bibelstudien, 내 성경공부, Mes études, Mis
   estudios, Meus estudos). Two quick creations never make two.
2. **One project:** that one, without showing it. The pane reads "Studies" and the
   way back from a study is "Back to Studies"; "Organise in projects" opens the
   project list for someone who wants it.
3. **Several projects:** the project list stays at the start with New study. A new
   study goes into the project last worked in on this device (kept in browser
   storage, never study data) if it still exists; otherwise the project of the most
   recently changed study (ties: smaller study id); otherwise the first project by
   title. Inside a project, New study creates in that project, as before.

### Passage line

Decided by the study alone, never by what Scripture happens to show (so the pane
means the same when panes are moved or detached). If the title is, in effect, the
primary passage (case, dash and spacing ignored: "John 15:1–11" for John 15:1–11)
the passage is not repeated beneath it; an **Open in Scripture** action remains.
If the title differs ("The True Vine"), the passage is shown compactly beneath it.
The title edit updates this straight away.

### Study details

Grouped, nothing removed: **About this study** (type, a quiet "changed" and count
line, status, purpose, kind-specific fields), **Passages** (make primary, remove),
**Related studies** (link, remove), **Copy** (duplicate). A built-in template is
never named; a user's own template is: "From your template: Wednesday Bible Study".

### One Add

The study has one **Add** button. Its choices are **Note** (a finding), **Section**
and **Text block**, which opens its kinds (Paragraph, Remark, Heading, Quotation,
Question). A new study shows the choices open once, with "Start your study"; after
writing it is the one button. A text block goes into the section last worked in
(the one with the cursor), else the last section, and the choice says which
("In Context:"). The per-section "Add…" is gone. Escape closes the kinds, then the
menu, returning focus.

### Remark: the Note block's new name

"Note" meant a finding, a text-block kind and a Scripture note. The user-facing
word for the **text block** changes; stored values do not (`blockType: "note"` is
unchanged). Chosen so it is distinct from both other meanings in every language:

| | EN | DE | KO | FR | ES | PT |
|---|---|---|---|---|---|---|
| Remark (text block) | Remark | Bemerkung | 참고 | Remarque | Comentario | Comentário |
| Study note (finding, in Add) | Note | Eintrag | 기록 | Élément d’étude | Apunte | Registro |
| Scripture note | Note | Notiz | 메모 | Note | Nota | Nota |

Reasons: *Bemerkung* avoids *Notiz* (Scripture notes) and *Anmerkungen* (Marks);
*참고* ("for reference") is how Korean documents mark an aside, and avoids 메모
(Scripture notes) and 기록 (findings); *Remarque* is not *Note*; Spanish and
Portuguese avoid *Observación/Observação*, which is a finding kind, so *Comentario/
Comentário*. "Aside" and "Comment" were rejected: "aside" has no natural German or
Korean equivalent, and "comment" suggests review comments.

### Note capture

Observation, Interpretation, Application and Question are shown as a row of choices
(a radio group, arrow keys move). The other six kinds are under **More types**; the
ten kinds are unchanged. The last kind used is remembered **per study** on this
device (`localStorage` key `study.lastFindingType.<studyId>`; no schema change); a
remembered less common kind stays on show. The section and "link the passage being
read" are under **Options**, shown only when there is a section or a passage; a
study-wide note needs no choice. Ctrl/Cmd+Enter saves; Escape closes Options, then
the capture.

### Findings in sections

Presentation only. A finding with a section is listed after that section's writing
("Notes in Context"); a finding without one, or whose section no longer exists, is
under **Study notes** (shown only when there is one, or a note is being written).
Order is the study's order everywhere; Move swaps within what is shown together and
leaves the other findings in place; the kind filter (six or more findings) narrows
both. Rendering changes no record.

### Editing and controls

Editable title, note text and block text have a resting underline (visible before
hover, in light and dark through the tokens). Each block has one visible "…" button
(options: move up/down, delete with a question), not a hover-only cluster; Escape
closes it and returns focus.

### Size and pane-aware layout

Primary controls are at least 44px (Add, Details, passage chips, capture actions,
menus, destructive actions) and secondary text is 15px, not 14px. Inside the Study
pane layout follows the **pane's** width (`@container` on the pane, `@md:`
variants), not the window's; a test guards against viewport breakpoints returning.

### Study list

Filters (project, type, status) appear from six studies, or while one is in use.
A row says its status only when it is not Active. Archived studies are hidden with
a quiet "Show archived (N)" and shown on request or when chosen as the status
filter; nothing about the backend query changed.

### Relations

Linking asks only for the study ("Related study"). **Describe the relationship** (one
step further, Escape steps back) chooses Related to, Continues, Contrasts with,
Supports or Linked to. Stored relation kinds are untouched.

### Templates and status

Built-in templates are invisible after creation; the creation approach row is the
only place they show ("Passage study", "Word study", "Topic", "Teaching
preparation", "My template"). Settings → Study templates is unchanged. Status stays
in the model: changed in Study details, shown in lists only when not Active.

## Known remaining limitations

- The study's own Add is at the top; in a very long study the reader scrolls up.
- A text block can only be added to a section (that is where blocks live).
- Titles equal to a passage in another language than the interface ("Joh 15,1–11")
  count as different, so the passage is shown beneath.
- With several projects the project list is still the start of the pane.
- Dark mode uses the existing tokens; no new colours were introduced, but it has
  not been reviewed on a real Windows display.

## Windows acceptance checklist (after merge to `main` and the automatic test update)

1. In an empty workspace create the first study: no project asked for; "My studies"
   exists in Projects.
2. Create a passage study ("John 15:1-11"): the title is the passage and it is not
   repeated; "Open in Scripture" works.
3. Create a Topic study ("Forgiveness").
4. Give a study a title that differs from its passage ("The True Vine"): the passage
   shows beneath it.
5. Open Study details: grouped as About, Passages, Related studies, Copy; no
   template named (unless it is your own).
6. Add an Observation; add another and choose More types.
7. Add a section; add a note into it (Options → section); add a study-wide note: it
   sits under Study notes.
8. Add a Remark from Add → Text block.
9. Narrow the Study pane: capture and details rows stack; nothing is cut off.
10. Keyboard only: Add, Details, edit a note, a block's "…" menu, Escape each time.
11. Dark mode: underlines, muted text and focus rings are visible.
12. Switch the interface to English, German and Korean: wording, "My studies", Remark.
13. Archive a study: it leaves the list; "Show archived (1)" brings it back.

## Tests

`tests/ui/study-refinement.test.tsx` (new) and `tests/ui/projects.test.tsx`
(rewritten) cover the above; existing study, findings, library-citation, Scripture
and layout tests were updated only where a label or first screen changed. Autosave,
duplication, passage reveal, citations and every backend API test are unchanged.
