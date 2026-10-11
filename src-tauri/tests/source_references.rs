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
fn a_german_source_links_mal_4_3_to_maleachi_but_not_the_word_mal() {
    // v0.11 acceptance: a German source citing "Mal 4,3" showed no link.
    with_db(|conn, dir| {
        let text = "Vergleiche Mal 4,3 und Mal 3,1-5. Lass uns mal sehen; noch mal 4 Dinge.\n";
        let id = add(conn, dir, "mal.txt", text, "Maleachi", "Deutsch");
        let found = library::source_references(conn, &id)?;
        let canonicals: Vec<&str> = found
            .iter()
            .map(|r| r.reference.canonical.as_str())
            .collect();
        assert_eq!(canonicals, ["MAL.4.3", "MAL.3.1-MAL.3.5"]);
        let segments = texts(conn, &id);
        let written: Vec<String> = found
            .iter()
            .map(|r| slice16(&segments[r.position as usize], r.start, r.end))
            .collect();
        assert_eq!(written, ["Mal 4,3", "Mal 3,1-5"]);
        // Drawn (EPUB/DOCX) text of the same source is read the same way.
        let pieces = vec!["Siehe Mal 4,3.".to_string(), "Mal 4 war genug.".to_string()];
        let drawn = library::detect_in_source(conn, &id, &pieces, None)?;
        assert_eq!(drawn[0].len(), 1);
        assert_eq!(drawn[0][0].reference.canonical, "MAL.4.3");
        assert!(drawn[1].is_empty());
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
fn drawn_text_is_read_in_every_language_the_sources_first() {
    with_db(|conn, dir| {
        let de = add(conn, dir, "de.txt", "Ein Absatz.\n", "D", "Deutsch");
        let en = add(conn, dir, "en.txt", "A paragraph.\n", "E", "English");
        let pieces = vec![
            "Siehe Joh 3,16.".to_string(),
            "See John 3:16.".to_string(),
            String::new(),
            "no digits".to_string(),
        ];
        let in_de = library::detect_in_source(conn, &de, &pieces, None)?;
        assert_eq!(in_de.len(), 4);
        assert_eq!(in_de[0][0].reference.canonical, "JHN.3.16");
        assert!(in_de[2].is_empty() && in_de[3].is_empty());
        let in_en = library::detect_in_source(conn, &en, &pieces, None)?;
        assert_eq!(in_en[1][0].reference.canonical, "JHN.3.16");
        // An English source still finds the German reference whole (not the English
        // reading "Joh 3"): every language is read, the source's first.
        assert_eq!(in_en[0].len(), 1);
        assert_eq!(
            (
                in_en[0][0].text.as_str(),
                in_en[0][0].reference.canonical.as_str()
            ),
            ("Joh 3,16", "JHN.3.16")
        );
        assert!(library::detect_in_source(conn, "no-such-source", &pieces, None).is_err());
        // Bounded: too many texts are read as empty, never an error.
        let many = vec!["John 3:16".to_string(); library::DETECT_TEXTS_LIMIT + 3];
        let out = library::detect_in_source(conn, &en, &many, None)?;
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
        let lists = library::detect_in_source(conn, &id, &page, None)?;
        let took = started.elapsed();
        println!("detect_in_source: {} pieces in {took:?}", page.len());
        assert!(lists.iter().all(|l| l.len() == 2));
        assert!(took < std::time::Duration::from_secs(2));
        Ok(())
    });
}

#[test]
fn drawn_text_links_a_bookless_reference_only_as_the_imported_text_resolved_it() {
    use abiding_word_lib::db::library::DrawnScope;
    with_db(|conn, dir| {
        let id = add(
            conn,
            dir,
            "sermon.md",
            "# John 15:1–11\n\nLook at 15:4 here.\n\n# Romans 8\n\nAnd 8:28 there; also 15:4 again.\n",
            "Sermon",
            "en",
        );
        let pieces = vec![
            "Look at 15:4 here.".to_string(),
            "And 8:28 there.".to_string(),
        ];
        let canon = |lists: &Vec<Vec<abiding_word_lib::scripture::parser::DetectedReference>>| -> Vec<Vec<String>> {
            lists
                .iter()
                .map(|l| l.iter().map(|r| r.reference.canonical.clone()).collect())
                .collect()
        };
        // the first document only: "15:4" is John's there
        let first = library::detect_in_source(
            conn,
            &id,
            &pieces,
            Some(DrawnScope {
                from: Some(0),
                to: Some(1),
                page: None,
            }),
        )?;
        assert_eq!(canon(&first), [vec!["JHN.15.4".to_string()], vec![]]);
        assert_eq!(first[0][0].text, "15:4");
        // both: "15:4" was John's in one section and Romans' in the other, so it is not linked
        let both = library::detect_in_source(
            conn,
            &id,
            &pieces,
            Some(DrawnScope {
                from: Some(0),
                to: Some(2),
                page: None,
            }),
        )?;
        assert_eq!(canon(&both), [vec![], vec!["ROM.8.28".to_string()]]);
        // without a scope, bookless references are never linked in drawn text
        let none = library::detect_in_source(conn, &id, &pieces, None)?;
        assert_eq!(canon(&none), [Vec::<String>::new(), vec![]]);
        Ok(())
    })
}

#[path = "support/library_fixtures.rs"]
mod fixtures;

#[test]
fn a_pdf_sermon_s_main_passage_reaches_its_later_pages_at_import_and_on_rebuild() {
    use abiding_word_lib::library::SourceType;
    with_db(|conn, dir| {
        let mut found = Vec::new();
        for (file, kind) in [("sermon.pdf", Some(SourceType::Sermon)), ("book.pdf", None)] {
            // a different file each time: the library refuses an identical one
            let bytes = fixtures::pdf(
                &[
                    &[
                        "John 15:1-11",
                        "Abiding in Christ",
                        "An opening paragraph with no passage in it at all.",
                    ],
                    &["Plain text on the second page."],
                    &["Much later, 15:4 says remain.", file],
                ],
                None,
                None,
            );
            let path = dir.join(file);
            fs::write(&path, &bytes).unwrap();
            let staged = import::stage(&path).unwrap();
            let id = abiding_word_lib::db::new_id();
            let relative = library::managed_relative_path(&id, &staged);
            library::commit_import(
                conn,
                &id,
                &staged,
                &CommitSourceImport {
                    preview_id: staged.id.clone(),
                    title: "Abiding in Christ".into(),
                    language: Some("en".into()),
                    source_type: kind,
                    ..Default::default()
                },
                &relative,
            )?;
            let at_import: Vec<String> = library::source_references(conn, &id)?
                .into_iter()
                .map(|r| r.reference.canonical)
                .collect();
            library::reindex_passages(conn, &id)?;
            let rebuilt: Vec<String> = library::source_references(conn, &id)?
                .into_iter()
                .map(|r| r.reference.canonical)
                .collect();
            assert_eq!(at_import, rebuilt, "import and rebuild agree");
            found.push(rebuilt);
        }
        assert_eq!(found[0], ["JHN.15.1-JHN.15.11", "JHN.15.4"], "the sermon");
        assert_eq!(
            found[1],
            ["JHN.15.1-JHN.15.11"],
            "a book (the default kind) has no main passage"
        );
        Ok(())
    })
}
