# AI

Since v0.16 the assistant exists, and stays optional: every feature of
Abiding Word works fully without it.

- Its interface is part of Teaching Preparation: `src/features/teaching/`
  (`AssistMenu`, `AssistPanel`, `TeachingField`) and Settings →
  `src/features/settings/AssistantSettings.tsx`.
- Provider access, keys, the bounded context, prompts, research and images
  live in the native core, `src-tauri/src/assistant/`, never in the frontend.

See `docs/teaching-preparation-v0.16.md` and `docs/architecture.md` §23–27.

Since v0.20 the same assistant also helps with study and research
(`docs/research-assistant-v0.20.md`):

- `InquiryPanel.tsx` — the shared temporary panel: kinds of help, the
  preview of every block that would be sent, asking, points with their
  standing and checked quotations, wording as a diff, and keeping a note.
- `Comparison.tsx` — the passages put aside to compare (this session only).
- Its uses: `src/features/studies/StudyHelp.tsx` (a part of a Bible Study)
  and `src/features/library/SourceHelp.tsx` (a source passage, comparing).
- The core: `src-tauri/src/assistant/inquiry/`.
