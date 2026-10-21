# v0.18.10 — Six-language native polish

This is not a feature milestone. It applies the owner's linguistic decisions,
taken from the v0.18.9 review corpus, and then a conservative contextual
polish of the whole interface in all six languages. The goal is wording that
reads as if written in each language, with the established terms used
consistently. Nothing is rewritten for variety, and no new terminology is
introduced.

- Input: [`i18n/native-polish-review-v0.18.9.md`](i18n/native-polish-review-v0.18.9.md)
  and [`i18n/native-polish-priority-v0.18.9.md`](i18n/native-polish-priority-v0.18.9.md),
  kept as the record of the review's input.
- Output: [`i18n/native-polish-review-v0.18.10.md`](i18n/native-polish-review-v0.18.10.md)
  (the whole corpus as it is now) and
  [`i18n/native-polish-priority-v0.18.10.md`](i18n/native-polish-priority-v0.18.10.md)
  (the approved terms, the questions left, and the 429 strings changed, for
  the final spot review).

The approved terminology is recorded in [`i18n.md`](i18n.md#approved-terminology-v01810-native-polish).

## 1. The owner's decisions, applied

| Decision | Applied as |
|---|---|
| Core terms locked | Bible Study, Bible Teaching, Study/Teaching template, Materials, Presentation, Church templates — per language as in `i18n.md` |
| Word study *Range of Meaning* | Bedeutungen · 의미의 범위 · Sens possibles · Significados · Sentidos possíveis |
| A part's place in the outline | Gliederung / Nicht in der Gliederung (German *Im Aufbau* read as "under construction") · 흐름 · Plan / Hors du plan · Esquema / Fuera del esquema · Estrutura / Fora da estrutura. The longer *Study outline* follows: Gliederung des Bibelstudiums, Esquema del estudio, Estrutura do estudo |
| Korean Settings section | 공부·가르침 틀. Each kind stays 공부 틀 / 가르침 틀, and the help texts that name the Settings path follow |
| Church templates | Modèles pour l’église · Plantillas para la iglesia · Modelos para a igreja, with their neighbouring strings (new, none) |
| Save as my template (German) | Als eigene Vorlage speichern, for Study and Teaching |
| Template preview (Korean) | 구성: {{parts}}. (and 구성: {{steps}}. for teaching). The period follows the other languages |
| Word document (German) | Als Word-Dokument speichern… — and no space before … in any German string (79 strings) |
| Portuguese *Widescreen* | Panorâmico (16:9) |
| German *Update(s)*, *Design*; Portuguese *Slide(s)*, *Design* | Kept: normal software terms |
| Materials, sermon terms, *Discussion*, *Bible story* | Confirmed and kept |
| Scripture-missing messages (Korean) | {{bible}}에는 {{verses}}의 본문이 없어 포함하지 않았습니다. 다른 성경에서 가져오지 않습니다. / {{bible}}에는 이 본문의 내용이 없습니다. 본문 위치만 표시합니다. |

## 2. The contextual pass

Each language was read in full: every string, by product context, against
the English. The changes were applied only after checks: placeholders,
plural forms and key sets identical, and no change to a key the owner had
decided.

| Language | Strings changed | Main themes |
|---|---|---|
| English | 40 | ’ throughout; plainer wording (*Carried over*, *This page has no selectable text*, *password store*, *Topical study*); help text quotes the real option names |
| German | 247 (79 of them the ellipsis) | *Bibellehre* where a teaching was called *Vorbereitung* or *Lehre*; *Gliederung*; *Möglicher Gesprächsverlauf* for "where it may lead"; *speichern*, never *sichern*; du-form retries; shorter viewer and menu labels; German reference examples |
| Korean | 66 | Settings path 공부·가르침 틀; 대지 for points and 순서 for steps; 삭제/편집 for both kinds of template; 가르침 자료 kept apart from 자료; product names in Latin script; 장/절/쪽 counters; polite assistant questions; Korean reference examples |
| French | 78 | *vous* throughout (four strings had *tu*); *Paramètres*; gender and agreement (*Conserver*, *Elle*); French reference examples; *Passage biblique*, *Expression* |
| Spanish | 93 | *Configuración* and *ordenador* consistently; « » quotes; *esquema* for the outline; *tú* throughout; Spanish reference examples; *Frase* in the concordance |
| Portuguese | 60 | *Estrutura* for the outline; *Salvar* = save, *Guardar* = keep; *Adicionar*; *lição* / *sermão*; a restored `{{count}}`; Portuguese reference examples |

**Reference examples.** The placeholders and error hints showed English book
names in five languages. German examples even pointed to input the German
parser reads differently (*Rom* is the city). They now use each language's
own names, all of which the shared resolver accepts in any interface
language (see `src-tauri/tests/reference_languages.rs` and
`reference_resolver.rs`).

**Narrow labels shortened:**
- German *Seitenbreite* / *Ganze Seite* (PDF toolbar), *Vollansicht öffnen*,
  *Neue Bibelstelle*, *Rückmeldung zum Aufbau*;
- Spanish *Frase*, *Palabra o frase*, *Partir de*, *Respuestas esperadas*;
- French *Expression*, *Conserver*;
- Korean 목차가 없습니다, 설치 정보.

Error, privacy and accessibility texts were not shortened.

**Deliberately retained:** the sermon shape, *Discussion*, *Bible story*, the
German loanwords, Portuguese *Slide* and *Design*, French *Supports*, and the
established Korean terms (성경공부, 성경 가르침, 공부 틀, 가르침 틀, 가르침
자료, 자료실, 자료, 출처, 본문, 강조, 가르침 구상, AI 도우미, 가르침 준비,
대지, 서론, 결론, 설명, 적용, 예화, 핵심 메시지, 인도자 메모).

## 3. Independent review

A separate review read every changed string against the English and the
rules. It found and fixed the following:

- one French grammar error (*L’essentiel auquel…*);
- three English changes that four languages hadn't followed: the password
  store, *selectable text* (where the Korean had become misleading for a
  scanned page), and the quoted option names in the duplicate help;
- the doubled *pour* in the French empty-template message.

The review confirmed these as clean:

- placeholders, plural branches and German address (du);
- *Gliederung* only where "outline" is meant (*Aufbau* stays for
  structure);
- Korean 틀 / 서식 and 가르침 자료 / 자료;
- no PT-PT forms;
- every new reference example accepted by the parser.

## 4. Architecture notes (reported, not forced)

- The **points canvas** serves sermon, talk, youth and other teaching with
  one set of keys. Korean 대지 is a sermon word, so a talk's parts are also
  called 대지. A kind-specific label needs kind-specific keys. German,
  French, Spanish and Portuguese read naturally for all four kinds.
- `studies.findings.newLabel` and similar labels assume a feminine note type
  in French, Spanish and Portuguese, which is true for every type today.
- `studies.keepIt` is shared by masculine and feminine items, so French uses
  the neutral *Conserver*.
- German `studies.teaching.links.wholeScope` and `assist.shared.*` were
  reworded so every combination of the shared keys is grammatical.

## 5. Questions left

They are listed with their strings in section 2 of the
[priority page](i18n/native-polish-priority-v0.18.10.md):

- German *Bibelstellenstudium* (long);
- *evangelisch-reformiert* as an example;
- *let that box shrink*;
- Korean 보관한 도우미 제안 and product names in Latin script;
- French *Liée à / Reliée à* and the colon in references;
- Portuguese *lição*;
- Spanish quotes in search hints;
- a possible English "your the whole teaching";
- the two architecture notes.

None of them blocks the Windows acceptance build.

## 6. Checks

- `npm run i18n:check`: key sets, plurals and placeholders identical in six
  languages.
- `tests/ui/i18n-corpus.test.ts` now also guards:
  - the approved terms;
  - no space before … in German;
  - Korean 틀 never in church-template strings, and 서식 never in
    Study/Teaching template strings.
- Tests that asserted old wording follow the new wording. The Word-export
  golden fixture follows the German *Möglicher Gesprächsverlauf*, and the
  Rust tests read it.
- No Rust code changed.

## 7. Next

1. The owner's final spot review of the v0.18.10 corpus.
2. One batched Windows acceptance build: German and Korean at narrow
   widths, the new German labels (*Bibelstellenstudium*, *Angaben zum
   Bibelstudium*), and Korean 공부·가르침 틀 in Settings.
