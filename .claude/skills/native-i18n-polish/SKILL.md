---
name: native-i18n-polish
description: Review Abiding Word's six UI languages for faithful, natural wording, key parity, accessibility, and current product terminology; follow docs/i18n.md.
---

# Native-language polish — Abiding Word

1. Read `docs/i18n.md` and the live language resources before editing. The canonical locales are **en**, **de**, **ko**, **fr**, **es**, **pt**. Portuguese is a single, neutral `pt` resource for Brazil and Portugal, not `pt-BR`.
2. Inspect the exact source UI string and the action or state it describes; preserve the user's mental model and established product terminology. The current workspace uses **note** and **part** where appropriate; do not restore superseded internal labels.
3. Review each of the six locale versions for native phrasing, consistent register, correct Scripture/book terminology, short understandable actions, plural grammar, accessibility text, and accurate error/empty/pending states.
4. Preserve every JSON key, interpolation placeholder, plural rule, punctuation necessary for code, and meaning. Do not add hard-coded English to UI components; do not drop untranslated strings to make the validator pass.
5. Run `npm run i18n:check`, the relevant TypeScript/tests/build checks, and inspect representative layouts when practical. A passing parity check alone does **not** establish native polish or usable layout.
6. Report concrete changed keys, any outstanding ambiguities, human review needs, and which checks actually ran. No merges or releases without the project-specific approval.
