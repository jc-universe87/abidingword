//! Find in this source (v0.13): where a query occurs in one source's stored
//! text, as UTF-16 ranges of each segment, in reading order. Sources are
//! invented and imported through the real path (stage, commit).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import;
use abiding_word_lib::library::{CommitSourceImport, GetSegments};
use rusqlite::Connection;

fn add(conn: &Connection, dir: &Path, file: &str, text: &str) -> String {
    let path = dir.join(file);
    fs::write(&path, text).unwrap();
    let staged = import::stage(&path).unwrap();
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, &staged);
    library::commit_import(
        conn,
        &id,
        &staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: file.into(),
            language: Some("en".into()),
            ..Default::default()
        },
        &relative,
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

fn text_at(conn: &Connection, id: &str, position: i64) -> String {
    library::segments(
        conn,
        &GetSegments {
            source_id: id.into(),
            around_segment_id: None,
            around_page: None,
            offset: Some(position),
            limit: Some(1),
        },
    )
    .unwrap()
    .segments
    .remove(0)
    .text
}

fn slice16(text: &str, start: i64, end: i64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start as usize..end as usize]).unwrap()
}

#[test]
fn finds_every_occurrence_in_reading_order_with_exact_ranges() {
    with_db(|conn, dir| {
        let id = add(
            conn,
            dir,
            "abide.md",
            "# Abiding\n\nRemain in me, and I in you.\n\nAs the branch cannot bear fruit unless it remains — REMAIN — in the vine.\n\nNothing here.\n",
        );
        let found = library::find_in_source(conn, &id, "remain")?;
        assert_eq!(found.total, 3);
        assert!(!found.truncated);
        let words: Vec<String> = found
            .matches
            .iter()
            .map(|m| slice16(&text_at(conn, &id, m.position), m.start, m.end))
            .collect();
        assert_eq!(words, ["Remain", "remain", "REMAIN"]);
        assert!(found
            .matches
            .windows(2)
            .all(|w| w[0].position <= w[1].position));

        let none = library::find_in_source(conn, &id, "   ")?;
        assert_eq!((none.total, none.matches.len()), (0, 0));
        assert_eq!(library::find_in_source(conn, &id, "olive")?.total, 0);
        Ok(())
    })
}

#[test]
fn many_occurrences_are_bounded_and_say_so() {
    with_db(|conn, dir| {
        let paragraph = "word ".repeat(1_000);
        let text: String = (0..12).map(|_| format!("{paragraph}\n\n")).collect();
        let id = add(conn, dir, "many.txt", &text);
        let found = library::find_in_source(conn, &id, "word")?;
        assert_eq!(found.total as usize, library::FIND_COUNT_LIMIT);
        assert_eq!(found.matches.len(), library::FIND_MATCHES_LIMIT);
        assert!(found.truncated);
        Ok(())
    })
}

#[test]
fn an_unknown_source_is_an_error() {
    with_db(|conn, _| {
        assert!(library::find_in_source(conn, "missing", "word").is_err());
        Ok(())
    })
}
