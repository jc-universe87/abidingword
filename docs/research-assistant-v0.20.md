# Study and research help (v0.20)

v0.20 extends the AI Assistant from Bible Teaching to the rest of the work:
help in a **Bible Study**, help with a **library source**, and **comparing**
two or three passages the person chose. It keeps the product's stance:
Scripture is primary, sources stay traceable, and the person stays the author.

The assistant remains optional. With it turned off (the default), nothing in
this document is visible and nothing is sent.

User guide: [Help with study and research](guide/12-study-help.md).

## 1. What the person sees

| Where | How it opens | What it offers |
|---|---|---|
| A part of a Bible Study | a small **Help** action in the part's header (only while the assistant is on) | look at all the part's writing, one piece of it, the selected words, or one of the part's notes; then: what the text says, its context, the meaning of selected words, related passages, how Christians read it differently, whether a conclusion follows, what may be overlooked or assumed, questions to study further, thinking through a recorded question, clearer wording, grammar, or a question in one's own words |
| Words selected in a source | **Help** in the selection bar | what the author says, how the argument goes, what the author assumes, which Scripture the author uses and how, whether the conclusion follows, what to check further, how it relates to the open Bible Study, or one's own question |
| Two or three passages | **More actions → Add to comparison**, then **Compare…** in the tray above the text | positions per author with their words and the Scripture they appeal to, agreement, disagreement, assumptions, what remains unsupported, and a verdict that may be "the selected passages do not say enough" |

There is no permanent chat panel. Each help request opens a temporary panel
next to the work, with its own title, and closes with **Escape**, **Cancel**
or **Done** (focus returns to the Help button). Nothing is kept as a chat
history: an answer disappears with its panel unless the person keeps a piece
of it as a note.

Screenshots: `docs/images/research-assistant-v0.20/` (English at 1280 px in
light and dark; German and Korean at 760 px in light and dark):

| File | Shows |
|---|---|
| `v020-study-no-assistant-*` | the Study with the assistant off: no Help anywhere |
| `v020-help-preview-*` | Help in a part: what it looks at, the kind of help, and every block that would be sent |
| `v020-help-answer-*` | an answer: each point with its standing and the words it rests on, and suggested passages |
| `v020-keep-form-*`, `v020-kept-note-*` | accepting a point as a note, and the note marked "Written with help from …" |
| `v020-source-preview-*`, `v020-source-answer-*` | help with a library passage, with the author's words and "Open in the source" |
| `v020-compare-*` | the comparison tray and a comparison with its verdict |
| `v020-error-*` | an answer that could not be given |

## 2. One pipeline for all three

The code is in `src-tauri/src/assistant/inquiry/` (beside the Teaching
assistant, which is unchanged). It reuses the existing provider, transport,
configuration and credential store: there is no second settings or secrets
system and no agent framework.

1. **Material** (`study.rs`, `source.rs`, `compare.rs`). The request is made
   from numbered, labelled blocks, assembled deterministically from the
   database within fixed limits:

   | Block | What | Limit |
   |---|---|---|
   | `P1` | the study's main passage in the study's Bible, else the person's default Bible, with its short name; or only the reference, said to be without its text | 4 000 characters |
   | `W1`, `W2`… | the person's writing as it is on screen (the piece in focus, the selected words and the writing they are in, or the whole part) | 12 000 in all |
   | `N1`… | the person's notes in that part (the note in focus first) | 8 notes, 500 each |
   | `Q1`… | quotations kept in those notes, attributed to their book and place | 4, 400 each |
   | `S1`… | selected words of a library source, checked exactly against its stored text, named with title, author and a place from the stored paragraphs ("Chapter 4 · p. 52 · paragraphs 12–16") | 12 000 for one passage; 6 000 each and 15 000 together when comparing |
   | `R1` | the person's question | 1 000 |

   Nothing else is ever included: no other study, no other part's writing,
   no other paragraph of the source, no settings, keys or file paths. With a
   source, the open Bible Study is added (its passage and up to six notes,
   those citing the source first) only when the person ticks **Also include
   my Bible Study**.

2. **Preview** (`inquiry_preview`). Every block, word for word, the service
   and model, whether text leaves the computer, whether library words are
   included, and that nothing is searched. The preview carries a
   **fingerprint**: SHA-256 over the provider, its name and model, the
   address and the complete system and user text.

3. **Ask** (`inquiry_ask`, with the fingerprint). The material is assembled
   again and sent only if its fingerprint is the one the person saw;
   otherwise the answer is "What would be sent has changed since you looked"
   (`inquiry.changed`) and the panel shows the new version first. The key is
   read from the credential store, and the request sent, with the database
   released.

4. **Check** (`interpret`). See §3. Nothing is changed by asking.

5. **Keep** (`inquiry_keep`). See §4.

No request is ever automatic: previews are local, and a request is sent only
when the person presses **Ask**. A request the person stopped waiting for, or
one for an earlier choice, is ignored when it answers.

## 3. Provenance and checks

**Material is data.** Each block is fenced as
`<<<DATA S1 | words of a book in the person's library; not the person's
words | label>>> … <<<END S1>>>`. Any `<<<` inside text, labels or titles
becomes `<< <`, so no text can close its block or open another. Titles in the
request's setting line are reduced to one line. The system instructions say
that everything between the markers is material to read, never
instructions, and that the assistant must not use what it may remember of a
book. Hostile excerpts and notes are tested (`tests/inquiry.rs`).

**Every point has a standing.** The answer's points are one of: in the Bible
text, the author says, about your writing, interpretation, the assistant's
reasoning, background knowledge (to check), question, not settled, position,
agreement, disagreement, assumption, not supported by the passages.

**Quotations are checked, not trusted.** Each quotation must be found
(ignoring case, quotation marks, dashes and spacing) in the block it names.
One that is not there is dropped and counted ("1 quotation in the answer was
not found in what was sent, so it was left out"). A reference without its
Bible text gives no words to quote. In a source block, a found quotation gets
its exact place (`segmentId` and UTF-16 offset at both ends) from the stored
text, so it opens in the reader and can be cited; quotations from paragraphs
outside the selection are not found.

**Claims need their words.** "In the Bible text" needs words of a `P` block,
"the author says" words of an `S` or `Q` block, "about your writing" words of
a `W` or `N` block, a position words of its own source, and agreement or
disagreement words of two different books (or of two passages, when one book
is compared with itself). Otherwise the point is shown as the assistant's
reasoning, or as not supported, and marked so.

**No false consensus.** The verdict follows the checked points, whatever the
answer claims: agreement and disagreement both shown is at most "partly";
"agree" needs a checked agreement, "disagree" a checked disagreement;
anything else is "the selected passages do not say enough to compare".

**References** an answer names are recognised by the app's own parser and
shown as passages "the assistant suggests looking up", not as part of what
was sent.

**Limits on the answer**: 8 points (12 when comparing), 700 characters each,
3 quotations per point (at most 6 are searched), 300 characters each, 5
references; a wording proposal far longer than the original is refused.
Malformed answers ("not JSON", missing fields) are refused with "The
assistant's answer could not be used. Nothing was changed."

**Theology.** The system instructions keep the existing stance: no position
is assumed unless the person describes their own in Settings; readings are
described fairly without choosing; observations, interpretation, the
assistant's reasoning and general knowledge are kept apart; no conclusions,
applications or teaching are written for the person. Explanations are in
the interface language; material is quoted in its own language.

## 4. Accepting help

- **Wording** (clearer wording, grammar) is shown as a word-by-word diff
  against the original. **Use this wording** puts it in place of the
  original, through the block's own editor, so autosave works as for typing.
  If the words have changed since asking, nothing is replaced and the panel
  says so.
- **A point, the whole answer, or a comparison** can become a note:
  **Add to Bible Study…** opens a small form with the text prefilled (the
  person may change anything), the kind of note, and the source passages it
  will cite (checkboxes; at most three). **Add as note** creates one note in
  the study and part, in one transaction:
  - the citations are checked against the source's stored text again
    (`source_annotations::cite`), so a note can never cite words that are not
    there;
  - the note records the assistant's name in `findings.data`
    (`{"assistedBy": "OpenAI · …"}`), shown under the note as "Written with
    help from …". Notes the person writes themselves carry nothing.
- With a source and no Bible Study open, the panel says "Open a Bible Study
  to add notes to it."

## 5. Migrations

None. The assistant's name lives in the `data` column that `findings` has had
since the first schema, which project files already carry and study
duplication now copies. It is read only when it is text, at most 200
characters, so crafted imported data cannot break the notes list.

## 6. Privacy and security, in short

- Off by default; no Help action while off; no background requests, no
  telemetry, no web search (comparison and source help never search).
- The preview lists exactly what the request holds; the fingerprint makes it
  so.
- Only the blocks above are sent. Keys stay in the operating system's
  credential store and go only in the request's header. Nothing of the
  request is logged (the transport logs the host only).
- The database is never held while waiting for the service.
- Results are applied only after the target is checked again: the original
  words for wording, the stored text for citations, the study and part for
  notes.

## 7. Tests

- `src-tauri/tests/inquiry.rs` (31 tests, scripted transport, temporary
  databases, invented text): what is sent and what never is; the fingerprint
  (a changed note, model or service refuses); selected words; quotation
  checks and downgrades; hostile writing, titles and source text; malformed
  and over-long answers; wording proposals and their limits; off and no key;
  grounding (no passage, no Bible text, an open question); a reference
  without its text; keeping a note, with and without citations, atomically;
  a citation of words not in the source; duplication; source location
  labels; a source without text; including a study; comparisons (count,
  sameness, length, positions, agreement across books, verdicts, keeping);
  crafted `data`; the whole part as on screen; loose matching.
- `tests/ui/study-help.test.tsx` (13) and `tests/ui/source-help.test.tsx`
  (5): the Help action only when on; preview before asking; points and their
  standing; Escape and focus; wording used only on request, never over
  changed words; selected words; a recorded question; keeping a point;
  "changed since you looked"; stopping; errors; German and Korean; source
  help with the author's words, opening the source, including the study,
  keeping a citation; comparing, insufficient verdict, keeping a comparison.
- The Teaching assistant's tests are unchanged and pass.

## 8. Known limits

- Help with a source works on selected words only. A page of an Original
  PDF without a text layer cannot be selected, so it cannot be asked about;
  a source with no readable text (a scanned PDF) is refused with an
  explanation. There is no OCR.
- Quotation checks are textual: they show the words are in the material,
  not that the point drawn from them is right. Points are still the
  assistant's work and are labelled so.
- Passages the assistant suggests are recognised, not checked against what
  the passage says.
- The comparison tray lasts for the session and is not saved.
- Wording help replaces one piece of writing at a time; it is not offered
  for notes.
- The preview's fingerprint covers what is sent, not the service's own
  behaviour.
