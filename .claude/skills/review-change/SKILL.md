---
name: review-change
description: Review an actual source diff for unintended deletions, functional regression, evidence, security, data preservation, UX, accessibility and translation completeness.
---

# Review an implementation without assuming it works

Require an actual base version and changed revision. Inspect diff and referenced tests/logs, not a summary alone. Review source preservation, scope drift, credentials/privacy, data migration, task authority gates, i18n coverage, accessible states, non-technical-user UX, and documentation accuracy. Run permitted checks when available; report unrun checks explicitly.

Output: **blockers**, **non-blocking findings**, **verified tests**, **unverified areas**, **recommended next action**. Use file/line references when available. Never merge, deploy, use paid inference or change production without the applicable approval.
