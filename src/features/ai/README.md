# AI (not in Foundation v0.1)

Intentionally empty. AI assistance is a later phase and must stay optional:
every feature of Abiding Word has to work fully without it.

When it arrives, UI for AI features lives here, and provider access goes
through the native core (`src-tauri/src/integrations/`), never directly from
the frontend. See `docs/architecture.md`, "Extension points".
