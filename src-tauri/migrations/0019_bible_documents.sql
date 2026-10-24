-- Abiding Word — migration 0019: Bible documents (v0.23)
--
-- A Bible can now be added from a PDF, EPUB, Word (.docx), Markdown or
-- plain-text file. Its files are kept as Abiding Word's own copies
-- (sources/bibles/<translation id>/), read by the library's adapters, and:
--
-- * when its books, chapters and verses were recognised and confirmed, it is
--   an ordinary Bible ('structured', 'ready'): its verses are in
--   bible_verse_texts as for any import, and each verse records where in the
--   document it came from (bible_verse_origins);
-- * otherwise it is read as a document ('document', 'document_only',
--   already allowed by migration 0002): no verses, no verse navigation; its
--   text is kept for reading and searching (bible_document_segments).
--
-- Additive: three new tables, an index and a full-text index. No existing
-- row or column changes. Details: docs/bible-documents-v0.23.md.

-- The files of a document Bible, in their reading order.
CREATE TABLE bible_documents (
    id                  TEXT PRIMARY KEY NOT NULL,
    translation_id      TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,
    -- 'pdf', 'epub', 'docx', 'markdown' or 'text'.
    format              TEXT NOT NULL CHECK (format IN ('pdf', 'epub', 'docx', 'markdown', 'text')),
    -- The managed copy's name inside sources/bibles/<translation id>/: never a path.
    file_name           TEXT NOT NULL,
    -- As the user had it, for reference only.
    original_file_name  TEXT NOT NULL,
    sha256              TEXT NOT NULL,
    size_bytes          INTEGER NOT NULL,
    -- As source_files.extraction_status: 'ocr_required' is a PDF of scanned
    -- pages, readable page by page but without text.
    extraction_status   TEXT NOT NULL
        CHECK (extraction_status IN ('digital_text', 'extracted_text', 'ocr_required')),
    page_count          INTEGER,
    created_at          TEXT NOT NULL,
    UNIQUE (translation_id, position)
);

-- The document's text, paragraph by paragraph, with its place in the original
-- (as the library's source_segments, without anything a citation needs).
CREATE TABLE bible_document_segments (
    seq              INTEGER PRIMARY KEY,
    document_id      TEXT NOT NULL REFERENCES bible_documents (id) ON DELETE CASCADE,
    position         INTEGER NOT NULL,
    content          TEXT NOT NULL,
    page_number      INTEGER,
    section_path     TEXT,
    UNIQUE (document_id, position)
);

-- Full-text search over a document Bible's text (external content, stable seq key).
CREATE VIRTUAL TABLE bible_document_search USING fts5 (
    content,
    content = 'bible_document_segments',
    content_rowid = 'seq',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER bible_document_segments_ai AFTER INSERT ON bible_document_segments BEGIN
    INSERT INTO bible_document_search (rowid, content) VALUES (new.seq, new.content);
END;

CREATE TRIGGER bible_document_segments_ad AFTER DELETE ON bible_document_segments BEGIN
    INSERT INTO bible_document_search (bible_document_search, rowid, content)
    VALUES ('delete', old.seq, old.content);
END;

-- Where each recognised verse came from: the document, its first and last
-- paragraph (segment positions) and pages. Auditable, never used to change
-- the text.
CREATE TABLE bible_verse_origins (
    translation_id  TEXT NOT NULL REFERENCES bible_translations (id) ON DELETE CASCADE,
    verse_id        INTEGER NOT NULL REFERENCES bible_verses (id),
    document_id     TEXT NOT NULL REFERENCES bible_documents (id) ON DELETE CASCADE,
    first_segment   INTEGER,
    last_segment    INTEGER,
    first_page      INTEGER,
    last_page       INTEGER,
    PRIMARY KEY (translation_id, verse_id)
) WITHOUT ROWID;

CREATE INDEX bible_documents_translation ON bible_documents (translation_id, position);
