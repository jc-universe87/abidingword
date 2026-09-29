-- Abiding Word — migration 0002: Scripture (Scripture v0.2)
--
-- Adds the canonical Bible structure, installed translations and their
-- verse text, full-text search, and rebuilds `annotations` so a Scripture
-- note can exist on its own (docs/architecture.md §20). Conventions as in
-- 0001 (docs/foundation-v0.1.md, "Database"); details in
-- docs/scripture-v0.2.md.
--
-- Canonical references are translation-independent: `bible_books`,
-- `bible_chapters` and `bible_verses` describe the canon, never a
-- particular edition, and are never deleted when a translation is removed.

-- ---------------------------------------------------------------------------
-- Canon: the 66-book Protestant canon, English versification.
-- Rows mirror src-tauri/src/scripture/canon.rs (a test keeps them equal).
-- ---------------------------------------------------------------------------

CREATE TABLE bible_books (
    id             INTEGER PRIMARY KEY NOT NULL,  -- ordinal: 1 Genesis … 66 Revelation
    code           TEXT NOT NULL UNIQUE,          -- canonical code, e.g. JHN
    testament      TEXT NOT NULL CHECK (testament IN ('OT', 'NT')),
    name           TEXT NOT NULL,                 -- default English name
    chapter_count  INTEGER NOT NULL CHECK (chapter_count >= 1)
);

INSERT INTO bible_books (id, code, testament, name, chapter_count) VALUES
    (1, 'GEN', 'OT', 'Genesis', 50),
    (2, 'EXO', 'OT', 'Exodus', 40),
    (3, 'LEV', 'OT', 'Leviticus', 27),
    (4, 'NUM', 'OT', 'Numbers', 36),
    (5, 'DEU', 'OT', 'Deuteronomy', 34),
    (6, 'JOS', 'OT', 'Joshua', 24),
    (7, 'JDG', 'OT', 'Judges', 21),
    (8, 'RUT', 'OT', 'Ruth', 4),
    (9, '1SA', 'OT', '1 Samuel', 31),
    (10, '2SA', 'OT', '2 Samuel', 24),
    (11, '1KI', 'OT', '1 Kings', 22),
    (12, '2KI', 'OT', '2 Kings', 25),
    (13, '1CH', 'OT', '1 Chronicles', 29),
    (14, '2CH', 'OT', '2 Chronicles', 36),
    (15, 'EZR', 'OT', 'Ezra', 10),
    (16, 'NEH', 'OT', 'Nehemiah', 13),
    (17, 'EST', 'OT', 'Esther', 10),
    (18, 'JOB', 'OT', 'Job', 42),
    (19, 'PSA', 'OT', 'Psalms', 150),
    (20, 'PRO', 'OT', 'Proverbs', 31),
    (21, 'ECC', 'OT', 'Ecclesiastes', 12),
    (22, 'SNG', 'OT', 'Song of Songs', 8),
    (23, 'ISA', 'OT', 'Isaiah', 66),
    (24, 'JER', 'OT', 'Jeremiah', 52),
    (25, 'LAM', 'OT', 'Lamentations', 5),
    (26, 'EZK', 'OT', 'Ezekiel', 48),
    (27, 'DAN', 'OT', 'Daniel', 12),
    (28, 'HOS', 'OT', 'Hosea', 14),
    (29, 'JOL', 'OT', 'Joel', 3),
    (30, 'AMO', 'OT', 'Amos', 9),
    (31, 'OBA', 'OT', 'Obadiah', 1),
    (32, 'JON', 'OT', 'Jonah', 4),
    (33, 'MIC', 'OT', 'Micah', 7),
    (34, 'NAM', 'OT', 'Nahum', 3),
    (35, 'HAB', 'OT', 'Habakkuk', 3),
    (36, 'ZEP', 'OT', 'Zephaniah', 3),
    (37, 'HAG', 'OT', 'Haggai', 2),
    (38, 'ZEC', 'OT', 'Zechariah', 14),
    (39, 'MAL', 'OT', 'Malachi', 4),
    (40, 'MAT', 'NT', 'Matthew', 28),
    (41, 'MRK', 'NT', 'Mark', 16),
    (42, 'LUK', 'NT', 'Luke', 24),
    (43, 'JHN', 'NT', 'John', 21),
    (44, 'ACT', 'NT', 'Acts', 28),
    (45, 'ROM', 'NT', 'Romans', 16),
    (46, '1CO', 'NT', '1 Corinthians', 16),
    (47, '2CO', 'NT', '2 Corinthians', 13),
    (48, 'GAL', 'NT', 'Galatians', 6),
    (49, 'EPH', 'NT', 'Ephesians', 6),
    (50, 'PHP', 'NT', 'Philippians', 4),
    (51, 'COL', 'NT', 'Colossians', 4),
    (52, '1TH', 'NT', '1 Thessalonians', 5),
    (53, '2TH', 'NT', '2 Thessalonians', 3),
    (54, '1TI', 'NT', '1 Timothy', 6),
    (55, '2TI', 'NT', '2 Timothy', 4),
    (56, 'TIT', 'NT', 'Titus', 3),
    (57, 'PHM', 'NT', 'Philemon', 1),
    (58, 'HEB', 'NT', 'Hebrews', 13),
    (59, 'JAS', 'NT', 'James', 5),
    (60, '1PE', 'NT', '1 Peter', 5),
    (61, '2PE', 'NT', '2 Peter', 3),
    (62, '1JN', 'NT', '1 John', 5),
    (63, '2JN', 'NT', '2 John', 1),
    (64, '3JN', 'NT', '3 John', 1),
    (65, 'JUD', 'NT', 'Jude', 1),
    (66, 'REV', 'NT', 'Revelation', 22);

CREATE TABLE bible_chapters (
    book_id  INTEGER NOT NULL REFERENCES bible_books (id),
    chapter  INTEGER NOT NULL CHECK (chapter >= 1),
    PRIMARY KEY (book_id, chapter)
) WITHOUT ROWID;

-- One row per chapter of every book (1,189 rows).
INSERT INTO bible_chapters (book_id, chapter)
WITH RECURSIVE numbers (n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 150
)
SELECT b.id, numbers.n
FROM bible_books b JOIN numbers ON numbers.n <= b.chapter_count;

-- Canonical verses. The id is the stable verse key BBCCCVVV (book ordinal,
-- chapter, verse), e.g. 43015007 = JHN.15.7. Rows are added the first time
-- any translation supplies that verse and are kept when translations go.
CREATE TABLE bible_verses (
    id       INTEGER PRIMARY KEY NOT NULL,
    book_id  INTEGER NOT NULL,
    chapter  INTEGER NOT NULL,
    verse    INTEGER NOT NULL CHECK (verse >= 1),
    UNIQUE (book_id, chapter, verse),
    FOREIGN KEY (book_id, chapter) REFERENCES bible_chapters (book_id, chapter),
    CHECK (id = book_id * 1000000 + chapter * 1000 + verse)
);

-- ---------------------------------------------------------------------------
-- Installed translations
-- ---------------------------------------------------------------------------

CREATE TABLE bible_translations (
    id                  TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL,
    short_name          TEXT NOT NULL,
    language            TEXT NOT NULL,
    language_code       TEXT,
    publisher           TEXT,
    copyright_notice    TEXT,
    license_type        TEXT,
    -- 'structured': parsed into book/chapter/verse and readable by passage.
    -- 'document':   a Bible file kept as a document, not yet mapped to the
    --               canon (no import path creates these in v0.2).
    kind                TEXT NOT NULL CHECK (kind IN ('structured', 'document')),
    -- File format the text came from, e.g. 'usfm'.
    source_type         TEXT NOT NULL,
    -- 'bundled':      shipped with Abiding Word.
    -- 'managed_copy': the user's file, copied into sources/bibles/<id>/.
    source_origin       TEXT NOT NULL CHECK (source_origin IN ('bundled', 'managed_copy')),
    -- Relative to the data folder for managed copies; the resource name for
    -- bundled texts. Never an absolute path.
    source_path         TEXT,
    -- File name(s) as chosen by the user, for reference only. The user's
    -- original file is never modified or deleted.
    original_file_name  TEXT,
    import_status       TEXT NOT NULL CHECK (import_status IN ('ready', 'document_only')),
    is_builtin          INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    book_count          INTEGER NOT NULL DEFAULT 0,
    verse_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX bible_translations_short_name
    ON bible_translations (short_name COLLATE NOCASE);

CREATE TABLE bible_verse_texts (
    id              INTEGER PRIMARY KEY,            -- rowid, used by full-text search
    translation_id  TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    verse_id        INTEGER NOT NULL REFERENCES bible_verses (id),
    text            TEXT NOT NULL,
    UNIQUE (translation_id, verse_id)
);

-- Psalm titles and similar lines that belong to a chapter, before verse 1.
CREATE TABLE bible_superscriptions (
    translation_id  TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    book_id         INTEGER NOT NULL,
    chapter         INTEGER NOT NULL,
    text            TEXT NOT NULL,
    PRIMARY KEY (translation_id, book_id, chapter),
    FOREIGN KEY (book_id, chapter) REFERENCES bible_chapters (book_id, chapter)
) WITHOUT ROWID;

-- Full-text search over verse text (SQLite FTS5, external content).
CREATE VIRTUAL TABLE bible_verse_search USING fts5 (
    text,
    content = 'bible_verse_texts',
    content_rowid = 'id',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER bible_verse_texts_ai AFTER INSERT ON bible_verse_texts BEGIN
    INSERT INTO bible_verse_search (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER bible_verse_texts_ad AFTER DELETE ON bible_verse_texts BEGIN
    INSERT INTO bible_verse_search (bible_verse_search, rowid, text)
    VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER bible_verse_texts_au AFTER UPDATE ON bible_verse_texts BEGIN
    INSERT INTO bible_verse_search (bible_verse_search, rowid, text)
    VALUES ('delete', old.id, old.text);
    INSERT INTO bible_verse_search (rowid, text) VALUES (new.id, new.text);
END;

-- Original-language data (OriginalText, Token, Lemma, Morphology, LexicalId;
-- docs/architecture.md §6, §9) will attach to bible_verses.id in a later
-- migration. Nothing is created for it here.

-- ---------------------------------------------------------------------------
-- Annotations, rebuilt.
--
-- In 0001 an annotation had to point at a passage_references row, but every
-- passage_references row must belong to a study, block or finding, so a
-- note on a verse outside any study was impossible. Scripture annotations
-- now carry their own canonical range. Existing rows are copied over.
-- ---------------------------------------------------------------------------

CREATE TABLE annotations_v2 (
    id                 TEXT PRIMARY KEY NOT NULL,
    workspace_id       TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    -- Canonical passage, e.g. ROM.8.1, with its verse-key range for lookup.
    passage            TEXT,
    start_key          INTEGER,
    end_key            INTEGER,
    -- Set only when the annotation is about one translation's wording.
    translation_id     TEXT REFERENCES bible_translations (id) ON DELETE SET NULL,
    source_segment_id  TEXT REFERENCES source_segments (id) ON DELETE CASCADE,
    -- note, highlight, bookmark (validated by the application).
    kind               TEXT NOT NULL DEFAULT 'note',
    content            TEXT NOT NULL DEFAULT '',
    data               TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT,
    revision           INTEGER NOT NULL DEFAULT 1,
    CHECK ((passage IS NOT NULL) + (source_segment_id IS NOT NULL) = 1),
    CHECK ((passage IS NULL) = (start_key IS NULL) AND (passage IS NULL) = (end_key IS NULL)),
    CHECK (end_key IS NULL OR end_key >= start_key)
);

INSERT INTO annotations_v2
    (id, workspace_id, passage, start_key, end_key, translation_id, source_segment_id,
     kind, content, data, created_at, updated_at, deleted_at, revision)
SELECT a.id, a.workspace_id,
       CASE WHEN p.id IS NULL THEN NULL ELSE
           p.book || '.' || p.start_chapter
           || COALESCE('.' || p.start_verse, '')
           || CASE WHEN p.end_chapter IS NULL THEN '' ELSE
                  '-' || p.book || '.' || p.end_chapter || COALESCE('.' || p.end_verse, '')
              END
       END,
       CASE WHEN p.id IS NULL THEN NULL ELSE
           b.id * 1000000 + p.start_chapter * 1000 + COALESCE(p.start_verse, 0) END,
       CASE WHEN p.id IS NULL THEN NULL ELSE
           b.id * 1000000 + COALESCE(p.end_chapter, p.start_chapter) * 1000
           + COALESCE(p.end_verse, CASE WHEN p.end_chapter IS NULL THEN p.start_verse END, 999) END,
       NULL, a.source_segment_id, a.kind, a.content, a.data,
       a.created_at, a.updated_at, a.deleted_at, a.revision
FROM annotations a
LEFT JOIN passage_references p ON p.id = a.passage_reference_id
LEFT JOIN bible_books b ON b.code = p.book;

DROP TABLE annotations;
ALTER TABLE annotations_v2 RENAME TO annotations;

CREATE INDEX annotations_range ON annotations (start_key, end_key) WHERE deleted_at IS NULL;
CREATE INDEX annotations_segment ON annotations (source_segment_id);
