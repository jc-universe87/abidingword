# Teaching Preparation with AI Assistance (v0.16)

> **AI assists; the human authors.**

A study can now lead to one or more **teaching preparations**: a sermon, a
small-group Bible study, a youth or children's lesson, a talk. The person
writes them. An optional **assistant** can comment on, check and suggest
wording for what they wrote, look for real stories (with sources) and find or
make images. It never writes the teaching, and it never changes the person's
text unless they choose a suggestion.

This is the technical record. The plain-language guide is
[`guide/10-teaching.md`](guide/10-teaching.md).

## 1. What was there before (audit)

- `docs/architecture.md` §23–27 and §36 planned a provider abstraction,
  explicit context boundaries, AI provenance and OS keychain storage for
  keys. `docs/product-backlog.md` §2 fixed the stance: the human is the
  primary author; no whole-sermon generation. Nothing was implemented.
  `src/features/ai/` was an empty placeholder.
- Studies already had a *teaching* study type with `details.audience`,
  `duration` and `teachingFormat`, and a "Teaching / Sermon" template whose
  sections are ordinary study sections. Findings already carried a
  `teaching_idea` and `illustration` kind, passages (`passage_references`,
  one owner per row) and, since v0.15, source citations with a quote and a
  removal-safe snapshot.
- There was no structured place for a sermon or lesson: no ordered main
  points, no central message, no way to reuse a finding without copying it.
- `reqwest` with rustls (ring) was already in the lockfile (the updater);
  there was no HTTP use in the app's own code and no secret storage.
- The content security policy allows images only from the app itself and
  `data:` addresses.

Decisions taken from that audit:

1. A **focused teaching model** (migration 0008) rather than reusing study
   sections: a sermon's structure (message, points, application) is not a
   study's, and several preparations per study must not disturb the study.
2. **Findings are linked, not copied**: one live link table.
3. **Scripture in a teaching gets its own small table**: `passage_references`
   allows exactly one owner (study, block or finding) by a `CHECK`, and a
   teaching passage must never become a study passage.
4. **The assistant lives in the core** (`src-tauri/src/assistant/`), not in
   the interface: the interface never talks to an AI service, never sees a
   key, and cannot widen what is sent.
5. **The content security policy is unchanged**: image previews are fetched
   by the core and handed to the window as `data:` addresses.

## 2. Data model — migration 0008 (`0008_teaching_preparations.sql`)

Additive only; five new tables, nothing existing changed. The usual
pre-migration backup is made (tested: `tests/migration_v8.rs`).

| Table | Holds |
|---|---|
| `teaching_preparations` | `study_id`, `title`, `kind` (sermon, bible_study, youth, children, lesson, talk, other — or none), `audience`, `purpose`, `central_message`, `introduction`, `conclusion`, `notes`, `position`; soft delete and revision like the rest |
| `teaching_points` | ordered main points: `title`, `explanation`, `application`, `illustration` |
| `teaching_finding_links` | a study finding used for the whole preparation (`point_id` NULL) or one point; unique per place |
| `teaching_passages` | Scripture named in the preparation or a point: book code and chapter/verse range, as in `passage_references` |
| `teaching_materials` | what the person kept from the assistant: `kind` (story, illustration, image, visual), `standing`, title, content, `sources` (JSON), `image` (JSON), `assistant` (which service and model) |

Rules (all in `src-tauri/src/db/teaching.rs`, tested in `tests/teaching.rs`):

- **Several preparations per study**, listed in creation order. Deleting one
  is a soft delete; the study, its findings and passages are untouched.
- **No fixed shape.** No field is required except a title; any number of
  points, of any kind (narrative, thematic, expository, inductive,
  question-based) without hard-coded modes. Points are inserted after a
  given point or at the end and always renumbered `0..n`; a reorder must name
  exactly the live points (a stale order is refused, never guessed).
- **Findings stay the study's.** A link names a finding of the *same* study
  (another study's is refused). It is live: the teaching always shows the
  finding as it is now. Unlinking never touches the finding; deleting the
  teaching never touches it; a finding deleted in the study simply stops
  showing. No finding row is ever created by Teaching. *Chosen over
  snapshots* because the study is where findings are worked on; a teaching
  that showed an old copy would quietly disagree with the study.
- **Source provenance is inherited.** A source-backed finding keeps its v0.15
  quote, citation, "open the source at the words" and removal-safe snapshot;
  the Teaching view shows it with the same component as the study.
- **Scripture** is validated as a canonical reference; the same passage in
  the same place is kept once; nothing is added to the study's passages.
- **Deleting a point** removes what hangs on it (links, passages, kept
  material) and renumbers the rest; linked findings stay in the study.
- **Kept material has an honest standing**, enforced in the core, not only
  in the interface:
  - a *story* is `verified` or `unverified`; `verified` requires sources from
    **two different sites**;
  - an *illustration* is always `hypothetical` (invented);
  - an *image* is `found` (with web addresses) or `generated` (with a file
    name the core chose: hex/UUID `.png`, so no path can be smuggled in);
  - a *visual* idea is a `suggestion`;
  - every link must be an `http(s)` address (no `javascript:` or `file:`).

Not changed: study duplication does not copy teaching preparations, and
study search does not index them (both deferred, §12).

## 3. The Teaching view

`src/features/teaching/`. A study has two views, **Bible Study** and **Bible
Teaching** (DE *Bibelstudium* / *Bibellehre*), switched by two buttons under
the study's passages (`aria-pressed`). The layout below was refined after
Windows testing (§17).

- **No preparation yet:** a short explanation and a choice of kind (sermon,
  group Bible study, youth, children, lesson, talk, other) and an optional
  title (default "Sermon · *study title*"). Nothing else is created.
- **A preparation:** title and kind; *What it is about* (who it is for,
  purpose, central message — "in your own words"), with Scripture and
  findings for the whole teaching; introduction; **main points** (title,
  explanation, application, illustration or example, each point's own
  passages, findings and kept material; move up/down, delete with a
  confirmation when it has writing); conclusion; notes for yourself.
- **Several preparations:** a *Teaching:* picker and *Prepare another
  teaching*.
- Every field saves as the person types (the same debounced autosave as study
  blocks). Fields keep their own text, so a reload never overwrites typing.
- References written in the explanation, application, introduction and
  conclusion are recognised as in study blocks (`DetectedReferences`).

## 4. The assistant: architecture

```
interface (TeachingField → AssistMenu → AssistPanel)
   │  assistant_preview / assistant_ask (input: preparation, part, text, action)
   ▼
core  assistant::prepare ── config (settings table) + key (OS credential store)
          │                 context::assemble (one preparation + its study, bounded)
          ▼
      assistant::run ── prompts (standing rules + action) ── provider (wire format)
          │                                                    │
          │             research (search → numbered results → checked)
          ▼                                                    ▼
      interpret (limits, excerpts, references)          http::Transport (reqwest)
          ▼
   AssistReply: a suggestion only (nothing stored, nothing changed)
```

- **Provider-neutral.** `assistant/provider.rs` builds one request for the
  configured service and reads its answer. Two wire formats cover every
  service offered: *chat completions* (OpenAI, Google Gemini's
  OpenAI-compatible endpoint, Ollama, LM Studio, any compatible server) and
  Anthropic *Messages*. Teaching code never names a vendor; adding one means
  adding a case there.
- **Local-first.** Ollama and LM Studio need no key and default to
  `localhost`; an address on this computer (`localhost`, `127.*`, `::1`) is
  *local*, anything else *remote* (`config::is_local_address`, tested
  against look-alikes such as `localhost.example.com`).
- **Off by default.** Nothing is sent unless the assistant is turned on, set
  up, and the person presses **Ask**. It never runs while typing, never in the
  background, never on its own.
- **Configuration is not study data.** The set-up is one JSON value under
  `assistant.config` in the settings table (service, address, model, search
  service, image options, the person's *perspective* text). **Keys are never
  stored there.**
- **Keys** (`assistant/secrets.rs`) go to the operating system's credential
  store through the `keyring` crate: Windows Credential Manager, macOS
  Keychain, the Linux kernel keyring. The interface can set or remove a key
  and learn *whether* one is kept, never read it. In a request the key is
  only in the one header the service reads (`Authorization: Bearer`,
  `x-api-key`, `x-subscription-token`), never in the body or the address; the
  transport logs only the host; errors are plain coded messages. Tested in
  `provider.rs`, `research.rs` and `tests/assistant.rs`
  (`keys_are_never_in_the_database_or_the_settings_view`).
- **The database is never held while waiting.** The commands assemble
  everything under the database lock (`assistant::prepare`), release it, then
  await the service (`commands/assistant.rs`).
- **Testable without a network.** Requests are plain `HttpCall`s sent through
  a `Transport`; `tests/assistant.rs` uses a scripted transport that records
  every request, so tests check exactly what would be sent.

## 5. Privacy: what is sent (bounded context)

`assistant/context.rs` assembles the context deterministically, from **one
teaching preparation and its study**, within fixed limits:

| Piece | Limit |
|---|---|
| the text worked on (the part, or only the selected words) | 12,000 characters (longer: "select a part") |
| the person's request, audience or target language | 1,000 / 200 / 60 |
| the teaching's title, kind, audience, purpose, central message | as written |
| nearby parts of the same teaching (other points' titles; the neighbouring points' text; introduction, conclusion) — also how the person's voice is learned | 1,200 each, 6,000 in all (12,000 for structure) |
| Scripture: the study's primary passage and the passages named in the teaching (whole + this point), with verses from the person's chosen Bible when installed | 8 passages, 5,000 characters of verse text |
| study findings linked here (this point, then the whole); for checking actions with none linked, the study's own findings | 12, 600 characters each |
| source quotations of those findings, with their citation | 400 characters each |

**Never sent:** other studies, other teaching preparations of the same study,
the library at large, marks, settings, keys, file paths. (Tested:
`the_request_carries_the_voice_rule_and_labelled_provenance_but_no_key` plants
text in another study and another teaching and checks it is absent.)

**Before anything is sent** the panel says where it goes ("To help, this will
be sent to *OpenAI · model*:" or "This stays on this computer") and lists
what will be shared in plain words (your Introduction; your audience, purpose
and central message; 3 other parts of this teaching; Scripture: John 15:1–8;
2 findings; 1 quotation with its source). For real stories it adds that
search words based on the request (which may include the person's words) go
to the search service. Images:
only the search words go to Wikimedia Commons.

## 6. Provenance

Every piece the assistant reads is labelled by where it comes from
(`context::render`): `TEACHING`, `SCRIPTURE (cite by reference)`, `STUDY
FINDINGS (the person's own notes)`, `SOURCE QUOTATION (words of a book in
their library, not the person's; attribute it)`, `OTHER PARTS OF THIS
TEACHING (written by the person)`, `TEXT TO WORK ON (written by the person)`,
`WHAT THE PERSON ASKS`.

What comes back keeps the same distinctions:

| Domain | How it is shown |
|---|---|
| the person's writing | their own fields; only they change them |
| Scripture | canonical references, opened in the Bible pane |
| study findings | the findings themselves (live), with their v0.15 citations |
| library sources | quote + citation + open at the words (unchanged from v0.15) |
| external research | a kept story with its sources (title, site, address — only addresses the search returned) and its standing |
| AI suggestion / inference | in the assistant panel, apart from the text; comments name the basis the assistant claims, in its name ("The assistant says this draws on Scripture / on your study / on a book in your library", or "The assistant's own thought, to weigh for yourself"); kept items carry their standing and "From *service · model*" |

A comment's quoted excerpt is shown only if those words really occur in the
person's text (never words put in their mouth). Passages named in comments
are recognised deterministically by the English reference parser; names that
are not real passages are dropped.

## 7. What the assistant does

Each part's **Help** menu offers three short groups (fewer for short fields):

- **Wording** — check grammar and spelling; make it clearer; make it shorter;
  make it sound natural; remove repetition; easier to say aloud; adapt for an
  audience…; translate…; help with a transition. Result: a **proposal**.
- **Comments** — review what I wrote; does the application follow from the
  passage?; check theology and the passage; suggest passages to look at.
  Result: **comments** (with basis, excerpts, suggested passages).
- **Ideas** — other ways to say this; help with a discussion question…; ideas
  for an illustration; find a real story…; suggest a visual. Results:
  **options**, **stories**, **visual ideas**.
- For the whole teaching (beside *Main points*): comment on the structure;
  how could I order what I have?

### 7.1 No ghost-writing (enforced in the core)

- Wording, comments and ideas need the person's text: an empty part is
  refused ("Write something here first. The assistant helps with what you
  have written."). A discussion question and a real story need the person's
  direction in their own words. Structure needs at least two points with
  something in them.
- A wording proposal far longer than the person's text is **not shown**
  (`proposal_limit`: about 1.5× + 200 characters; shorter for *shorten*,
  600 for a transition, 2× for translating, adapting or speaking aloud).
- Alternatives: at most 3, each short. Comments: at most 6 asked, 8 kept.
- The standing instructions (`prompts::system`) say, every time: do not
  write a sermon, lesson, Bible study or whole section; do not invent a
  central message, conclusions, applications, questions or personal stories;
  keep their voice; keep Scripture, notes, sources and your own reasoning
  apart; never invent real events, quotations, people, books or addresses;
  say when an example is invented; reply as JSON in the shape asked.

### 7.2 Keeping the person's voice

Every request carries: *"Preserve the author's meaning, theological
vocabulary, voice, sentence rhythm and level of formality. Make only the
requested type of change."* The assistant is told to learn how the person
writes from their own writing in *this* teaching (the nearby parts), and not
to make it sound generic, corporate, academic, motivational or like a
typical sermon of any tradition or preacher unless asked. No style profile,
persona or personality label is created or stored.

### 7.3 Theology

No denominational position is built in. By default the assistant is told to
assume none and to say where Christians read a passage differently. The
person may describe their own tradition or way of reading Scripture in
Settings (*Your theological tradition*, up to 1,000 characters); it is then
respected. Scripture is the norm the person works from; theological comments
are framed as questions or concerns to consider, never as corrections on the
assistant's authority.

## 8. Real stories and anecdotes

`assistant/research.rs`:

1. The assistant turns the person's request into up to 3 search queries.
2. The configured search service is asked (Brave Search with a key, or a
   SearXNG instance the person trusts); results are numbered (at most 12,
   no address twice, only `http(s)`).
3. The assistant is given *only* those results and asked which real examples
   they report, naming results **by number**. It is told not to add facts,
   names, dates or quotations, and not to use its memory of famous stories.
4. Deterministically: numbers that do not exist are dropped; a story no
   result reports is not offered; every address comes from step 2; a story
   is **checked** ("Two independent sites in the search results report it
   (read them before using it)") only when results from two different *sites*
   are cited for it (`site_of` parses the address as a browser would:
   `news.bbc.co.uk` and `www.bbc.co.uk` are one site, `evil.com\@bbc.co.uk` is
   evil.com, a raw IP address is its own site), otherwise
   **not checked** ("only one source. Please check before you use it.").

With **no search service**, no story is offered and the service is not asked
to invent one: "Real stories can only be found and checked with a search
service… or ask for an invented illustration instead." With no suitable
results: "No real story could be found and checked in the search results.
Nothing has been made up." The panel also says the check is against the
results' summaries, and to read the full sources before using a story.
Invented illustrations are a separate action and are always labelled
"Invented example, not a real event".

## 9. Images

`assistant/images.rs`:

- **Visual ideas** are the assistant's suggestions (photo, simple diagram or
  drawing, with search words), labelled as suggestions.
- **Find freely licensed images**: Wikimedia Commons search (only the search
  words are sent). Images without a licence are left out; each keeps its
  title, licence, licence address, author, attribution wording and page.
  Previews are fetched by the core from `https://upload.wikimedia.org/` only
  and returned as `data:` addresses; the window loads no remote image.
- **Make an image** (only when turned on, and only with OpenAI or a compatible
  server's images endpoint): the request asks for a clear illustration, *not
  a photograph*, and no imitation of a photograph of a real historical
  scene. The result is held in memory and written to
  `sources/teaching-images/<uuid>.png` in the data folder **only if the person
  keeps it**; it is always shown as "Made by the assistant: an illustration,
  not a photograph".
- Nothing is placed in a teaching without **Keep**. There is no slide or
  media library.

## 10. Human approval: what each result allows

| Result | Choices | Effect |
|---|---|---|
| Proposal | **Use this wording** (or *Put this at the start* for a transition); Done/Escape | replaces the part, or only the selected words; announced; **Undo** restores the earlier text |
| Comments | open a passage; **Add** a suggested passage | adds that passage to this teaching (never to the study) |
| Options | **Add below my text** | appends the option under the person's text, with Undo |
| Illustration ideas | **Keep as an idea** | kept material, `hypothetical` (not inserted into the text) |
| Stories | open a source; **Keep with this teaching** | kept material with its sources and standing |
| Visual ideas | find images; make an image; **Keep this idea** / **Keep this image** | kept material, `suggestion` / `found` / `generated` |

Asking never changes anything (tested: the teaching's stored state is
identical before and after a request). AI responses are not stored unless
kept; nothing is kept automatically.

## 11. Accessibility and plain language

- Keyboard only: the view switch, every field, adding, moving (focus stays on
  the moved point's button) and deleting points (focus on *Keep*), the Help
  menu (a real menu: arrows, Escape returns to its button), the panel
  (initial focus on its input or on *Ask*, Ctrl+Enter asks, Escape closes and
  returns focus to the text; the result's heading receives focus when it
  arrives), Accept/Undo, source links and image actions.
- Announced politely: "Working…", "Suggestion ready.", "The assistant could
  not help this time.", "Kept with this teaching.", "Changed as you chose.",
  point added/moved/removed. Errors are `role="alert"`.
- Standing is always in words, never by colour alone (colour only adds
  emphasis to "Not checked").
- Targets are at least 44 px.
- Plain words in the teaching flow: *Help*, *Ask*, *Review what I wrote*,
  *Find a real story*, *Suggest a visual*. No "prompt", "model", "token" or
  "AI" jargon there; the service and model are named only in Settings and in
  the "sent to … / From …" lines.

## 12. Languages

All new text is in the six interface languages (en, de, ko, fr, es, pt):
1,321 English keys in all, consistent (`npm run i18n:check`). Korean uses the
accepted terms (성경공부, 기록, 본문, 자료, 출처, 자료실, 메모, 참고) and
natural Korean teaching words: **가르침 준비** (Teaching), **설교**, **소그룹
성경공부**, **공과** (lesson), **대지** (main point), **서론 / 결론**, **설명**,
**적용**, **예화** (illustration), **핵심 메시지**, **인도자 메모**, and
**도우미 / 도움 받기** for the assistant; no 연구, 프로젝트, 템플릿, 섹션,
블록 or 발견 (checked by `tests/ui/korean-terminology.test.ts`). German uses
*Bibelstudium*, *Predigt*, *Hauptpunkte*, *Erkenntnis*; French *étude*,
*prédication*, *observation*; Spanish and Portuguese *estudio/estudo*,
*sermón/sermão*, *hallazgo/descoberta*.

## 13. Tests

- **Rust** (`cargo test --locked`: 553 in all):
  - `tests/teaching.rs` (6): several preparations, save/clear/validate,
    delete leaves the study; point insert/reorder/stale order/edit/delete
    renumbering; findings linked live, never copied, never owned, other study
    refused, deleted finding hidden; Scripture without touching the study;
    kept material standings, two-site rule, unsafe links, path traversal;
    schema version.
  - `tests/assistant.rs` (15): a suggestion changes nothing; the request
    carries the voice rule, labelled provenance and no key, and nothing from
    another study or teaching; the preview lists what is shared and where;
    no ghost-writing without material; an over-long suggestion is refused;
    comments never misquote, passages recognised and not added; illustrations
    marked invented; no key / turned off → nothing sent; a local service needs
    no key and is local; keys never in the database or the settings view; real
    stories need a search and are checked against it (fabricated numbers and
    addresses dropped); no results → nothing made up; a discussion question
    needs the person's own text or findings; "other ways to say it" stay about
    as long as the person's words; the title is always listed as shared and
    source quotations are bounded.
  - `tests/migration_v8.rs`: backup, existing data unchanged, empty usable
    tables, no second backup.
  - unit tests in `assistant/` (15): local addresses (and look-alikes such as
    `127.0.0.1.nip.io` or `localhost@evil.com`), remote detection, bad
    addresses, key only in its header, no call without a key, answers and
    refusals, JSON in prose, voice/boundary instructions, site counting,
    only returned addresses, unsafe search links, no search → nothing
    searched, image licence/author, previews only from Wikimedia, generation
    only where set up.
- **Interface** (`npx vitest run`: 624 in all), `tests/ui/teaching.test.tsx`
  (24): empty start and autosave; points from the keyboard; findings as live
  links; Scripture not added to the study; several teachings; Korean words;
  share-first, ask-on-request, diff, nothing changed until *Use this
  wording*, Undo; Escape restores focus and changes nothing; selection-only
  replacement; empty part refused; comments with basis and passage added only
  on request; illustrations invented and kept only on request; real stories
  need search, checked/unchecked, sources open in the browser; found images
  with licence, made images marked; hidden while off; Settings: off by
  default, key never shown, connection check, local service needs no key;
  and, after the review: a suggestion is refused if the text changed after
  asking; a selection keeps its line breaks; a transition goes before the
  selected words; one-line parts are replaced, never given line breaks; the
  whole teaching's order offers nothing to insert; focus after deleting a
  point; look-alike local addresses; the comparison keeps changed phrases
  together.
- Regression: every earlier suite stays green (Study, v0.15 Sources to Study,
  Library, Marks, Scripture, Quick Capture). `tests/ui/settings.test.tsx` now
  expects the Assistant section instead of the planned "AI assistance" line.

## 14. Independent review and what changed

An independent review of the whole diff found, and these were fixed:

1. *Use this wording* could overwrite text typed after asking → it is now
   refused when the words it was made for have changed ("Your text changed
   after you asked…").
2. Look-alike "local" addresses (`127.0.0.1.nip.io`, `localhost@evil.com`)
   were treated as this computer → addresses are parsed as the request will
   be, in the core and in Settings; only `localhost` and loopback addresses
   count.
3. A redirect could have carried a key header to another host → redirects
   are never followed.
4. Alternatives added line breaks to one-line parts → one-line parts are
   replaced (*Use this*), and line breaks are removed from what goes in.
5. A transition went to the start of the whole part → it goes before the
   selected words.
6. A selection's line breaks could be lost → they stay where they were.
7. A do-nothing *Add below* for the whole teaching's order → not offered.
8. The real-story notice said only search words go out → it now says search
   words are based on the request and may include the person's words.
9. Also: logs keep only the host (never a user name in an address); `site_of`
   parses addresses; kept image previews load once per image and only while
   finding images is on; source quotations are bounded (2 per finding, 8 in
   all) and citations cut; a discussion question needs the person's own text
   or findings, and is framed as sharpening their observation; alternatives
   stay about as long as the person's words; the teaching's title is always
   listed as shared; a found image needs its page and licence; a generated
   image stays held until really kept; the credential store is read only when
   asking, never while the database is held; Settings shows a key's status
   only for the saved service; deleting a point moves focus to the point
   before it and ignores a save that arrives late; basis and "checked" labels
   now say what the assistant claims rather than state it as fact.

## 15. Deliberately not in v0.16

- Whole-sermon, whole-lesson or question-set generation; autonomous or
  proactive assistance; a chat window.
- Presenter mode, slides, PowerPoint, DOCX/PDF export, a media library.
- Collaboration, sync, OCR, a template marketplace, citation styles.
- Copying teaching preparations when a study is duplicated; indexing them in
  study search.
- A record of which accepted wording changes came from the assistant (the
  person sees the comparison before choosing; once chosen, it is their text).
- Web search through an AI service's own search tool (kept provider-neutral:
  a separate search service is used).
- Linux: the kernel keyring keeps a key until the computer restarts; a
  persistent Secret Service store is a later option.
- A generated image kept and later removed (or whose teaching is deleted)
  stays as a file in `sources/teaching-images/` (soft delete, like the rest);
  a clean-up of unreferenced files is later work.
- Checking that the search results actually *describe* a story (beyond the
  model citing them): the person is told to read the sources.

## 16. Windows acceptance (suggested)

1. Upgrade from 0.5.0-dev.32: backup made; studies, findings, marks and
   sources unchanged; Teaching shows *Prepare a teaching from this study*.
2. Create a sermon and a youth lesson for one study; write in every field;
   restart the app: everything is there; switch between them.
3. Add, move (keyboard) and delete points; the confirmation keeps focus on
   *Keep*.
4. Use a finding (also a source-backed one): its quote and *Open source* work;
   edit the finding in the study and see it change; stop using it: it stays
   in the study.
5. Add passages to the whole teaching and a point; open them in the Bible;
   the study's passages are unchanged.
6. With the assistant off: no Help anywhere.
7. Settings → Assistant (sections start closed; Updates is one line): turn
   on, choose a service, open *How do I get a key?*, keep a key (then check
   Windows Credential Manager has an "Abiding Word" entry and that the key is
   nowhere in the data folder), *Check the connection*. Try Ollama locally if
   available ("Runs on this computer").
8. On a paragraph: *Check grammar*; read "what will be shared"; Ask; see the
   comparison; Escape; ask again; *Use this wording*; Undo.
9. Select a sentence and *Make it clearer*: only that sentence changes.
10. *Check theology and the passage*: comments with their basis; add a
    suggested passage; open it.
11. *Ideas for an illustration*: marked invented; keep one.
12. *Find a real story* without search (clear refusal), then with a search
    service: checked / not checked, sources open in the browser; keep one.
13. *Suggest a visual*: find images (licence and author shown, previews
    appear); keep one; if image making is on, make one (marked as made) and
    keep it; restart: kept images still show.
14. Keyboard only, then with a screen reader: menus, panel, Ask
    (Ctrl+Enter), results announced, Escape back to the text.
15. Korean (and one more language): the Teaching words read naturally.

## 17. Refinement pass after Windows testing

Real use of 0.5.0-dev.33 on Windows showed a workspace that asked for too
much attention: Settings was long and flat, the assistant setup assumed API
knowledge, the Help menu was a long list, long operations looked frozen, and
the Teaching view gave metadata the same weight as the writing. This pass
keeps the data model and the assistant core and changes how things are
presented. The principle: **the main work dominates; AI, provenance, media,
metadata and technical settings are secondary and disclosed progressively.**

### 17.1 Settings information architecture

- Order: **Updates, Appearance, Bible texts, Templates, Language, Assistant,
  About this installation, Coming in later versions** (DE *Updates,
  Darstellung, Bibelübersetzungen, Vorlagen, Sprache, Assistent, Über diese
  Installation, In späteren Versionen*). `SETTINGS_SECTIONS` in
  `SettingsView.tsx` is the single source.
- Every section is a heading whose button opens or closes it
  (`aria-expanded`, `aria-controls`; the summary is the button's description)
  with a one-line status: *Up to date* / *Version 1.2.3 is available*, theme,
  language, *Off* / *On · service*, version. Sections are independent (not an
  accordion), closed by default, and the open ones are remembered on the
  device (`settings.openSections`). Contents stay mounted while closed, so
  nothing typed is lost.
- **Updates** is one line normally. It opens by itself when an update is
  available, installing, or failed (until the person closes it). A quiet
  automatic check that finds nothing now records *up to date* (it used to
  return to *idle*), so the line can say so. The signed-updater flow
  (`UpdatesContext`, `Updater`) is unchanged.
- A sticky header holds **Back to workspace**, the title and a jump list
  (links; selecting one opens the section, scrolls to it and focuses its
  button). Escape still goes back. The Template editor and the Library got
  the same sticky Back bar; nothing else was redesigned.

### 17.2 Assistant setup

- **Providers:** OpenAI, Anthropic, Google Gemini, **xAI (Grok)**,
  **Perplexity**, **DeepSeek**, **Qwen (Alibaba Cloud Model Studio,
  international endpoint)**, Ollama, LM Studio and **Other compatible
  service**. All but Anthropic use the chat-completions request already in
  `provider.rs`; the new ones are presets (`ProviderKind::{Xai, Perplexity,
  Deepseek, Qwen}` with their usual address). `needs_key` is now "every
  service on the internet": `!matches!(Ollama | Lmstudio | OpenaiCompatible)`.
  The choice is grouped by where it runs (*On the internet*, alphabetical; *On
  this computer*; *Other*), never ranked by vendor, and each preset fills an
  editable default model (no model list is fetched or shown).
- **Journey:** turn on → choose a service → get and paste the key → model →
  check the connection → ready. When off, only *Turn on the assistant to
  choose a service and check the connection.* Turning on or off, keeping a
  key and checking save by themselves; *Save* is for the extras.
- **"How do I get a key?"** per cloud service (native `<details>`): what it
  is, why, where (a button to the official page, with the address shown),
  cost (usually a little, paid on their site), where to paste it. Ollama and
  LM Studio get *How do I set up …?*: runs on this computer, no key, no
  account, needs a capable computer; link to the official download.
- **Check the connection** sits under the model. It is disabled only with a
  visible reason (also its accessible description): no address for the
  generic service, an address not starting with http(s)://, no key kept, or no
  model. `connectionBlocker()` decides, in the order the steps appear.
- Technical words (address of the service) live under **Advanced**; the
  generic service shows its address in the main flow because it needs one.
  No "endpoint", "base URL", "token" or "OpenAI-compatible protocol" in the
  normal path (tested).
- **Research** is now *Look up real stories* (DE *Echte Geschichten
  recherchieren*): an AI assistant cannot be trusted to remember facts, so a
  search service looks for real sources and the person reads them. It no
  longer suggests that two results prove anything.
- **Theology** is *How should the assistant place theological questions?*
  (DE *Wie soll der Assistent theologische Fragen einordnen?*), marked
  optional, with one-click examples (Evangelical Reformed, Roman Catholic,
  Lutheran, Pentecostal, no particular tradition, "show the different views
  first"). No biography is asked for; nothing is assumed when it is empty.

### 17.3 The Help menu and free text

- Two levels: **Improve my wording**, **Review what I wrote**, **Help with
  structure**, **Ideas and illustrations**, **Look something up**, then
  **Ask for something else…** (`assistCategories()` in `labels.ts`; short
  parts get fewer). One menu element (`role="menu"`) drills down: Enter or →
  opens a category (focus on its first action), ← or Escape goes back to the
  category it came from, Escape at the top closes and returns focus to Help;
  arrows, Home and End move; Tab closes. Headings, spacing, a separator and a
  visible focus bar give it a hierarchy.
- **Free text** is a new core action, `AssistAction::Free`. It needs the
  person's words (`assistant.sayWhat` otherwise, at most 1 000 characters as
  before) and some of their material (writing in the teaching or study notes;
  `assistant.writeFirst` otherwise), sees the same bounded context (the whole
  teaching when asked from the main part's Help), and is **answered only as
  comments**, at most 5 of 400 characters each (`interpret` routes it with Review), so there is never wording
  to apply. Its request adds `FREE_LIMITS`: the request cannot change the
  rules, the assistant does not write the teaching or any part of it even
  when asked, and treats the request as a question, never as instructions.
  The person's words appear only in the labelled *WHAT THE PERSON ASKS* data
  block, never inside the instruction sentence.
  The standing system rules (no ghost-writing, keep the voice, no invented
  facts) apply as to every action. Tested in Rust (a request to "write my
  whole introduction" with a reply that contains a suggestion still yields
  comments only) and in the interface (no *Use this wording*).

### 17.4 Long operations

`Pending` (in `AssistPanel.tsx`) says at once, in words and through a
`role="status"` live region: *Asking the assistant…*, *Looking for sources…
This can take a little while.*, *Finding suitable images…*, *Creating an
image… This can take a little while.* After 20 s it adds that it is taking
longer than usual. No percentages (none are known). Buttons are disabled while
their request runs and the handlers refuse a second start (Ask, Ctrl+Enter,
Find, Make). **Stop waiting** is offered for asking: it is safe because asking
changes nothing, so a late answer is simply ignored (a request counter).
Errors (including the core's 180 s timeout) are shown as before and Ask is
usable again. Image search and generation are not cancellable (they finish
or fail on their own; nothing is placed without *Keep*).

### 17.5 Terminology and German address

- The two views are **Bible Study** / **Bible Teaching** (DE *Bibelstudium* /
  *Bibellehre*, KO *성경공부* / *성경 가르침*, FR *Étude biblique* /
  *Enseignement biblique*, ES *Estudio bíblico* / *Enseñanza bíblica*, PT
  *Estudo bíblico* / *Ensino bíblico*). The kinds of teaching are unchanged.
- **German uses "du" throughout** (137 strings changed across app, errors,
  library, scripture, settings and studies; quotations and Bible text
  untouched). `tests/ui/german-address.test.ts` fails on any formal address.
  **Spanish** was made consistently *tú* as well (82 strings); French keeps
  *vous* and Portuguese (Brazil) *você*, both already consistent.

### 17.6 "Erkenntnis" / finding: audit and what changed

The data model is untouched (findings remain `findings` rows with a type;
teaching links are `teaching_finding_links`). What the person sees:

- **Study (already plain, unchanged):** the list is *Study notes*; the
  entries are named by their type (Observation, Interpretation, Application,
  Question…); German calls them *Einträge*, Korean *기록*, Spanish *apuntes*,
  Portuguese *registros*, French *éléments d'étude*. English still says
  "Add a finding" / "Show findings" in two controls.
- **Teaching (v0.16, changed):** it had introduced the abstract word (EN
  *finding*, DE *Erkenntnis*, ES *hallazgo*, PT *descoberta*, FR
  *observation* for every type). Now: *Use something from your study*, *From
  your study, in …*, *Stop using this here*, *one note from your study* in
  "what will be shared"; German *Eintrag* everywhere, matching the Study. A
  test keeps "Erkenntnis"/"finding" out of the Teaching strings.
- **Recommendation for the Study redesign (deferred):** drop "finding" as a
  user-facing word altogether. Name entries by what they are (note,
  observation, question, insight, quotation) and the collection *Your notes*;
  rename the two remaining English controls then, with the redesign, so the
  study tests and guide change once.

### 17.7 The Teaching canvas

- **Main content first:** title; one quiet line **About this teaching**
  (summary: kind · for whom) that opens kind, who it is for, purpose, what
  the whole teaching uses from the study, and *Delete this teaching*; then
  central message, introduction, the main part, conclusion, notes for
  yourself. The assistant's introductory sentence was removed; Help buttons
  stay quiet beside each part. The open state is remembered per device
  (`teaching.aboutOpen`).
- **Kind-aware main part (small architectural step):** `canvasShape(kind)`
  maps sermon/youth/talk/other → **points**, group Bible study →
  **questions** (*Questions and answers*: the question, what the passage
  shows, what it means for us, notes for leading), lesson/children →
  **steps** (*Lesson plan*: the step, what you will say or do, what they
  should take away, activity/material/example). Labels come from
  `studies.teaching.shape.<shape>.*`; the stored points are the same, so
  changing the kind loses nothing.

### 17.8 Direction recorded for later milestones

- **Format-specific canvases.** The shape is now a single switch in the view.
  A later milestone can give each shape its own canvas: a manuscript editor
  with an outline for sermons; question/answer pairs anchored to verses for
  Bible studies; a timed sequence (agenda) for lessons and children's work.
  The schema can grow without breaking this: `teaching_points` gains an
  optional `role` (question, step, point) and `duration`, and a preparation a
  `canvas` value; until then the kind decides. Avoid hard-coding "three
  points" anywhere.
- **Inline media later.** The canvas should become a sequence of typed
  blocks (text, Scripture, question, image, activity, audio) rather than
  fixed fields. Kept material (`teaching_materials`) is already separate
  from the writing, with kind and standing, and can be referenced from such
  blocks. No audio management now.
- **Presentation is not a peer of Bible Study / Bible Teaching.** It is an
  output of a teaching. Two future paths: (A) **export or create** a
  presentation (PowerPoint/slides) from a teaching's parts and kept images;
  (B) **present directly**: an audience screen (Scripture, images, key
  sentences) and a presenter screen (manuscript, notes, current and next,
  navigation), using the multi-window work in the backlog (§1). Nothing in
  this pass blocks either: parts, points and materials have stable ids and an
  order, and media stays out of the manuscript text.
- **Templates (no redesign now).** Problems seen: *Study templates* in
  Settings shape only the Study; Teaching has its own fixed parts and kinds,
  so there are two parallel notions of structure; built-in study templates
  duplicate one another in places (passage and word studies share most
  sections); and a template cannot say which teaching kind it prepares for.
  What belongs where: the **Study** owns sections for investigating a text;
  **Bible Teaching** owns the shape of what is taught (§17.7); a **Template**
  should become a starting point for either, named by purpose. This pass only
  renamed the section to *Templates* (DE *Vorlagen*) with the summary
  *Starting outlines for new studies*. Next milestone: one template list with
  a "for Study / for Teaching" type, teaching templates that set the kind and
  canvas, and fewer, clearly different built-in study templates.

### 17.9 Tests added or changed

- Settings (`tests/ui/settings.test.tsx`): order and summaries, all closed,
  About opens, independent sections with Enter/Space and `aria-controls`,
  jump list opens and focuses, sticky header with Back, remembered sections,
  theme, Escape. Other suites open sections through `openSettingsSection()`.
- Updates (`tests/ui/updates.test.tsx`): unchanged expectations, now through
  the opened section.
- Assistant setup (`tests/ui/teaching.test.tsx`): off-state sentence; reasons
  for a disabled check (no key, no model, no address, bad address); the check
  enabled once the prerequisites exist; the new presets and their models; the
  generic service; key help with the official link; local-program help; no
  jargon in the normal path; research wording without overclaiming; theology
  optional with examples and no biography.
- Help menu: six top-level choices, keyboard through both levels, Escape and
  focus, free text answered as comments only.
- Long operations: pending text for asking, story search, image search and
  generation; one request at a time; Stop waiting ignores the late answer;
  error state.
- Teaching canvas: About folded, writing first, kind-aware names, works
  without the assistant.
- German and terminology (`tests/ui/german-address.test.ts`).
- Rust: presets and `needs_key`; the free request's prompt; the free request
  end to end.

### 17.10 Independent review of this pass, and what changed

A separate review of the whole diff from `main` found, and this pass fixed:

- On a first start the default service had no model, so the check stayed
  blocked: the form now fills the suggested model whenever none is chosen.
- Enter in a key field saved the form and left the key behind: it now keeps
  the key (provider and search keys).
- Escape anywhere in Settings went back and lost what was being typed: it now
  ignores Escape from fields and disclosures.
- Switching to a service whose key was already kept showed "no key": the
  service is saved as soon as it is chosen, so the kept key shows.
- The waiting message was in a live region that appeared already filled: the
  announcement is now filled a moment later; while asking, focus moves to
  **Stop waiting** (what had it is disabled). Image buttons use
  `aria-disabled`, so focus stays on them.
- The free request: request kept out of the instructions, shorter answers,
  needs the person's material, and sees the whole teaching from the main
  part's Help.
- German "Hilfe zu {{part}}" was ungrammatical with some parts: now "Hilfe:
  {{part}}"; "die ganze Vorbereitung" is "deine ganze Bibellehre"; stiffer
  category names rewritten. French free-text label corrected.
- "Point added/moved/removed" and the delete question now follow the kind
  (question, step).
- Updates reopened only once: closing it now holds for that state only.
- Category items no longer claim a submenu (`aria-haspopup`); a delete
  question is withdrawn when *About this teaching* closes.
- *Stop waiting* now says the service may still finish the request and that
  it may count toward the person's use (the core request is not cancelled).
- The core's label for xAI matches the interface, "xAI (Grok)".

Not changed: the generic service's label ("Other compatible service") is
recorded in English in "From …" lines, like the other service names; the Qwen
link opens Alibaba Cloud's help page on getting a key (the console address
differs by region); suggested model names are defaults the person can edit.
