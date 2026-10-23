-- Abiding Word — migration 0017: word annotations (v0.21)
--
-- The words of a Bible as its own word markup identifies them: for USFM,
-- `\w …|lemma="…" strong="…" x-morph="…"\w*`. Everything here belongs to one
-- installed translation and goes with it (ON DELETE CASCADE, through
-- bible_word_annotations); nothing is shared between translations, since
-- their words do not align. Additive only: Bibles added before keep working
-- and gain annotations when added again. Details: docs/original-language-v0.21.md.
--
-- Compact by design (a fully tagged Bible has about 800,000 words): one
-- integer key per annotated translation, each distinct (lemma, `strong`)
-- stored once as an entry with its lexical identifiers, and each word only
-- its place, written form, entry and morphology code.

-- What a translation's annotations hold, as read at import.
CREATE TABLE bible_word_annotations (
    id               INTEGER PRIMARY KEY,
    translation_id   TEXT NOT NULL UNIQUE REFERENCES bible_translations (id) ON DELETE CASCADE,
    -- Where the annotations come from: 'usfm' (\w attributes).
    source_format    TEXT NOT NULL,
    word_count       INTEGER NOT NULL CHECK (word_count >= 0),
    verse_count      INTEGER NOT NULL CHECK (verse_count >= 0),
    lemma_count      INTEGER NOT NULL CHECK (lemma_count >= 0),   -- words with a lemma
    strong_count     INTEGER NOT NULL CHECK (strong_count >= 0),  -- words with lexical ids
    morph_count      INTEGER NOT NULL CHECK (morph_count >= 0),   -- words with a morphology code
    -- The attribute that held the morphology ('x-morph' or 'morph').
    morph_attribute  TEXT,
    -- 'oshb' (described from its documentation), 'raw' (shown as written) or 'none'.
    morph_scheme     TEXT NOT NULL CHECK (morph_scheme IN ('oshb', 'raw', 'none')),
    -- JSON: the import's report (other attribute names seen, words left out and why).
    details          TEXT NOT NULL,
    created_at       TEXT NOT NULL
);

-- One dictionary entry of a translation's annotations: a lemma with the
-- `strong` value given with it, exactly as written (either may be absent).
-- Homographs — one lemma, different identifiers — are different entries.
CREATE TABLE bible_lemma_entries (
    id             INTEGER PRIMARY KEY,
    annotation_id  INTEGER NOT NULL REFERENCES bible_word_annotations (id) ON DELETE CASCADE,
    lemma          TEXT,
    -- The lemma as compared when typed (accents, points and case ignored).
    lemma_fold     TEXT,
    strong         TEXT,
    -- How many words carry this entry.
    occurrences    INTEGER NOT NULL CHECK (occurrences > 0),
    CHECK ((lemma IS NULL) = (lemma_fold IS NULL))
);

CREATE INDEX bible_lemma_entries_lemma ON bible_lemma_entries (annotation_id, lemma);
CREATE INDEX bible_lemma_entries_fold ON bible_lemma_entries (annotation_id, lemma_fold);

-- Each lexical identifier of an entry: every value and part of its `strong`
-- attribute, as written ("H7225", "b"). Looked up by value.
CREATE TABLE bible_entry_ids (
    value     TEXT NOT NULL,
    entry_id  INTEGER NOT NULL REFERENCES bible_lemma_entries (id) ON DELETE CASCADE,
    PRIMARY KEY (value, entry_id)
) WITHOUT ROWID;

CREATE INDEX bible_entry_ids_entry ON bible_entry_ids (entry_id);

-- One annotated word. Offsets are UTF-16 units into the verse's stored text
-- (bible_verse_texts.text), end exclusive: what the reader highlights.
CREATE TABLE bible_words (
    annotation_id  INTEGER NOT NULL REFERENCES bible_word_annotations (id) ON DELETE CASCADE,
    -- The verse whose text holds the word (a bridge's first verse).
    verse_id       INTEGER NOT NULL REFERENCES bible_verses (id),
    position       INTEGER NOT NULL CHECK (position >= 0),
    start_offset   INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset     INTEGER NOT NULL,
    surface        TEXT NOT NULL,
    -- 'w' a word, 'p' a phrase (several written words), 't' part of one.
    shape          TEXT NOT NULL CHECK (shape IN ('w', 'p', 't')),
    entry_id       INTEGER NOT NULL REFERENCES bible_lemma_entries (id) ON DELETE CASCADE,
    morph          TEXT,
    PRIMARY KEY (annotation_id, verse_id, position),
    CHECK (end_offset > start_offset)
) WITHOUT ROWID;

CREATE INDEX bible_words_entry ON bible_words (entry_id, verse_id, position);
