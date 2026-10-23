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

/// The whole OSHB with its verse map (v0.22.1), checked against the files
/// themselves, independently of the reader: the text of every book in order,
/// every word kept, every `KJV:` mark and every whole-verse map entry landing
/// in the English verse it names, and every English verse present (the
/// exceptions listed).
#[test]
#[ignore]
fn oshb_corpus_reference_correctness() {
    use abiding_word_lib::scripture::canon;
    use abiding_word_lib::scripture::versification::{osis_book, split_part};
    let Some(dir) = folder() else {
        eprintln!("AW_EDITIONS not set; nothing to do");
        return;
    };
    let mut paths = files(&dir, "oshb");
    paths.push(dir.join("vm_VerseMap.xml"));
    let staged = import::stage(&paths, ImportOrigin::UserFiles).unwrap();
    for issue in &staged.content.issues {
        println!("  {:?} {}", issue.severity, issue.message);
    }
    assert!(!staged.content.has_errors());
    let strip = |s: &str| -> String {
        s.chars()
            .filter(|c| !c.is_whitespace() && *c != '/')
            .collect()
    };
    let note = regex::Regex::new(r"(?s)<note\b[^>]*>(.*?)</note>").unwrap();
    let tag = regex::Regex::new(r"(?s)<[^>]+>").unwrap();
    let verse_re = regex::Regex::new(r#"(?s)<verse osisID="([^"]+)">(.*?)</verse>"#).unwrap();
    let english = |ordinal: u8, c: u16, v: u16| -> Option<String> {
        staged
            .content
            .books
            .get(&ordinal)?
            .chapters
            .get(&c)?
            .verses
            .get(&v)
            .map(|t| strip(t))
    };
    let (mut words_in_files, mut marks_checked, mut entries_checked) = (0usize, 0usize, 0usize);
    let mut failures: Vec<String> = Vec::new();
    let map_text = std::fs::read_to_string(dir.join("vm_VerseMap.xml")).unwrap();
    let map = abiding_word_lib::scripture::versification::parse(&map_text).unwrap();
    for path in files(&dir, "oshb") {
        let text = std::fs::read_to_string(&path).unwrap();
        let mut file_text = String::new();
        let mut ordinal = 0u8;
        for caps in verse_re.captures_iter(&text) {
            let id = &caps[1];
            let body = &caps[2];
            let mut parts = id.split('.');
            let book = osis_book(parts.next().unwrap()).unwrap();
            ordinal = book.ordinal;
            let (c, v): (u16, u16) = (
                parts.next().unwrap().parse().unwrap(),
                parts.next().unwrap().parse().unwrap(),
            );
            // Words outside notes.
            let plain_body = note.replace_all(body, "");
            words_in_files += plain_body.matches("<w ").count() + plain_body.matches("<w>").count();
            let verse_text = strip(&tag.replace_all(&plain_body, ""));
            file_text.push_str(&verse_text);
            // Each KJV mark: the text from it to the next mark is in the verse it names.
            let mut pieces: Vec<(Option<String>, String)> = vec![(None, String::new())];
            let mut last = 0;
            for m in note.captures_iter(body) {
                let whole = m.get(0).unwrap();
                let before = &body[last..whole.start()];
                pieces
                    .last_mut()
                    .unwrap()
                    .1
                    .push_str(&strip(&tag.replace_all(before, "")));
                last = whole.end();
                if let Some(target) = m[1].trim().strip_prefix("KJV:") {
                    pieces.push((Some(target.to_string()), String::new()));
                }
            }
            pieces
                .last_mut()
                .unwrap()
                .1
                .push_str(&strip(&tag.replace_all(&body[last..], "")));
            for (target, piece) in &pieces {
                let Some(target) = target else { continue };
                if piece.is_empty() {
                    continue;
                }
                let base = split_part(target).unwrap().0;
                let (o, tc, tv) =
                    abiding_word_lib::scripture::versification::osis_verse(base).unwrap();
                marks_checked += 1;
                if !english(o, tc, tv).is_some_and(|e| e.contains(piece.as_str())) {
                    failures.push(format!("{id}: mark {target} not found there"));
                }
            }
            // Each whole-verse map entry: the verse is in the English verse named.
            if let Some(&(tc, tv)) = map.to_english.get(&(ordinal, c, v)) {
                // Verses the text does not divide (a mark at their start is not a division).
                if pieces.iter().filter(|(_, p)| !p.is_empty()).count() == 1
                    && !verse_text.is_empty()
                {
                    entries_checked += 1;
                    let in_verse =
                        english(ordinal, tc, tv).is_some_and(|e| e.contains(&verse_text));
                    let in_title = staged.content.books[&ordinal]
                        .chapters
                        .get(&tc)
                        .and_then(|ch| ch.superscription.as_ref())
                        .is_some_and(|s| strip(s).contains(&verse_text));
                    if !in_verse && !in_title {
                        failures.push(format!("{id}: map entry {tc}:{tv} not found there"));
                    }
                }
            }
        }
        // The book's text, in order: titles then verses, chapter by chapter.
        let mut stored = String::new();
        for chapter in staged.content.books[&ordinal].chapters.values() {
            if let Some(title) = &chapter.superscription {
                stored.push_str(&strip(title));
            }
            for text in chapter.verses.values() {
                stored.push_str(&strip(text));
            }
        }
        if stored != file_text {
            let at = stored
                .chars()
                .zip(file_text.chars())
                .take_while(|(a, b)| a == b)
                .count();
            failures.push(format!(
                "{}: text differs from character {at} ({} vs {} characters)",
                canon::by_ordinal(ordinal).unwrap().code,
                stored.chars().count(),
                file_text.chars().count()
            ));
        }
    }
    // Every English verse of the Old Testament, and which are absent.
    let mut absent = Vec::new();
    for book in canon::BOOKS.iter().filter(|b| b.ordinal <= 39) {
        for c in 1..=book.chapter_count {
            for v in 1..=canon::verse_count(book, c).unwrap_or(0) {
                if english(book.ordinal, c, v).is_none() {
                    absent.push(format!("{} {c}:{v}", book.code));
                }
            }
        }
    }
    let report = &staged.content.words.report;
    println!(
        "OSHB corpus: {} words in the files; {} indexed + {} in titles + {} left out; {marks_checked} marks and {entries_checked} map entries checked; absent English verses: {absent:?}",
        words_in_files,
        report.words,
        report.left_out.outside_verse,
        report.left_out.total()
    );
    for f in failures.iter().take(30) {
        println!("  FAIL {f}");
    }
    assert!(failures.is_empty(), "{} failures", failures.len());
    assert_eq!(
        report.words + report.left_out.outside_verse + report.left_out.total(),
        words_in_files
    );
}
