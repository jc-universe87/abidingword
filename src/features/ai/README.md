# AI

Since v0.16 the assistant exists, and stays optional: every feature of
Abiding Word works fully without it.

- Its interface is part of Teaching Preparation: `src/features/teaching/`
  (`AssistMenu`, `AssistPanel`, `TeachingField`) and Settings →
  `src/features/settings/AssistantSettings.tsx`.
- Provider access, keys, the bounded context, prompts, research and images
  live in the native core, `src-tauri/src/assistant/`, never in the frontend.

See `docs/teaching-preparation-v0.16.md` and `docs/architecture.md` §23–27.
