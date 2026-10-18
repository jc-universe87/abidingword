//! Language-aware passage indexing (v0.9, sub-phase 2): the language finally
//! chosen for a source decides its links, at import and at rebuild; headings
//! and explicit references use the same dictionary; manual links survive. All
//! text is invented.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::{findings, library, projects, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateFinding, CreateProject, CreateStudy, FindingType};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import::{self, StagedSource};
use abiding_word_lib::library::sections::{self, LinkOrigin};
use abiding_word_lib::library::{AddFindingSource, CommitSourceImport};
use abiding_word_lib::scripture::language::ReferenceLanguage::{De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::reference::ScriptureRef;
use fixtures::EpubChapter;
use rusqlite::Connection;

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

/// Adds a staged source with the language the person chose in the dialog.
fn commit(conn: &Connection, staged: &StagedSource, title: &str, language: Option<&str>) -> String {
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, staged);
    library::commit_import(
        conn,
        &id,
        staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: title.into(),
            language: language.map(str::to_string),
            ..Default::default()
        },
        &relative,
    )
    .unwrap();
    id
}

fn add(conn: &Connection, dir: &Path, file: &str, bytes: &[u8], language: Option<&str>) -> String {
    let staged = import::stage(&write(dir, file, bytes)).unwrap();
    commit(conn, &staged, file, language)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn reference(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

fn segment(conn: &Connection, source: &str, starts: &str) -> String {
    conn.query_row(
        "SELECT id FROM source_segments WHERE source_id = ?1 AND content LIKE ?2 || '%'",
        [source, starts],
        |r| r.get(0),
    )
    .unwrap_or_else(|_| panic!("no segment starting {starts:?}"))
}

fn links(conn: &Connection, segment_id: &str) -> Vec<(&'static str, String)> {
    library::segment_passage_links(conn, segment_id)
        .unwrap()
        .into_iter()
        .map(|l| (l.origin.as_str(), l.reference.canonical))
        .collect()
}

/// Every non-manual link of a source, without ids or dates, for comparing two states.
fn index_of(conn: &Connection, source: &str) -> Vec<(i64, String, String, String, Option<i64>)> {
    conn.prepare(
        "SELECT g.position, p.origin, p.passage, p.matched_text, p.start_offset
         FROM source_passages p JOIN source_segments g ON g.id = p.segment_id
         WHERE p.source_id = ?1 AND p.origin <> 'manual'
         ORDER BY g.position, p.origin, p.passage, p.start_offset",
    )
    .unwrap()
    .query_map([source], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

const GERMAN: &str = "# Johanneskommentar

## Joh 15,1–11 — Der wahre Weinstock

Ein erster Absatz über den Weinstock.

Ein zweiter Absatz. Vgl. Röm 8,28 und 1. Kor 13,4–7.

## Schluss

Letzte Worte ohne Bibelstelle.
";

const KOREAN: &str = "# 요한복음 연구

## 요한복음 15장 1-11절 — 참포도나무

첫 번째 문단은 포도나무에 대하여 쓴다.

두 번째 문단은 롬 8:28을 인용한다.

## 맺음말

마지막 말에는 성경 구절이 없다.
";

// --- the language of the source decides ----------------------------------------------

#[test]
fn a_german_source_gets_german_explicit_and_heading_links() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "joh.md",
            GERMAN.as_bytes(),
            Some("Deutsch"),
        );
        let first = links(conn, &segment(conn, &id, "Ein erster Absatz"));
        assert_eq!(first, [("section", "JHN.15.1-JHN.15.11".to_string())]);
        let second = links(conn, &segment(conn, &id, "Ein zweiter Absatz"));
        assert_eq!(
            second,
            [
                // in the order they are written in the paragraph
                ("explicit", "ROM.8.28".to_string()),
                ("explicit", "1CO.13.4-1CO.13.7".to_string()),
                ("inherited", "JHN.15.1-JHN.15.11".to_string())
            ]
        );
        assert!(links(conn, &segment(conn, &id, "Letzte Worte")).is_empty());
        // the Sources pane finds it for a verse inside the heading's range
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].locations[0].origin, LinkOrigin::Section);
        assert_eq!(found[0].locations[0].matched_text, "Joh 15,1–11");
        // and the literal mention is a mention, with its UTF-16 offsets
        let mentions = library::mentions(conn, &reference("ROM.8.28"))?;
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].matched_text, "Röm 8,28");
        Ok(())
    });
}

#[test]
fn a_korean_source_gets_korean_explicit_and_heading_links() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "yohan.md",
            KOREAN.as_bytes(),
            Some("한국어"),
        );
        let first = links(conn, &segment(conn, &id, "첫 번째 문단"));
        assert_eq!(first, [("section", "JHN.15.1-JHN.15.11".to_string())]);
        let second = links(conn, &segment(conn, &id, "두 번째 문단"));
        assert_eq!(
            second,
            [
                ("explicit", "ROM.8.28".to_string()),
                ("inherited", "JHN.15.1-JHN.15.11".to_string())
            ]
        );
        assert!(links(conn, &segment(conn, &id, "마지막 말에는")).is_empty());
        let mentions = library::mentions(conn, &reference("ROM.8.28"))?;
        assert_eq!(mentions[0].matched_text, "롬 8:28");
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert_eq!(found[0].locations[0].matched_text, "요한복음 15장 1-11절");
        Ok(())
    });
}

#[test]
fn french_spanish_and_portuguese_references_are_stored_canonically() {
    let temp = tempfile::tempdir().unwrap();
    let cases = [
        (
            "fr.txt",
            "Voir Jn 3,16 et 1 Co 13,4-7.",
            "Français",
            "Jn 3,16",
            "JHN.3.16",
        ),
        (
            "es.txt",
            "Véase Juan 3:16 y 1 Co 13:4-7.",
            "Español",
            "Juan 3:16",
            "JHN.3.16",
        ),
        (
            "pt.txt",
            "Veja João 3:16 e 1º Coríntios 13:4-7.",
            "Português",
            "João 3:16",
            "JHN.3.16",
        ),
    ];
    with_db(|conn| {
        for (file, text, language, written, canonical) in cases {
            let id = add(conn, temp.path(), file, text.as_bytes(), Some(language));
            let stored = library::passages(conn, &id)?;
            let canon: Vec<_> = stored
                .iter()
                .map(|m| m.reference.canonical.as_str())
                .collect();
            assert_eq!(canon, [canonical, "1CO.13.4-1CO.13.7"], "{language}");
            assert_eq!(stored[0].matched_text, written, "{language}");
        }
        // all three sources answer the same canonical passage
        assert_eq!(
            library::passage_sources(conn, &reference("JHN.3.16"))?.len(),
            3
        );
        assert_eq!(
            library::passage_sources(conn, &reference("1CO.13"))?.len(),
            3
        );
        Ok(())
    });
}

#[test]
fn the_interface_language_plays_no_part() {
    // Nothing here knows the interface language. Explicit references are found in
    // every supported language, whatever the source's language or the app's.
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let ko = add(
            conn,
            temp.path(),
            "k.txt",
            "John 3:16 and 요한복음 3:16".as_bytes(),
            Some("Korean"),
        );
        let de = add(
            conn,
            temp.path(),
            "d.txt",
            "Johannes 3,16 and 요한복음 3:16".as_bytes(),
            Some("German"),
        );
        let ko_found = library::passages(conn, &ko)?;
        let de_found = library::passages(conn, &de)?;
        let texts = |found: &[abiding_word_lib::library::PassageMention]| -> Vec<String> {
            let mut t: Vec<String> = found.iter().map(|m| m.matched_text.clone()).collect();
            t.sort();
            t
        };
        assert_eq!(texts(&ko_found), ["John 3:16", "요한복음 3:16"]);
        assert_eq!(texts(&de_found), ["Johannes 3,16", "요한복음 3:16"]);
        assert!(ko_found
            .iter()
            .chain(&de_found)
            .all(|m| m.reference.canonical == "JHN.3.16"));
        Ok(())
    });
}

#[test]
fn an_unknown_or_missing_language_is_indexed_as_english() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        for (n, language) in [None, Some(""), Some("Latina")].into_iter().enumerate() {
            // a different file each time: the library refuses an identical one
            let text = format!("Siehe John 3:16 und Joh 3,16 und 요한복음 3:16. ({n})");
            let id = add(
                conn,
                temp.path(),
                &format!("f{n}.txt"),
                text.as_bytes(),
                language,
            );
            let found: Vec<_> = library::passages(conn, &id)?
                .into_iter()
                .map(|m| (m.matched_text, m.reference.canonical))
                .collect();
            // English is the priority; the German and Korean references are found whole
            // ("Joh 3,16", not the English reading "Joh 3")
            assert_eq!(
                found,
                [
                    ("John 3:16".to_string(), "JHN.3.16".to_string()),
                    ("Joh 3,16".to_string(), "JHN.3.16".to_string()),
                    ("요한복음 3:16".to_string(), "JHN.3.16".to_string()),
                ],
                "{language:?}"
            );
        }
        Ok(())
    });
}

// --- preview versus final language ------------------------------------------------------

fn german_epub(language_tag: &str) -> Vec<u8> {
    fixtures::epub(
        &format!("<dc:title>Ein Kommentar</dc:title><dc:language>{language_tag}</dc:language>"),
        &[EpubChapter {
            file: "one.xhtml",
            xhtml_body: "<h1>Kommentar</h1><h2>Joh 15,1–11 — Weinstock</h2>\
                <p>Erster Absatz über die Rebe.</p><p>Zweiter Absatz, siehe Röm 8,28.</p>",
        }],
        &[0],
    )
}

#[test]
fn the_preview_reads_the_files_language_and_otherwise_english() {
    let temp = tempfile::tempdir().unwrap();
    let german = import::stage(&write(temp.path(), "de.epub", &german_epub("de-DE"))).unwrap();
    assert_eq!(german.index.language, De);
    assert_eq!(german.index.references.len(), 1, "Röm 8,28");
    assert_eq!(
        german.index.sections.len(),
        2,
        "a section link and an inherited one"
    );

    let unlabelled = import::stage(&write(temp.path(), "x.md", GERMAN.as_bytes())).unwrap();
    assert_eq!(
        unlabelled.index.language, En,
        "no metadata language: English, for the preview only"
    );

    let korean = import::stage(&write(
        temp.path(),
        "ko.epub",
        &fixtures::epub(
            "<dc:title>제목</dc:title><dc:language>ko</dc:language>",
            &[EpubChapter {
                file: "a.xhtml",
                xhtml_body: "<h1>장</h1><p>요한복음 3:16</p>",
            }],
            &[0],
        ),
    ))
    .unwrap();
    assert_eq!(korean.index.language, Ko);
    assert_eq!(korean.index.references.len(), 1);
}

#[test]
fn the_language_chosen_at_commit_decides_not_the_preview() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        // 1. the file says German; the person says English: the index is made for English
        //    (the German references are found all the same: a language is a priority, not a gate)
        let staged = import::stage(&write(temp.path(), "de.epub", &german_epub("de"))).unwrap();
        assert_eq!(staged.index.language, De);
        let id = commit(conn, &staged, "Als Englisch abgelegt", Some("English"));
        assert_eq!(library::mentions(conn, &reference("ROM.8.28"))?.len(), 1);
        let sections: Vec<_> = index_of(conn, &id)
            .into_iter()
            .filter(|(_, origin, ..)| origin == "section")
            .map(|(_, _, passage, ..)| passage)
            .collect();
        // the whole German range, not the English reading of "Joh 15" alone
        assert_eq!(sections, ["JHN.15.1-JHN.15.11"]);
        let language: Option<String> =
            conn.query_row("SELECT language FROM sources WHERE id = ?1", [&id], |r| {
                r.get(0)
            })?;
        assert_eq!(language.as_deref(), Some("English"));

        // 2. the file says nothing; the person says German: German links
        let staged = import::stage(&write(temp.path(), "x.md", GERMAN.as_bytes())).unwrap();
        assert_eq!(staged.index.language, En);
        assert_eq!(
            staged.index.references.len(),
            2,
            "Röm 8,28 and 1. Kor 13,4–7, read as German"
        );
        let id = commit(conn, &staged, "Als Deutsch abgelegt", Some("Deutsch"));
        assert_eq!(
            library::mentions(conn, &reference("ROM.8.28"))?.len(),
            2,
            "this source and the first"
        );
        assert!(
            index_of(conn, &id)
                .iter()
                .any(|(_, origin, passage, ..)| origin == "section"
                    && passage == "JHN.15.1-JHN.15.11")
        );

        // 3. the same file, the same language as the preview: the same links as a rebuild would make
        let staged = import::stage(&write(temp.path(), "y.epub", &german_epub("de-AT"))).unwrap();
        let id = commit(conn, &staged, "Wie angekündigt", Some("de"));
        let at_import = index_of(conn, &id);
        library::reindex_passages(conn, &id)?;
        assert_eq!(index_of(conn, &id), at_import);

        // 4. a blank language at commit is English, even when the file said German: the
        //    explicit references are the same, and the German shorthand is not read
        let staged = import::stage(&write(temp.path(), "z.epub", &german_epub("de-CH"))).unwrap();
        let id = commit(conn, &staged, "Ohne Sprache", None);
        assert!(index_of(conn, &id).iter().any(|(_, origin, passage, ..)| {
            origin == "section" && passage == "JHN.15.1-JHN.15.11"
        }));
        Ok(())
    });
}

// --- rebuilding an existing library -----------------------------------------------------------

#[test]
fn an_index_made_in_english_is_rebuilt_in_the_sources_language_with_both_kinds_of_link() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        // Indexed by an older rule: filed as English, re-filed as German since. An index
        // made by an older version (version 1) is what is rebuilt.
        let id = add(conn, temp.path(), "joh.md", GERMAN.as_bytes(), None);
        conn.execute(
            "DELETE FROM source_passages WHERE source_id = ?1 AND origin = 'explicit'",
            [&id],
        )?;
        assert!(library::mentions(conn, &reference("ROM.8.28"))?.is_empty());
        conn.execute(
            "UPDATE sources SET language = 'Deutsch', passage_index_version = 1 WHERE id = ?1",
            [&id],
        )?;

        let report = library::ensure_passage_index(conn)?;
        assert_eq!((report.rebuilt, report.failed), (1, 0));

        // explicit links now exist for the German references ...
        assert_eq!(library::mentions(conn, &reference("ROM.8.28"))?.len(), 1);
        assert_eq!(library::mentions(conn, &reference("1CO.13.5"))?.len(), 1);
        // ... and the section links were replaced, not added to
        let sections: Vec<_> = index_of(conn, &id)
            .into_iter()
            .filter(|(_, origin, ..)| origin == "section")
            .map(|(_, _, passage, ..)| passage)
            .collect();
        assert_eq!(sections, ["JHN.15.1-JHN.15.11"]);
        let version: i64 = conn.query_row(
            "SELECT passage_index_version FROM sources WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )?;
        assert_eq!(version, sections::INDEX_VERSION);

        // a second rebuild changes nothing
        let once = index_of(conn, &id);
        library::reindex_passages(conn, &id)?;
        library::reindex_passages(conn, &id)?;
        assert_eq!(index_of(conn, &id), once);
        assert_eq!(library::ensure_passage_index(conn)?.rebuilt, 0);
        Ok(())
    });
}

#[test]
fn rebuilding_never_touches_manual_links_citations_or_the_sources_own_details() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "joh.md",
            GERMAN.as_bytes(),
            Some("Deutsch"),
        );
        let cited = segment(conn, &id, "Ein erster Absatz");
        // a link a person confirmed (nothing creates one yet, but the model has a place for it)
        conn.execute(
            "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key,
                 matched_text, start_offset, end_offset, created_at, origin)
             VALUES ('manual-1', ?1, ?2, 'PSA.23', 19023000, 19023999, 'my choice', NULL, NULL,
                     '2026-01-01T00:00:00.000Z', 'manual')",
            [&id, &cited],
        )?;
        // a citation of that segment
        let workspace = workspaces::get_default(conn)?;
        let project = projects::create(
            conn,
            &CreateProject {
                workspace_id: workspace.id,
                title: "John".into(),
                description: None,
            },
        )?;
        let study = studies::create(
            conn,
            &CreateStudy {
                project_id: project.id,
                title: "John 15".into(),
                ..Default::default()
            },
        )?;
        let finding = findings::create(
            conn,
            &CreateFinding {
                study_id: study.study.id,
                finding_type: FindingType::Quotation,
                content: Some("Remain.".into()),
                section_id: None,
                passage: None,
            },
        )?
        .id;
        findings::add_source(
            conn,
            &AddFindingSource {
                finding_id: finding.clone(),
                segment_id: Some(cited.clone()),
                ..Default::default()
            },
        )?;
        let before = library::get(conn, &id)?;

        conn.execute(
            "UPDATE sources SET passage_index_version = 0 WHERE id = ?1",
            [&id],
        )?;
        library::ensure_passage_index(conn)?;

        let manual: (String, String, String) = conn.query_row(
            "SELECT id, passage, matched_text FROM source_passages WHERE origin = 'manual'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        assert_eq!(
            manual,
            ("manual-1".into(), "PSA.23".into(), "my choice".into())
        );
        assert_eq!(
            findings::get(conn, &finding)?.sources[0]
                .segment_id
                .as_deref(),
            Some(cited.as_str())
        );
        let after = library::get(conn, &id)?;
        assert_eq!(
            (
                &after.title,
                &after.language,
                after.segment_count,
                &after.content_hash,
                &after.updated_at
            ),
            (
                &before.title,
                &before.language,
                before.segment_count,
                &before.content_hash,
                &before.updated_at
            )
        );
        // a manual link is not a literal mention
        assert!(library::mentions(conn, &reference("PSA.23"))?.is_empty());
        Ok(())
    });
}

#[test]
fn a_source_whose_rebuild_fails_does_not_stop_the_app_and_keeps_its_links() {
    let temp = tempfile::tempdir().unwrap();
    let db_path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let (broken, healthy) = {
        let db = Database::open(&db_path, &backups).unwrap();
        db.with_conn(|conn| {
            let broken = add(
                conn,
                temp.path(),
                "joh.md",
                GERMAN.as_bytes(),
                Some("Deutsch"),
            );
            let healthy = add(
                conn,
                temp.path(),
                "t.txt",
                "Siehe Röm 8,28.".as_bytes(),
                Some("Deutsch"),
            );
            conn.execute("UPDATE sources SET passage_index_version = 0", [])?;
            // something that makes writing a section link fail, as a damaged database might
            conn.execute_batch(
                "CREATE TRIGGER fail_sections BEFORE INSERT ON source_passages
                 WHEN NEW.origin = 'section' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;",
            )?;
            Ok((broken, healthy))
        })
        .unwrap()
    };

    // Opening runs the rebuild; it must not fail the start.
    let db =
        Database::open(&db_path, &backups).expect("a failed rebuild does not stop the app opening");
    db.with_conn(|conn| {
        let version = |id: &str| -> i64 {
            conn.query_row(
                "SELECT passage_index_version FROM sources WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        // the healthy source was rebuilt
        assert_eq!(version(&healthy), sections::INDEX_VERSION);
        // the failed one is exactly as it was: its transaction rolled back, so no link was lost
        assert_eq!(
            version(&broken),
            0,
            "it will be tried again at the next start"
        );
        let explicit: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages WHERE source_id = ?1 AND origin = 'explicit'",
            [&broken],
            |r| r.get(0),
        )?;
        assert_eq!(explicit, 2, "its explicit links are still there");
        let report = library::ensure_passage_index(conn)?;
        assert_eq!((report.rebuilt, report.failed), (0, 1));
        // once the cause is gone it is rebuilt
        conn.execute("DROP TRIGGER fail_sections", [])?;
        let report = library::ensure_passage_index(conn)?;
        assert_eq!((report.rebuilt, report.failed), (1, 0));
        assert_eq!(version(&broken), sections::INDEX_VERSION);
        Ok(())
    })
    .unwrap();
}

// --- size ---------------------------------------------------------------------------------

#[test]
fn indexing_a_moderately_large_source_in_each_language_is_quick() {
    let temp = tempfile::tempdir().unwrap();
    let samples = [
        (
            En,
            "English",
            "As John 3:16 and Rom 8:28 say, God so loved the world.",
        ),
        (
            De,
            "Deutsch",
            "Wie Joh 3,16 und Röm 8,28 sagen, hat Gott die Welt so geliebt.",
        ),
        (
            Ko,
            "한국어",
            "요한복음 3장 16절과 롬 8:28이 말하듯 하나님이 세상을 사랑하셨다.",
        ),
        (
            Fr,
            "Français",
            "Comme Jn 3,16 et Rm 8,28 le disent, Dieu a tant aimé le monde.",
        ),
        (
            Es,
            "Español",
            "Como dicen Jn 3:16 y Ro 8:28, Dios amó tanto al mundo.",
        ),
        (
            Pt,
            "Português",
            "Como dizem Jo 3:16 e Rm 8:28, Deus amou tanto o mundo.",
        ),
    ];
    with_db(|conn| {
        for (language, label, sentence) in samples {
            // 5,000 paragraphs under 100 headings, one reference-bearing sentence each
            let mut text = String::from("# Eine Quelle\n\n");
            for section in 0..100 {
                text.push_str(&format!("## Abschnitt {section}\n\n"));
                for _ in 0..50 {
                    text.push_str(sentence);
                    text.push_str("\n\n");
                }
            }
            let path = write(
                temp.path(),
                &format!("{}.md", language.code()),
                text.as_bytes(),
            );
            let started = std::time::Instant::now();
            let staged = import::stage(&path).unwrap();
            let staged_in = started.elapsed();
            let started = std::time::Instant::now();
            let id = commit(conn, &staged, language.code(), Some(label));
            let committed_in = started.elapsed();
            let stored = library::passages(conn, &id)?.len();
            eprintln!(
                "{}: {} segments, {} references found; stage {:?}, commit {:?}",
                language.code(),
                staged.document.segments.len(),
                stored,
                staged_in,
                committed_in
            );
            assert_eq!(
                stored,
                5_000 * 2,
                "{label}: two references in every paragraph"
            );
            assert!(
                staged_in + committed_in < std::time::Duration::from_secs(10),
                "{label}"
            );
        }
        Ok(())
    });
}
