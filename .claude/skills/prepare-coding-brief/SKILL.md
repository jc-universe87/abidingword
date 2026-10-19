---
name: prepare-coding-brief
description: Prepare a fully self-contained implementation brief grounded in the current repository, complete with open questions, acceptance criteria, tests, and approval gates.
---

# Prepare a coding brief

1. Inspect current repository, branch/commit, architecture, migration state, tests, assets, language policy, working tree and deployment topology. If inaccessible, say so clearly.
2. State exactly what is verified versus user-stated, inferred and proposed. Do not invent paths or current code.
3. Identify actual user need and the narrowest viable implementation; note deliberate out-of-scope items and compatibility requirements.
4. List unresolved requirements; ask one precise consequential question at a time and hold implementation if essential to correctness.
5. Prepare one self-contained brief (assume Claude Code session memory can reset): objective, verified baseline, scope/non-scope, constraints, file touch list, safety gates, detailed changes, tests, acceptance conditions, rollback, output format, and explicit instructions to preserve all unrelated behaviour.
6. Label `PLAN ONLY` unless the owner explicitly authorised implementation. For implementation, keep stage boundaries and require review before live changes.
7. Never claim checks will pass before running them; indicate the environment necessary.

## Copy-ready brief skeleton

**Phase / authority:** PLAN ONLY | APPROVED IMPLEMENTATION | DEPLOYMENT APPROVAL REQUIRED.
**Goal:** one end-user outcome.
**Verified baseline:** sources, commit SHA, files and source dates.
**Constraints:** hard prohibitions, brand, existing data, i18n, privacy, cost.
**Proposed architecture:** components, alternatives, maintenance cost.
**File-by-file approach:** surgical changes, preserved logic, migrations.
**Acceptance tests:** specific, runnable and measurable.
**Safety:** scope and prohibitions, external/live actions, backups.
**Deliverable:** exact diff/PR/ZIP and verification report.
**Open decisions:** numbered, narrow questions, no fabricated answers.
