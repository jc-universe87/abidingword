# Test-only USFM fixtures

Synthetic files for automated tests. The sentences are invented placeholder
text, not Scripture, and must never be shipped or shown as a Bible.

- `usfm-a/`, `usfm-b/`: two small "translations" (John 14–16 in part,
  Romans 8 in part, Psalm 23) with different wording, for import, reading,
  switching, search and removal tests.
- `usfm-broken/`: files with deliberate faults (duplicate verse, invalid
  chapter, unreadable verse number) for validation tests.
