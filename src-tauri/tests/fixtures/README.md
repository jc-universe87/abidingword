# Test-only USFM fixtures

Synthetic files for automated tests. The sentences are invented placeholder
text, not Scripture, and must never be shipped or shown as a Bible.

- `usfm-a/`, `usfm-b/`: two small "translations" (John 14–16 in part,
  Romans 8 in part, Psalm 23) with different wording, for import, reading,
  switching, search and removal tests.
- `usfm-broken/`: files with deliberate faults (duplicate verse, invalid
  chapter, unreadable verse number) for validation tests.

# Test-only presentation templates

`templates/*.pptx` are synthetic church designs written by
`scripts/fixtures/make_template_fixtures.py` (run it again to rebuild them;
the output is byte-identical). They are modelled on what PowerPoint
(16:9, Calibri, logo in a group, SmartArt, a cropped photo background),
LibreOffice Impress (4:3, two masters, gradient, Korean footer), Google
Slides (720×405, an EMF picture, a tiled background) and Keynote
(1920×1080, Helvetica Neue, an SVG picture, embedded fonts) save. No real
church's design, logo or font is included.
