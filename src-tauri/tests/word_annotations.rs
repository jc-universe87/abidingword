//! Word annotations (v0.21): `\w …|lemma="…" strong="…" x-morph="…"\w*`
//! read from USFM, placed exactly in the stored verse text, stored per
//! translation, and removed with it.
//!
//! Every fixture below is CONSTRUCTED TEST TEXT, not Bible text: invented
//! sentences made of real Greek and Hebrew words, with annotations written for
//! the test. The morphology codes follow the OSHB documentation's own examples;
//! nothing here is an analysis of a real verse. The only real Bibles used are
//! the bundled ones, read to check that their text is unchanged.

#[path = "support/usfm_v020.rs"]
mod usfm_v020;

use std::io::Read;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::bible_words::{
    self, LemmaLookup, LemmaQuery, LemmaSelection, VerseWordsQuery,
};
use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::import::{self, ImportOrigin, StagedImport};
use abiding_word_lib::scripture::usfm::{self, WordShape};
use abiding_word_lib::scripture::CommitImport;
use rusqlite::Connection;

fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start..end]).unwrap()
}

/// Each marked word's offsets select exactly its surface in the stored text.
fn assert_placed(doc: &usfm::UsfmDocument) {
    for verse in &doc.verses {
        for w in &verse.words {
            assert_eq!(
                utf16_slice(&verse.text, w.start, w.end),
                w.surface,
                "{}:{}",
                verse.chapter,
                verse.label
            );
        }
    }
}

// ---------------------------------------------------------------- reading

#[test]
fn bundled_bibles_read_to_exactly_the_v020_text() {
    use abiding_word_lib::scripture::bundled::BUNDLED;
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/scripture");
    let mut books = 0;
    let mut marked = 0;
    for bible in BUNDLED {
        let file = std::fs::File::open(resources.join(bible.id).join(bible.resource)).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).unwrap();
            let name = entry.name().to_ascii_lowercase();
            if !(name.ends_with(".usfm") || name.ends_with(".sfm")) {
                continue;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).unwrap();
            let source = String::from_utf8_lossy(&bytes);
            let old = usfm_v020::parse(&source);
            let new = usfm::parse(&source);
            assert_eq!(new.book_code, old.book_code, "{} {name}", bible.id);
            assert_eq!(
                new.superscriptions, old.superscriptions,
                "{} {name}",
                bible.id
            );
            assert_eq!(new.verses_outside_chapter, old.verses_outside_chapter);
            assert_eq!(
                new.unknown_markers, old.unknown_markers,
                "{} {name}",
                bible.id
            );
            assert_eq!(new.verses.len(), old.verses.len(), "{} {name}", bible.id);
            for (a, b) in new.verses.iter().zip(&old.verses) {
                assert_eq!(
                    (&a.chapter, &a.label, &a.text),
                    (&b.chapter, &b.label, &b.text),
                    "{} {name}",
                    bible.id
                );
            }
            assert_placed(&new);
            marked += new.verses.iter().map(|v| v.words.len()).sum::<usize>();
            books += 1;
        }
    }
    assert!(books > 500, "every bundled book was compared ({books})");
    assert!(
        marked > 1_000_000,
        "the Strong's-tagged Bibles' words were placed ({marked})"
    );
}

#[test]
fn bundled_strongs_only_bibles_are_reported_but_not_indexed() {
    let zip = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/scripture/engwebp/engwebp_usfm.zip");
    let staged = import::stage(&[zip], ImportOrigin::Bundled { id: "engwebp" }).unwrap();
    let words = staged.preview(Default::default()).words;
    assert!(words.marked > 100_000);
    assert_eq!(words.with_lemma, 0);
    assert!(words.with_lexical_id > 100_000);
    assert!(!words.indexed);
    assert_eq!(words.not_indexed, Some("strongOnly"));
    assert!(staged
        .content
        .books
        .values()
        .all(|b| b.chapters.values().all(|c| c.words.is_empty())));
}

#[test]
fn offsets_hold_for_greek_hebrew_astral_characters_and_joiners() {
    // Constructed test text.
    let doc = usfm::parse(concat!(
        "\\id TST constructed test text\n\\c 1\n\\p\n",
        "\\v 1 «\\w Ἐν|lemma=\"ἐν\"\\w*   \\w ἀρχῇ|lemma=\"ἀρχή\"\\w*»,\n\\q2 \\w ἦν|lemma=\"εἰμί\"\\w* ὁ \\w λόγος|lemma=\"λόγος\"\\w*.\n",
        "\\v 2 \\w בְּ/רֵאשִׁ֖ית|lemma=\"b/7225\"\\w* \\w בָּרָ֣א|lemma=\"1254 a\"\\w* \\w אֶת־|lemma=\"853\"\\w*הָ\u{05BE}\n",
        "\\v 3 𐤀𐤁 \\w 𐤂𐤃|lemma=\"x\"\\w* \\w a\u{200D}b|lemma=\"joined\"\\w* \\w עִבְרִ\u{2060}י|lemma=\"j\"\\w*\n",
        "\\v 4 \\w un|lemma=\"un\"\\w*done\n",
    ));
    assert_placed(&doc);
    let v1 = &doc.verses[0];
    assert_eq!(v1.text, "«Ἐν ἀρχῇ», ἦν ὁ λόγος.");
    assert_eq!(
        v1.words
            .iter()
            .map(|w| w.surface.as_str())
            .collect::<Vec<_>>(),
        ["Ἐν", "ἀρχῇ", "ἦν", "λόγος"]
    );
    assert_eq!((v1.words[0].start, v1.words[0].end), (1, 3));
    assert!(v1.words.iter().all(|w| w.shape == WordShape::Word));
    let v2 = &doc.verses[1];
    assert_eq!(v2.words[0].surface, "בְּ/רֵאשִׁ֖ית");
    // The maqaf joins two words but is not a letter: the marked word ends before it.
    assert_eq!(v2.words[2].surface, "אֶת");
    assert_eq!(v2.words[2].shape, WordShape::Word);
    let v4 = &doc.verses[3];
    assert_eq!(
        (v4.words[0].surface.as_str(), v4.words[0].shape),
        ("un", WordShape::Part),
        "part of a written word"
    );
    let v3 = &doc.verses[2];
    assert_eq!(v3.words[0].surface, "𐤂𐤃");
    assert_eq!(
        (v3.words[0].start, v3.words[0].end),
        (5, 9),
        "astral letters count two UTF-16 units"
    );
    assert_eq!(v3.words[1].surface, "a\u{200D}b");
    assert_eq!(
        v3.words[1].shape,
        WordShape::Word,
        "a joiner stays inside its word"
    );
    assert_eq!(v3.words[2].shape, WordShape::Word);
    assert_eq!(doc.word_problems.total(), 0);
}

#[test]
fn phrases_nesting_escapes_and_attribute_lists() {
    let doc = usfm::parse(concat!(
        "\\id TST constructed test text\n\\c 1\n\\p\n",
        // A phrase, a nested word inside a character span, an escaped bar.
        "\\v 1 \\w son of man|lemma=\"υἱὸς ἀνθρώπου\"\\w* \\wj \\+w said|lemma=\"λέγω\" strong=\"G3004\"\\+w*\\wj* \\w a|lemma=\"x\\|y\"\\w*\n",
    ));
    let words = &doc.verses[0].words;
    assert_eq!(doc.verses[0].text, "son of man said a");
    assert_eq!(words[0].shape, WordShape::Phrase);
    assert_eq!(
        words[0].attributes.as_deref(),
        Some("lemma=\"υἱὸς ἀνθρώπου\"")
    );
    assert_eq!(
        words[1].attributes.as_deref(),
        Some("lemma=\"λέγω\" strong=\"G3004\"")
    );
    assert_eq!(words[2].attributes.as_deref(), Some("lemma=\"x\\|y\""));
}

#[test]
fn broken_markup_is_counted_and_never_misplaced() {
    let doc = usfm::parse(concat!(
        "\\id TST constructed test text\n\\c 1\n\\s1 \\w Heading|lemma=\"h\"\\w*\n\\p\n",
        "\\v 1 \\w open|lemma=\"o\" never closed\n",
        "\\v 2 stray\\w* close \\w outer \\+w inner|lemma=\"i\"\\+w* rest|lemma=\"o\"\\w* \\w ,|lemma=\"p\"\\w*\n",
        "\\v 3 \\w fine|lemma=\"f\"\\w*\n",
    ));
    assert_placed(&doc);
    let p = &doc.word_problems;
    assert_eq!(p.outside_verse, 1, "the heading's word");
    // An unclosed `\w` and a stray `\w*` carry no attribute list: they
    // annotate nothing, so they are seen but not counted as lost words.
    assert_eq!(p.unclosed, 0);
    assert_eq!(p.stray_close, 1);
    assert_eq!(p.overlapping, 2, "a word inside a word: neither is kept");
    assert_eq!(p.empty, 1, "punctuation only");
    // Text is unchanged by the markup problems.
    assert_eq!(doc.verses[1].text, "stray close outer inner rest ,");
    assert_eq!(doc.verses[2].words.len(), 1);
    assert_eq!(doc.verses[2].words[0].surface, "fine");
}

#[test]
fn an_escaped_quote_is_read_as_part_of_its_value_not_left_in_the_text() {
    // The one deliberate difference from v0.20, whose reader could not match a
    // list containing `\"` and so left `a|lemma="x\"y"` in the verse text.
    let doc = usfm::parse("\\id TST constructed\n\\c 1\n\\p\n\\v 1 \\w a|lemma=\"x\\\"y\"\\w* b\n");
    assert_eq!(doc.verses[0].text, "a b");
    assert_eq!(
        usfm_v020::parse("\\id TST\n\\c 1\n\\p\n\\v 1 \\w a|lemma=\"x\\\"y\"\\w* b\n").verses[0]
            .text,
        "a|lemma=\"x\\\"y\" b"
    );
    assert_eq!(
        doc.verses[0].words[0].attributes.as_deref(),
        Some("lemma=\"x\\\"y\"")
    );
}

#[test]
fn a_crafted_verse_with_very_many_marked_words_is_refused_quickly() {
    let mut text = String::from("\\id TST constructed\n\\c 1\n\\p\n\\v 1");
    for _ in 0..100_000 {
        text.push_str(" \\w a|x\\w*");
    }
    let started = std::time::Instant::now();
    let doc = usfm::parse(&text);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(20),
        "{:?}",
        started.elapsed()
    );
    assert!(doc.verses[0].words.is_empty());
    assert_eq!(doc.word_problems.too_many, 100_000);
}

#[test]
fn glossary_markup_without_attributes_keeps_an_untagged_bible_quiet() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage_text(
        temp.path(),
        "JHN.usfm",
        "\\id JHN constructed\n\\c 1\n\\p\n\\v 1 \\w grace\\w* \\w —\\w* \\w outer \\+w inner\\+w*\\w* stray\\w* \\w open\n\\v 2 \\w x|\\w* \\w y|x-note=\"n\"\\w*\n",
    );
    let words = staged.preview(Default::default()).words;
    assert!(!words.indexed);
    assert_eq!(words.not_indexed, None, "nothing to say: {words:?}");
    assert_eq!(words.left_out.total(), 0);
}

#[test]
fn sentinel_characters_in_the_source_disable_word_reading() {
    let doc = usfm::parse("\\id TST\n\\c 1\n\\p\n\\v 1 \\w a|lemma=\"x\"\\w* \u{FDD0}\n");
    assert!(doc.word_problems.unreadable);
    assert!(doc.verses[0].words.iter().all(|w| w.attributes.is_none()));
}

// ---------------------------------------------------------------- importing

/// Constructed Hebrew-style test book: invented verses, OSHB-style codes from
/// the scheme's documented examples. Two homographs share the lemma "בָּרָא"
/// with different identifiers, so they stay apart.
fn hebrew_fixture() -> String {
    let w = |text: &str, lemma: &str, strong: &str, morph: &str| {
        format!("\\w {text}|lemma=\"{lemma}\" strong=\"{strong}\" x-morph=\"{morph}\"\\w*")
    };
    let mut s = String::from("\\id GEN constructed test text — not Bible text\n\\c 1\n\\p\n");
    s.push_str(&format!(
        "\\v 1 {} {} {}׃\n",
        w("בְּ/רֵאשִׁית", "b/7225", "b:H7225", "HR/Ncfsa"),
        w("בָּרָא", "בָּרָא", "H1254a", "HVqp3ms"),
        w("אֱלֹהִים", "אֱלֹהִים", "H430", "HNcmpa")
    ));
    s.push_str(&format!(
        "\\v 2 {} {}׃\n",
        w("וַ/יִּבְרָא", "בָּרָא", "c:H1254a", "HC/Vqw3ms"),
        w("אֱלֹהִים", "אֱלֹהִים", "H430", "HNcmpa")
    ));
    s.push_str(&format!(
        "\\v 3 {} {}׃\n",
        w("בָּרָא", "בָּרָא", "H1254b", "HVqp3ms"),
        w("הָאָרֶץ", "אֶרֶץ", "d:H776", "HTd/Ncbsa")
    ));
    s.push_str("\\v 4 unmarked words only.\n");
    s.push_str("\\c 2\n\\p\n");
    s.push_str(&format!(
        "\\v 1 {}׃\n",
        w("אֱלֹהִים", "אֱלֹהִים", "H430", "HNcmpa")
    ));
    s
}

fn stage_text(dir: &Path, name: &str, text: &str) -> StagedImport {
    let path = dir.join(name);
    std::fs::write(&path, text).unwrap();
    import::stage(&[path], ImportOrigin::UserFiles).unwrap()
}

fn commit(conn: &Connection, staged: &StagedImport, short: &str) -> String {
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: format!("Fixture {short}"),
            short_name: short.into(),
            language: "Hebrew".into(),
            language_code: Some("hbo".into()),
            publisher: None,
            copyright_notice: None,
            license_type: None,
            words: Default::default(),
        },
        &SourceRecord {
            origin: "managed_copy",
            path: Some("sources/bibles/test".into()),
            original_file_name: Some("fixture".into()),
            format: "usfm",
            is_builtin: false,
        },
    )
    .unwrap();
    id
}

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn the_preview_summarises_annotations_truthfully() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage_text(temp.path(), "GEN.usfm", &hebrew_fixture());
    let words = staged.preview(Default::default()).words;
    assert_eq!(words.marked, 8);
    assert_eq!(words.words, 8);
    assert_eq!(words.verses, 4);
    assert_eq!(words.with_lemma, 8);
    assert_eq!(words.with_lexical_id, 8);
    assert_eq!(words.with_morphology, 8);
    assert_eq!(words.distinct_lemmas, 4);
    assert_eq!(words.morph_attribute.as_deref(), Some("x-morph"));
    // The codes fit OSHB's scheme, but nothing in the files says so (v0.22).
    assert_eq!(words.grammar.scheme, Some("oshb"));
    assert_eq!((words.grammar.coded, words.grammar.described), (8, 8));
    assert!(words.grammar.stated.is_none());
    assert_eq!(words.left_out.total(), 0);
    assert!(words.indexed);

    // An untagged Bible: nothing to say.
    let plain = stage_text(
        temp.path(),
        "JHN.usfm",
        "\\id JHN constructed\n\\c 1\n\\p\n\\v 1 In the beginning.\n",
    );
    let words = plain.preview(Default::default()).words;
    assert_eq!(
        (words.marked, words.indexed, words.not_indexed),
        (0, false, None)
    );
}

#[test]
fn raw_morphology_is_kept_and_not_described() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage_text(
        temp.path(),
        "JHN.usfm",
        "\\id JHN constructed test text\n\\c 1\n\\p\n\\v 1 \\w λόγος|lemma=\"λόγος\" x-morph=\"Gr,N,,,,,NMS,\"\\w* \\w ἦν|lemma=\"εἰμί\" x-morph=\"Gr,V,IIA3,,S,\"\\w*\n",
    );
    let words = staged.preview(Default::default()).words;
    assert_eq!(words.grammar.scheme, None);
    assert!(words.indexed);
    let mut list = staged
        .content
        .books
        .values()
        .flat_map(|b| b.chapters.values())
        .flat_map(|c| c.words.values())
        .flatten();
    assert_eq!(list.next().unwrap().morph.as_deref(), Some("Gr,N,,,,,NMS,"));
}

#[test]
fn malformed_attributes_leave_words_out_and_too_many_make_the_index_unreliable() {
    let temp = tempfile::tempdir().unwrap();
    // A few problems: indexed, and counted.
    let mut text = String::from("\\id GEN constructed test text\n\\c 1\n\\p\n\\v 1 ");
    for i in 0..200 {
        text.push_str(&format!("\\w w{i}|lemma=\"l{i}\"\\w* "));
    }
    text.push_str("\\w a|lemma=\"x\" lemma=\"y\"\\w* \\w b|lemma=bare\\w*\n");
    let words = stage_text(temp.path(), "GEN.usfm", &text)
        .preview(Default::default())
        .words;
    assert_eq!(words.left_out.conflict, 1);
    assert_eq!(words.left_out.syntax, 1);
    assert_eq!(words.words, 200);
    assert!(words.indexed);

    // Many: nothing is indexed, rather than a partial index that looks complete.
    let mut text = String::from("\\id GEN constructed test text\n\\c 1\n\\p\n\\v 1 ");
    for i in 0..100 {
        text.push_str(&format!(
            "\\w w{i}|lemma=\"l{i}\"\\w* \\w b{i}|lemma=\"open\\w* "
        ));
    }
    let staged = stage_text(temp.path(), "GEN2.usfm", &text);
    let words = staged.preview(Default::default()).words;
    assert!(words.left_out.syntax >= 100);
    assert_eq!(words.not_indexed, Some("unreliable"));
    assert!(!words.indexed);
}

#[test]
fn words_are_stored_per_translation_searched_and_removed_with_it() {
    with_db(|conn, dir| {
        let staged = stage_text(dir, "GEN.usfm", &hebrew_fixture());
        let a = commit(conn, &staged, "TSTA");
        let b = commit(
            conn,
            &stage_text(dir, "GEN-b.usfm", &hebrew_fixture()),
            "TSTB",
        );
        let plain = commit(
            conn,
            &stage_text(
                dir,
                "GEN-c.usfm",
                "\\id GEN constructed\n\\c 1\n\\p\n\\v 1 Plain words.\n",
            ),
            "TSTC",
        );
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_words"), 16);
        let info = bibles::get(conn, &a)?.words.expect("annotations recorded");
        assert_eq!(
            (info.word_count, info.lemmas, info.morph_scheme.as_str()),
            (8, true, "oshb")
        );
        assert!(bibles::get(conn, &plain)?.words.is_none());

        // Homographs: one lemma, two identifiers, two entries.
        let entries = bible_words::entries(
            conn,
            &LemmaLookup {
                translation_id: a.clone(),
                text: "ברא".into(),
            },
        )?;
        let found: Vec<_> = entries
            .iter()
            .map(|e| (e.strong.as_deref().unwrap(), e.occurrences))
            .collect();
        assert_eq!(found, [("H1254a", 1), ("H1254b", 1), ("c:H1254a", 1)]);

        // A lemma, with highlights exactly on its words.
        let result = bible_words::search(
            conn,
            &LemmaQuery {
                translation_id: a.clone(),
                selection: LemmaSelection::Lemma {
                    lemma: "אֱלֹהִים".into(),
                },
                morph: vec![],
                book: None,
            },
        )?;
        assert_eq!((result.occurrences, result.verses), (3, 3));
        assert_eq!(result.books[0].code, "GEN");
        let refs: Vec<_> = result
            .hits
            .iter()
            .map(|h| h.reference.canonical.clone())
            .collect();
        assert_eq!(refs, ["GEN.1.1", "GEN.1.2", "GEN.2.1"]);
        for hit in &result.hits {
            for (s, e) in &hit.matches {
                assert_eq!(utf16_slice(&hit.text, *s, *e), "אֱלֹהִים");
            }
        }
        assert_eq!(result.morph_scheme, "oshb");
        assert!(result.morphology[0].described.is_some());

        // A lexical identifier, exact, across the comma and colon parts.
        let by_id = bible_words::search(
            conn,
            &LemmaQuery {
                translation_id: a.clone(),
                selection: LemmaSelection::LexicalId {
                    id: "H1254a".into(),
                },
                morph: vec!["HC/Vqw3ms".into()],
                book: None,
            },
        )?;
        assert_eq!(by_id.occurrences, 1, "filtered to the one code");
        let lower = bible_words::search(
            conn,
            &LemmaQuery {
                translation_id: a.clone(),
                selection: LemmaSelection::LexicalId {
                    id: "h1254a".into(),
                },
                morph: vec![],
                book: None,
            },
        )?;
        assert_eq!(
            lower.occurrences, 2,
            "a lexical number in small letters, as in entries"
        );
        assert_eq!(
            by_id.morphology.len(),
            2,
            "codes are listed before the filter"
        );

        // The word inspector.
        let verse = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: a.clone(),
                verse: "GEN.1.1".into(),
            },
        )?;
        assert_eq!(verse.len(), 3);
        assert_eq!(verse[0].lexical_ids, ["H7225", "b"]);
        assert_eq!(verse[0].described.as_ref().unwrap().segments.len(), 2);

        // An untagged Bible says so.
        let err = bible_words::search(
            conn,
            &LemmaQuery {
                translation_id: plain.clone(),
                selection: LemmaSelection::Lemma { lemma: "x".into() },
                morph: vec![],
                book: None,
            },
        )
        .unwrap_err();
        assert!(
            matches!(&err, AppError::InvalidInput(m) if m.code == Some("words.unavailable")),
            "{err:?}"
        );

        // Removing one translation removes its words only.
        bibles::remove(conn, &a)?;
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_words"), 8);
        assert_eq!(
            count(conn, "SELECT COUNT(*) FROM bible_word_annotations"),
            1
        );
        for orphans in [
            "SELECT COUNT(*) FROM bible_words WHERE annotation_id NOT IN (SELECT id FROM bible_word_annotations)",
            "SELECT COUNT(*) FROM bible_lemma_entries WHERE annotation_id NOT IN (SELECT id FROM bible_word_annotations)",
            "SELECT COUNT(*) FROM bible_entry_ids WHERE entry_id NOT IN (SELECT id FROM bible_lemma_entries)",
        ] {
            assert_eq!(count(conn, orphans), 0, "{orphans}");
        }
        assert!(bibles::get(conn, &b)?.words.is_some());
        Ok(())
    });
}

#[test]
fn a_v16_database_upgrades_with_no_words_and_keeps_its_bibles() {
    use abiding_word_lib::db::migrations::{self, MIGRATIONS};
    let temp = tempfile::tempdir().unwrap();
    let path: PathBuf = temp.path().join("abiding-word.db");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::run_with(&mut conn, &MIGRATIONS[..16]).unwrap();
        conn.execute_batch(
            "INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin, import_status, created_at, updated_at)
             VALUES ('t-1', 'Fixture', 'FIX', 'English', 'structured', 'usfm', 'managed_copy', 'ready', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z');",
        )
        .unwrap();
    }
    let db = Database::open(&path, &temp.path().join("pre-migration")).unwrap();
    db.with_conn(|conn| {
        let t = bibles::get(conn, "t-1")?;
        assert!(t.words.is_none());
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_words"), 0);
        Ok(())
    })
    .unwrap();
}

// ---------------------------------------------------------------- scale

/// Peak resident memory of this process so far (Linux), in MiB.
fn peak_mib() -> Option<f64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    let line = status.lines().find(|l| l.starts_with("VmHWM:"))?;
    let kib: f64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kib / 1024.0)
}

/// A GENERATED annotated Bible (constructed test text, not Bible text): the
/// canon's real verse structure, `per_verse` marked words in every verse,
/// lemmas drawn unevenly from a pool of 6,000 (a few very common, most rare),
/// OSHB-style codes and lexical numbers. `every` keeps one book in `every`.
fn generated_bible(dir: &Path, per_verse: usize, every: usize) -> Vec<PathBuf> {
    use abiding_word_lib::scripture::canon::{self, BOOKS};
    const CODES: [&str; 6] = [
        "HNcmsa",
        "HVqp3ms",
        "HR/Ncfsa",
        "HC/Vqw3ms",
        "HTd/Ncmpa",
        "HTo",
    ];
    let mut files = Vec::new();
    let mut n: u64 = 0;
    for (b, book) in BOOKS.iter().enumerate().filter(|(b, _)| b % every == 0) {
        let mut text = format!("\\id {} generated test text — not Bible text\n", book.code);
        for c in 1..=book.chapter_count {
            text.push_str(&format!("\\c {c}\n\\p\n"));
            for v in 1..=canon::verse_count(book, c).unwrap_or(20) {
                text.push_str(&format!("\\v {v}"));
                for _ in 0..per_verse {
                    n = n
                        .wrapping_mul(6364136223846793005)
                        .wrapping_add(1442695040888963407);
                    // Uneven: squaring a uniform draw favours small numbers.
                    let u = (n >> 33) as f64 / (1u64 << 31) as f64;
                    let lemma = ((u * u * u) * 6000.0) as usize;
                    let code = CODES[(n >> 7) as usize % CODES.len()];
                    text.push_str(&format!(
                        " \\w w{lemma}x|lemma=\"l{lemma}\" strong=\"H{lemma}\" x-morph=\"{code}\"\\w*"
                    ));
                }
                text.push('\n');
            }
        }
        let path = dir.join(format!("{b:02}{}.usfm", book.code));
        std::fs::write(&path, text).unwrap();
        files.push(path);
    }
    files
}

struct Measured {
    words: i64,
    verses: i64,
    stage: std::time::Duration,
    commit: std::time::Duration,
    index_mib: f64,
    peak_mib: Option<f64>,
    queries: Vec<(String, usize, std::time::Duration)>,
}

fn measure(per_verse: usize, every: usize) -> Measured {
    use abiding_word_lib::scripture::concordance::{self, ConcordanceMode, ConcordanceQuery};
    use std::time::Instant;
    let temp = tempfile::tempdir().unwrap();
    let files = generated_bible(temp.path(), per_verse, every);
    let db = Database::open(&temp.path().join("aw.db"), &temp.path().join("pre")).unwrap();
    let started = Instant::now();
    let staged = import::stage(&files, ImportOrigin::UserFiles).unwrap();
    let stage = started.elapsed();
    let peak = peak_mib();
    assert!(staged.preview(Default::default()).words.indexed);
    db.with_conn(|conn| {
        let size = |conn: &Connection| -> f64 {
            let pages: i64 = conn
                .query_row("PRAGMA page_count", [], |r| r.get(0))
                .unwrap();
            let page: i64 = conn
                .query_row("PRAGMA page_size", [], |r| r.get(0))
                .unwrap();
            (pages * page) as f64 / 1_048_576.0
        };
        let started = Instant::now();
        let id = commit(conn, &staged, "GEN-PERF");
        let commit_took = started.elapsed();
        // The words' own share: the database with them, then without (both compacted).
        conn.execute_batch("VACUUM")?;
        let with_words = size(conn);
        let words: i64 = conn.query_row("SELECT COUNT(*) FROM bible_words", [], |r| r.get(0))?;
        let verses: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT verse_id) FROM bible_words",
            [],
            |r| r.get(0),
        )?;
        conn.execute_batch("DELETE FROM bible_word_annotations; VACUUM;")?;
        let text_only = size(conn);
        // Put them back for the queries.
        let tx = conn.unchecked_transaction()?;
        bible_words::insert(
            &tx,
            &id,
            &staged.content,
            "usfm",
            &Default::default(),
            "2026-10-23T00:00:00Z",
        )?;
        tx.commit()?;

        let mut queries = Vec::new();
        let mut time = |label: &str, f: &mut dyn FnMut() -> usize| {
            let started = Instant::now();
            let n = f();
            queries.push((label.to_string(), n, started.elapsed()));
        };
        let lemma = |l: &str| LemmaQuery {
            translation_id: id.clone(),
            selection: LemmaSelection::Lemma { lemma: l.into() },
            morph: vec![],
            book: None,
        };
        time("entries l0 (most frequent)", &mut || {
            bible_words::entries(
                conn,
                &LemmaLookup {
                    translation_id: id.clone(),
                    text: "l0".into(),
                },
            )
            .unwrap()
            .len()
        });
        time("lemma l0 (most frequent)", &mut || {
            bible_words::search(conn, &lemma("l0")).unwrap().occurrences
        });
        time("lemma l0, one book", &mut || {
            let mut q = lemma("l0");
            q.book = Some("GEN".into());
            bible_words::search(conn, &q).unwrap().hits.len()
        });
        time("lemma l0, one code", &mut || {
            let mut q = lemma("l0");
            q.morph = vec!["HVqp3ms".into()];
            bible_words::search(conn, &q).unwrap().occurrences
        });
        time("lemma l5000 (rare)", &mut || {
            bible_words::search(conn, &lemma("l5000"))
                .unwrap()
                .occurrences
        });
        time("lexical id H42", &mut || {
            bible_words::search(
                conn,
                &LemmaQuery {
                    translation_id: id.clone(),
                    selection: LemmaSelection::LexicalId { id: "H42".into() },
                    morph: vec![],
                    book: None,
                },
            )
            .unwrap()
            .occurrences
        });
        time("verse words GEN.1.1", &mut || {
            bible_words::verse_words(
                conn,
                &VerseWordsQuery {
                    translation_id: id.clone(),
                    verse: "GEN.1.1".into(),
                },
            )
            .unwrap()
            .len()
        });
        time("surface word w0x", &mut || {
            concordance::search(
                conn,
                &ConcordanceQuery {
                    translation_id: id.clone(),
                    query: "w0x".into(),
                    mode: ConcordanceMode::Word,
                    book: None,
                },
            )
            .unwrap()
            .occurrences
        });
        time("remove the Bible (cascade)", &mut || {
            bibles::remove(conn, &id).unwrap();
            0
        });
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_words"), 0);
        Ok(Measured {
            words,
            verses,
            stage,
            commit: commit_took,
            index_mib: with_words - text_only,
            peak_mib: peak,
            queries,
        })
    })
    .unwrap()
}

fn report(m: &Measured) {
    println!(
        "{} annotated words in {} verses: stage {:?}, commit {:?}, word index {:.1} MiB, peak memory {}",
        m.words,
        m.verses,
        m.stage,
        m.commit,
        m.index_mib,
        m.peak_mib.map_or("n/a".into(), |p| format!("{p:.0} MiB"))
    );
    for (label, n, took) in &m.queries {
        println!("  {label:<28} {n:>8}  {took:?}");
    }
}

#[test]
fn part_of_a_generated_annotated_bible_imports_and_answers_quickly() {
    // Every eighth book, 12 words a verse: about 50,000 words; in CI's debug build.
    let m = measure(12, 8);
    report(&m);
    assert!(m.words > 30_000);
    for (label, _, took) in &m.queries {
        assert!(
            *took < std::time::Duration::from_secs(3),
            "{label}: {took:?}"
        );
    }
}

/// The whole Bible at the density of a fully tagged edition (about 25 words a
/// verse, ~780,000 words). Measured for the documentation with
/// `cargo test --release --locked --test word_annotations -- --ignored --nocapture`.
#[test]
#[ignore]
fn a_whole_generated_annotated_bible_is_measured() {
    let m = measure(25, 1);
    report(&m);
    for (label, _, took) in &m.queries {
        // Removing a whole Bible is a rare, one-time action; queries must be quick.
        let limit = if label.starts_with("remove") { 15 } else { 2 };
        assert!(
            *took < std::time::Duration::from_secs(limit),
            "{label}: {took:?}"
        );
    }
}
