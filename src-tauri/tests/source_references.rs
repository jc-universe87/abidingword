//! Scripture links inside Library sources (v0.11): where each stored reference
//! is in its segment's text (Reading view), and detection in a source's own
//! language for drawn formatted text. Sources are invented and imported through
//! the real path (stage, commit, index).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import;
use abiding_word_lib::library::{CommitSourceImport, GetSegments};
use rusqlite::Connection;

fn add(
    conn: &Connection,
    dir: &Path,
    file: &str,
    text: &str,
    title: &str,
    language: &str,
) -> String {
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
            title: title.into(),
            language: Some(language.into()),
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

/// UTF-16 slice of a text, as the interface slices it.
fn slice16(text: &str, start: i64, end: i64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start as usize..end as usize]).unwrap()
}

fn texts(conn: &Connection, id: &str) -> Vec<String> {
    library::segments(
        conn,
        &GetSegments {
            source_id: id.into(),
            around_segment_id: None,
            around_page: None,
            offset: Some(0),
            limit: Some(500),
        },
    )
    .unwrap()
    .segments
    .into_iter()
    .map(|s| s.text)
    .collect()
}

#[test]
fn each_language_stores_where_its_references_are() {
    with_db(|conn, dir| {
        let cases = [
            (
                "English",
                "Compare John 15:5, Romans 6:1-4, and Galatians 2:20.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4", "GAL.2.20"],
            ),
            (
                "Deutsch",
                "Vergleiche Joh 15,5 und Röm 6,1–4.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4"],
            ),
            (
                "한국어",
                "요한복음 15장 5절과 로마서 6장 1-4절을 보라.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4"],
            ),
            (
                "Français",
                "Comparez Jean 15,5 et Romains 6,1-4.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4"],
            ),
            (
                "Español",
                "Compara Juan 15:5 y Romanos 6:1-4.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4"],
            ),
            (
                "Português",
                "Compare João 15:5 e Romanos 6:1-4.",
                vec!["JHN.15.5", "ROM.6.1-ROM.6.4"],
            ),
        ];
        for (i, (language, text, expected)) in cases.iter().enumerate() {
            let id = add(
                conn,
                dir,
                &format!("{i}.txt"),
                &format!("{text}\n"),
                language,
                language,
            );
            let found = library::source_references(conn, &id)?;
            let canonicals: Vec<&str> = found
                .iter()
                .map(|r| r.reference.canonical.as_str())
                .collect();
            assert_eq!(&canonicals, expected, "{language}");
            let segments = texts(conn, &id);
            for r in &found {
                // The offsets name exactly the written reference, punctuation around it untouched.
                let written = slice16(&segments[r.position as usize], r.start, r.end);
                assert!(
                    written.chars().any(|c| c.is_ascii_digit()),
                    "{language}: {written:?}"
                );
                assert!(
                    !written.starts_with(' ') && !written.ends_with(' ') && !written.ends_with(','),
                    "{language}: {written:?}"
                );
            }
            // In reading order, never overlapping.
            for pair in found.windows(2) {
                assert!(pair[0].position < pair[1].position || pair[0].end <= pair[1].start);
            }
        }
        Ok(())
    });
}

#[test]
fn section_links_have_no_place_in_the_text_and_are_not_returned() {
    with_db(|conn, dir| {
        let id = add(
            conn,
            dir,
            "s.md",
            "# S\n\n## John 15:1–11\n\nThe vine, as John 15:5 says.\n\nRemaining.\n",
            "S",
            "English",
        );
        let found = library::source_references(conn, &id)?;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].reference.canonical, "JHN.15.5");
        Ok(())
    });
}

#[test]
fn an_unknown_source_is_an_error_and_a_source_without_references_is_empty() {
    with_db(|conn, dir| {
        assert!(library::source_references(conn, "no-such-source").is_err());
        let id = add(
            conn,
            dir,
            "n.txt",
            "No references here at all.\n",
            "N",
            "English",
        );
        assert!(library::source_references(conn, &id)?.is_empty());
        Ok(())
    });
}

#[test]
fn drawn_text_is_read_in_the_sources_language_not_another() {
    with_db(|conn, dir| {
        let de = add(conn, dir, "de.txt", "Ein Absatz.\n", "D", "Deutsch");
        let en = add(conn, dir, "en.txt", "A paragraph.\n", "E", "English");
        let pieces = vec![
            "Siehe Joh 3,16.".to_string(),
            "See John 3:16.".to_string(),
            String::new(),
            "no digits".to_string(),
        ];
        let in_de = library::detect_in_source(conn, &de, &pieces)?;
        assert_eq!(in_de.len(), 4);
        assert_eq!(in_de[0][0].reference.canonical, "JHN.3.16");
        assert!(in_de[2].is_empty() && in_de[3].is_empty());
        let in_en = library::detect_in_source(conn, &en, &pieces)?;
        assert_eq!(in_en[1][0].reference.canonical, "JHN.3.16");
        // German notation is not English: the English parser does not take "Joh 3,16" as John 3:16.
        assert!(in_en[0].iter().all(|r| r.reference.canonical != "JHN.3.16"));
        assert!(library::detect_in_source(conn, "no-such-source", &pieces).is_err());
        // Bounded: too many texts are read as empty, never an error.
        let many = vec!["John 3:16".to_string(); library::DETECT_TEXTS_LIMIT + 3];
        let out = library::detect_in_source(conn, &en, &many)?;
        assert_eq!(out.len(), many.len());
        assert!(out[library::DETECT_TEXTS_LIMIT].is_empty());
        Ok(())
    });
}

#[test]
fn a_long_source_answers_quickly() {
    with_db(|conn, dir| {
        let mut text = String::new();
        for n in 0..3000 {
            text.push_str(&format!(
                "Paragraph {n}: compare John 15:5 and Romans 6:{} here.\n\n",
                n % 20 + 1
            ));
        }
        let id = add(conn, dir, "long.txt", &text, "Long", "English");
        let started = std::time::Instant::now();
        let found = library::source_references(conn, &id)?;
        let took = started.elapsed();
        println!("source_references: {} references in {took:?}", found.len());
        assert_eq!(found.len(), 6000);
        assert!(took < std::time::Duration::from_secs(2));
        // A large drawn page: a thousand pieces of text, read in one call.
        let page: Vec<String> = (0..1000)
            .map(|n| format!("Piece {n}: see John 15:{} and Romans 6:1-4.", n % 20 + 1))
            .collect();
        let started = std::time::Instant::now();
        let lists = library::detect_in_source(conn, &id, &page)?;
        let took = started.elapsed();
        println!("detect_in_source: {} pieces in {took:?}", page.len());
        assert!(lists.iter().all(|l| l.len() == 2));
        assert!(took < std::time::Duration::from_secs(2));
        Ok(())
    });
}
