# v0.18.9 — Baseline content refinement and language-polish preparation

v0.18.9 does two small things:

1. It refines the built-in Study and Teaching baselines lightly, as starting
   points rather than prescriptions.
2. It prepares every interface string in all six languages for a native
   review.

It does **not** rewrite any language. The native polish comes next, done by
the owner with native speakers, working from the two review documents below.

## 1. Principles kept

- A built-in template is a starting point. It is not a theological position
  or a required workflow, so baselines stay light (about four to eight
  starting parts).
- Phases are never padded to fill the sequence. A baseline uses only the
  phases its parts belong to.
- Work already made is never changed by a baseline edit. A study or teaching
  keeps its own copy of the structure it started with.
- *Teaching preparation* (`teaching-study.json`) stays hidden (`"offered":
  false`), but old studies made from it still load and are still translated.

## 2. Study baselines

| Baseline | Starts with | Optional (*Add part*) | Retired (old studies only) |
|---|---|---|---|
| Passage study | Text · Observations · Context · Meaning · Theology · Application | Structure · Key Words · Related Scripture · Open Questions | Exegesis · Audience · Teaching |
| Word study | Word · Occurrences · **Range of Meaning** · Key Passages · Conclusions | Immediate Contexts · Theological Significance | — |
| Topical study | Question / Topic · Key Passages · Main Themes · Conclusions · Application | Biblical Context · Difficult Passages · Theology | — |
| Biblical theology | Theme · Old Testament · New Testament · Fulfilment / Consummation · Synthesis | Gospels · Epistles · Canonical Development | Teaching |
| Systematic theology | Doctrine · Key Biblical Texts · Biblical Synthesis · Conclusions · Application | Historical Theology · Confessional Witness · Alternative Positions | — |
| Teaching preparation (hidden) | Text · Main Idea · Exegesis · Theology · Purpose · Audience · Structure · Illustrations · Application · Teaching Outline | — | — |

What changed in v0.18.9, and why:

| Where | Before | Now | Why |
|---|---|---|---|
| Word study · *Word* guidance | The word being studied, its original form and how translations render it. | The word or expression being studied, and how translations render it. | It no longer promises original-language analysis the app doesn't offer, and allows a phrase. |
| Word study · *Occurrences* guidance | Where the word appears. (Automatic occurrence lists arrive with the concordance.) | Where the word appears; the concordance can list its occurrences. | The concordance exists since v0.12, so "arrive" was out of date. |
| Word study · part title | Semantic Range | Range of Meaning | Plain words instead of a technical term. |
| Passage study · description | …moving from the text itself to teaching it. | …from the text itself to what it means for faith and life. | A study doesn't have to end in teaching. |
| Biblical theology · description | A theme traced along the storyline of Scripture from promise to fulfilment. | A theme traced through the unfolding story of Scripture. | It no longer presumes one shape for every theme. |
| Biblical theology · *Fulfilment / Consummation* guidance | Its fulfilment in Christ and its final completion. | Where and how the theme reaches its fulfilment or completion. | It describes the part without deciding the answer for the person. |

All other Study baselines were reviewed and left unchanged. Each new text is
translated into all six languages.

### Old studies stay translated

The interface translates a stored part only while its key and English text
are still the built-in's (`src/features/studies/builtinText.ts`). A part
whose text the person changed is never translated. If the English changed
with nothing else, old studies would fall back to English.

To prevent that, each changed section keeps its earlier English in
`formerTitles` / `formerGuidance` in its resource file. A stored part
matching the current English or any former English shows the current
translation, so an old *Semantic Range* reads *Bedeutungsspektrum* in German.
No migration is needed and nothing stored is rewritten. The Rust core
ignores the new fields (`ensure_builtin` reads only what it knows).

## 3. Teaching baselines

| Format | Starts with |
|---|---|
| Sermon · Talk · Youth · Other | Introduction → (no points) → Conclusion: the neutral shape; the person adds main points |
| Group Bible study | No questions: an empty question would only have to be deleted |
| Lesson | Teaching · Discussion (a question) · Activity |
| Children | Welcome · Bible story (a Bible-reading step) · Question · Activity · Prayer |

All of these were reviewed and kept. *Introduction / main points /
Conclusion* is flagged in the review documents. The question there is
whether it reads as neutral in every language, not as a homiletic method.

## 4. Previews and guidance

- Guidance stays one short sentence per part.
- The *Starts with: …* preview is built from each template's own data. In
  the template lists (Settings → Templates, Study and Teaching) and on the
  new-study form, it is clamped to two lines (`line-clamp-2`). The full text
  stays available as the `title` and to screen readers.

## 5. Safety and regressions

Re-tested: built-in templates can't be changed and only offer *Save as my
template*; a personal copy is independent of its built-in; a new study or
teaching takes a copy, so editing or deleting a template never changes it.

Materials, passage text and Word export (v0.18.8) are covered by the
existing tests and fixtures, and all still pass:

- materials carry no guidance or description text;
- privacy of leader-only content;
- numbering;
- `material_passages`, including bridged verses;
- the DOCX golden fixture.

New tests in `tests/ui/baselines.test.tsx`:

- *refining a baseline* — former wording is still translated, former text
  differs from current, the legacy teaching study loads and isn't offered;
- *what each baseline makes* — starting parts only, at most eight, empty
  blocks; teaching baselines make empty points; materials made from them
  are empty when the baseline has no points.

## 6. Language-polish preparation

### The two review documents

- [`i18n/native-polish-review-v0.18.9.md`](i18n/native-polish-review-v0.18.9.md):
  the whole corpus, every key in all six languages, grouped by 23 product
  contexts. Each group opens with a note on what its words mean. Plural
  forms are shown together (*one:*, *many:*, *other:*), placeholders
  (`{{bible}}`) are listed, and ⚑ marks a question for the reviewer.
- [`i18n/native-polish-priority-v0.18.9.md`](i18n/native-polish-priority-v0.18.9.md):
  where to start. It contains:
  - the established terms and how often each language uses each rendering;
  - the flagged questions;
  - strings added or changed since v0.18.4;
  - short labels (buttons, menus, tabs);
  - strings where German or Korean may not fit;
  - error messages;
  - the audit's findings.

Context notes explain meaning only. They never suggest a translation.

### How the corpus is made

`npm run i18n:corpus` runs `scripts/i18n-corpus.mjs`, which reads
`src/i18n/locales/*/*.json` and writes both documents:

- It is deterministic: keys are sorted, nothing depends on dates, and it
  uses no network.
- The one git use is the "changed since v0.18.4" list in the priority
  document, which compares with commit `5e1bfe6`. Without git, that section
  says so instead of failing.
- A key that matches no product context stops the script.
- `node scripts/i18n-corpus.mjs --check` fails when the committed review
  document no longer matches the locale files.

The corpus holds **2,091 strings (2,143 keys** with plural forms counted
separately) in each of the six languages.

### Audit

Each finding has a class:

- **A** — a clear bug, fixed now;
- **B** — a wording question for the native reviewer;
- **C** — an intentional difference, documented.

| Check | Result |
|---|---|
| German formal address (*Sie/Ihr*; the policy is informal *du*) | none |
| Korean 프로젝트 / 템플릿 / 섹션 / 블록 outside the presentation's own PowerPoint terms | none |
| `...` instead of `…` | none |
| A straight apostrophe in French (French uses ’ everywhere else) | **36 strings — fixed (A)** |
| English loanwords (*Update(s)*, *Design* in German; *Slide(s)*, *Design*, *Widescreen* in Portuguese) | 8 — for the reviewer (B) |
| Same spelling as English (book names, product names, cognates such as *Application*, *Conclusion*) | 172 — listed, intentional (C) |
| An ellipsis on a label in one language and not the other | none |

German puts a space before *…* throughout (*Speichern …*), and the other
languages don't. Each language is consistent, so this is left as it is.
English mixes ’ and `'`. It is the source text that built-in matching
depends on, so it is left alone too.

### Terms locked for the review

These stay as they are until the native review decides otherwise
(`tests/ui/i18n-corpus.test.ts`):

- Bible Study — Bibelstudium · 성경공부 · Étude biblique · Estudio bíblico · Estudo bíblico
- Bible Teaching — Bibellehre · 성경 가르침 · Enseignement biblique · Enseñanza bíblica · Ensino bíblico
- Materials — Unterlagen · 가르침 자료 · Supports · Materiales · Materiais
- Church templates — Gemeindevorlagen · 교회 서식 · Modèles de l’église · Plantillas de la iglesia · Modelos da igreja
- Note (in a study) — Notiz · 기록 · Note · Apunte · Anotação

German informal address and the Korean terms (성경공부, 공부 틀, 부분, 기록,
참고) are already guarded by `german-address.test.ts` and
`korean-terminology.test.ts`.

### Left for the native review

- every B finding;
- the ⚑ questions, among them:
  - the neutral sermon shape;
  - *Range of Meaning* in each language;
  - Korean 성경공부 틀 as the name of the Settings section that also holds
    Teaching templates;
  - *Start from*;
  - German *Im Aufbau*;
  - *Materials* in every language;
- the length of German and Korean labels at narrow widths.

## 7. Tests

`tests/ui/i18n-corpus.test.ts` checks that:

- the committed corpus is current;
- every English key and plural form is exported, from every namespace;
- the corpus has 23 contexts, each string is in exactly one, and an unplaced
  key throws;
- plural forms and placeholders are shown, with Korean *other* only and
  French *one / many / other*;
- table characters are escaped;
- no class A finding remains, and a planted straight apostrophe or English
  string is caught;
- the established terms keep their renderings.

## 8. Limitations

- The audit is mechanical. It can't judge register, tone or whether a
  phrase is natural, which is the native review's job.
- Same-as-English detection lists cognates. It doesn't decide whether a
  native word would be better, except for the eight loanwords flagged.
- The corpus covers the interface strings only. Bible texts, book-name
  packs for references (`resources/refs`) and the built-in Study template
  resource files (whose English is shown through the `studies.builtin.*`
  keys) are outside it.

## 9. Next

After the native review: apply its changes to the locale files, run
`npm run i18n:corpus` and `npm run i18n:check`, then do the Windows visual
acceptance in German and Korean.
