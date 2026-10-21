# Abiding Word — documentation map

> [!TIP]
> **Looking for how to use Abiding Word?** Start with the
> **[User Guide](guide/README.md)**. It explains everything in plain language,
> with pictures. The rest of this page is for developers and anyone curious
> about how Abiding Word was designed and built.

## For everyone

| Document | What it is |
|---|---|
| [User Guide](guide/README.md) | How to use Abiding Word, step by step |

## For developers

| Document | What it is |
|---|---|
| [developers.md](developers.md) | Building, testing and releasing; repository layout; milestone status |
| [concept.md](concept.md) | The original vision: why Abiding Word exists and what it should become. |
| [architecture.md](architecture.md) | How the program is built: the desktop shell, the data store and how the parts talk to each other. |
| [i18n.md](i18n.md) | How the six interface languages work, with the terminology guide for translators. |
| [updates.md](updates.md) | How test versions are built, signed and delivered as automatic updates. |
| [product-backlog.md](product-backlog.md) | Ideas and features deliberately left for later. |

## The record of each version

Each version of Abiding Word has a technical record of what was built and why.
They are kept as written at the time.

| Document | In plain words |
|---|---|
| [foundation-v0.1.md](foundation-v0.1.md) | v0.1: the empty workspace, the data folder, and safe upgrades with automatic backups. |
| [scripture-v0.2.md](scripture-v0.2.md) | v0.2: the Bible reader, references like “Rom 8:1-17”, adding Bibles and Bible search. |
| [studies-v0.3.md](studies-v0.3.md) | v0.3: study kinds, templates, study notes, related studies and study search. |
| [library-v0.4.md](library-v0.4.md) | v0.4: adding your own books and documents, exact page and section references, library search, citations. |
| [scripture-annotations-v0.5.md](scripture-annotations-v0.5.md) | v0.5: highlights in five colours, notes, bookmarks and the Marks list. |
| [study-workspace-ux-v0.6.md](study-workspace-ux-v0.6.md) | v0.6: a simpler study screen that starts with “What would you like to study?”. |
| [source-navigation-v0.7.md](source-navigation-v0.7.md) | v0.7: following links and footnotes inside books, with Back and Forward. |
| [formatted-source-viewer.md](formatted-source-viewer.md) | The Reading and Original views for PDF, EPUB and Word files. |
| [formatted-epub-v0.8.md](formatted-epub-v0.8.md) | v0.8: e-books shown with their original formatting. |
| [formatted-docx-v0.8.md](formatted-docx-v0.8.md) | v0.8: Word documents added to the library and shown with their original formatting. |
| [passage-aware-sources-v0.9.md](passage-aware-sources-v0.9.md) | v0.9: the Sources pane lists the books about your passage and says why. |
| [study-workspace-refinement-v0.10.md](study-workspace-refinement-v0.10.md) | v0.10: projects made optional, one Add button, quicker study notes, a tidier layout. |
| [scripture-links-v0.11.md](scripture-links-v0.11.md) | v0.11: click a Bible reference in a book to open it, and find your way back. |
| [concordance-v0.12.md](concordance-v0.12.md) | v0.12: every place a word appears in a Bible, by book. |
| [multilingual-references-v0.13.2.md](multilingual-references-v0.13.2.md) | v0.13.2: references in any supported language in one source; heading lines as context. |
| [reference-language-packs.md](reference-language-packs.md) | The shared reference engine: 100 language packs, typed-input policy, provenance, and how to add the 101st. |
| [reference-context-v0.13.1.md](reference-context-v0.13.1.md) | v0.13.1: references without a book name, folding contents, EPUB text repair. |
| [library-reading-v0.13.md](library-reading-v0.13.md) | v0.13: find in a book, generated contents, and clickable Bible references on PDF pages. |
| [source-annotations-v0.14.md](source-annotations-v0.14.md) | v0.14: highlights, notes and bookmarks in your own books, on their pages too, and Marks for the Bible and your books together. |
| [sources-to-study-v0.15.md](sources-to-study-v0.15.md) | v0.15: bring what you read into your study with its source; copy a quotation with its citation. |
| [teaching-preparation-v0.16.md](teaching-preparation-v0.16.md) | v0.16: teaching preparations written from a study; the optional assistant ("AI assists; the human authors"): providers, keys, bounded context, provenance, real stories, images. |
| [study-teaching-simplification-v0.17.md](study-teaching-simplification-v0.17.md) | v0.17: Bible Study as parts with their own Add and notes (no more "findings"), small templates, a canvas for each kind of teaching, lesson steps with kinds; more search services for real stories. |
| [presentation-templates-v0.18.1.md](presentation-templates-v0.18.1.md) | v0.18.1: drag-and-drop slide ordering; church templates imported from PowerPoint (Keynote and Google Slides via PowerPoint) with a compatibility report, reused as template files or made in a small designer; one layout for the live view, PowerPoint and PDF; Windows/Office acceptance checklist. |
| [references-appearance-v0.18.2.md](references-appearance-v0.18.2.md) | v0.18.2: one shared resolver for typed passages in 100 languages (root cause, call sites, policy); a dark variant for each background family; Presenter View follows the app; Windows acceptance checklist. |
| [correctness-hardening-v0.18.3.md](correctness-hardening-v0.18.3.md) | v0.18.3: Bible language metadata (import, Settings), verse validation for typed references, per-window command allowlisting, template image staging, the replacement-font check; combined Windows acceptance checklist for v0.18–v0.18.3. |
| [workspace-hierarchy-v0.18.4.md](workspace-hierarchy-v0.18.4.md) | v0.18.4: the workspace's visual hierarchy — pane surfaces, four type levels, less bold and fewer borders, the two-line Teaching header, and *Materials* as the umbrella for what a teaching becomes; before/after screenshots. |
| [desktop-visual-system-v0.18.5.md](desktop-visual-system-v0.18.5.md) | v0.18.5: one visual system for the whole desktop app — type levels, surfaces, fields, actions, selected states, dialogs and status colours shared by Library, Source Reader, Settings, the presentation editor, Presenter View and church templates; audit, width/language/theme passes, owner screenshot package. |
| [study-flow-materials-v0.18.6.md](study-flow-materials-v0.18.6.md) | v0.18.6: a Bible Study read as one movement from the text to teaching (phases, outline, the way on to a teaching); Materials with a manuscript or guide, a question sheet (group and leader versions) and a worksheet, made from the teaching by fixed rules, printed, saved or copied. |
| [user-templates-v0.18.7.md](user-templates-v0.18.7.md) | v0.18.7: Bible Study and Bible Teaching templates of the person's own: phases stated by each part of a template and followed by the study outline, Teaching templates (format and starting points or steps), "Save as my template" from a study or a teaching (structure only), "Add a step ▸ kind"; migrations 0013 and 0014. |
| [baselines-materials-v0.18.8.md](baselines-materials-v0.18.8.md) | v0.18.8: the built-in Study and Teaching baselines as data, starting points for later refinement; previews from each template's parts; a new teaching chooses its format, then a matching template; the Bible passage on a material from the chosen Bible only; Word (.docx) export from the one material model. |
| [presentation-delivery-v0.18.md](presentation-delivery-v0.18.md) | v0.18 (in progress): presentations made from a Bible Teaching and following it live; one Presenter View for phone, tablet and computer; an audience screen on a second display; PowerPoint, PDF, phone speaker sheet, Markdown and a self-contained delivery package from the same slides. |
