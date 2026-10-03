# Abiding Word
## Bible Study Workspace — Concept Reference

### 1. Product summary

**Abiding Word** is a cross-platform, low-barrier, AI-assisted **Bible Study Workspace** designed for serious Scripture study, teaching preparation, and long-term personal knowledge building.

The platform provides the **scaffolding**, while the user supplies the substance:

- their theological and hermeneutical profile
- their preferred Bible translations and original-language tools
- their own PDFs, ebooks, notes, scans, webpages, audio, video, and other study material
- their preferred Bible-study and sermon-preparation methods
- their previous studies, conclusions, questions, teaching material, and accumulated knowledge

The goal is not to force users to adapt to a predefined Bible-study app. Instead, the system should adapt to the user's sources, methods, theology, and workflow.

The core product idea is:

> **Scripture at the centre. Your study around it.**

And the central workflow is:

> **Word → Understanding → Teaching**

---

### 2. Theological and pedagogical principle

Abiding Word is built around two inseparable responsibilities:

#### Love God
Be diligent in understanding and handling Scripture faithfully.

This means careful attention to:

- biblical context
- literary genre
- original languages
- canonical context
- biblical theology
- systematic theology
- historical theology
- confessional commitments
- sound hermeneutics

A key text is 2 Timothy 2:15: the call to rightly handle the word of truth.

#### Love your neighbour
Be diligent in teaching Scripture clearly, appropriately, and lovingly.

This means considering:

- the audience
- age
- cultural background
- level of biblical knowledge
- educational setting
- pastoral context
- clarity of communication
- appropriate application
- suitable teaching format

The core brand line is:

> **Study with diligence. Teach with love.**

The study process should therefore not jump directly from a Bible text to a polished sermon. The expected flow is:

> **Text → Understanding → Theology → Application → Audience → Teaching**

---

### 3. Product philosophy

Abiding Word is not primarily a chat app.

The **study itself is the primary object**.

Chat is one interface for working on a study, but the study remains a persistent structured workspace.

For example:

**Project: Romans Sermon Series**

- Study: Romans 1:1–17
- Study: Romans 1:18–32
- Study: Romans 2:1–16

Inside a study:

- Passage analysis
- Word studies
- Questions
- Observations
- Sources
- Exegesis
- Theology
- Application
- Audience notes
- Teaching design
- Outputs

The user should be able to return months or years later and continue from the accumulated study rather than from a chat transcript.

---

### 3a. The software should disappear

Abiding Word exists to support Bible study, not to become the object of
attention. The architecture underneath may be as sophisticated as it needs to
be; that complexity must not be passed on to the user.

The interface should be:

- frictionless
- intuitive
- calm
- non-technical
- progressively disclosed
- sensible by default
- usable by pastors, teachers and ordinary Bible readers without any software
  training

The user should not need to understand internal database concepts, canonical
reference syntax, provider abstractions, sync architecture, source adapters,
internal annotation models, AI-provider terminology, or any implementation
distinction that does not help them study.

> **The user should be thinking about Scripture, not about Abiding Word.**

In practice:

- Prefer one obvious action over several configuration steps.
- Prefer sensible defaults over setup.
- Use the user's language, not implementation terminology.
- Accept natural input instead of teaching users special syntax.
- Hide advanced options until they are useful.
- Do not expose a capability merely because it exists technically.
- Avoid the feature-dashboard, developer-tool look.
- Accessibility is part of simplicity, not an advanced feature.
- More internal complexity is acceptable if it makes the user's experience
  simpler.

This is inspired by the "it should just work" philosophy of product design,
not by copying anyone's visual style. Before adding a control, ask: *does the
user need to make this decision?* If not, choose a good default and hide the
complexity.

---

### 4. Main study types

Abiding Word should support multiple study entry points within the same underlying study engine.

#### Passage study
For verses, paragraphs, chapters, books, or larger biblical units.

Typical work includes:

- context
- structure
- observations
- grammar and syntax
- argument flow
- cross-references
- biblical theology
- theological synthesis
- application

#### Word study
Especially for Hebrew, Aramaic, and Greek.

Native concordance functionality should include:

- lemma search
- morphology
- occurrence lists
- usage by author
- usage by book/corpus
- translation patterns
- semantic range
- cognates
- Septuagint relationships where relevant
- lexical sources
- context-sensitive interpretation

The interface should allow simple natural-language requests such as:

> Show every occurrence of δικαιοσύνη in Romans.

or:

> Where does Genesis use ברית, and how does its usage develop?

Advanced users should still be able to access detailed morphological and lexical data.

#### Topical study
For themes such as:

- covenant
- resurrection
- prayer
- wisdom
- church discipline
- kingdom
- holiness

#### Biblical-theological study
Tracing themes through redemptive history, for example:

- temple
- priesthood
- sacrifice
- kingdom
- seed
- exile and restoration

#### Systematic theology study
For broader doctrinal work such as:

- Christology
- justification
- ecclesiology
- baptism
- eschatology

These studies may combine:

- Scripture
- confessions
- historical theology
- theological literature
- competing doctrinal positions
- personal notes and conclusions

#### Teaching and sermon study
A study aimed at a specific teaching outcome:

- sermon
- Bible study
- workshop
- seminar
- small-group session
- youth study
- catechesis
- lecture
- devotional

---

### 5. Core scaffold

The product should provide a universal scaffold that works even if a new user has uploaded nothing.

#### A. Hermeneutics and theological profile

The user can define:

- doctrine of Scripture
- authority and inspiration assumptions
- confessional background
- theological tradition
- preferred hermeneutical principles
- limits or cautions regarding historical-critical methodology
- preferred translation philosophy
- preferred commentators or schools
- original-language competence
- cultural and ministry context

This profile should guide the assistant but should remain visible and editable.

The system should never silently flatten theological differences.

#### B. Biblical text layer

Scripture is not merely one document among many.

The Bible itself should be the central text layer, including:

- preferred translations
- original Hebrew/Aramaic/Greek
- lemmas
- morphology
- cross-references
- parallel passages
- textual notes where relevant
- user annotations
- verse and passage navigation

Theologically and architecturally, Scripture remains the norm against which secondary sources are evaluated.

#### C. Personal library / sources

Users should be able to bring their own material in many formats:

- PDFs
- EPUBs
- Word documents
- PowerPoint
- webpages
- scanned notes
- handwritten notes
- photographs
- seminar notes
- sermons
- YouTube videos
- podcasts
- audio recordings
- lecture recordings
- exported notes from other systems

The principle is:

> **Bring your library, not somebody else's predetermined library.**

#### D. Study methods and templates

Users should be able to work with predefined or custom study methods.

Examples include:

- POZEK-style methods
- Helge Stadelmann-inspired study workflows
- inductive study
- exegetical sermon preparation
- topical study
- biblical theology
- systematic theology
- youth study
- small-group study
- seminar or workshop preparation
- devotional study

Templates should be workflows, not rigid forms.

Example:

> Observe → Context → Structure → Exegesis → Theology → Application → Teaching

Users should be able to create, duplicate, modify, and combine methods.

#### E. Study workspace

The workspace is where everything comes together.

A typical study might contain:

- Scripture
- source material
- observations
- questions
- quotations
- exegesis
- theological synthesis
- application
- audience notes
- teaching structure
- outputs
- AI conversation

The workspace should be passage- or project-centred rather than chat-centred.

#### F. Findings layer

During study, users should be able to create structured findings such as:

- Observation
- Interpretation
- Question
- Quotation
- Doctrine
- Application
- Illustration
- Teaching idea

These findings should remain reusable and searchable.

#### G. Previous-study memory

The system should remember prior work.

For example:

> You studied Romans 8 in March 2027 and concluded X about adoption. You left Y unresolved and later used the passage in a Galatians 4 sermon.

This should gradually form a lifelong personal Bible-study knowledge base.

#### H. Source comparison and disagreement

When sources disagree, the AI should not blend them into a synthetic answer.

Instead it should show:

- who argues what
- where they differ
- what assumptions they use
- what biblical evidence they rely on
- what the user's own notes say

The user should be able to compare interpretations before drawing conclusions.

#### I. Teaching-production layer

One body of exegesis should be able to produce multiple teaching outputs.

For example:

**Master study**
→ sermon manuscript  
→ sermon outline  
→ small-group questions  
→ leader guide  
→ handout  
→ workshop  
→ youth version  
→ devotional  
→ presentation  
→ published article

The principle is:

> **One body of exegesis, multiple teaching expressions.**

---

### 6. Provenance, citations, and trust

Source provenance should be a first-class feature.

Every extracted claim should retain a path back to the source:

- exact PDF page
- paragraph
- note
- webpage
- timestamp
- audio/video segment
- document section

The system should clearly distinguish between:

- biblical text
- the user's own previous conclusions
- statements from the user's library
- general model knowledge
- AI inference

Useful research modes could include:

#### Library only
The model may use only the user's provided sources plus the biblical text.

#### Library + general scholarship
The user's library remains primary, but wider model knowledge may be used.

#### Explore wider scholarship
The system may actively bring in additional scholarship, clearly labelled as external.

Auditability is essential for serious theological work and later publication.

---

### 7. Commercialisation and general-user design

Abiding Word should be designed from the beginning as a general product, not merely as a personal tool.

The user's own theological profile and source library should be one implementation of the system, not hard-coded into the product.

#### Universal scaffold
The product should work immediately with:

- Bible text
- concordance/search
- Greek/Hebrew tools
- study workspaces
- generic templates
- notes
- source manager
- citations
- AI assistance
- output generation
- study history
- export/publication

#### Personal configuration
Each user then adds:

- theological profile
- preferred confessions
- Bible translations
- study methods
- favourite authors
- personal sources
- notes
- templates

#### Optional content packs
Possible future packs might include:

- Reformed study profile
- Lutheran study profile
- Baptist study profile
- historical creeds/confessions
- Church Fathers
- Greek study workflow
- Hebrew study workflow
- expository preaching templates
- small-group templates
- youth ministry templates

Licensing would need to be considered carefully for commercial third-party methods and resources.

---

### 8. Accessibility and low barrier

The product should serve both advanced and non-technical users.

#### Advanced user
May want:

> NA28 → lemma → morphology → Pauline occurrences → compare translations → search uploaded commentaries → save findings → export notes

#### Senior pastor or low-tech user
May simply want:

> I'm preaching on John 15 next Sunday. Help me study it.

The app should then guide the user naturally.

No user should need:

- Docker
- Git
- command-line tools
- vector database knowledge
- manual API configuration
- technical setup

The primary experience should be browser-based and cross-platform.

Recommended direction:

- responsive web app / PWA
- Windows
- macOS
- Linux
- Chromebook
- tablet
- mobile

Self-hosting can still be offered for advanced users.

---

### 9. Publication and authorship

Publication should be considered from the beginning.

A study may eventually become:

- PDF
- Word document
- Markdown
- webpage
- printable handout
- sermon manuscript
- presentation
- public study link
- multi-part course
- book or commentary material

The system should track:

- user-authored text
- quotations
- AI-generated prose
- source summaries
- Bible quotations
- references
- copyrighted imported material

This is important for both academic integrity and future commercial publication.

---

### 10. UX model

The interface should feel more like a **research desk** than a dashboard.

A desktop workspace could conceptually use three main areas:

**SCRIPTURE** | **STUDY** | **SOURCES**

AI conversation should appear contextually rather than dominate the workspace.

The interface should avoid:

- excessive card grids
- overly rounded SaaS UI
- visual clutter
- unnecessary decoration

It should favour:

- margins
- columns
- dividers
- annotation patterns
- strong typography
- generous whitespace
- clear hierarchy

The interface should recede so that Scripture, sources, and thought come forward.

---

### 11. Brand identity

#### Brand
**Abiding Word**

#### Descriptor
**Bible Study Workspace**

#### Core tagline
**Study with diligence. Teach with love.**

#### Supporting line
**Scripture at the centre. Your study around it.**

#### Brand character
The visual identity should feel:

- reverent
- scholarly
- calm
- grounded
- strong
- disciplined
- modern
- accessible
- substantial

It should avoid:

- generic church-app visuals
- decorative devotional aesthetics
- vine/grape imagery
- crosses as generic logo devices
- generic open-Bible logos
- floral/botanical styling
- overly soft SaaS aesthetics

---

### 12. Logo concept

The final logomark is an abstract three-part symbol.

#### Left form — the Word
A strong, angled page-edge shape.

It represents:

- Scripture
- the Word
- the source text
- stability and foundation

#### Centre — chapter:verse
Two dots form a colon.

This represents:

- biblical reference notation
- close study
- textual attention
- understanding

#### Right form — forward chevron
A strong directional form.

It represents:

- movement
- understanding becoming teaching
- study becoming communication
- faithful delivery of the Word

Together the mark communicates:

> **Word → Understanding → Teaching**

The symbol should remain abstract enough to work even when the user does not consciously decode every layer.

---

### 13. Colour system

The refined brand package uses a strong, high-contrast palette.

Core colours include:

- **Forest Green** — primary brand / Scripture / Word
- **Burgundy** — study / chapter:verse / interpretation
- **Brass** — teaching / movement / emphasis
- **Ivory** — primary light background
- **Stone** — secondary neutral
- **Charcoal** — strong text and monochrome use

The identity uses colour semantically rather than decoratively.

Dark mode should use a deep forest/near-black base with warm light text.

---

### 14. Typography

Brand and product typography should distinguish between reading and interface functions.

#### Brand/display
A strong serif, currently aligned with **Noto Serif Display** in the refined package.

#### UI
**Inter**

#### Long-form reading / Scripture
Use a highly readable serif such as:

- **Noto Serif**
- **Literata**

One should eventually be chosen as the primary reading face, with the other as fallback or alternative.

#### Original languages
Use appropriate high-quality Unicode fonts for:

- Greek
- Hebrew
- Aramaic

Noto families are a strong cross-platform option.

---

### 15. Design principles

Abiding Word should pass these tests:

- Does it honour the seriousness of Scripture?
- Does it invite prolonged study rather than demand attention?
- Can a senior pastor use it comfortably?
- Does it still feel modern to a seminary student or younger teacher?
- Is the interface calm enough for long sessions?
- Is the product powerful without exposing unnecessary complexity?
- Can users move naturally from study to teaching?
- Can every important claim be traced back to its source?

The product should be:

> **Simple enough to begin with a Bible verse. Powerful enough to write a commentary.**

---

### 16. Product architecture summary

A simple conceptual flow:

**Hermeneutical Profile**  
↓  
**Biblical Text Layer**

**Personal Library** → **Retrieval / Search / Concordance**  
↓  
**Study Methods / Templates**  
↓  
## **Study Workspace**
Research → Exegesis → Theology → Application → Audience → Teaching  
↓  
**Outputs**
Sermon · Bible Study · Questionnaire · Workshop · Slides · Handout · Publication

Running alongside everything:

- personal study memory
- exact source provenance
- citations
- reusable findings
- project history

---

### 17. Positioning

Abiding Word is not intended to replace Scripture with AI.

It is intended to help users:

- study Scripture more carefully
- use their own trusted resources more effectively
- retain and reuse previous work
- compare interpretations transparently
- organise complex study
- prepare teaching appropriately for real people
- turn study into faithful teaching and publication

The product is therefore best understood as:

> **A source-owned, AI-assisted Bible Study Workspace for serious study, teaching, and long-term biblical knowledge.**

---

### 18. Current design baseline

The latest brand package should be treated as the design baseline.

The visual identity is mature enough to freeze unless actual product implementation reveals a concrete usability problem.

The next major work should focus on:

- product architecture
- UX flows
- study data model
- source ingestion
- Bible text and concordance architecture
- original-language tooling
- workspace layout
- AI interaction model
- study templates
- publication/export model
- cross-platform implementation

The logo and brand should now support the product rather than continue to be redesigned.
