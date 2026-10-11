//! Scripture storage, import, search, annotations and study passages.

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::SourceRecord;
use abiding_word_lib::db::{
    annotations, bibles, projects, studies, study_passages, workspaces, Database,
};
use abiding_word_lib::domain::{CreateProject, CreateStudy};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::scripture::canon::BOOKS;
use abiding_word_lib::scripture::import::{self, ImportOrigin, Severity, StagedContent};
use abiding_word_lib::scripture::reference::ScriptureRef;
use abiding_word_lib::scripture::{
    AddStudyPassage, BibleTranslation, CommitImport, CreateAnnotation, SearchScripture,
    UpdateAnnotation,
};
use rusqlite::Connection;

fn fixture_files(set: &str) -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(set);
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    files
}

fn meta(preview_id: &str, name: &str, short_name: &str) -> CommitImport {
    CommitImport {
        preview_id: preview_id.into(),
        name: name.into(),
        short_name: short_name.into(),
        language: "English".into(),
        language_code: Some("en".into()),
        publisher: None,
        copyright_notice: None,
        license_type: None,
    }
}

fn user_source() -> SourceRecord {
    SourceRecord {
        origin: "managed_copy",
        path: Some("sources/bibles/test".into()),
        original_file_name: Some("fixture".into()),
        format: "usfm",
        is_builtin: false,
    }
}

fn install(conn: &Connection, set: &str, short_name: &str) -> AppResult<BibleTranslation> {
    let staged = import::stage(&fixture_files(set), ImportOrigin::UserFiles)?;
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &meta(&staged.id, &format!("Fixture {short_name}"), short_name),
        &user_source(),
    )
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn new_study(conn: &Connection) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: "John".into(),
            description: None,
        },
    )?;
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project.id,
            title: "John 15:1–11".into(),
            template_key: None,
            ..Default::default()
        },
    )?
    .study
    .id)
}

fn r(value: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(value).unwrap()
}

// --- canon -----------------------------------------------------------------

#[test]
fn the_database_canon_matches_the_registry() {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, code, testament, name, chapter_count FROM bible_books ORDER BY id",
        )?;
        let rows: Vec<(u8, String, String, String, u16)> = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .collect::<Result<_, _>>()?;
        assert_eq!(rows.len(), 66);
        for (row, book) in rows.iter().zip(BOOKS.iter()) {
            assert_eq!(
                row,
                &(
                    book.ordinal,
                    book.code.to_string(),
                    book.testament.code().to_string(),
                    book.name.to_string(),
                    book.chapter_count
                )
            );
        }
        let chapters: i64 =
            conn.query_row("SELECT COUNT(*) FROM bible_chapters", [], |r| r.get(0))?;
        assert_eq!(chapters, 1189);
        Ok(())
    });
}

// --- import ----------------------------------------------------------------

#[test]
fn a_valid_fixture_imports_with_a_clear_preview() {
    let staged = import::stage(&fixture_files("usfm-a"), ImportOrigin::UserFiles).unwrap();
    let preview = staged.preview(Default::default());
    assert!(preview.can_import, "{:?}", preview.issues);
    assert_eq!(preview.book_count, 3);
    let books: Vec<_> = preview
        .books
        .iter()
        .map(|b| (b.code, b.chapters, b.verses))
        .collect();
    assert_eq!(books, vec![("PSA", 1, 2), ("JHN", 3, 10), ("ROM", 1, 3)]);
    assert_eq!(preview.skipped_files, vec!["00-FRT.usfm".to_string()]);
    // A partial Bible is reported, not refused.
    assert!(preview.issues.iter().all(|i| i.severity != Severity::Error));
    assert!(preview
        .issues
        .iter()
        .any(|i| i.message.contains("3 of 21 chapters")));
    // The interface translates issues from their code and values.
    let missing = preview
        .issues
        .iter()
        .find(|i| i.code.as_deref() == Some("bibleImport.missingChapters") && i.book == Some("JHN"))
        .expect("coded issue");
    assert_eq!(missing.params["bookCode"], "JHN");
    assert_eq!(missing.params["found"], "3");
    assert_eq!(missing.params["count"], "21");
    assert_eq!(missing.params["more"], "10");
    assert_eq!(missing.params["numbers"], "1, 2, 3, 4, 5, 6, 7, 8");
}

#[test]
fn faulty_files_are_reported_in_plain_language_and_block_the_import() {
    let staged = import::stage(&fixture_files("usfm-broken"), ImportOrigin::UserFiles).unwrap();
    let preview = staged.preview(Default::default());
    assert!(!preview.can_import);
    let messages: Vec<&str> = preview.issues.iter().map(|i| i.message.as_str()).collect();
    let has = |needle: &str| messages.iter().any(|m| m.contains(needle));
    assert!(has("John 15:1 appears twice"), "{messages:#?}");
    assert!(
        has("the verse number “x” could not be read"),
        "{messages:#?}"
    );
    assert!(has("John 99: John has 21 chapters"), "{messages:#?}");
    assert!(has("verse 2 not found"), "{messages:#?}");
    assert_eq!(
        preview.issues[0].severity,
        Severity::Error,
        "errors come first"
    );

    with_db(|conn| {
        let error = bibles::commit_import(
            conn,
            "x",
            &staged.content,
            &meta(&staged.id, "Broken", "BRK"),
            &user_source(),
        )
        .unwrap_err();
        assert!(matches!(error, AppError::Import(_)));
        assert!(bibles::list(conn)?.is_empty());
        Ok(())
    });
}

#[test]
fn unsupported_files_are_refused_clearly() {
    let temp = tempfile::tempdir().unwrap();
    let pdf = temp.path().join("bible.pdf");
    std::fs::write(&pdf, b"%PDF-1.7").unwrap();
    match import::stage(&[pdf], ImportOrigin::UserFiles) {
        Err(AppError::UnsupportedFormat(message)) => assert!(message.contains("PDF")),
        other => panic!("{:?}", other.err()),
    }
    let text = temp.path().join("notes.txt");
    std::fs::write(&text, b"Just some notes.").unwrap();
    assert!(matches!(
        import::stage(&[text], ImportOrigin::UserFiles),
        Err(AppError::UnsupportedFormat(_))
    ));
}

#[test]
fn a_failed_commit_leaves_nothing_behind() {
    with_db(|conn| {
        // Bypass staging validation to force a failure mid-transaction: a
        // chapter the canon does not have violates a foreign key.
        let mut staged = import::stage(&fixture_files("usfm-a"), ImportOrigin::UserFiles)?;
        let john = staged.content.books.get_mut(&43).unwrap();
        john.chapters
            .entry(99)
            .or_default()
            .verses
            .insert(1, "Impossible".into());

        let error = bibles::commit_import(
            conn,
            "partial",
            &staged.content,
            &meta(&staged.id, "Partial", "PRT"),
            &user_source(),
        );
        assert!(error.is_err());
        assert!(bibles::list(conn)?.is_empty());
        let texts: i64 =
            conn.query_row("SELECT COUNT(*) FROM bible_verse_texts", [], |r| r.get(0))?;
        let verses: i64 = conn.query_row("SELECT COUNT(*) FROM bible_verses", [], |r| r.get(0))?;
        assert_eq!((texts, verses), (0, 0));
        Ok(())
    });
}

#[test]
fn duplicate_short_names_are_refused() {
    with_db(|conn| {
        install(conn, "usfm-a", "FXA")?;
        let error = install(conn, "usfm-b", "fxa").unwrap_err();
        assert!(matches!(error, AppError::DuplicateTranslation(_)));
        assert_eq!(bibles::list(conn)?.len(), 1);
        Ok(())
    });
}

// --- reading ---------------------------------------------------------------

#[test]
fn chapters_and_passages_are_read_in_canonical_order() {
    with_db(|conn| {
        let bible = install(conn, "usfm-a", "FXA")?;
        assert_eq!((bible.book_count, bible.verse_count), (3, 15));

        let chapter = bibles::chapter(conn, &bible.id, "JHN", 15)?;
        assert_eq!(chapter.verses.len(), 7);
        assert_eq!(chapter.verses[0].canonical, "JHN.15.1");
        assert_eq!(
            chapter.verses[0].text,
            "Fixture alpha fifteen one about the vine."
        );
        assert_eq!(
            chapter.verses[1].text, "Fixture alpha fifteen two about fruit.",
            "footnote removed"
        );

        let psalm = bibles::chapter(conn, &bible.id, "PSA", 23)?;
        assert_eq!(
            psalm.superscription.as_deref(),
            Some("Fixture alpha psalm title.")
        );
        assert_eq!(
            psalm.verses[0].text,
            "Fixture alpha twenty-three one about a shepherd; continued on a second line."
        );

        let passage = bibles::passage(conn, &bible.id, &r("JHN.14.2-JHN.15.2"))?;
        let got: Vec<_> = passage
            .verses
            .iter()
            .map(|v| v.canonical.as_str())
            .collect();
        assert_eq!(got, ["JHN.14.2", "JHN.15.1", "JHN.15.2"]);

        // A book this Bible lacks reads as empty, not as an error.
        assert!(bibles::chapter(conn, &bible.id, "GEN", 1)?
            .verses
            .is_empty());
        assert!(matches!(
            bibles::chapter(conn, &bible.id, "JHN", 22),
            Err(AppError::InvalidReference(_))
        ));
        assert!(matches!(
            bibles::chapter(conn, "no-such-bible", "JHN", 1),
            Err(AppError::NotFound { .. })
        ));
        Ok(())
    });
}

#[test]
fn switching_translation_keeps_the_same_canonical_passage() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let b = install(conn, "usfm-b", "FXB")?;
        let passage = r("ROM.8.1");
        let in_a = bibles::passage(conn, &a.id, &passage)?;
        let in_b = bibles::passage(conn, &b.id, &passage)?;
        assert_eq!(in_a.verses[0].canonical, in_b.verses[0].canonical);
        assert!(in_a.verses[0].text.contains("alpha"));
        assert!(in_b.verses[0].text.contains("beta"));
        let shared: i64 = conn.query_row("SELECT COUNT(*) FROM bible_verses", [], |r| r.get(0))?;
        assert_eq!(shared, 15, "canonical verses are shared, not duplicated");
        Ok(())
    });
}

// --- search ----------------------------------------------------------------

fn search(
    conn: &Connection,
    query: &str,
    translation: Option<&str>,
    book: Option<&str>,
) -> AppResult<Vec<String>> {
    let results = bibles::search(
        conn,
        &SearchScripture {
            query: query.into(),
            translation_id: translation.map(String::from),
            book: book.map(String::from),
        },
    )?;
    Ok(results
        .hits
        .iter()
        .map(|h| format!("{} {}", h.translation_short_name, h.reference.canonical))
        .collect())
}

#[test]
fn search_finds_words_and_phrases_with_filters() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        install(conn, "usfm-b", "FXB")?;

        assert_eq!(
            search(conn, "vine", None, None)?,
            ["FXA JHN.15.1", "FXB JHN.15.1"]
        );
        assert_eq!(search(conn, "VINE", Some(&a.id), None)?, ["FXA JHN.15.1"]);
        assert_eq!(
            search(conn, "\"no condemnation\"", Some(&a.id), None)?,
            ["FXA ROM.8.1"]
        );
        assert!(search(conn, "\"condemnation no\"", Some(&a.id), None)?.is_empty());
        assert_eq!(
            search(conn, "about", Some(&a.id), Some("ROM"))?,
            ["FXA ROM.8.1"]
        );
        assert_eq!(
            search(conn, "fifteen about", Some(&a.id), None)?.len(),
            4,
            "all words must occur"
        );
        // FTS syntax typed by the user is treated as plain words.
        assert!(search(conn, "vine OR NEAR(* \"", Some(&a.id), None).is_ok());
        assert!(matches!(
            search(conn, "  ", None, None),
            Err(AppError::InvalidInput(_))
        ));
        Ok(())
    });
}

// --- removal ---------------------------------------------------------------

#[test]
fn removing_a_bible_keeps_studies_passages_and_notes() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let study = new_study(conn)?;
        let link = study_passages::add(
            conn,
            &AddStudyPassage {
                study_id: study.clone(),
                reference: "JHN.15.1-JHN.15.11".into(),
                ..Default::default()
            },
        )?;
        let general = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.1".into(),
                kind: "note".into(),
                content: Some("No condemnation".into()),
                translation_id: None,
                ..Default::default()
            },
        )?;
        let wording = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.1".into(),
                kind: "note".into(),
                content: Some("This translation says vine".into()),
                translation_id: Some(a.id.clone()),
                ..Default::default()
            },
        )?;

        bibles::remove(conn, &a.id)?;

        assert!(bibles::list(conn)?.is_empty());
        let texts: i64 =
            conn.query_row("SELECT COUNT(*) FROM bible_verse_texts", [], |r| r.get(0))?;
        assert_eq!(texts, 0);
        let canonical: i64 =
            conn.query_row("SELECT COUNT(*) FROM bible_verses", [], |r| r.get(0))?;
        assert_eq!(canonical, 15, "canonical structure stays");
        assert!(
            search(conn, "vine", None, None)?.is_empty(),
            "search index cleaned"
        );

        assert_eq!(studies::get(conn, &study)?.title, "John 15:1–11");
        assert_eq!(study_passages::list(conn, &study)?[0].id, link.id);
        assert_eq!(
            annotations::get(conn, &general.id)?.content,
            "No condemnation"
        );
        let kept = annotations::get(conn, &wording.id)?;
        assert_eq!(
            kept.translation_id, None,
            "translation link dropped, note kept"
        );
        assert_eq!(kept.reference.canonical, "JHN.15.1");
        Ok(())
    });
}

// --- annotations -----------------------------------------------------------

#[test]
fn annotations_attach_to_canonical_passages() {
    with_db(|conn| {
        install(conn, "usfm-a", "FXA")?;
        let note = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.1".into(),
                kind: "note".into(),
                content: Some("First".into()),
                translation_id: None,
                ..Default::default()
            },
        )?;
        let highlight = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.2".into(),
                kind: "highlight".into(),
                content: None,
                translation_id: None,
                ..Default::default()
            },
        )?;
        let again = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.2".into(),
                kind: "highlight".into(),
                content: None,
                translation_id: None,
                ..Default::default()
            },
        )?;
        assert_eq!(highlight.id, again.id, "no duplicate highlights");
        annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.3".into(),
                kind: "bookmark".into(),
                content: None,
                translation_id: None,
                ..Default::default()
            },
        )?;

        let chapter: Vec<_> = annotations::list(conn, &r("ROM.8"))?
            .into_iter()
            .map(|a| a.kind)
            .collect();
        assert_eq!(chapter, ["note", "highlight", "bookmark"]);
        assert_eq!(annotations::list(conn, &r("ROM.8.1"))?.len(), 1);
        assert!(annotations::list(conn, &r("ROM.9"))?.is_empty());

        let updated = annotations::update(
            conn,
            &UpdateAnnotation {
                id: note.id.clone(),
                content: Some("Revised".into()),
                ..Default::default()
            },
        )?;
        assert_eq!((updated.content.as_str(), updated.revision), ("Revised", 2));
        annotations::delete(conn, &highlight.id)?;
        assert_eq!(annotations::list(conn, &r("ROM.8"))?.len(), 2);

        assert!(annotations::create(
            conn,
            &CreateAnnotation {
                reference: "ROM.8.1".into(),
                kind: "sticker".into(),
                content: None,
                translation_id: None,
                ..Default::default()
            }
        )
        .is_err());
        assert!(matches!(
            annotations::create(
                conn,
                &CreateAnnotation {
                    reference: "ROM.17.1".into(),
                    kind: "note".into(),
                    content: None,
                    translation_id: None,
                    ..Default::default()
                }
            ),
            Err(AppError::InvalidReference(_))
        ));
        Ok(())
    });
}

#[test]
fn annotations_and_study_passages_survive_a_restart() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let (study, note) = {
        let db = Database::open(&path, &backups).unwrap();
        db.with_conn(|conn| {
            install(conn, "usfm-a", "FXA")?;
            let study = new_study(conn)?;
            study_passages::add(
                conn,
                &AddStudyPassage {
                    study_id: study.clone(),
                    reference: "JHN.15.1-JHN.15.11".into(),
                    ..Default::default()
                },
            )?;
            let note = annotations::create(
                conn,
                &CreateAnnotation {
                    reference: "JHN.15.7".into(),
                    kind: "note".into(),
                    content: Some("Ask".into()),
                    translation_id: None,
                    ..Default::default()
                },
            )?;
            Ok((study, note.id))
        })
        .unwrap()
    };
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        let passages = study_passages::list(conn, &study)?;
        assert_eq!(passages[0].reference.display, "John 15:1–11");
        assert_eq!(annotations::get(conn, &note)?.content, "Ask");
        assert_eq!(bibles::list(conn)?[0].short_name, "FXA");
        Ok(())
    })
    .unwrap();
}

// --- study passages --------------------------------------------------------

#[test]
fn studies_link_to_passages_optionally() {
    with_db(|conn| {
        let study = new_study(conn)?;
        assert!(
            study_passages::list(conn, &study)?.is_empty(),
            "a study need not have a passage"
        );

        let first = study_passages::add(
            conn,
            &AddStudyPassage {
                study_id: study.clone(),
                reference: "JHN.15.1-JHN.15.11".into(),
                ..Default::default()
            },
        )?;
        let second = study_passages::add(
            conn,
            &AddStudyPassage {
                study_id: study.clone(),
                reference: "ROM.8".into(),
                ..Default::default()
            },
        )?;
        let again = study_passages::add(
            conn,
            &AddStudyPassage {
                study_id: study.clone(),
                reference: "JHN.15.1-JHN.15.11".into(),
                ..Default::default()
            },
        )?;
        assert_eq!(first.id, again.id);

        let listed: Vec<_> = study_passages::list(conn, &study)?
            .into_iter()
            .map(|p| p.reference.canonical)
            .collect();
        assert_eq!(listed, ["JHN.15.1-JHN.15.11", "ROM.8"]);

        study_passages::remove(conn, &second.id)?;
        assert_eq!(study_passages::list(conn, &study)?.len(), 1);
        assert!(matches!(
            study_passages::add(
                conn,
                &AddStudyPassage {
                    study_id: study,
                    reference: "not a passage".into(),
                    ..Default::default()
                }
            ),
            Err(AppError::InvalidReference(_))
        ));
        Ok(())
    });
}

// --- every Bible shipped with the app ---------------------------------------

/// The file's SHA-256, as SOURCE.md records it.
fn sha256_hex(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).unwrap();
    Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn every_bundled_bible_is_recorded_and_imports_cleanly() {
    use abiding_word_lib::scripture::bundled::BUNDLED;
    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/scripture");
    let config =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
            .unwrap();
    for bible in BUNDLED {
        let folder = resources.join(bible.id);
        let zip = folder.join(bible.resource);
        // Shipped exactly as recorded: the licence statement and checksum are kept beside it.
        let source = std::fs::read_to_string(folder.join("SOURCE.md"))
            .unwrap_or_else(|_| panic!("{}: SOURCE.md missing", bible.id));
        assert!(
            source.contains(&sha256_hex(&zip)),
            "{}: checksum differs from SOURCE.md",
            bible.id
        );
        // The publisher's own licence statement, kept beside the file.
        assert!(
            folder.join("copr.htm").exists() || folder.join("copyright-statement.txt").exists(),
            "{}: publisher's licence statement missing",
            bible.id
        );
        assert!(
            config.contains(&format!(
                "\"../resources/scripture/{}/{}\": \"scripture/{}\"",
                bible.id, bible.resource, bible.resource
            )),
            "{}: not in tauri.conf.json resources",
            bible.id
        );

        let staged = import::stage(&[zip], ImportOrigin::Bundled { id: bible.id }).unwrap();
        let preview = staged.preview(Default::default());
        let errors: Vec<_> = preview
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .collect();
        assert!(errors.is_empty(), "{}: {errors:#?}", bible.id);
        assert_eq!(preview.book_count, 66, "{}", bible.id);
        assert_eq!(preview.chapter_count, 1189, "{}", bible.id);
        assert!(
            (30_900..31_250).contains(&preview.verse_count),
            "{}: {}",
            bible.id,
            preview.verse_count
        );
        let john_3_16 = &staged.content.books[&43].chapters[&3].verses[&16];
        assert!(john_3_16.chars().count() > 40, "{}: {john_3_16}", bible.id);
        assert!(
            !john_3_16.contains('\\') && !john_3_16.contains('|'),
            "{}: markup left: {john_3_16}",
            bible.id
        );
    }
}

#[test]
fn the_korean_bible_has_the_verses_other_copies_lacked() {
    // 개역한글 from the Korean Bible Society's own text: eBible.org's copy
    // lacked these verses (resources/scripture/kor1961/SOURCE.md).
    let zip = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/scripture/kor1961/kor1961_usfm.zip");
    let staged = import::stage(&[zip], ImportOrigin::Bundled { id: "kor1961" }).unwrap();
    let books = &staged.content.books;
    let verse =
        |book: u8, chapter: u16, verse: u16| books[&book].chapters[&chapter].verses[&verse].clone();
    assert!(
        verse(1, 30, 43).starts_with("이에 그 사람이 심히 풍부하여"),
        "{}",
        verse(1, 30, 43)
    );
    assert_eq!(
        verse(19, 118, 29),
        "여호와께 감사하라 그는 선하시며 그 인자하심이 영원함이로다"
    );
    assert!(verse(60, 5, 14).starts_with("너희는 사랑의 입맞춤으로 피차 문안하라"));
    assert_eq!(
        verse(43, 3, 16),
        "하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 저를 믿는 자마다 멸망치 않고 영생을 얻게 하려 하심이니라"
    );
    // Psalm titles are kept; the translator's notes stay in the file, not in the verse.
    assert_eq!(
        books[&19].chapters[&8].superscription.as_deref(),
        Some("다윗의 시, 영장으로 깃딧에 맞춘 노래")
    );
    assert!(!verse(19, 8, 5).contains("하나님"), "{}", verse(19, 8, 5));
}

// --- the bundled World English Bible ----------------------------------------

#[test]
fn the_bundled_world_english_bible_imports_cleanly() {
    let zip = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../resources/scripture/engwebp/engwebp_usfm.zip");
    let staged = import::stage(&[zip], ImportOrigin::Bundled { id: "engwebp" }).unwrap();
    let preview = staged.preview(Default::default());
    let errors: Vec<_> = preview
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(errors.is_empty(), "{errors:#?}");
    assert_eq!(preview.book_count, 66);
    assert_eq!(preview.chapter_count, 1189);
    assert!(
        (31_000..31_200).contains(&preview.verse_count),
        "{}",
        preview.verse_count
    );

    let content: &StagedContent = &staged.content;
    let john = &content.books[&43].chapters[&15].verses;
    assert!(john[&1].contains("I am the true vine"), "{}", john[&1]);
    assert!(!john[&1].contains("strong"), "Strong's markup removed");
    let psalm = &content.books[&19].chapters[&23];
    assert_eq!(psalm.superscription.as_deref(), Some("A Psalm by David."));
    assert_eq!(
        psalm.verses[&1],
        "The LORD is my shepherd; I shall lack nothing."
    );

    with_db(|conn| {
        let bible = bibles::commit_import(
            conn,
            "web",
            content,
            &meta(&staged.id, "World English Bible", "WEB"),
            &SourceRecord {
                origin: "bundled",
                path: Some("scripture/engwebp_usfm.zip".into()),
                original_file_name: Some("engwebp_usfm.zip".into()),
                format: "usfm",
                is_builtin: true,
            },
        )?;
        assert_eq!(bible.book_count, 66);
        assert!(bibles::find_builtin(conn, "scripture/engwebp_usfm.zip")?.is_some());
        let hits = search(conn, "\"true vine\"", Some(&bible.id), None)?;
        assert_eq!(hits, ["WEB JHN.15.1"]);
        Ok(())
    });
}
