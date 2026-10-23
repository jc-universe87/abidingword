//! Real original-language editions through the real import pipeline (v0.22).
//!
//! Not run by default: the editions are not part of the repository (their
//! licences allow personal use and attributed redistribution, but adding a
//! corpus to the project needs the owner's decision). To run, download the
//! files named below into one folder and:
//!
//!   AW_EDITIONS=<folder> cargo test --release --test real_editions -- --ignored --nocapture
//!
//! - `hboWLC_usfm.zip`  https://ebible.org/Scriptures/details.php?id=hboWLC
//! - `grcmt_usfm.zip`   https://ebible.org/Scriptures/details.php?id=grcmt
//! - `grcbyz_usfm.zip`, `grctr_usfm.zip`, `grcsbl_usfm.zip` (Strong's only)
//! - MorphGNT: the `*-morphgnt.txt` files of https://github.com/morphgnt/sblgnt
//!   in a sub-folder `morphgnt/`
//! - OSHB: the `wlc/*.xml` book files of https://github.com/openscriptures/morphhb
//!   in a sub-folder `oshb/`, and its `wlc/VerseMap.xml` as `vm_VerseMap.xml`
//!
//! Each edition is staged, then added to an in-memory database and searched
//! as a person would: a verse's words, a lexical number or lemma, its
//! occurrences.

use std::path::{Path, PathBuf};
use std::time::Instant;

use abiding_word_lib::db::bible_words::{
    self, LemmaLookup, LemmaQuery, LemmaSelection, VerseWordsQuery,
};
use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::{CommitImport, WordChoice};

fn folder() -> Option<PathBuf> {
    std::env::var_os("AW_EDITIONS").map(PathBuf::from)
}

fn files(dir: &Path, name: &str) -> Vec<PathBuf> {
    // "a+b": several inputs chosen together.
    if name.contains('+') {
        return name.split('+').flat_map(|n| files(dir, n)).collect();
    }
    let path = dir.join(name);
    if path.is_dir() {
        let mut list: Vec<PathBuf> = std::fs::read_dir(&path)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "txt" || e == "xml"))
            .collect();
        list.sort();
        list
    } else {
        vec![path]
    }
}

#[test]
#[ignore]
fn real_editions_report() {
    let Some(dir) = folder() else {
        eprintln!("AW_EDITIONS not set; nothing to do");
        return;
    };
    // (inputs, a verse to inspect, a lookup to try, what the person chooses)
    let numbers = WordChoice {
        numbers: true,
        grammar: None,
    };
    for (name, verse, lookup, choice) in [
        ("hboWLC_usfm.zip", "GEN.1.1", "H430", WordChoice::default()),
        (
            "hboWLC_usfm.zip+vm_VerseMap.xml",
            "JOL.3.1",
            "H430",
            WordChoice::default(),
        ),
        (
            "oshb+vm_VerseMap.xml",
            "GEN.1.1",
            "430",
            WordChoice::default(),
        ),
        ("grcmt_usfm.zip", "JHN.1.1", "3056", WordChoice::default()),
        ("grcbyz_usfm.zip", "JHN.1.1", "G3056", numbers.clone()),
        ("grctr_usfm.zip", "JHN.1.1", "G3056", WordChoice::default()),
        ("grcsbl_usfm.zip", "JHN.1.1", "g3056", numbers.clone()),
        ("morphgnt", "JHN.1.1", "λογος", WordChoice::default()),
    ] {
        if std::env::var("AW_ONLY").is_ok_and(|only| only != name) {
            continue;
        }
        let paths = files(&dir, name);
        if paths.iter().any(|p| !p.exists()) || paths.is_empty() {
            eprintln!("{name}: not present");
            continue;
        }
        let started = Instant::now();
        let staged = match import::stage(&paths, ImportOrigin::UserFiles) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("{name}: {e:?}");
                continue;
            }
        };
        let preview = staged.preview(Default::default());
        println!(
            "{name}: {} books, {} verses, {} issues, staged in {:?}\n  words: {}",
            preview.book_count,
            preview.verse_count,
            preview.issues.len(),
            started.elapsed(),
            serde_json::to_string(&preview.words).unwrap()
        );
        for issue in preview.issues.iter().take(12) {
            println!("  {:?} {}", issue.severity, issue.message);
        }
        if !preview.can_import {
            println!("  (cannot be added as it is)");
            continue;
        }
        let db = Database::open_in_memory().unwrap();
        db.with_conn(|conn| {
            let started = Instant::now();
            let id = bibles::new_translation_id();
            bibles::commit_import(
                conn,
                &id,
                &staged.content,
                &CommitImport {
                    preview_id: staged.id.clone(),
                    name: name.into(),
                    short_name: "REAL".into(),
                    language: "Original".into(),
                    language_code: None,
                    publisher: None,
                    copyright_notice: None,
                    license_type: None,
                    words: choice.clone(),
                },
                &SourceRecord {
                    origin: "managed_copy",
                    path: None,
                    original_file_name: None,
                    format: staged.format,
                    is_builtin: false,
                },
            )?;
            let translation = bibles::get(conn, &id)?;
            println!(
                "  added in {:?}; words: {:?}",
                started.elapsed(),
                translation.words
            );
            if translation.words.is_none() {
                return Ok(());
            }
            let started = Instant::now();
            let words = bible_words::verse_words(
                conn,
                &VerseWordsQuery {
                    translation_id: id.clone(),
                    verse: verse.into(),
                },
            )?;
            println!("  {verse} ({:?}):", started.elapsed());
            for w in words.iter().take(6) {
                println!(
                    "    {} | lemma {:?} | number {:?} | code {:?} | described {}",
                    w.surface,
                    w.lemma,
                    w.strong,
                    w.morph,
                    w.described
                        .as_ref()
                        .map_or("no".to_string(), |d| serde_json::to_string(d).unwrap())
                );
            }
            let started = Instant::now();
            let entries = bible_words::entries(
                conn,
                &LemmaLookup {
                    translation_id: id.clone(),
                    text: lookup.into(),
                },
            )?;
            println!(
                "  lookup {lookup:?} ({:?}): {} entries",
                started.elapsed(),
                entries.len()
            );
            for e in entries.iter().take(4) {
                println!(
                    "    {:?} · {:?} · {} · matched {:?}",
                    e.lemma, e.strong, e.occurrences, e.matched_id
                );
            }
            if let Some(first) = entries.first() {
                let selection = match &first.matched_id {
                    Some(id) => LemmaSelection::LexicalId { id: id.clone() },
                    None => LemmaSelection::Entry {
                        lemma: first.lemma.clone(),
                        strong: first.strong.clone(),
                    },
                };
                let started = Instant::now();
                let found = bible_words::search(
                    conn,
                    &LemmaQuery {
                        translation_id: id.clone(),
                        selection,
                        morph: vec![],
                        book: None,
                    },
                )?;
                println!(
                    "  occurrences: {} in {} verses, {} books ({:?}); codes {}",
                    found.occurrences,
                    found.verses,
                    found.books.len(),
                    started.elapsed(),
                    found.morphology.len()
                );
            }
            Ok(())
        })
        .unwrap();
    }
}

/// What a lexical-number index costs for the bundled Bibles that carry
/// Strong's numbers (v0.22: offered, never added by default).
#[test]
#[ignore]
fn bundled_number_index_cost() {
    use abiding_word_lib::scripture::bundled::BUNDLED;
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/scripture");
    for bible in BUNDLED {
        let path = resources.join(bible.id).join(bible.resource);
        let started = Instant::now();
        let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
        let staging = started.elapsed();
        let report = &staged.content.words.report;
        if report.not_indexed != Some("strongOnly") {
            println!(
                "{}: no lexical numbers only ({:?})",
                bible.short_name, report.not_indexed
            );
            continue;
        }
        let db = Database::open_in_memory().unwrap();
        db.with_conn(|conn| {
            let size = |conn: &rusqlite::Connection| -> i64 {
                conn.query_row("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()", [], |r| r.get(0)).unwrap()
            };
            let mut meta = CommitImport {
                preview_id: staged.id.clone(),
                name: bible.name.into(),
                short_name: "A".into(),
                language: bible.language.into(),
                language_code: None,
                publisher: None,
                copyright_notice: None,
                license_type: None,
                words: WordChoice::default(),
            };
            let record = SourceRecord { origin: "bundled", path: None, original_file_name: None, format: "usfm", is_builtin: true };
            let started = Instant::now();
            bibles::commit_import(conn, &bibles::new_translation_id(), &staged.content, &meta, &record)?;
            let plain_time = started.elapsed();
            let plain = size(conn);
            meta.short_name = "B".into();
            meta.words = WordChoice { numbers: true, grammar: None };
            let started = Instant::now();
            let id = bibles::new_translation_id();
            bibles::commit_import(conn, &id, &staged.content, &meta, &record)?;
            let numbers_time = started.elapsed();
            let both = size(conn);
            let started = Instant::now();
            let entries = bible_words::entries(conn, &LemmaLookup { translation_id: id.clone(), text: "G3056".into() })?;
            let lookup = started.elapsed();
            println!(
                "{}: {} words; staged {:?}; text {:?} ({:.1} MiB); text + numbers {:?} (+{:.1} MiB, estimate {:.1} MiB); G3056 lookup {:?} ({} entries)",
                bible.short_name,
                report.words,
                staging,
                plain_time,
                plain as f64 / 1048576.0,
                numbers_time,
                (both - 2 * plain) as f64 / 1048576.0,
                report.estimated_bytes as f64 / 1048576.0,
                lookup,
                entries.len()
            );
            Ok(())
        })
        .unwrap();
    }
}
