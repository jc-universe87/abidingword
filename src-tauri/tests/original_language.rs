//! Original-language research (v0.22): the Open Scriptures Hebrew Bible's
//! OSIS and MorphGNT importers, Hebrew-to-English verse maps, lexical-number
//! search for Strong's-only editions, where grammar descriptions come from,
//! and giving an installed Bible its word index again.
//!
//! Every fixture below is CONSTRUCTED TEST TEXT, not Bible text: short
//! invented sentences made of real Hebrew and Greek words, with lexical
//! numbers and grammar codes written for the test in each scheme's documented
//! form. Verse numbers are chosen to exercise the verse-map rules; they are
//! not the real verses at those places.

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bible_words::{
    self, LemmaLookup, LemmaQuery, LemmaSelection, VerseWordsQuery,
};
use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::import::{self, ImportOrigin, Severity, StagedImport};
use abiding_word_lib::scripture::{CommitImport, WordChoice};
use rusqlite::Connection;

fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, text).unwrap();
    path
}

fn stage(paths: &[PathBuf]) -> StagedImport {
    import::stage(paths, ImportOrigin::UserFiles).unwrap()
}

fn commit(
    conn: &Connection,
    staged: &StagedImport,
    short: &str,
    words: WordChoice,
) -> AppResult<String> {
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: format!("Fixture {short}"),
            short_name: short.into(),
            language: "Fixture".into(),
            language_code: None,
            publisher: None,
            copyright_notice: None,
            license_type: None,
            words,
        },
        &SourceRecord {
            origin: "managed_copy",
            path: Some("sources/bibles/test".into()),
            original_file_name: Some("fixture".into()),
            format: staged.format,
            is_builtin: false,
        },
    )?;
    Ok(id)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn utf16_slice(text: &str, start: usize, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start..end]).unwrap()
}

fn codes(staged: &StagedImport) -> Vec<&str> {
    staged
        .content
        .issues
        .iter()
        .filter_map(|i| i.code.as_deref())
        .collect()
}

// ---------------------------------------------------------------- OSHB OSIS

/// A constructed OSHB OSIS book: Joel with Hebrew chapter numbers (four
/// chapters), maqaf and sof pasuq marks, a note with a qere reading, a ketiv.
fn oshb_joel() -> String {
    r#"<?xml version="1.0" encoding="utf-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
<osisText osisIDWork="OSHB" osisRefWork="Bible" xml:lang="he">
<header>
<work osisWork="OSHB"><title>Constructed OSHB test</title><rights type="x-BY">Creative Commons Attribution 4.0</rights></work>
<work osisWork="WLC"><title>WLC</title><rights>Public Domain</rights></work>
</header>
<div type="book" osisID="Joel">
<chapter osisID="Joel.1">
<verse osisID="Joel.1.1"><w lemma="1697" morph="HNcmsc" id="01a">דְּבַר</w><seg type="x-maqqef">־</seg><w lemma="3068" morph="HNp" id="01b">יְהוָה</w> <w lemma="b/7225" morph="HR/Ncfsa" id="01c">בְּ/רֵאשִׁית</w><note type="variant"><catchWord>x</catchWord><rdg type="x-qere"><w lemma="9999" morph="HNcmsa">קרי</w></rdg></note><seg type="x-sof-pasuq">׃</seg></verse>
</chapter>
<chapter osisID="Joel.3">
<verse osisID="Joel.3.1"><w lemma="430" morph="HNcmpa" id="03a">אֱלֹהִים</w> <w type="x-ketiv" lemma="1254 a" morph="HVqp3ms" id="03b">בָּרָא</w><seg type="x-sof-pasuq">׃</seg></verse>
</chapter>
<chapter osisID="Joel.4">
<verse osisID="Joel.4.1"><w lemma="c/430" morph="HC/Ncmpa" id="04a">וֵ/אלֹהִים</w> <w lemma="1254 a" morph="HVqp3ms" id="04b">בָּרָא</w><seg type="x-sof-pasuq">׃</seg></verse>
</chapter>
</div>
</osisText>
</osis>
"#
    .to_string()
}

/// A constructed verse map in OSHB's format.
const JOEL_MAP: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<verseMap>
<book osisID="Joel"><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.4.1" kjv="Joel.3.1" type="full"/></book>
</verseMap>
"#;

#[test]
fn an_oshb_book_reads_its_words_marks_and_numbers_without_inventing_lemmas() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[
        write(temp.path(), "Joel.xml", &oshb_joel()),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    assert_eq!(staged.format, "osis");
    assert!(!staged.content.has_errors(), "{:?}", staged.content.issues);
    let joel = &staged.content.books[&29];
    let one = &joel.chapters[&1];
    // Morpheme separators gone, maqaf and sof pasuq attached, the qere note not text.
    assert_eq!(one.verses[&1], "דְּבַר־יְהוָה בְּרֵאשִׁית׃");
    let words = &one.words[&1];
    assert_eq!(words.len(), 3);
    for w in words {
        assert_eq!(utf16_slice(&one.verses[&1], w.start, w.end), w.surface);
        // OSHB's lemma attribute is a lexical identifier, never a dictionary form.
        assert!(w.lemma.is_none());
    }
    assert_eq!(words[2].strong.as_deref(), Some("b/7225"));
    // The prefix letter "b" is a morpheme, not a lexical number.
    assert_eq!(words[2].ids, vec!["7225".to_string()]);
    assert_eq!(words[2].morph.as_deref(), Some("HR/Ncfsa"));

    // The Hebrew chapters 3 and 4 are the English 2:28 and 3:1.
    assert_eq!(joel.chapters[&2].verses[&28], "אֱלֹהִים בָּרָא׃");
    assert_eq!(joel.chapters[&3].verses[&1], "וֵאלֹהִים בָּרָא׃");
    assert!(!joel.chapters.contains_key(&4));
    assert!(codes(&staged).contains(&"bibleImport.verseMapApplied"));

    // The format names its scheme: that is the statement.
    let grammar = &staged.content.words.report.grammar;
    assert_eq!(grammar.scheme, Some("oshb"));
    assert_eq!(grammar.stated.as_ref().unwrap().words, "osisWork=\"OSHB\"");
    let preview = staged.preview(Default::default());
    assert_eq!(preview.suggested.name, "Constructed OSHB test");
    assert!(preview
        .suggested
        .copyright_notice
        .unwrap()
        .contains("Creative Commons Attribution 4.0"));
}

#[test]
fn without_a_verse_map_hebrew_numbering_is_refused_with_a_way_forward() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[write(temp.path(), "Joel.xml", &oshb_joel())]);
    assert!(staged.content.has_errors());
    let found = codes(&staged);
    assert!(found.contains(&"bibleImport.chapterOutOfRange"));
    // Once for the chapter, not once per verse.
    assert_eq!(
        found
            .iter()
            .filter(|c| **c == "bibleImport.chapterOutOfRange")
            .count(),
        1
    );
    assert!(found.contains(&"bibleImport.hebrewNumbering"));
}

#[test]
fn a_verse_map_is_not_used_on_english_numbering_and_a_broken_one_is_not_used_at_all() {
    let temp = tempfile::tempdir().unwrap();
    // A USFM text already in English numbering (not OSHB, which is always Hebrew-numbered).
    let english = "\\id JOL constructed test text\n\\c 2\n\\p\n\\v 28 אֱלֹהִים בָּרָא׃\n\\c 3\n\\p\n\\v 1 וֵאלֹהִים בָּרָא׃\n";
    let staged = stage(&[
        write(temp.path(), "JOL.usfm", english),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    assert!(codes(&staged).contains(&"bibleImport.verseMapUnused"));
    assert_eq!(
        staged.content.books[&29].chapters[&3].verses[&1],
        "וֵאלֹהִים בָּרָא׃"
    );

    let broken = r#"<verseMap><verse wlc="Joel.3.1" kjv="Amos.2.28" type="full"/></verseMap>"#;
    let staged = stage(&[
        write(temp.path(), "JOL.usfm", english),
        write(temp.path(), "VerseMap.xml", broken),
    ]);
    assert!(codes(&staged).contains(&"bibleImport.verseMapRefused"));
}

#[test]
fn a_single_hebrew_book_is_renumbered_too() {
    let temp = tempfile::tempdir().unwrap();
    let w = |text: &str| format!(r#"<w lemma="430" morph="HNcmpa">{text}</w>"#);
    // One OSHB book with no Joel or Malachi: still the Hebrew numbering.
    let osis = format!(
        r#"<osis><osisText osisIDWork="OSHB"><header><work osisWork="OSHB"><title>T</title></work></header>
<div type="book" osisID="Ps"><chapter osisID="Ps.3"><verse osisID="Ps.3.1">{a}</verse><verse osisID="Ps.3.2">{b}</verse></chapter></div></osisText></osis>"#,
        a = w("מִזְמוֹר"),
        b = w("יְהוָה"),
    );
    let map = r#"<verseMap><verse wlc="Ps.3.2" kjv="Ps.3.1" type="full"/></verseMap>"#;
    let staged = stage(&[
        write(temp.path(), "Ps.xml", &osis),
        write(temp.path(), "VerseMap.xml", map),
    ]);
    let psalm = &staged.content.books[&19].chapters[&3];
    assert_eq!(psalm.superscription.as_deref(), Some("מִזְמוֹר"));
    assert_eq!(psalm.verses[&1], "יְהוָה");
    // Without the map, OSHB input is told to add it.
    let staged = stage(&[write(temp.path(), "Ps.xml", &osis)]);
    assert!(codes(&staged).contains(&"bibleImport.hebrewNumbering"));
    // A USFM book whose verse numbers only the Hebrew numbering has (Gen 32:33).
    let usfm = "\\id GEN constructed\n\\c 32\n\\p\n\\v 1 א\n\\v 33 ב\n";
    let map = r#"<verseMap><verse wlc="Gen.32.1" kjv="Gen.31.55" type="full"/><verse wlc="Gen.32.33" kjv="Gen.32.32" type="full"/></verseMap>"#;
    let staged = stage(&[
        write(temp.path(), "GEN.usfm", usfm),
        write(temp.path(), "VerseMap.xml", map),
    ]);
    let gen = &staged.content.books[&1].chapters;
    assert_eq!(gen[&31].verses[&55], "א");
    assert_eq!(gen[&32].verses[&32], "ב");
}

#[test]
fn character_references_are_read_and_unknown_entities_refused() {
    let temp = tempfile::tempdir().unwrap();
    let joel = oshb_joel().replace("דְּבַר</w>", "דְּבַ&#x5E8;</w>");
    let staged = stage(&[
        write(temp.path(), "Joel.xml", &joel),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    assert!(staged.content.books[&29].chapters[&1].verses[&1].starts_with("דְּבַר־"));
    let joel = oshb_joel().replace("דְּבַר</w>", "דְּבַר&unknown;</w>");
    let staged = stage(&[
        write(temp.path(), "Joel.xml", &joel),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    assert!(codes(&staged).contains(&"bibleImport.badOsis"));
}

#[test]
fn psalm_titles_and_joined_verses_follow_the_map_rules() {
    let temp = tempfile::tempdir().unwrap();
    let w = |lemma: &str, text: &str| format!(r#"<w lemma="{lemma}" morph="HNcmsa">{text}</w>"#);
    let osis = format!(
        r#"<osis><osisText osisIDWork="OSHB"><header><work osisWork="OSHB"><title>T</title></work></header>
<div type="book" osisID="Ps"><chapter osisID="Ps.3">
<verse osisID="Ps.3.1">{t}</verse><verse osisID="Ps.3.2">{a}</verse><verse osisID="Ps.3.3">{b}</verse>
</chapter></div></osisText></osis>"#,
        t = w("4210", "מִזְמוֹר"),
        a = w("3068", "יְהוָה"),
        b = w("430", "אֱלֹהִים"),
    );
    let numbers = format!(
        r#"<osis><osisText osisIDWork="OSHB"><header><work osisWork="OSHB"><title>T</title></work></header>
<div type="book" osisID="Num"><chapter osisID="Num.25">
<verse osisID="Num.25.18">{a}</verse><verse osisID="Num.25.19">{b}</verse></chapter>
<chapter osisID="Num.26"><verse osisID="Num.26.1">{c}</verse></chapter>
<chapter osisID="Joel.4"></chapter></div></osisText></osis>"#,
        a = w("1697", "דָּבָר"),
        b = w("3068", "יְהוָה"),
        c = w("430", "אֱלֹהִים"),
    );
    // Joel 4 marks the files as Hebrew-numbered.
    let joel = oshb_joel();
    let map = r#"<verseMap>
<verse wlc="Ps.3.2" kjv="Ps.3.1" type="full"/><verse wlc="Ps.3.3" kjv="Ps.3.2" type="full"/>
<verse wlc="Num.25.19" kjv="Num.26.1!a" type="partial"/>
<verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.4.1" kjv="Joel.3.1" type="full"/>
</verseMap>"#;
    let staged = stage(&[
        write(temp.path(), "Ps.xml", &osis),
        write(
            temp.path(),
            "Num.xml",
            &numbers.replace("<chapter osisID=\"Joel.4\"></chapter>", ""),
        ),
        write(temp.path(), "Joel.xml", &joel),
        write(temp.path(), "VerseMap.xml", map),
    ]);
    let psalm = &staged.content.books[&19].chapters[&3];
    assert_eq!(psalm.superscription.as_deref(), Some("מִזְמוֹר"));
    assert_eq!(psalm.verses[&1], "יְהוָה");
    assert_eq!(psalm.verses[&2], "אֱלֹהִים");
    assert!(!psalm.verses.contains_key(&3));
    // The title's words are not words of a verse.
    assert!(psalm.words[&1].iter().all(|w| w.surface != "מִזְמוֹר"));
    let num = &staged.content.books[&4].chapters;
    assert_eq!(num[&26].verses[&1], "יְהוָה אֱלֹהִים");
    let joined = &num[&26].words[&1];
    assert_eq!(
        utf16_slice(&num[&26].verses[&1], joined[1].start, joined[1].end),
        "אֱלֹהִים"
    );
    assert!(!num[&25].verses.contains_key(&19));
}

#[test]
fn broken_or_foreign_xml_is_refused_and_never_half_read_silently() {
    let temp = tempfile::tempdir().unwrap();
    let cut = &oshb_joel()[..oshb_joel().find("<chapter osisID=\"Joel.3\">").unwrap()];
    let staged = stage(&[write(
        temp.path(),
        "Joel.xml",
        &format!("{cut}<verse osisID=\"Joel.1.2\"><w>x</q>"),
    )]);
    assert!(codes(&staged).contains(&"bibleImport.badOsis"));
    assert!(staged.content.has_errors());

    // Another publisher's OSIS (or USX) alone is refused as not yet supported.
    let other = write(
        temp.path(),
        "book.xml",
        "<osis><osisText osisIDWork=\"KJV\"></osisText></osis>",
    );
    match import::stage(std::slice::from_ref(&other), ImportOrigin::UserFiles) {
        Err(AppError::UnsupportedFormat(m)) => assert_eq!(m.code, Some("bibleImport.formatNotYet")),
        Err(other) => panic!("{other:?}"),
        Ok(_) => panic!("foreign OSIS was read"),
    }
    // Beside readable files, it is set aside.
    let staged = stage(&[
        other,
        write(temp.path(), "Joel.xml", &oshb_joel()),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    assert!(!staged.content.has_errors());
}

#[test]
fn an_oshb_bible_is_searched_by_number_and_its_grammar_is_described_on_the_editions_word() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[
        write(temp.path(), "Joel.xml", &oshb_joel()),
        write(temp.path(), "VerseMap.xml", JOEL_MAP),
    ]);
    with_db(|conn| {
        let id = commit(conn, &staged, "OSHB", WordChoice::default())?;
        let words = bibles::get(conn, &id)?.words.unwrap();
        assert_eq!(
            (words.morph_scheme.as_str(), words.grammar_basis.as_deref()),
            ("oshb", Some("edition"))
        );
        assert_eq!(words.source_format, "osis");
        assert!(!words.lemmas && words.lexical_ids);
        // "430" finds both entries that carry it ("430" and "c/430"): all its words at once.
        let entries = bible_words::entries(
            conn,
            &LemmaLookup {
                translation_id: id.clone(),
                text: "430".into(),
            },
        )?;
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .all(|e| e.matched_id.as_deref() == Some("430") && e.lemma.is_none()));
        let all = bible_words::search(
            conn,
            &LemmaQuery {
                translation_id: id.clone(),
                selection: LemmaSelection::LexicalId { id: "430".into() },
                morph: vec![],
                book: None,
            },
        )?;
        assert_eq!(all.occurrences, 2);
        // A homograph letter: written with or without the space.
        let homograph = bible_words::entries(
            conn,
            &LemmaLookup {
                translation_id: id.clone(),
                text: "1254a".into(),
            },
        )?;
        assert_eq!(homograph[0].strong.as_deref(), Some("1254 a"));
        let verse = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: id.clone(),
                verse: "JOL.1.1".into(),
            },
        )?;
        assert!(verse[2].described.is_some());
        Ok(())
    });
}

// ---------------------------------------------------------------- MorphGNT

/// Constructed MorphGNT lines (book 04 is John): an invented sentence, a
/// vocative (a case the README does not list), and enough plain verses that
/// the codes still fit the documented scheme (95%).
fn morphgnt() -> String {
    let mut text = MORPHGNT_START.to_string();
    for verse in 3..=30 {
        text.push_str(&format!(
            "0401{verse:02} N- ----NSM- λόγος. λόγος λόγος λόγος\n"
        ));
    }
    text
}

const MORPHGNT_START: &str = "040101 RA ----NSM- ὁ ὁ ὁ ὁ\n\
040101 N- ----NSM- λόγος λόγος λόγος λόγος\n\
040101 V- 3IAI-S-- ἦν ἦν ἦν εἰμί\n\
040101 P- -------- ἐν ἐν ἐν ἐν\n\
040101 N- ----DSF- ἀρχῇ. ἀρχῇ ἀρχῇ ἀρχή\n\
040102 N- ----VSM- λόγε, λόγε λόγε λόγος\n";

#[test]
fn morphgnt_gives_dictionary_forms_and_grammar_described_as_morphgnt() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[write(temp.path(), "64-Jn-morphgnt.txt", &morphgnt())]);
    assert_eq!(staged.format, "morphgnt");
    let john = &staged.content.books[&43].chapters[&1];
    assert_eq!(john.verses[&1], "ὁ λόγος ἦν ἐν ἀρχῇ.");
    let words = &john.words[&1];
    assert_eq!(
        utf16_slice(&john.verses[&1], words[4].start, words[4].end),
        "ἀρχῇ"
    );
    assert_eq!(words[2].lemma.as_deref(), Some("εἰμί"));
    assert!(words.iter().all(|w| w.strong.is_none()));
    let report = &staged.content.words.report;
    assert!(report.indexed);
    assert_eq!(report.grammar.scheme, Some("morphgnt"));
    assert!(report.grammar.stated.is_some());
    with_db(|conn| {
        let id = commit(conn, &staged, "MGNT", WordChoice::default())?;
        let entries = bible_words::entries(
            conn,
            &LemmaLookup {
                translation_id: id.clone(),
                text: "λογος".into(),
            },
        )?;
        assert_eq!(entries[0].occurrences, 30);
        let verse = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: id.clone(),
                verse: "JHN.1.1".into(),
            },
        )?;
        assert!(verse[2].described.is_some());
        // The vocative the README does not list stays as written.
        let two = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: id,
                verse: "JHN.1.2".into(),
            },
        )?;
        assert_eq!(two[0].morph.as_deref(), Some("N- ----VSM-"));
        assert!(two[0].described.is_none());
        Ok(())
    });
}

#[test]
fn malformed_morphgnt_lines_are_counted_and_too_many_refuse_the_book() {
    let temp = tempfile::tempdir().unwrap();
    let mut text = morphgnt();
    text.push_str("040131 N- ----NSM- only five\n");
    let staged = stage(&[write(temp.path(), "a.txt", &text)]);
    assert!(codes(&staged).contains(&"bibleImport.badLines"));
    assert!(!staged.content.has_errors());
    for _ in 0..20 {
        text.push_str("not a morphgnt line at all\n");
    }
    let staged = stage(&[write(temp.path(), "a.txt", &text)]);
    assert!(staged.content.has_errors());
}

// ---------------------------------------------------------------- Strong's only

fn strongs_only() -> String {
    "\\id JHN constructed test text\n\\c 1\n\\p\n\\v 1 \\w ὁ|strong=\"G3588\"\\w* \\w λόγος|strong=\"G3056\"\\w* \\w ἦν|strong=\"G1510\"\\w*\n\\v 2 \\w λόγον|strong=\"G3056\"\\w*\n".into()
}

#[test]
fn lexical_numbers_alone_are_indexed_only_when_asked_and_found_in_any_spelling() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[write(temp.path(), "JHN.usfm", &strongs_only())]);
    let report = &staged.content.words.report;
    assert_eq!(
        (report.indexed, report.not_indexed),
        (false, Some("strongOnly"))
    );
    assert_eq!(report.words, 4);
    assert_eq!(report.estimated_bytes, 4 * import::BYTES_PER_WORD);
    with_db(|conn| {
        let plain = commit(conn, &staged, "SO1", WordChoice::default())?;
        assert!(bibles::get(conn, &plain)?.words.is_none());

        let id = commit(
            conn,
            &staged,
            "SO2",
            WordChoice {
                numbers: true,
                grammar: None,
            },
        )?;
        let words = bibles::get(conn, &id)?.words.unwrap();
        assert!(words.lexical_ids && !words.lemmas && !words.morphology);
        for typed in ["G3056", "g3056", "3056", "G03056"] {
            let entries = bible_words::entries(
                conn,
                &LemmaLookup {
                    translation_id: id.clone(),
                    text: typed.into(),
                },
            )?;
            assert_eq!(entries.len(), 1, "{typed}");
            assert_eq!(entries[0].strong.as_deref(), Some("G3056"));
            assert_eq!(entries[0].occurrences, 2);
            // A number is never shown as a lemma.
            assert!(entries[0].lemma.is_none());
        }
        // A different number is never the same number.
        for typed in ["G305", "G30560", "H3056"] {
            let entries = bible_words::entries(
                conn,
                &LemmaLookup {
                    translation_id: id.clone(),
                    text: typed.into(),
                },
            )?;
            assert!(entries.is_empty(), "{typed}");
        }
        Ok(())
    });
}

#[test]
fn bible_words_number_variants_are_only_spellings_of_the_same_number() {
    let v = bible_words::number_variants("H430");
    assert!(v.contains(&"H0430".to_string()) && v.contains(&"H430".to_string()));
    assert!(!v.iter().any(|x| x.starts_with('G')));
    // An edition that writes bare numbers (OSHB) is found from "H430" too.
    assert!(v.contains(&"430".to_string()));
    let v = bible_words::number_variants("1254a");
    assert!(v.contains(&"1254 a".to_string()) && v.contains(&"H1254a".to_string()));
    assert_eq!(
        bible_words::number_variants("λόγος"),
        vec!["λόγος".to_string()]
    );
    assert_eq!(
        bible_words::number_variants("H12345678"),
        vec!["H12345678".to_string()]
    );
}

// ---------------------------------------------------------------- provenance

fn robinson_text() -> String {
    "\\id JHN constructed test text\n\\c 1\n\\p\n\\v 1 \\w λογος|strong=\"G3056\" x-morph=\"N-NSM\"\\w* \\w ην|strong=\"G1510\" x-morph=\"V-IAI-3S\"\\w*\n".into()
}

#[test]
fn a_fitting_scheme_is_described_only_on_the_editions_word_or_the_persons_choice() {
    let temp = tempfile::tempdir().unwrap();
    // No statement: the codes fit Robinson's scheme, but are shown as written.
    let staged = stage(&[write(temp.path(), "JHN.usfm", &robinson_text())]);
    let grammar = &staged.content.words.report.grammar;
    assert_eq!(
        (grammar.scheme, grammar.coded, grammar.described),
        (Some("robinson"), 2, 2)
    );
    assert!(grammar.stated.is_none());
    with_db(|conn| {
        let raw = commit(conn, &staged, "R1", WordChoice::default())?;
        let words = bibles::get(conn, &raw)?.words.unwrap();
        assert_eq!(
            (words.morph_scheme.as_str(), words.grammar_basis.as_deref()),
            ("raw", None)
        );
        let verse = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: raw,
                verse: "JHN.1.1".into(),
            },
        )?;
        assert!(verse.iter().all(|w| w.described.is_none()));

        // The person chooses the scheme the codes fit.
        let chosen = commit(
            conn,
            &staged,
            "R2",
            WordChoice {
                numbers: false,
                grammar: Some("robinson".into()),
            },
        )?;
        let words = bibles::get(conn, &chosen)?.words.unwrap();
        assert_eq!(
            (words.morph_scheme.as_str(), words.grammar_basis.as_deref()),
            ("robinson", Some("person"))
        );
        let verse = bible_words::verse_words(
            conn,
            &VerseWordsQuery {
                translation_id: chosen,
                verse: "JHN.1.1".into(),
            },
        )?;
        assert!(verse.iter().all(|w| w.described.is_some()));

        // A scheme they do not fit is refused, and nothing is added.
        let wrong = commit(
            conn,
            &staged,
            "R3",
            WordChoice {
                numbers: false,
                grammar: Some("oshb".into()),
            },
        );
        assert!(
            matches!(wrong, Err(AppError::InvalidInput(ref m)) if m.code == Some("words.grammarNotFit"))
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM bible_translations WHERE short_name = 'R3'",
                [],
                |r| r.get::<_, i64>(0)
            )?,
            0
        );
        Ok(())
    });

    // The edition's own front matter names Robinson: described, on its word.
    let frt = "\\id FRT constructed front matter\n\\p PARSING CODES FOR VERB-RELATED FORMS, by Maurice A. Robinson\n";
    let staged = stage(&[
        write(temp.path(), "JHN.usfm", &robinson_text()),
        write(temp.path(), "00-FRT.usfm", frt),
    ]);
    let stated = staged.content.words.report.grammar.stated.clone().unwrap();
    assert_eq!(stated.file, "00-FRT.usfm");
    with_db(|conn| {
        let id = commit(conn, &staged, "R4", WordChoice::default())?;
        let words = bibles::get(conn, &id)?.words.unwrap();
        assert_eq!(words.grammar_basis.as_deref(), Some("edition"));
        assert_eq!(words.grammar_evidence.unwrap().file, "00-FRT.usfm");
        Ok(())
    });

    // A copr.htm naming another scheme states nothing about these codes.
    let copr = write(
        temp.path(),
        "copr.htm",
        "<p>credit the Open Scriptures Hebrew Bible Project</p>",
    );
    let staged = stage(&[write(temp.path(), "JHN.usfm", &robinson_text()), copr]);
    assert!(staged.content.words.report.grammar.stated.is_none());
}

// ---------------------------------------------------------------- re-indexing

#[test]
fn an_installed_bible_gains_its_word_index_without_changing_its_text() {
    let temp = tempfile::tempdir().unwrap();
    let staged = stage(&[write(temp.path(), "JHN.usfm", &strongs_only())]);
    with_db(|conn| {
        let id = commit(conn, &staged, "RE", WordChoice::default())?;
        let text_before: String = conn.query_row(
            "SELECT group_concat(text, '|') FROM bible_verse_texts WHERE translation_id = ?1",
            [&id],
            |r| r.get(0),
        )?;
        // Read again (as from its kept copy) and indexed by number, on request.
        let again = stage(&[write(temp.path(), "JHN.usfm", &strongs_only())]);
        bible_words::replace(
            conn,
            &id,
            &again.content,
            again.format,
            &WordChoice {
                numbers: true,
                grammar: None,
            },
        )?;
        assert!(bibles::get(conn, &id)?.words.unwrap().lexical_ids);
        // Again: replaced, not doubled.
        bible_words::replace(
            conn,
            &id,
            &again.content,
            again.format,
            &WordChoice {
                numbers: true,
                grammar: None,
            },
        )?;
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM bible_words", [], |r| r
                .get::<_, i64>(0))?,
            4
        );
        let text_after: String = conn.query_row(
            "SELECT group_concat(text, '|') FROM bible_verse_texts WHERE translation_id = ?1",
            [&id],
            |r| r.get(0),
        )?;
        assert_eq!(text_before, text_after);

        // Files that no longer give exactly this text are refused.
        let changed = stage(&[write(
            temp.path(),
            "JHN.usfm",
            &strongs_only().replace("λόγον", "λόγου"),
        )]);
        let refused = bible_words::replace(
            conn,
            &id,
            &changed.content,
            changed.format,
            &WordChoice {
                numbers: true,
                grammar: None,
            },
        );
        assert!(
            matches!(refused, Err(AppError::InvalidInput(ref m)) if m.code == Some("words.textDiffers"))
        );
        // Nothing indexable is refused too, and the index stays.
        let none = bible_words::replace(
            conn,
            &id,
            &again.content,
            again.format,
            &WordChoice::default(),
        );
        assert!(
            matches!(none, Err(AppError::InvalidInput(ref m)) if m.code == Some("words.nothingToIndex"))
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM bible_words", [], |r| r
                .get::<_, i64>(0))?,
            4
        );
        Ok(())
    });
}

// ---------------------------------------------------------------- migration

#[test]
fn a_v17_database_keeps_its_words_and_stops_describing_on_a_fit_alone() {
    use abiding_word_lib::db::migrations::{self, MIGRATIONS};
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::run_with(&mut conn, &MIGRATIONS[..17]).unwrap();
        conn.execute_batch(
            "INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin, import_status, created_at, updated_at)
             VALUES ('t-1', 'Fixture', 'FIX', 'Hebrew', 'structured', 'usfm', 'managed_copy', 'ready', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z');
             INSERT INTO bible_word_annotations (id, translation_id, source_format, word_count, verse_count, lemma_count, strong_count, morph_count, morph_attribute, morph_scheme, details, created_at)
             VALUES (1, 't-1', 'usfm', 0, 0, 0, 0, 0, 'x-morph', 'oshb', '{}', '2026-10-20T10:00:00Z');",
        )
        .unwrap();
    }
    let db = Database::open(&path, &temp.path().join("pre-migration")).unwrap();
    db.with_conn(|conn| {
        let words = bibles::get(conn, "t-1")?.words.unwrap();
        assert_eq!(words.morph_scheme, "raw");
        assert!(words.grammar_basis.is_none() && words.grammar_evidence.is_none());
        // The new columns take only the documented values.
        let bad = conn.execute(
            "UPDATE bible_word_annotations SET grammar_scheme = 'guess'",
            [],
        );
        assert!(bad.is_err());
        Ok(())
    })
    .unwrap();
    assert_eq!(
        std::fs::read_dir(temp.path().join("pre-migration"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn notes_and_maps_are_size_limited_and_issues_are_severities_not_text() {
    let temp = tempfile::tempdir().unwrap();
    // A copr.htm larger than the notes limit is not read (and not an error).
    let big = write(
        temp.path(),
        "copr.htm",
        &"Maurice A. Robinson PARSING CODES ".repeat(40_000),
    );
    let staged = stage(&[write(temp.path(), "JHN.usfm", &robinson_text()), big]);
    assert!(staged.content.words.report.grammar.stated.is_none());
    assert!(staged
        .content
        .issues
        .iter()
        .all(|i| i.severity != Severity::Error));
}

#[test]
fn a_psalm_title_of_two_hebrew_verses_stays_a_title() {
    let temp = tempfile::tempdir().unwrap();
    let w = |lemma: &str, text: &str| format!(r#"<w lemma="{lemma}" morph="HNcmsa">{text}</w>"#);
    // As the map writes Psalm 51: Hebrew 1–2 are the title, and both 2 and 3 map to English 1.
    let osis = format!(
        r#"<osis><osisText osisIDWork="OSHB"><header><work osisWork="OSHB"><title>T</title></work></header>
<div type="book" osisID="Ps"><chapter osisID="Ps.51">
<verse osisID="Ps.51.1">{a}</verse><verse osisID="Ps.51.2">{b}</verse><verse osisID="Ps.51.3">{c}</verse><verse osisID="Ps.51.4">{d}</verse>
</chapter></div></osisText></osis>"#,
        a = w("4210", "מִזְמוֹר"),
        b = w("5416", "נָתָן"),
        c = w("2603", "חָנֵּנִי"),
        d = w("3526", "כַּבְּסֵנִי"),
    );
    let map = r#"<verseMap><verse wlc="Ps.51.2" kjv="Ps.51.1" type="full"/><verse wlc="Ps.51.3" kjv="Ps.51.1" type="full"/>
<verse wlc="Ps.51.4" kjv="Ps.51.2" type="full"/><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.4.1" kjv="Joel.3.1" type="full"/></verseMap>"#;
    let staged = stage(&[
        write(temp.path(), "Ps.xml", &osis),
        write(temp.path(), "Joel.xml", &oshb_joel()),
        write(temp.path(), "VerseMap.xml", map),
    ]);
    let psalm = &staged.content.books[&19].chapters[&51];
    assert_eq!(psalm.superscription.as_deref(), Some("מִזְמוֹר נָתָן"));
    assert_eq!(psalm.verses[&1], "חָנֵּנִי");
    assert_eq!(psalm.verses[&2], "כַּבְּסֵנִי");
    assert_eq!(psalm.words[&1].len(), 1);
}
