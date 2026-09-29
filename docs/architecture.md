# Abiding Word
## Frozen Technical Architecture & Implementation Plan

### Status

This document freezes the current technical direction for **Abiding Word — Bible Study Workspace**.

It is intended to be the implementation reference for the first build phase.

The architecture may evolve when real-world constraints appear, but changes should be made deliberately against this baseline rather than by drifting from the original product concept.

---

# 1. Architectural principles

Abiding Word is:

- **local-first**
- **cross-platform**
- **offline-capable**
- **user-owned**
- **source-owned**
- **AI-assisted, not AI-dependent**
- **interoperable**
- **self-hosting-friendly without requiring self-hosting**
- **usable by non-technical users**
- **capable of serious scholarly and pastoral study**

The core principle is:

> **Abiding Word should work fully as a genuine application on one device, without requiring a hosted Abiding Word service.**

Optional functionality may use external services:

- synchronisation
- cloud AI
- web research
- YouTube import
- transcription
- external storage

But the application itself must remain usable without them.

A second architectural principle is:

> **Anything deterministic should remain deterministic. AI should reason over reliable tools rather than replace them.**

Examples:

- locating Romans 8:15 is deterministic
- finding all occurrences of a Greek lemma is deterministic
- preserving a PDF page citation is deterministic
- comparing interpretations is an AI reasoning task
- adapting a study for a youth group is an AI reasoning task

---

# 2. High-level architecture

```text
Abiding Word Application
│
├── User Interface
│   ├── Scripture
│   ├── Study Workspace
│   ├── Sources
│   ├── Notes / Findings
│   ├── AI Assistant
│   └── Teaching / Publication
│
├── Local Core
│   ├── Scripture Engine
│   ├── Study Engine
│   ├── Library Engine
│   ├── Search Engine
│   ├── Citation / Provenance Engine
│   ├── AI Tool Layer
│   ├── Sync Engine
│   ├── Version / Backup Engine
│   └── Integration Layer
│
├── Local Data
│   ├── SQLite
│   ├── Source Files
│   ├── Search Indexes
│   └── Local Cache
│
├── Optional External Services
│   ├── AI Providers
│   ├── WebDAV / Nextcloud
│   ├── Syncthing / Folder Sync
│   ├── S3-compatible Storage
│   ├── Transcription Services
│   └── External Research
│
└── External Ecosystem
    ├── Bevro
    ├── Zekor
    ├── MCP Clients
    ├── Third-party Apps
    └── Export / Import Tools
```

---

# 3. Cross-platform application framework

## Recommended baseline

**Tauri + React + TypeScript**

### Frontend

- React
- TypeScript
- Tailwind CSS
- Abiding Word design tokens
- responsive layout
- desktop-first study experience
- mobile-aware design

### Application shell

**Tauri**

Target platforms:

- Windows
- macOS
- Linux

Mobile support should remain architecturally possible:

- Android
- iOS

Desktop is the primary study environment.

Mobile may later be used for:

- Scripture reading
- reviewing studies
- adding observations
- recording ideas
- reading sources
- viewing teaching plans
- AI interaction
- lightweight editing

### Why Tauri

Preferred over Electron because:

- lighter runtime
- lower memory overhead
- native OS webview
- better fit for long-running desktop study sessions
- still works well with React

Flutter remains an alternative only if Tauri mobile maturity becomes a blocker.

---

# 4. Local data architecture

## Primary database

**SQLite**

Each installation should maintain a local database, for example:

```text
abiding-word.db
```

SQLite contains structured application data.

Examples:

- users/local profile
- workspaces
- projects
- studies
- study sections
- study blocks
- findings
- citations
- Bible metadata
- annotations
- library metadata
- source metadata
- sync metadata
- version history
- settings
- hermeneutical profile
- AI interaction metadata

## Full-text search

Use **SQLite FTS5** initially.

This should support:

- Scripture search
- library text search
- notes
- studies
- findings

Vector search may be added locally later.

Do not introduce an external vector database in the first architecture unless required by scale.

---

# 5. Filesystem layout

Source files should remain files rather than being embedded wholesale into SQLite.

Example:

```text
Abiding Word/
├── database/
│   └── abiding-word.db
│
├── sources/
│   ├── books/
│   ├── notes/
│   ├── scans/
│   ├── audio/
│   ├── video/
│   ├── webpages/
│   └── bibles/
│
├── indexes/
│
├── cache/
│
├── sync/
│
├── backups/
│
└── exports/
```

The database stores references, metadata, hashes, parsing state, citations, indexes, and relationships.

---

# 6. Scripture architecture

Scripture is a **first-class domain**, not just another uploaded document.

## Canonical addressing

All structured Scripture should map to permanent canonical references independent of translation.

Examples:

```text
GEN.1.1
JHN.15.7
ROM.8.1
```

These IDs become the common reference layer for:

- studies
- annotations
- word studies
- citations
- teaching outputs
- previous-study links
- external integrations

## Core entities

```text
Bible
Translation
Book
Chapter
Verse
VerseText

OriginalText
Token
Lemma
Morphology
CrossReference
Pericope
TextualNote
```

Original-language token records may include:

```text
surface_form
normalized_form
lemma
language
morphology
position
verse_id
lexical_ids
```

---

# 7. User-imported Bible texts

Abiding Word must support Bible editions that users already legally possess.

Supported or planned import formats:

- OSIS
- USFM
- USX
- EPUB
- PDF
- TXT
- HTML
- DOCX
- compatible Sword modules where lawful and technically feasible
- other structured Bible formats later

## Two import states

### Structured Bible

Successfully parsed into:

```text
Book → Chapter → Verse
```

This enables:

- verse navigation
- concordance
- translation comparison
- reference linking
- word search
- AI Scripture tools

### Bible Document

A PDF, EPUB, or similar file that is readable and searchable but not yet structurally mapped.

The user can later choose:

> Convert to structured Bible

This avoids forcing unreliable parsing during initial import.

---

# 8. Bible import pipeline

```text
Import file
    ↓
Detect format
    ↓
Extract structure
    ↓
Detect books / chapters / verses
    ↓
Map to canonical references
    ↓
Run integrity checks
    ↓
Show verification screen
    ↓
Store structured Bible
```

Example verification:

```text
Genesis 1 — 31 verses detected ✓
Genesis 2 — 25 verses detected ✓
Matthew 1 — 25 verses detected ✓
```

PDF parsing should be treated as lower-confidence because PDFs encode presentation rather than semantics.

EPUB should be preferred when available because it often retains structural markup.

---

# 9. Concordance and original-language architecture

Bible search should be deterministic.

Capabilities should include:

- surface-form search
- lemma search
- morphology
- occurrence counts
- search by author
- search by book
- search by corpus
- translation comparison
- semantic / lexical lookup
- cognates
- Septuagint relationships where relevant
- Strong's or alternative lexical identifiers where legally and technically appropriate

Example request:

> Show every occurrence of δικαιοσύνη in Romans.

This should query structured Scripture data, not ask the LLM to remember occurrences.

Advanced original-language support can follow the initial MVP, but the schema should allow it from the beginning.

---

# 10. Personal library architecture

The library should support user-owned study material in many formats.

## Source types

- PDF
- EPUB
- DOCX
- PPTX
- HTML
- Markdown
- plain text
- webpages
- scanned notes
- handwritten notes
- photographs
- audio
- video
- YouTube
- sermons
- lectures
- seminar notes

## Core entities

```text
Source
SourceFile
SourceVersion
SourceSegment
SourceMetadata
SourceCitation
SourceEmbedding
SourceRelationship
```

A normalized segment may contain:

```text
source_id
segment_id
text
page_number
section_title
start_time
end_time
bounding_box
language
confidence
embedding
```

---

# 11. Source ingestion pipeline

```text
Upload / Import
    ↓
Identify source type
    ↓
Extract text / media metadata
    ↓
Preserve document structure
    ↓
Normalize
    ↓
Detect Bible references
    ↓
Chunk intelligently
    ↓
Index full text
    ↓
Create embeddings if enabled
    ↓
Ready for research
```

Chunking should be structure-aware.

Examples:

### Commentary

Preserve:

- chapter
- heading
- paragraph
- page
- Bible references

### Audio / Video

Preserve:

- transcript segment
- start timestamp
- end timestamp
- confidence

### Scans

Preserve:

- page
- OCR result
- confidence
- user corrections

---

# 12. Import adapter architecture

The ingestion system should use adapters.

```text
SourceAdapter
├── PDFAdapter
├── EPUBAdapter
├── DOCXAdapter
├── MarkdownAdapter
├── WebAdapter
├── YouTubeAdapter
├── AudioAdapter
├── ImageAdapter
└── PlainTextAdapter
```

Each adapter returns a common normalized document model.

Bible importers are a parallel specialized adapter family:

```text
BibleImportAdapter
├── OSISImporter
├── USFMImporter
├── USXImporter
├── EPUBBibleImporter
├── PDFBibleImporter
├── TextBibleImporter
└── SwordImporter
```

---

# 13. Provenance and citation architecture

Every claim retrieved from a source should preserve exact provenance.

Examples:

### PDF

```text
document
edition
page
section
paragraph / segment
```

### Video / Audio

```text
source
00:32:18–00:33:04
```

### Webpage

```text
URL
title
retrieval date
section
segment
```

The system must distinguish:

- biblical text
- user's own notes
- user's previous conclusions
- user's library
- model general knowledge
- external web research
- AI inference

This distinction should be stored internally even when the UI presents it compactly.

---

# 14. Studies as structured objects

A Study must not be stored as one large Markdown document.

## Core hierarchy

```text
Workspace
 └── Project
      └── Study
           └── StudySection
                └── StudyBlock
```

## Core entities

```text
Project
Study
StudySection
StudyBlock
Finding
Citation
PassageReference
SourceReference
StudyRelation
```

## Example study

```text
Study: Romans 8:1–17

Sections:
- Text
- Context
- Observations
- Structure
- Exegesis
- Theology
- Application
- Audience
- Teaching
```

## Block types

Examples:

- paragraph
- quotation
- question
- observation
- interpretation
- word study
- passage reference
- source citation
- comparison
- table
- AI analysis
- user note
- application
- teaching idea

---

# 15. Projects

Projects group related studies.

Examples:

- Romans Sermon Series
- Doctrine of Justification
- Genesis Bible Study
- Westminster Confession Course
- Youth Retreat 2027

Core hierarchy:

```text
Workspace
 └── Project
      └── Study
```

Projects should exist from the first usable version.

---

# 16. Study findings

Findings should be reusable structured objects.

Types include:

- Observation
- Interpretation
- Question
- Quotation
- Doctrine
- Application
- Illustration
- Teaching Idea
- Unresolved Issue
- Conclusion

These should be searchable across studies.

---

# 17. Study templates

Study methods should be data-driven, not hard-coded.

Entities:

```text
StudyTemplate
TemplateSection
TemplatePrompt
TemplateRule
```

Example:

```yaml
name: Expository Passage Study

sections:
  - Text
  - Literary Context
  - Historical Context
  - Structure
  - Observations
  - Exegesis
  - Biblical Theology
  - Systematic Theology
  - Application
  - Audience
  - Teaching Outline
```

Users should be able to:

- create
- duplicate
- modify
- combine
- import
- export

study methods.

Potential future sharing or marketplace support should be possible.

---

# 18. Hermeneutical profile

The hermeneutical profile should be structured, not merely one system prompt.

Possible entities:

```text
HermeneuticalProfile
TheologicalPosition
ConfessionalDocument
InterpretivePreference
TranslationPreference
MethodologicalBoundary
PreferredAuthor
SourceTrustRule
```

Also provide a prose field:

> My approach to Scripture

The profile may include:

- doctrine of Scripture
- authority / inspiration
- confessional background
- theological tradition
- translation philosophy
- preferred methods
- source preferences
- methodological cautions
- original-language competence
- ministry context

Important separation:

> Theological preferences must not alter deterministic factual retrieval.

For example, a lemma search remains objective corpus work.

The theological profile becomes relevant during interpretation and synthesis.

---

# 19. Source trust and priority

Users should be able to classify sources.

Possible levels:

- Primary / Trusted
- Useful / Secondary
- Consult Critically
- Historical Interest
- Do Not Use Automatically

The retrieval system should respect these settings.

It should not hide opposing sources when explicitly requested.

---

# 20. Scripture annotation model

Annotations should exist independently of full Studies.

Support:

- highlights
- underlining
- notes
- tags
- bookmarks
- links between passages
- saved selections
- questions
- personal translation notes

A user should not have to create a Study merely to annotate a verse.

---

# 21. Bible reference detection

Bible references should be a native data type throughout the system.

The system should detect references in:

- books
- notes
- sermon transcripts
- studies
- teaching material
- imported webpages
- OCR
- audio transcripts

Examples:

```text
Rom 8:15
Romans 8:15
Romans viii.15
John chapter fifteen verse seven
```

These should map to canonical references such as:

```text
ROM.8.15
JHN.15.7
```

This allows Abiding Word to connect sources automatically to Scripture.

---

# 22. Search architecture

There should be three distinct search domains.

## Scripture search

Deterministic search over:

- reference
- phrase
- translation
- lemma
- morphology
- book
- author
- corpus

## Library search

Hybrid retrieval using:

- SQLite FTS5
- metadata filters
- optional local/vector similarity

## Study memory search

Search:

- previous studies
- findings
- sermons
- conclusions
- questions
- teaching outputs
- annotations

The UI should make these domains distinguishable.

---

# 23. AI architecture

Abiding Word should use a provider abstraction.

## Providers

```text
LLMProvider
EmbeddingProvider
TranscriptionProvider
OCRProvider
```

Potential LLM providers:

- OpenAI
- Anthropic
- Google
- Ollama
- LM Studio
- OpenAI-compatible endpoints
- other providers later

No core study workflow should depend permanently on one AI vendor.

---

# 24. AI tools

The assistant should operate explicit Abiding Word tools.

Examples:

```text
get_passage
search_scripture
search_lemma
get_word_occurrences
search_library
open_source_segment
get_previous_studies
create_study
create_finding
update_study_block
compare_sources
generate_teaching_output
export_study
```

The AI should interact with the application through these tools rather than relying on a giant prompt and uncontrolled context.

---

# 25. AI research modes

The application should support explicit context boundaries.

## My Library Only

Allowed:

- Scripture
- user library
- user studies
- user notes

## My Library + Model Knowledge

Adds:

- model background knowledge

## Explore Wider Sources

Adds:

- external web research
- additional external sources

Users should also be able to specify:

- use only selected sources
- exclude selected sources
- do not use previous studies
- use only one project
- compare these three commentaries

---

# 26. AI provenance

AI-generated material should internally record:

- prompt / instruction context
- sources consulted
- Scripture used
- external sources used
- model/provider
- generated timestamp
- later user edits

The UI does not need to display intrusive AI badges everywhere, but provenance should remain inspectable.

---

# 27. Conversation model

Conversation remains an interface into the Study, not the primary storage object.

Entities:

```text
StudyConversation
Message
ToolCall
GeneratedArtifact
```

Conversation context should know:

```text
workspace
project
study
selected passage
selected section
selected sources
active research mode
```

Example:

> Compare this with Calvin.

The system should understand the current passage and active context.

---

# 28. Teaching output architecture

Teaching material should derive from a Study.

```text
Study
   ↓
TeachingArtifact
```

Types may include:

- sermon
- small group
- Bible study
- workshop
- lecture
- leader guide
- handout
- youth study
- catechesis
- devotional
- slides
- article

Each artifact may include:

```text
audience
duration
language
difficulty
format
tone
learning_goals
```

This encodes the product principle:

> Love God by understanding Scripture carefully.  
> Love your neighbour by teaching it appropriately.

---

# 29. Publication architecture

A Study may eventually produce:

- PDF
- DOCX
- Markdown
- HTML
- public webpage
- printable handout
- sermon manuscript
- slide deck
- small-group guide
- course
- commentary material

The publication layer must retain awareness of:

- user-authored text
- AI-generated text
- quotations
- source summaries
- Bible quotations
- copyright restrictions
- bibliographic metadata

---

# 30. Bibliographic metadata

Source records should preserve publication details where possible.

Fields may include:

- author
- title
- subtitle
- publisher
- edition
- year
- ISBN
- DOI
- language
- source type
- copyright status
- license
- local file hash

This enables later citation formatting.

Future citation styles may include:

- SBL
- Chicago
- footnotes
- bibliography
- other academic styles

---

# 31. Source identity and deduplication

Imported resources should be fingerprinted.

Use:

- file hash
- bibliographic metadata
- edition information
- source identifier

The system should detect:

- duplicate imports
- revised editions
- different formats of the same work
- source replacements

---

# 32. OCR and transcription quality

Machine-derived text must carry status.

Example:

```text
Original Source
→ Machine OCR / Transcription
→ User Corrected
```

Store confidence where available.

Users should be able to correct OCR or transcription without losing the original extraction.

---

# 33. Multilingual architecture

Abiding Word should be multilingual from the beginning.

The system must allow different languages for:

- Scripture
- sources
- study
- teaching output
- UI
- original languages

Example:

```text
Scripture: English
Commentary: German
Notes: Korean
Greek text: Greek
Teaching output: Korean
```

All text handling must be Unicode-safe.

---

# 34. Version history

Studies and important content should support history.

Users should be able to:

- restore deleted blocks
- recover earlier versions
- compare edits
- undo AI rewrites
- inspect changes

The version system should share infrastructure with sync where possible.

---

# 35. Backup and disaster recovery

Backup is a first-class feature.

Abiding Word should support:

- automatic local backups
- pre-upgrade backups
- manual full backup
- portable workspace export
- restore to a new device

A full archive may include:

```text
database
settings
studies
templates
annotations
source metadata
source files
indexes
sync state
```

Users should be able to choose whether large source files are included.

---

# 36. Encryption and secrets

Sensitive data should not be stored in plain configuration files.

Use OS keychain / credential storage for:

- AI API keys
- WebDAV credentials
- sync secrets
- tokens

Optional local encryption may later protect:

- database
- source library
- backups

This is particularly relevant for:

- unpublished sermons
- private notes
- pastoral material
- copyrighted resources

---

# 37. Synchronisation architecture

Sync must be optional.

The application works without it.

Potential providers:

```text
SyncProvider
├── LocalFolder
├── WebDAV
├── Nextcloud
├── SyncthingFolder
├── S3Compatible
└── FutureProviders
```

Do **not** synchronise the live SQLite file directly.

Use a change journal.

---

# 38. Sync journal

Each meaningful mutation should produce a sync event.

Example:

```text
event_id
device_id
timestamp
object_type
object_id
revision
operation
payload
```

Operations may include:

- study created
- block updated
- finding added
- annotation changed
- template updated
- source metadata changed

Devices exchange journal operations and apply them locally.

---

# 39. Conflict handling

Initial strategy:

- revision-based conflict detection
- preserve both sides when unsafe to merge
- user-visible conflict resolution

Potential future enhancement:

- CRDT support using Yjs or Automerge for specific collaborative text areas

Do not introduce CRDT complexity everywhere unless real-world use requires it.

---

# 40. Self-hosting model

Abiding Word should not require a self-hosted application server.

Advanced users may self-host optional services.

Example:

```text
Abiding Word Desktop
├── Nextcloud WebDAV → sync
├── Ollama → local AI
└── Local files → library
```

Another user may use:

```text
Abiding Word Desktop
├── Syncthing → sync
└── cloud AI provider
```

The application itself remains local.

---

# 41. Integration architecture

Abiding Word should be usable completely on its own, but should never be architected as an island.

Add a dedicated Integration Layer.

```text
Integration Layer
├── Local REST API
├── MCP Server
├── Event / Webhook Stream
├── Deep Links
├── Import / Export
└── Future Extension API
```

The API should be local-only by default.

Remote exposure over LAN or Tailscale should require explicit opt-in.

---

# 42. MCP interface

Abiding Word should expose capabilities through MCP.

Possible tools:

```text
search_scripture
get_passage
search_library
search_studies
get_study
create_study
add_finding
add_note
get_word_occurrences
compare_sources
generate_teaching_output
export_study
```

This allows Bevro and other agents to discover Abiding Word as a capability provider.

---

# 43. Bevro integration

Bevro should function as an orchestrator, not as the owner of Abiding Word data.

Example:

> Find my previous study on Judges 9, compare it with relevant knowledge from Zekor, and create a follow-up study in Abiding Word.

Possible flow:

```text
Bevro
  ↓
Zekor → retrieve cross-domain knowledge
  ↓
Abiding Word → retrieve Scripture / studies / sources
  ↓
LLM / agent reasoning
  ↓
Abiding Word → create or update study
```

Abiding Word remains the domain authority for Bible-study data.

---

# 44. Zekor integration

Zekor should not become the canonical store for Abiding Word studies.

Division of responsibility:

```text
Abiding Word = domain authority
Zekor = cross-domain memory and discovery
Bevro = orchestration
```

Abiding Word owns:

- Scripture references
- study structure
- source provenance
- citations
- findings
- theological study
- teaching outputs

Zekor may index selected Abiding Word objects for broader retrieval.

---

# 45. Event system

Abiding Word should emit domain events.

Examples:

```text
study.created
study.updated
study.completed
finding.created
source.imported
source.updated
teaching_output.created
project.completed
```

Other systems may subscribe.

Example:

```text
study.completed
   ↓
Zekor indexes conclusions
   ↓
Bevro marks related task complete
```

---

# 46. Deep links

Use a stable URI scheme.

Examples:

```text
abidingword://study/<uuid>
abidingword://project/<uuid>
abidingword://passage/JHN.15.7
abidingword://source/<uuid>
```

This allows external systems to open the exact object in Abiding Word.

---

# 47. Stable identifiers

All major objects should use stable UUIDs.

Examples:

- workspace
- project
- study
- study block
- finding
- source
- citation
- annotation
- teaching artifact

External integrations should never depend on filenames or mutable titles.

---

# 48. Integration permissions

External agents and applications should receive scoped permissions.

Examples:

```text
read_scripture
read_studies
search_library
read_sources
write_notes
create_studies
update_studies
create_findings
export_outputs
```

No integration should automatically receive unrestricted library access.

This is especially important for copyrighted or private material.

---

# 49. Import / export interoperability

Support portable formats wherever possible.

Potential formats:

- Markdown
- JSON
- HTML
- PDF
- DOCX
- OPML
- structured Abiding Word archive

Study templates should also be importable/exportable.

The internal data model should not intentionally trap user content.

---

# 50. Collaboration

Collaboration is not a first-release priority.

However, the ownership model should permit future:

- shared studies
- teacher / co-teacher workflows
- church teams
- study groups
- read-only sharing
- commenting
- collaborative teaching preparation

Possible future roles:

```text
owner
editor
teacher
viewer
```

Do not build real-time collaboration into V1 unless required.

---

# 51. Application updates and migrations

Local-first applications must protect long-term data.

Require:

- schema migrations
- versioned database schema
- migration tests
- pre-upgrade backup
- integrity checks
- rollback strategy where practical

The goal is that a ten-year study library remains safe across application updates.

---

# 52. Extension points

Define extension interfaces early for:

- source importers
- Bible importers
- sync providers
- AI providers
- transcription providers
- OCR providers
- export formats
- study templates
- external research tools

Avoid implementing a full plugin marketplace initially.

The architecture should merely avoid making extensions impossible later.

---

# 53. Privacy model

The local-first architecture provides a strong principle:

> **Your library remains yours.**

User files and study data remain local unless explicitly synced or sent to an external provider.

The application should make it clear when content is being sent to:

- AI providers
- transcription services
- web research services
- sync providers

Users should be able to choose local AI where desired.

---

# 54. Recommended initial stack

```text
APPLICATION
Tauri
React
TypeScript
Tailwind CSS
Abiding Word design tokens

LOCAL DATA
SQLite
SQLite FTS5
Local filesystem

AI
Provider abstraction
OpenAI
Anthropic
Google
Ollama
LM Studio
OpenAI-compatible endpoints

SYNC
WebDAV / Nextcloud
Local folder
Syncthing folder
S3-compatible later

INTEGRATION
Local REST API
MCP
Domain events
Deep links
Portable import/export
```

---

# 55. Possible supporting languages / libraries

The primary app should remain Tauri + React.

Tauri's Rust layer may handle:

- filesystem access
- secure storage
- native OS integration
- local database
- process management
- local API / MCP server
- sync services

JavaScript / TypeScript may handle:

- UI
- application state
- study editor
- user interaction
- some parsing

Python should **not** be required as a separately installed dependency for normal users.

If unique document-processing libraries require Python, possible approaches include:

- bundled sidecar
- optional local worker
- replacing with Rust/JS libraries where practical

The user experience must remain one-click / normal-app installation.

---

# 56. MVP scope

The first genuinely useful version should include:

1. desktop app for Windows/macOS/Linux
2. local SQLite storage
3. project and study management
4. structured Study model
5. Scripture passage reader
6. at least one legally distributable Bible text
7. user Bible import
8. passage references using canonical IDs
9. PDF / EPUB / Markdown library import
10. source indexing and search
11. exact source citations
12. Scripture annotations
13. study findings
14. basic study templates
15. AI provider abstraction
16. AI conversation within a Study
17. explicit AI tools for Scripture and library retrieval
18. research modes
19. teaching output generation
20. Markdown / basic document export
21. local backup
22. brand design system
23. basic MCP / local API foundation
24. stable UUID object model

---

# 57. Features deliberately deferred beyond early MVP

Design for them now, but do not make them first-release blockers:

- advanced Hebrew morphology
- advanced Greek morphology
- syntax trees
- large lexical datasets
- OCR of handwritten notes
- full audio/video transcription
- collaborative editing
- CRDT real-time editing
- template marketplace
- public publishing platform
- mobile-first study editor
- complex citation style engine
- large-scale plugin ecosystem
- commercial content marketplace

---

# 58. Suggested development sequence

## Phase 1 — Foundation

- repository
- Tauri
- React
- SQLite
- migrations
- local settings
- filesystem structure
- design system
- UUID conventions

## Phase 2 — Scripture

- canonical Bible model
- passage reader
- structured Bible import
- Bible document import
- reference parsing
- annotations

## Phase 3 — Studies

- projects
- studies
- sections
- blocks
- findings
- study templates

## Phase 4 — Library

- source ingestion
- PDF
- EPUB
- Markdown
- metadata
- provenance
- FTS5
- Bible-reference extraction

## Phase 5 — AI

- provider abstraction
- model configuration
- Abiding Word tools
- research modes
- citations
- provenance

## Phase 6 — Workspace UX

- Scripture panel
- Study panel
- Source panel
- AI interaction
- contextual actions
- responsive layout

## Phase 7 — Teaching

- audience model
- sermon output
- Bible-study output
- small-group questions
- teaching artifact model

## Phase 8 — Sync and portability

- backup
- restore
- sync journal
- WebDAV / Nextcloud
- folder sync
- conflict handling

## Phase 9 — Integration

- local REST API
- MCP server
- deep links
- domain events
- Bevro integration
- Zekor integration

## Phase 10 — Advanced study

- original languages
- morphology
- advanced concordance
- wider source formats
- publication refinement

---

# 59. Key data ownership rules

Abiding Word is authoritative for:

- Scripture structure
- passage references
- user Bible imports
- studies
- study sections
- findings
- citations
- annotations
- source provenance
- teaching outputs
- study templates
- hermeneutical profile

Zekor may index selected material.

Bevro may orchestrate actions.

External systems may interact through explicit APIs and permissions.

No external system should silently become the canonical store for Abiding Word domain data.

---

# 60. Final architectural definition

Abiding Word should be understood technically as:

> **A local-first, cross-platform Bible-study application with a structured Scripture engine, personal source library, persistent study model, deterministic search, AI-assisted research and teaching tools, optional user-controlled synchronisation, strong provenance, durable backup/versioning, and open integration with wider agent ecosystems.**

Its ecosystem principle is:

> **Usable completely on its own, but never architected as an island.**

Its AI principle is:

> **AI reasons over trusted tools and sources; it does not replace deterministic biblical and document infrastructure.**

Its data principle is:

> **The user's studies, sources, Bible editions, annotations, and accumulated knowledge remain under the user's control.**

This document should be treated as the frozen architecture baseline for the implementation phase.
