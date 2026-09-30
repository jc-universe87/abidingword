//! Library v0.4: importers, provenance, duplicates, Scripture links, search,
//! citations, removal and rollback. All material is synthetic (see
//! support/library_fixtures.rs).

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::{findings, library, projects, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateFinding, CreateProject, CreateStudy, FindingType};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::library::import::{self, StagedSource};
use abiding_word_lib::library::{
    AddFindingSource, CommitSourceImport, GetSegments, LicenceStatus, SearchLibrary, SourceType,
};
use abiding_word_lib::scripture::reference::ScriptureRef;
use fixtures::EpubChapter;
use rusqlite::Connection;

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

fn commit(conn: &Connection, staged: &StagedSource, title: &str) -> AppResult<String> {
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, staged);
    library::commit_import(
        conn,
        &id,
        staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: title.into(),
            author: staged.document.metadata.author.clone(),
            ..Default::default()
        },
        &relative,
    )?;
    Ok(id)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

/// FTS5 "integrity-check" with rank 1 compares the index with its content
/// table, so stale or missing index entries fail the check.
fn fts_consistent(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "INSERT INTO library_search (library_search, rank) VALUES ('integrity-check', 1)",
        [],
    )?;
    Ok(())
}

// --- PDF -------------------------------------------------------------------

#[test]
fn a_text_pdf_keeps_page_provenance() {
    let temp = tempfile::tempdir().unwrap();
    let bytes = fixtures::pdf(
        &[
            &[
                "The cross stands at the centre of the Christian faith.",
                "Substitution is at its heart.",
            ],
            &[
                "Forgiveness is costly, as Romans 3:25-26 shows.",
                "Grace is never cheap.",
            ],
            &["Self-giving love is the pattern for the church."],
        ],
        Some("A Synthetic Study of the Cross"),
        Some("Test Author"),
    );
    let path = write(temp.path(), "cross.pdf", &bytes);
    let staged = import::stage(&path).unwrap();
    assert_eq!(staged.document.format, "pdf");
    assert_eq!(staged.document.page_count, Some(3));
    assert_eq!(
        staged.document.metadata.title.as_deref(),
        Some("A Synthetic Study of the Cross")
    );
    assert_eq!(
        staged.document.metadata.author.as_deref(),
        Some("Test Author")
    );
    assert!(staged.problem().is_none());
    let pages: Vec<_> = staged
        .document
        .segments
        .iter()
        .map(|s| (s.page_number, s.paragraph_index))
        .collect();
    assert_eq!(
        pages,
        [
            (Some(1), Some(0)),
            (Some(1), Some(1)),
            (Some(2), Some(0)),
            (Some(2), Some(1)),
            (Some(3), Some(0))
        ]
    );
    assert_eq!(staged.references.len(), 1);

    with_db(|conn| {
        let id = commit(conn, &staged, "The Cross")?;
        let source = library::get(conn, &id)?;
        assert_eq!(
            (
                source.format.as_deref(),
                source.page_count,
                source.segment_count
            ),
            (Some("pdf"), Some(3), 5)
        );
        assert_eq!(source.extraction_status.as_deref(), Some("extracted_text"));
        assert_eq!(source.source_type, SourceType::Book);
        assert_eq!(source.licence_status, LicenceStatus::Private);

        let hits = library::search(
            conn,
            &SearchLibrary {
                query: "costly".into(),
                offset: None,
            },
        )?;
        assert_eq!(hits.hits.len(), 1);
        let hit = &hits.hits[0];
        assert_eq!(
            (
                hit.page_number,
                hit.locator.as_str(),
                hit.source_title.as_str()
            ),
            (Some(2), "p. 2", "The Cross")
        );
        assert!(hit.snippet.contains("\u{2}costly\u{3}"));

        // Reopen at the exact place.
        let window = library::segments(
            conn,
            &GetSegments {
                source_id: id.clone(),
                around_segment_id: Some(hit.segment_id.clone()),
                offset: None,
                limit: Some(3),
            },
        )?;
        let target = window
            .segments
            .iter()
            .find(|s| s.id == hit.segment_id)
            .unwrap();
        assert_eq!(target.page_number, Some(2));
        assert!(target.text.starts_with("Forgiveness is costly"));
        fts_consistent(conn)
    });
}

#[test]
fn a_scanned_pdf_is_reported_not_imported() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "scan.pdf",
        &fixtures::pdf(&[&[], &[]], None, None),
    );
    let staged = import::stage(&path).unwrap();
    assert!(staged.document.segments.is_empty());
    let problem = staged.problem().unwrap();
    assert!(
        problem.contains("scanned pages") && problem.contains("OCR"),
        "{problem}"
    );
    with_db(|conn| {
        assert!(matches!(
            commit(conn, &staged, "Scan"),
            Err(AppError::Import(_))
        ));
        assert!(library::list(conn, &Default::default())?.is_empty());
        Ok(())
    });
}

#[test]
fn a_broken_or_unsupported_file_is_refused_plainly() {
    let temp = tempfile::tempdir().unwrap();
    let broken = write(temp.path(), "broken.pdf", b"%PDF-1.7 not really");
    assert!(matches!(import::stage(&broken), Err(AppError::Import(_))));
    let docx = write(temp.path(), "notes.docx", b"PK..");
    match import::stage(&docx) {
        Err(AppError::UnsupportedFormat(message)) => {
            assert!(message.contains("PDF, EPUB, Markdown"))
        }
        other => panic!("{:?}", other.err()),
    }
}

// --- EPUB ------------------------------------------------------------------

fn sample_epub() -> Vec<u8> {
    fixtures::epub(
        r#"<dc:title>Knowing a Synthetic God</dc:title><dc:creator>Test Writer</dc:creator><dc:language>en</dc:language><dc:publisher>Fixture Press</dc:publisher><dc:identifier id="uid">urn:isbn:9780000000002</dc:identifier>"#,
        &[
            EpubChapter { file: "ch2.xhtml", xhtml_body: "<h1>Chapter Two</h1><p>Knowing about God differs from knowing God.</p><h2>Wisdom</h2><p>See James 1:5.</p>" },
            EpubChapter { file: "ch1.xhtml", xhtml_body: "<h1>Chapter One</h1><p>The study of God is practical.</p>" },
        ],
        &[1, 0],
    )
}

#[test]
fn an_epub_keeps_metadata_reading_order_and_chapters() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(temp.path(), "knowing.epub", &sample_epub());
    let staged = import::stage(&path).unwrap();
    let meta = &staged.document.metadata;
    assert_eq!(meta.title.as_deref(), Some("Knowing a Synthetic God"));
    assert_eq!(meta.author.as_deref(), Some("Test Writer"));
    assert_eq!(meta.language.as_deref(), Some("en"));
    assert_eq!(meta.publisher.as_deref(), Some("Fixture Press"));
    assert_eq!(meta.isbn.as_deref(), Some("9780000000002"));
    assert_eq!(staged.document.chapter_count, Some(2));
    let seen: Vec<_> = staged
        .document
        .segments
        .iter()
        .map(|s| (s.text.as_str(), s.locator()))
        .collect();
    assert_eq!(
        seen,
        [
            ("The study of God is practical.", "Chapter One".to_string()),
            (
                "Knowing about God differs from knowing God.",
                "Chapter Two".to_string()
            ),
            ("See James 1:5.", "Chapter Two › Wisdom".to_string()),
        ]
    );
    assert!(
        staged
            .document
            .segments
            .iter()
            .all(|s| s.page_number.is_none()),
        "no invented pages"
    );
    assert_eq!(staged.references[0].1.reference.canonical, "JAS.1.5");
}

// --- Markdown and text -----------------------------------------------------

#[test]
fn markdown_and_text_notes_import_with_structure() {
    let temp = tempfile::tempdir().unwrap();
    let md = write(temp.path(), "romans-notes.md", b"# Romans Notes\n\n## Justification\n\nDeclared righteous (Rom 3:24).\n\n## Adoption\n\nSons, not slaves: Romans 8:15.\n");
    let staged = import::stage(&md).unwrap();
    assert_eq!(staged.document.format, "markdown");
    let seen: Vec<_> = staged
        .document
        .segments
        .iter()
        .map(|s| s.locator())
        .collect();
    assert_eq!(
        seen,
        ["Romans Notes › Justification", "Romans Notes › Adoption"]
    );
    assert_eq!(staged.references.len(), 2);

    let txt = write(
        temp.path(),
        "sermon.txt",
        b"Opening illustration.\n\nMain point from John 15:5.\n\nClosing prayer.",
    );
    let staged = import::stage(&txt).unwrap();
    assert_eq!(staged.document.segments.len(), 3);
    assert_eq!(staged.document.segments[1].locator(), "¶ 2");
    with_db(|conn| {
        let id = commit(conn, &staged, "Sermon")?;
        assert_eq!(library::get(conn, &id)?.source_type, SourceType::Notes);
        Ok(())
    });
}

// --- duplicates ------------------------------------------------------------

#[test]
fn the_same_file_is_recognised_as_a_duplicate() {
    let temp = tempfile::tempdir().unwrap();
    let a = write(temp.path(), "a.md", b"# Notes\n\nSame content.");
    let b = write(temp.path(), "renamed copy.md", b"# Notes\n\nSame content.");
    let first = import::stage(&a).unwrap();
    let second = import::stage(&b).unwrap();
    assert_eq!(first.hash, second.hash);
    with_db(|conn| {
        let id = commit(conn, &first, "Notes")?;
        let dup = library::find_duplicate(conn, &second.hash)?.unwrap();
        assert_eq!(
            (dup.id.as_str(), dup.title.as_str()),
            (id.as_str(), "Notes")
        );
        match commit(conn, &second, "Notes again") {
            Err(AppError::Conflict(message)) => {
                assert!(message.contains("already in your library"))
            }
            other => panic!("{other:?}"),
        }
        let allowed = abiding_word_lib::db::new_id();
        library::commit_import(
            conn,
            &allowed,
            &second,
            &CommitSourceImport {
                preview_id: second.id.clone(),
                title: "Deliberate second copy".into(),
                allow_duplicate: true,
                ..Default::default()
            },
            "notes/x/renamed copy.md",
        )?;
        assert_eq!(library::list(conn, &Default::default())?.len(), 2);
        Ok(())
    });
}

// --- Scripture links and search --------------------------------------------

#[test]
fn scripture_references_in_sources_are_linked_and_found() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "notes.md",
        b"# Notes\n\nSee Romans 8:1-4 and Galatians 2:16.\n\nAlso Rom 8:28.\n\nNothing here.",
    );
    let staged = import::stage(&path).unwrap();
    with_db(|conn| {
        let id = commit(conn, &staged, "Romans Notes")?;
        let passages: Vec<_> = library::passages(conn, &id)?
            .into_iter()
            .map(|p| p.reference.canonical)
            .collect();
        assert_eq!(passages, ["ROM.8.1-ROM.8.4", "GAL.2.16", "ROM.8.28"]);

        let romans_8 = library::mentions(
            conn,
            &ScriptureRef::from_canonical("ROM.8.1-ROM.8.17").unwrap(),
        )?;
        let found: Vec<_> = romans_8
            .iter()
            .map(|m| {
                (
                    m.source_title.as_str(),
                    m.matched_text.as_str(),
                    m.locator.as_str(),
                )
            })
            .collect();
        assert_eq!(found, [("Romans Notes", "Romans 8:1-4", "Notes")]);
        assert_eq!(
            library::mentions(conn, &ScriptureRef::from_canonical("ROM.8.28").unwrap())?.len(),
            1
        );
        assert!(
            library::mentions(conn, &ScriptureRef::from_canonical("JHN.3").unwrap())?.is_empty()
        );
        Ok(())
    });
}

#[test]
fn search_pages_results_and_stays_consistent_after_removal() {
    let temp = tempfile::tempdir().unwrap();
    let body: String = (1..=60)
        .map(|i| format!("Paragraph {i} speaks of grace.\n\n"))
        .collect();
    let path = write(temp.path(), "grace.txt", body.as_bytes());
    let staged = import::stage(&path).unwrap();
    with_db(|conn| {
        let id = commit(conn, &staged, "Grace")?;
        let first = library::search(
            conn,
            &SearchLibrary {
                query: "grace".into(),
                offset: None,
            },
        )?;
        assert_eq!(first.hits.len(), 50);
        assert!(first.has_more);
        let second = library::search(
            conn,
            &SearchLibrary {
                query: "grace".into(),
                offset: Some(50),
            },
        )?;
        assert_eq!((second.hits.len(), second.has_more), (10, false));
        fts_consistent(conn)?;

        library::remove(conn, &id)?;
        assert!(library::search(
            conn,
            &SearchLibrary {
                query: "grace".into(),
                offset: None
            }
        )?
        .hits
        .is_empty());
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM library_search", [], |r| r.get(0))?;
        assert_eq!(rows, 0, "no stale index entries");
        fts_consistent(conn)?;
        let links: i64 =
            conn.query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))?;
        assert_eq!(links, 0);
        assert!(matches!(
            library::get(conn, &id),
            Err(AppError::NotFound { .. })
        ));
        assert!(library::list(conn, &Default::default())?.is_empty());
        Ok(())
    });
}

// --- rollback --------------------------------------------------------------

#[test]
fn a_failed_import_leaves_nothing_behind() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "notes.md",
        b"# Notes\n\nRomans 8:1.\n\nMore text.",
    );
    let mut staged = import::stage(&path).unwrap();
    // Corrupt one detected reference so the last step of the transaction fails.
    staged.references[0].1.reference.canonical = "NOT.A.REFERENCE".into();
    with_db(|conn| {
        assert!(commit(conn, &staged, "Broken").is_err());
        let count = |table: &str| -> AppResult<i64> {
            Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
        };
        assert_eq!(
            (
                count("sources")?,
                count("source_files")?,
                count("source_segments")?,
                count("source_passages")?,
                count("library_search")?
            ),
            (0, 0, 0, 0, 0)
        );
        fts_consistent(conn)
    });
}

#[test]
fn managed_paths_are_safe_whatever_the_file_is_called() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(temp.path(), "..%2F..%2Fescape; rm -rf.md", b"# x\n\ntext");
    let staged = import::stage(&path).unwrap();
    let relative = library::managed_relative_path("abc", &staged);
    assert!(relative.starts_with("notes/abc/"), "{relative}");
    assert!(
        !relative[10..].contains('/') && !relative.contains(".."),
        "{relative}"
    );
}

// --- findings citing sources ----------------------------------------------

fn study_with_finding(conn: &Connection) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: "Romans".into(),
            description: None,
        },
    )?;
    let study = studies::create(
        conn,
        &CreateStudy {
            project_id: project.id,
            title: "Romans 8".into(),
            ..Default::default()
        },
    )?;
    Ok(findings::create(
        conn,
        &CreateFinding {
            study_id: study.study.id,
            finding_type: FindingType::Quotation,
            content: Some("Union with Christ.".into()),
            section_id: None,
            passage: None,
        },
    )?
    .id)
}

#[test]
fn findings_cite_segments_and_survive_restart_and_removal() {
    let temp = tempfile::tempdir().unwrap();
    let pdf = write(
        temp.path(),
        "murray.pdf",
        &fixtures::pdf(
            &[
                &["Front matter page of the synthetic book."],
                &["Union with Christ is the central truth of salvation."],
            ],
            None,
            None,
        ),
    );
    let db_path = temp.path().join("aw.db");
    let backups = temp.path().join("backups");
    let (finding, source) = {
        let db = Database::open(&db_path, &backups).unwrap();
        db.with_conn(|conn| {
            let staged = import::stage(&pdf)?;
            let source = commit(conn, &staged, "Redemption (synthetic)")?;
            let finding = study_with_finding(conn)?;
            let hit = library::search(
                conn,
                &SearchLibrary {
                    query: "union".into(),
                    offset: None,
                },
            )?
            .hits
            .remove(0);
            let cited = findings::add_source(
                conn,
                &AddFindingSource {
                    finding_id: finding.clone(),
                    segment_id: hit.segment_id.clone(),
                },
            )?;
            let again = findings::add_source(
                conn,
                &AddFindingSource {
                    finding_id: finding.clone(),
                    segment_id: hit.segment_id,
                },
            )?;
            assert_eq!(again.sources.len(), 1, "no duplicate citation");
            let c = &cited.sources[0];
            assert_eq!(
                (c.title.as_str(), c.locator.as_deref(), c.removed),
                ("Redemption (synthetic)", Some("p. 2"), false)
            );
            assert_eq!(
                cited.content, "Union with Christ.",
                "citing copies no source text"
            );
            Ok((finding, source))
        })
        .unwrap()
    };

    let db = Database::open(&db_path, &backups).unwrap();
    db.with_conn(|conn| {
        let f = findings::get(conn, &finding)?;
        assert_eq!(f.sources.len(), 1, "citation survives restart");
        assert!(f.sources[0].segment_id.is_some());

        library::remove(conn, &source)?;
        let after = findings::get(conn, &finding)?;
        let c = &after.sources[0];
        assert!(c.removed, "marked as removed, not silently dropped");
        assert_eq!(c.segment_id, None);
        assert_eq!(
            (c.title.as_str(), c.locator.as_deref()),
            ("Redemption (synthetic)", Some("p. 2"))
        );

        findings::remove_source(conn, &c.id)?;
        assert!(findings::get(conn, &finding)?.sources.is_empty());
        Ok(())
    })
    .unwrap();
}
