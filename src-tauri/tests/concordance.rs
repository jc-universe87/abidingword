//! Concordance (v0.12): surface-form word and phrase occurrences in one
//! installed Bible, through the real import path. All text is invented.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::error::AppResult;
use abiding_word_lib::scripture::concordance::{self, ConcordanceMode, ConcordanceQuery};
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::CommitImport;
use rusqlite::Connection;

/// Installs a Bible from (file name, USFM) pairs; returns its id.
fn install(
    conn: &Connection,
    dir: &Path,
    short: &str,
    language: &str,
    books: &[(&str, String)],
) -> String {
    let folder = dir.join(short);
    std::fs::create_dir_all(&folder).unwrap();
    let files: Vec<PathBuf> = books
        .iter()
        .map(|(name, text)| {
            let path = folder.join(name);
            std::fs::write(&path, text).unwrap();
            path
        })
        .collect();
    let staged = import::stage(&files, ImportOrigin::UserFiles).unwrap();
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: format!("Fixture {short}"),
            short_name: short.into(),
            language: language.into(),
            language_code: None,
            publisher: None,
            copyright_notice: None,
            license_type: None,
            words: Default::default(),
            as_document: false,
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

fn book(code: &str, verses: &[&str]) -> (String, String) {
    let mut text = format!("\\id {code} Fixture (test only)\n\\c 1\n\\p\n");
    for (i, v) in verses.iter().enumerate() {
        text.push_str(&format!("\\v {} {}\n", i + 1, v));
    }
    (format!("{code}.usfm"), text)
}

fn pairs(v: &[(String, String)]) -> Vec<(&str, String)> {
    v.iter().map(|(n, t)| (n.as_str(), t.clone())).collect()
}

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

fn look(
    conn: &Connection,
    translation: &str,
    query: &str,
    mode: ConcordanceMode,
) -> concordance::ConcordanceResult {
    concordance::search(
        conn,
        &ConcordanceQuery {
            translation_id: translation.into(),
            query: query.into(),
            mode,
            book: None,
        },
    )
    .unwrap()
}

use ConcordanceMode::{Phrase, Word};

fn english(conn: &Connection, dir: &Path) -> String {
    let books: Vec<(String, String)> = vec![
        book(
            "ROM",
            &[
                "Saved by grace, not by works.",
                "Grace upon grace; no disgrace.",
                "The other one.",
            ],
        ),
        book("EPH", &["For by grace you are saved.", "Grace to you."]),
        book("JHN", &["Full of grace and truth."]),
    ];
    let refs: Vec<(&str, String)> = books.iter().map(|(n, t)| (n.as_str(), t.clone())).collect();
    install(conn, dir, "EN", "English", &refs)
}

#[test]
fn words_are_whole_tokens_case_folded_and_counted_by_book() {
    with_db(|conn, dir| {
        let en = english(conn, dir);
        let r = look(conn, &en, "Grace", Word);
        // ROM 1 (1), ROM 2 (2: "Grace upon grace", not "disgrace"), EPH 1, EPH 2, JHN 1
        assert_eq!(r.verses, 5);
        assert_eq!(r.occurrences, 6);
        let books: Vec<(&str, usize, usize)> = r
            .books
            .iter()
            .map(|b| (b.code.as_str(), b.verses, b.occurrences))
            .collect();
        assert_eq!(books, vec![("JHN", 1, 1), ("ROM", 2, 3), ("EPH", 2, 2)]);
        assert!(r.hits_complete);
        let rom2 = r
            .hits
            .iter()
            .find(|h| h.reference.canonical == "ROM.1.2")
            .unwrap();
        assert_eq!(rom2.matches, vec![(0, 5), (11, 16)]);
        // "he" never matches inside "the" or "other"
        assert_eq!(look(conn, &en, "he", Word).verses, 0);
        Ok(())
    });
}

#[test]
fn phrases_are_consecutive_and_differ_from_words() {
    with_db(|conn, dir| {
        let en = english(conn, dir);
        let r = look(conn, &en, "by grace", Phrase);
        assert_eq!(r.verses, 2);
        assert_eq!(r.occurrences, 2);
        let refs: Vec<&str> = r
            .hits
            .iter()
            .map(|h| h.reference.canonical.as_str())
            .collect();
        assert_eq!(refs, vec!["ROM.1.1", "EPH.1.1"]);
        assert!(concordance::search(
            conn,
            &ConcordanceQuery {
                translation_id: en.clone(),
                query: "by grace".into(),
                mode: Word,
                book: None
            }
        )
        .is_err());
        Ok(())
    });
}

#[test]
fn empty_unknown_and_invalid_queries() {
    with_db(|conn, dir| {
        let en = english(conn, dir);
        assert_eq!(look(conn, &en, "zebra", Word).verses, 0);
        assert!(look(conn, &en, "zebra", Word).books.is_empty());
        let bad = |q: &str, t: &str| {
            concordance::search(
                conn,
                &ConcordanceQuery {
                    translation_id: t.into(),
                    query: q.into(),
                    mode: Word,
                    book: None,
                },
            )
        };
        assert!(bad("  ;; ", &en).is_err());
        assert!(bad("grace", "no-such-bible").is_err());
        Ok(())
    });
}

/// Installs a one-book Bible in `language`.
fn one_book(
    conn: &Connection,
    dir: &Path,
    short: &str,
    language: &str,
    code: &str,
    verses: &[&str],
) -> String {
    let files = vec![book(code, verses)];
    install(conn, dir, short, language, &pairs(&files))
}

#[test]
fn european_accents_are_kept_and_case_is_folded() {
    with_db(|conn, dir| {
        let fr = one_book(
            conn,
            dir,
            "FR",
            "Français",
            "ROM",
            &["Il est élu.", "Elu sans accent.", "ÉLU en capitales."],
        );
        assert_eq!(look(conn, &fr, "élu", Word).verses, 2); // élu, ÉLU
        assert_eq!(look(conn, &fr, "elu", Word).verses, 1);
        let de = one_book(
            conn,
            dir,
            "DE",
            "Deutsch",
            "ROM",
            &["Über die Gnade.", "Uber ohne Umlaut.", "Die Gnadenzeit."],
        );
        assert_eq!(look(conn, &de, "über", Word).verses, 1);
        assert_eq!(look(conn, &de, "Gnade", Word).verses, 1); // not "Gnadenzeit"
        let es = one_book(
            conn,
            dir,
            "ES",
            "Español",
            "ROM",
            &["Yo sé que vive.", "Se levantó."],
        );
        assert_eq!(look(conn, &es, "sé", Word).verses, 1);
        assert_eq!(look(conn, &es, "se", Word).verses, 1);
        let pt = one_book(
            conn,
            dir,
            "PT",
            "Português",
            "ROM",
            &["Ele é bom.", "E ele vive."],
        );
        assert_eq!(look(conn, &pt, "é", Word).verses, 1);
        assert_eq!(look(conn, &pt, "e", Word).verses, 1);
        Ok(())
    });
}

#[test]
fn korean_greek_and_hebrew_follow_their_policies() {
    with_db(|conn, dir| {
        let ko = one_book(
            conn,
            dir,
            "KO",
            "한국어",
            "ROM",
            &["은혜를 받았다.", "은혜가 넘친다.", "은혜를 입은 자."],
        );
        assert_eq!(look(conn, &ko, "은혜를", Word).verses, 2);
        assert_eq!(look(conn, &ko, "은혜", Word).verses, 0); // the written word, no morphology
        let gr = one_book(
            conn,
            dir,
            "GR",
            "Ελληνικά",
            "JHN",
            &[
                "Ἐν ἀρχῇ ἦν ὁ λόγος.",
                "καὶ ὁ Λόγος σὰρξ ἐγένετο.",
                "λογοσ ἀλλος.",
            ],
        );
        assert_eq!(look(conn, &gr, "λογος", Word).verses, 3); // accents, capitals and final sigma ignored
        let he = one_book(
            conn,
            dir,
            "HE",
            "עברית",
            "GEN",
            &["בְּרֵאשִׁית בָּרָא אֱלֹהִים", "אֶת־הָאָרֶץ", "בראשית ברא"],
        );
        assert_eq!(look(conn, &he, "בראשית", Word).verses, 2); // pointed and unpointed
        assert_eq!(look(conn, &he, "הָאָרֶץ", Word).verses, 1); // the maqaf separates
        Ok(())
    });
}

#[test]
fn many_verses_are_listed_one_book_at_a_time() {
    with_db(|conn, dir| {
        let verses: Vec<String> = (0..250).map(|n| format!("Grace number {n}.")).collect();
        let refs: Vec<&str> = verses.iter().map(String::as_str).collect();
        let psa = book("PSA", &refs[..150]);
        let isa = book("ISA", &refs[150..]);
        let en = install(
            conn,
            dir,
            "BIG",
            "English",
            &[
                (psa.0.as_str(), psa.1.clone()),
                (isa.0.as_str(), isa.1.clone()),
            ],
        );
        let r = look(conn, &en, "grace", Word);
        assert_eq!(r.verses, 250);
        assert!(r.hits.is_empty() && !r.hits_complete);
        let isa_only = concordance::search(
            conn,
            &ConcordanceQuery {
                translation_id: en.clone(),
                query: "grace".into(),
                mode: Word,
                book: Some("ISA".into()),
            },
        )?;
        assert_eq!(isa_only.hits.len(), 100);
        assert!(isa_only.hits.iter().all(|h| h.reference.book == "ISA"));
        assert_eq!(isa_only.verses, 250); // the counts stay for the whole Bible
        Ok(())
    });
}

#[test]
fn a_whole_bible_answers_quickly() {
    with_db(|conn, dir| {
        // 66 books × 30 chapters' worth of verses in one chapter each: about 31,000 verses.
        let words = [
            "the", "grace", "of", "God", "and", "faith", "love", "light", "word", "truth",
        ];
        let mut files = Vec::new();
        for (b, info) in abiding_word_lib::scripture::canon::BOOKS.iter().enumerate() {
            let code = info.code;
            let mut text = format!("\\id {code} Fixture (test only)\n");
            for c in 1..=info.chapter_count as usize {
                text.push_str(&format!("\\c {c}\n\\p\n"));
                for v in 1..=26 {
                    let i = b * 7 + c * 3 + v;
                    text.push_str(&format!(
                        "\\v {v} And {} the {} of {} came by {} in {} rare{}.\n",
                        words[i % 10],
                        words[(i + 3) % 10],
                        words[(i + 5) % 10],
                        words[(i + 7) % 10],
                        words[(i + 1) % 10],
                        if i % 97 == 0 { "jewel" } else { "" }
                    ));
                }
            }
            files.push((format!("{code}.usfm"), text));
        }
        let refs: Vec<(&str, String)> =
            files.iter().map(|(n, t)| (n.as_str(), t.clone())).collect();
        let en = install(conn, dir, "FULL", "English", &refs);
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM bible_verse_texts WHERE translation_id = ?1",
            [&en],
            |r| r.get(0),
        )?;
        println!("verses: {total}");
        for (query, mode) in [
            ("the", Word),
            ("grace", Word),
            ("rarejewel", Word),
            ("by grace", Phrase),
            ("of God", Phrase),
            ("λογος", Word),
        ] {
            let started = Instant::now();
            let r = look(conn, &en, query, mode);
            let took = started.elapsed();
            println!(
                "{query:>10}: {} verses, {} occurrences, {took:?}",
                r.verses, r.occurrences
            );
            assert!(took < Duration::from_secs(5));
        }
        Ok(())
    });
}
