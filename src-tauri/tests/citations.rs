//! Citations that travel without their library source (v0.19.1).
//!
//! A project moved to a computer that does not have a cited library book
//! keeps every citation: its title, author, words, page, section and anchor,
//! and says that the book is not on this computer. It survives further
//! moves unchanged, and points at the book again only when exactly that
//! file (the same SHA-256) is there; never by a similar title. Everything
//! runs on temporary data folders. All text is invented.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{findings, library, projects, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateFinding, CreateProject, CreateStudy, FindingType};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::filesystem::DataDirs;
use abiding_word_lib::portability::project;
use rusqlite::{params, Connection};

struct Folder {
    _temp: tempfile::TempDir,
    dirs: DataDirs,
    db: Database,
}

fn folder() -> Folder {
    let temp = tempfile::tempdir().unwrap();
    let dirs = DataDirs::ensure(temp.path().join("Abiding Word")).unwrap();
    let db = Database::open(&dirs.database_file(), &dirs.pre_migration_backups()).unwrap();
    Folder {
        _temp: temp,
        dirs,
        db,
    }
}

const HASH: &str = "4f2b1c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
const ANCHOR: &str = r#"{"v":1,"startSegmentId":"seg-1","startOffset":4,"endSegmentId":"seg-1","endOffset":30,"prefix":"The ","suffix":" and"}"#;

/// A library source with one paragraph and a mark on it.
fn add_source(conn: &Connection, id: &str, title: &str, hash: &str) -> AppResult<()> {
    let w = workspaces::get_default(conn)?.id;
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, author, content_hash, created_at, updated_at)
         VALUES (?1, ?2, 'book', ?3, 'A. Writer', ?4, '2026-01-01', '2026-01-01')",
        params![id, w, title, hash],
    )?;
    conn.execute(
        "INSERT INTO source_segments (id, source_id, position, content, created_at, updated_at)
         VALUES (?1, ?2, 0, 'The branch bears fruit only in the vine, and not alone.', '2026-01-01', '2026-01-01')",
        params![format!("seg-{id}"), id],
    )?;
    conn.execute(
        "INSERT INTO source_annotations (id, workspace_id, source_id, kind, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'highlight', '2026-01-01', '2026-01-01')",
        params![format!("mark-{id}"), w, id],
    )?;
    Ok(())
}

/// A project "John" with one study and a note citing `source`, with every
/// piece of a citation filled in.
fn make_project(conn: &Connection, title: &str, source: &str) -> AppResult<(String, String)> {
    let w = workspaces::get_default(conn)?.id;
    let p = projects::create(
        conn,
        &CreateProject {
            workspace_id: w,
            title: title.into(),
            description: None,
        },
    )?
    .id;
    let s = studies::create(
        conn,
        &CreateStudy {
            project_id: p.clone(),
            title: "Abiding".into(),
            ..Default::default()
        },
    )?
    .study
    .id;
    let f = findings::create(
        conn,
        &CreateFinding {
            study_id: s,
            finding_type: FindingType::Quotation,
            content: Some("Fruit is the vine's.".into()),
            section_id: None,
            passage: None,
        },
    )?
    .id;
    conn.execute(
        "INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator,
             cited_title, cited_author, quote, cited_section, anchor, annotation_id,
             created_at, updated_at)
         VALUES ('cite-1', ?1, ?2, ?3, 'p. 152', 'On the Vine', 'A. Writer',
             'branch bears fruit only in the vine', 'Chapter 3 › The Vine', ?4, ?5,
             '2026-01-01', '2026-01-01')",
        params![
            f,
            source,
            format!("seg-{source}"),
            ANCHOR,
            format!("mark-{source}")
        ],
    )?;
    Ok((p, f))
}

/// What a citation says, without ids that change.
#[derive(Debug, PartialEq, Eq, Clone)]
struct Said {
    title: Option<String>,
    author: Option<String>,
    quote: Option<String>,
    locator: Option<String>,
    section: Option<String>,
    anchor: Option<String>,
    origin: Option<String>,
    hash: Option<String>,
}

fn said(conn: &Connection, project_id: &str) -> Vec<(Option<String>, Said)> {
    let mut stmt = conn
        .prepare(
            "SELECT c.source_id, c.cited_title, c.cited_author, c.quote, c.locator, c.cited_section,
                    c.anchor, c.cited_source_id, c.cited_content_hash
             FROM finding_sources c JOIN findings f ON f.id = c.finding_id
             JOIN studies s ON s.id = f.study_id
             WHERE s.project_id = ?1 AND c.deleted_at IS NULL ORDER BY c.rowid",
        )
        .unwrap();
    stmt.query_map([project_id], |r| {
        Ok((
            r.get(0)?,
            Said {
                title: r.get(1)?,
                author: r.get(2)?,
                quote: r.get(3)?,
                locator: r.get(4)?,
                section: r.get(5)?,
                anchor: r.get(6)?,
                origin: r.get(7)?,
                hash: r.get(8)?,
            },
        ))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn export(f: &Folder, project_id: &str, dir: &Path, name: &str) -> PathBuf {
    let path = dir.join(format!("{name}.awproject"));
    f.db.with_conn(|c| project::export(c, project_id, &f.dirs.teaching_images(), &path))
        .unwrap();
    path
}

fn import(f: &Folder, path: &Path) -> AppResult<project::ImportReport> {
    f.db.with_conn(|c| project::import(c, path, &f.dirs.teaching_images(), &f.dirs.cache()))
}

fn code<T: std::fmt::Debug>(result: AppResult<T>) -> String {
    match result {
        Err(AppError::Import(m)) => m.code.unwrap_or_default().to_string(),
        other => format!("{other:?}"),
    }
}

fn the_citation(f: &Folder, project_id: &str) -> abiding_word_lib::library::FindingCitation {
    f.db.with_conn(|c| {
        let finding: String = c.query_row(
            "SELECT f.id FROM findings f JOIN studies s ON s.id = f.study_id WHERE s.project_id = ?1",
            [project_id],
            |r| r.get(0),
        )?;
        Ok(findings::get(c, &finding)?.sources.remove(0))
    })
    .unwrap()
}

#[test]
fn a_citation_keeps_everything_where_its_source_is_missing_and_survives_every_move() {
    let out = tempfile::tempdir().unwrap();
    // Computer A has the book and cites it.
    let a = folder();
    let (pa, _) =
        a.db.with_conn(|c| {
            add_source(c, "lib-1", "On the Vine", HASH)?;
            make_project(c, "John", "lib-1")
        })
        .unwrap();
    let mut original = a.db.with_conn(|c| Ok(said(c, &pa))).unwrap();
    // Written like a citation from before v0.19.1 (no origin or hash
    // stored); the export fills both in from the source.
    assert_eq!(original[0].1.origin, None);
    original[0].1.origin = Some("lib-1".into());
    original[0].1.hash = Some(HASH.into());
    let to_b = export(&a, &pa, out.path(), "a");

    // Computer B does not have it: the preview names it, calmly.
    let b = folder();
    let preview = b.db.with_conn(|c| project::inspect(c, &to_b)).unwrap();
    assert_eq!(preview.missing.sources, vec!["On the Vine".to_string()]);
    let report = import(&b, &to_b).unwrap();
    assert_eq!((report.citations_kept, report.left_out), (1, 0));
    let kept = b.db.with_conn(|c| Ok(said(c, &report.project_id))).unwrap();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].0, None, "no source row is made up");
    assert_eq!(
        kept[0].1, original[0].1,
        "title, author, words, page, section, anchor, origin and hash kept"
    );
    let c = the_citation(&b, &report.project_id);
    assert!(c.unavailable && c.removed);
    assert_eq!(c.source_id, None);
    assert_eq!(c.title, "On the Vine");
    assert_eq!(c.author.as_deref(), Some("A. Writer"));
    assert_eq!(
        c.quote.as_deref(),
        Some("branch bears fruit only in the vine")
    );
    assert_eq!(c.section.as_deref(), Some("Chapter 3 › The Vine"));
    assert_eq!((c.segment_id, c.annotation_id), (None, None));
    // Nothing to open, and no error either.
    assert!(b
        .db
        .with_conn(|conn| findings::locate_source(conn, &c.id))
        .unwrap()
        .is_none());
    // No placeholder book appeared in B's library.
    assert_eq!(
        b.db.with_conn(|conn| Ok(
            conn.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get::<_, i64>(0))?
        ))
        .unwrap(),
        0
    );

    // B → C → D: still the same citation, still missing, still named.
    let to_c = export(&b, &report.project_id, out.path(), "b");
    let c_folder = folder();
    let preview = c_folder
        .db
        .with_conn(|c| project::inspect(c, &to_c))
        .unwrap();
    assert_eq!(preview.missing.sources, vec!["On the Vine".to_string()]);
    let rc = import(&c_folder, &to_c).unwrap();
    assert_eq!(rc.citations_kept, 1);
    let to_d = export(&c_folder, &rc.project_id, out.path(), "c");
    let d = folder();
    let rd = import(&d, &to_d).unwrap();
    let last = d.db.with_conn(|c| Ok(said(c, &rd.project_id))).unwrap();
    assert_eq!(last[0].0, None);
    assert_eq!(last[0].1, original[0].1);

    // Back on A, where the book is: it points at it again.
    let back = export(&d, &rd.project_id, out.path(), "d");
    let ra = import(&a, &back).unwrap();
    assert_eq!((ra.citations_kept, ra.citations_reconnected), (0, 0));
    let home = a.db.with_conn(|c| Ok(said(c, &ra.project_id))).unwrap();
    assert_eq!(home[0].0.as_deref(), Some("lib-1"));
    assert!(!the_citation(&a, &ra.project_id).unavailable);
}

#[test]
fn exactly_the_same_file_reconnects_a_citation_and_a_similar_title_never_does() {
    let out = tempfile::tempdir().unwrap();
    let a = folder();
    let (pa, _) =
        a.db.with_conn(|c| {
            add_source(c, "lib-1", "On the Vine", HASH)?;
            make_project(c, "John", "lib-1")
        })
        .unwrap();
    let path = export(&a, &pa, out.path(), "a");

    // The same title, another file: not the same book.
    let similar = folder();
    similar
        .db
        .with_conn(|c| add_source(c, "other", "On the Vine", &"a".repeat(64)))
        .unwrap();
    let r = import(&similar, &path).unwrap();
    assert_eq!((r.citations_kept, r.citations_reconnected), (1, 0));
    assert_eq!(
        similar
            .db
            .with_conn(|c| Ok(said(c, &r.project_id)))
            .unwrap()[0]
            .0,
        None
    );

    // The same file under another id (added to that library separately):
    // the citation points at it, without the other computer's paragraph or mark.
    let same = folder();
    same.db
        .with_conn(|c| add_source(c, "here-1", "On the Vine (my copy)", HASH))
        .unwrap();
    let preview = same.db.with_conn(|c| project::inspect(c, &path)).unwrap();
    assert!(preview.missing.sources.is_empty());
    let r = import(&same, &path).unwrap();
    assert_eq!((r.citations_kept, r.citations_reconnected), (0, 1));
    let c = the_citation(&same, &r.project_id);
    assert_eq!(c.source_id.as_deref(), Some("here-1"));
    assert!(!c.unavailable && !c.removed);
    assert_eq!((c.segment_id, c.annotation_id), (None, None));
    assert_eq!(
        c.quote.as_deref(),
        Some("branch bears fruit only in the vine")
    );

    // Two copies of that file here: which one was meant cannot be told.
    let two = folder();
    two.db
        .with_conn(|c| {
            add_source(c, "copy-1", "On the Vine", HASH)?;
            add_source(c, "copy-2", "On the Vine", HASH)
        })
        .unwrap();
    let r = import(&two, &path).unwrap();
    assert_eq!((r.citations_kept, r.citations_reconnected), (1, 0));

    // Adding exactly that file later reconnects the kept citation.
    let later = folder();
    let r = import(&later, &path).unwrap();
    later
        .db
        .with_conn(|c| {
            add_source(c, "added-later", "On the Vine", HASH)?;
            assert_eq!(
                library::reconnect_citations(c, "added-later", HASH, "2026-02-01")?,
                1
            );
            // A different file reconnects nothing.
            assert_eq!(
                library::reconnect_citations(c, "added-later", &"b".repeat(64), "2026-02-01")?,
                0
            );
            Ok(())
        })
        .unwrap();
    assert_eq!(
        the_citation(&later, &r.project_id).source_id.as_deref(),
        Some("added-later")
    );
}

#[test]
fn a_source_removed_from_the_library_keeps_its_citations_as_before() {
    let out = tempfile::tempdir().unwrap();
    let a = folder();
    let (pa, _) =
        a.db.with_conn(|c| {
            add_source(c, "lib-1", "On the Vine", HASH)?;
            let made = make_project(c, "John", "lib-1")?;
            c.execute(
                "UPDATE sources SET deleted_at = '2026-02-01' WHERE id = 'lib-1'",
                [],
            )?;
            Ok(made)
        })
        .unwrap();
    let here = the_citation(&a, &pa);
    assert!(here.removed && !here.unavailable);
    assert_eq!(here.title, "On the Vine");
    // Moved on the same computer, it still points at that (removed) source.
    let path = export(&a, &pa, out.path(), "a");
    let r = import(&a, &path).unwrap();
    let again = the_citation(&a, &r.project_id);
    assert_eq!(again.source_id.as_deref(), Some("lib-1"));
    assert!(again.removed && !again.unavailable);
    // Elsewhere it is kept without its source, with all it said.
    let b = folder();
    let r = import(&b, &path).unwrap();
    assert_eq!(r.citations_kept, 1);
    assert_eq!(the_citation(&b, &r.project_id).title, "On the Vine");
}

/// A package written by hand, correctly listed.
fn handmade(path: &Path, schema: i64, data: &serde_json::Value, sources: serde_json::Value) {
    let bytes = serde_json::to_vec(data).unwrap();
    let sha = {
        use sha2::Digest;
        sha2::Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let manifest = serde_json::json!({
        "format": "abiding-word-project", "formatVersion": 1, "schemaVersion": schema,
        "appVersion": "0.19.0", "createdAt": "2026-01-01", "title": "Handmade",
        "external": { "sources": sources },
        "files": [{ "path": "project.json", "size": bytes.len(), "sha256": sha }]
    });
    let mut out = zip::ZipWriter::new(fs::File::create(path).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    out.start_file("manifest.json", options).unwrap();
    out.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    out.start_file("project.json", options).unwrap();
    out.write_all(&bytes).unwrap();
    out.finish().unwrap();
}

fn base_tables(citations: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "tables": {
        "projects": [{ "id": "p", "workspace_id": "w", "title": "Handmade", "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1 }],
        "studies": [{ "id": "s", "project_id": "p", "title": "S", "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1, "study_type": "passage", "status": "active" }],
        "findings": [{ "id": "f", "study_id": "s", "kind": "quotation", "content": "Words.", "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1, "sort_order": 0 }],
        "finding_sources": citations
    }})
}

#[test]
fn a_v0_19_package_from_before_this_fix_keeps_partial_citations_and_refuses_corrupt_ones() {
    let out = tempfile::tempdir().unwrap();
    let there = folder();
    let row = |extra: serde_json::Value| {
        let mut r = serde_json::json!({ "id": "c", "finding_id": "f", "source_id": "gone",
            "source_segment_id": "seg-gone", "annotation_id": "mark-gone",
            "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1 });
        for (k, v) in extra.as_object().unwrap() {
            r[k] = v.clone();
        }
        r
    };
    let named = serde_json::json!([{ "id": "gone", "name": "Institutes" }]);

    // Schema 15 (v0.19 before this fix): no hash or origin columns; only a title.
    let p = out.path().join("partial.awproject");
    handmade(
        &p,
        15,
        &base_tables(serde_json::json!([row(
            serde_json::json!({ "cited_title": "Institutes", "locator": "I.1.1" })
        )])),
        named.clone(),
    );
    let r = import(&there, &p).unwrap();
    assert_eq!((r.citations_kept, r.left_out), (1, 0));
    let c = the_citation(&there, &r.project_id);
    assert_eq!(
        (c.title.as_str(), c.locator.as_deref(), c.author.as_deref()),
        ("Institutes", Some("I.1.1"), None)
    );
    assert!(c.unavailable);

    // No title in the row: the manifest's name for the source is used.
    let p = out.path().join("named.awproject");
    handmade(
        &p,
        15,
        &base_tables(serde_json::json!([row(serde_json::json!({}))])),
        named,
    );
    let r = import(&there, &p).unwrap();
    assert_eq!(the_citation(&there, &r.project_id).title, "Institutes");

    // Nothing says what was cited: left out, the rest imported.
    let p = out.path().join("nameless.awproject");
    handmade(
        &p,
        15,
        &base_tables(serde_json::json!([row(
            serde_json::json!({ "cited_title": "  " })
        )])),
        serde_json::json!([]),
    );
    let r = import(&there, &p).unwrap();
    assert_eq!((r.citations_kept, r.left_out, r.counts.notes), (0, 1, 1));

    // A citation whose values are not text: the package is refused, nothing changes.
    let projects_before: i64 = there
        .db
        .with_conn(|c| Ok(c.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?))
        .unwrap();
    for (name, bad) in [
        ("number", serde_json::json!({ "cited_title": 42 })),
        ("object", serde_json::json!({ "quote": { "x": 1 } })),
        ("list", serde_json::json!({ "cited_source_id": ["a"] })),
    ] {
        let p = out.path().join(format!("{name}.awproject"));
        handmade(
            &p,
            15,
            &base_tables(serde_json::json!([row(bad)])),
            serde_json::json!([]),
        );
        assert_eq!(code(import(&there, &p)), "portability.notPackage", "{name}");
    }
    let projects_after: i64 = there
        .db
        .with_conn(|c| Ok(c.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(projects_before, projects_after);
    // An unreadable anchor is dropped, never trusted; the citation stays.
    let p = out.path().join("anchor.awproject");
    handmade(
        &p,
        15,
        &base_tables(serde_json::json!([row(
            serde_json::json!({ "cited_title": "Institutes", "anchor": "{oops" })
        )])),
        serde_json::json!([]),
    );
    let r = import(&there, &p).unwrap();
    assert_eq!(r.citations_kept, 1);
}

#[test]
fn imported_twice_each_project_keeps_its_own_citation() {
    let out = tempfile::tempdir().unwrap();
    let a = folder();
    let (pa, _) =
        a.db.with_conn(|c| {
            add_source(c, "lib-1", "On the Vine", HASH)?;
            make_project(c, "John", "lib-1")
        })
        .unwrap();
    let path = export(&a, &pa, out.path(), "a");
    let b = folder();
    let first = import(&b, &path).unwrap();
    let second = import(&b, &path).unwrap();
    assert_ne!(first.project_id, second.project_id);
    b.db.with_conn(|c| {
        assert_eq!(said(c, &first.project_id).len(), 1);
        assert_eq!(said(c, &second.project_id).len(), 1);
        let ids: i64 = c.query_row("SELECT COUNT(DISTINCT id) FROM finding_sources", [], |r| {
            r.get(0)
        })?;
        assert_eq!(ids, 2);
        // Removing one project's citation leaves the other's.
        let one: String = c.query_row(
            "SELECT c.id FROM finding_sources c JOIN findings f ON f.id = c.finding_id
             JOIN studies s ON s.id = f.study_id WHERE s.project_id = ?1",
            [&first.project_id],
            |r| r.get(0),
        )?;
        findings::remove_source(c, &one)?;
        assert_eq!(said(c, &first.project_id).len(), 0);
        assert_eq!(said(c, &second.project_id).len(), 1);
        Ok(())
    })
    .unwrap();
}

#[test]
fn the_database_will_not_hold_a_citation_that_names_nothing() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|c| {
        let (_, f) = {
            add_source(c, "lib-1", "On the Vine", HASH)?;
            make_project(c, "John", "lib-1")?
        };
        let refused = c.execute(
            "INSERT INTO finding_sources (id, finding_id, source_id, created_at, updated_at)
             VALUES ('x', ?1, NULL, '2026-01-01', '2026-01-01')",
            [&f],
        );
        assert!(refused.is_err());
        c.execute(
            "INSERT INTO finding_sources (id, finding_id, source_id, cited_title, created_at, updated_at)
             VALUES ('y', ?1, NULL, 'A title', '2026-01-01', '2026-01-01')",
            [&f],
        )?;
        Ok(())
    })
    .unwrap();
}

/// id, source_id, cited_title, locator, cited_source_id, cited_content_hash
type StoredRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

#[test]
fn a_database_from_before_keeps_every_citation_through_the_upgrade() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    const T: &str = "2026-01-01T00:00:00.000Z";
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::run_with(&mut conn, &MIGRATIONS[..15]).unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('w', 'My Workspace', 1, '{T}', '{T}');
             INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('p', 'w', 'John', '{T}', '{T}');
             INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('s', 'p', 'Abiding', 'passage', '{T}', '{T}');
             INSERT INTO findings (id, study_id, kind, content, created_at, updated_at) VALUES ('f', 's', 'quotation', 'Words.', '{T}', '{T}');
             INSERT INTO sources (id, workspace_id, source_type, title, content_hash, created_at, updated_at) VALUES ('lib', 'w', 'book', 'On the Vine', '{HASH}', '{T}', '{T}');
             INSERT INTO sources (id, workspace_id, source_type, title, created_at, updated_at, deleted_at) VALUES ('old', 'w', 'book', 'Removed one', '{T}', '{T}', '{T}');
             INSERT INTO finding_sources (id, finding_id, source_id, locator, cited_title, quote, created_at, updated_at) VALUES ('c1', 'f', 'lib', 'p. 3', 'On the Vine', 'the vine', '{T}', '{T}');
             INSERT INTO finding_sources (id, finding_id, source_id, created_at, updated_at) VALUES ('c2', 'f', 'old', '{T}', '{T}');
             INSERT INTO finding_sources (id, finding_id, source_id, cited_title, created_at, updated_at, deleted_at) VALUES ('c3', 'f', 'lib', 'Gone', '{T}', '{T}', '{T}');"
        ))
        .unwrap();
    }
    let db = Database::open(&path, &backups).unwrap();
    assert_eq!(
        fs::read_dir(&backups).unwrap().count(),
        1,
        "backed up first"
    );
    db.with_conn(|c| {
        let rows: Vec<StoredRow> = c
            .prepare("SELECT id, source_id, cited_title, locator, cited_source_id, cited_content_hash FROM finding_sources ORDER BY id")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<Result<_, _>>()?;
        assert_eq!(
            rows,
            vec![
                ("c1".into(), Some("lib".into()), Some("On the Vine".into()), Some("p. 3".into()), Some("lib".into()), Some(HASH.into())),
                ("c2".into(), Some("old".into()), None, None, Some("old".into()), None),
                ("c3".into(), Some("lib".into()), Some("Gone".into()), None, Some("lib".into()), Some(HASH.into())),
            ]
        );
        let f = findings::get(c, "f")?;
        assert_eq!(f.sources.len(), 2);
        assert!(!f.sources[0].removed && !f.sources[0].unavailable);
        assert!(f.sources[1].removed && !f.sources[1].unavailable);
        assert_eq!(f.sources[1].title, "Removed one");
        let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        assert_eq!(ok, "ok");
        let broken: i64 = c.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0))?;
        assert_eq!(broken, 0);
        Ok(())
    })
    .unwrap();
}

#[test]
fn adding_exactly_the_cited_file_to_the_library_reconnects_kept_citations() {
    use abiding_word_lib::library::import;
    use abiding_word_lib::library::{AddFindingSource, CommitSourceImport, SearchLibrary};
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("vine-notes.md");
    fs::write(
        &file,
        b"# Notes on the Vine\n\nThe branch bears fruit only in the vine.\n",
    )
    .unwrap();
    let add = |conn: &Connection| -> AppResult<String> {
        let staged = import::stage(&file)?;
        let id = abiding_word_lib::db::new_id();
        let relative = library::managed_relative_path(&id, &staged);
        library::commit_import(
            conn,
            &id,
            &staged,
            &CommitSourceImport {
                preview_id: staged.id.clone(),
                title: "Notes on the Vine".into(),
                ..Default::default()
            },
            &relative,
        )?;
        Ok(id)
    };

    // A: the file is in the library and a note cites a paragraph of it.
    let a = folder();
    let (pa, finding) =
        a.db.with_conn(|c| {
            let source = add(c)?;
            add_source(c, "unused", "Unused", &"c".repeat(64))?;
            let (p, f) = make_project(c, "John", "unused")?;
            let hit = library::search(
                c,
                &SearchLibrary {
                    query: "branch".into(),
                    offset: None,
                },
            )?
            .hits
            .into_iter()
            .find(|h| h.source_id == source)
            .unwrap();
            findings::add_source(
                c,
                &AddFindingSource {
                    finding_id: f.clone(),
                    segment_id: Some(hit.segment_id),
                    ..Default::default()
                },
            )?;
            Ok((p, f))
        })
        .unwrap();
    assert_eq!(
        a.db.with_conn(|c| Ok(findings::get(c, &finding)?.sources.len()))
            .unwrap(),
        2
    );
    let path = export(&a, &pa, out.path(), "a");

    // B: imported without it; both citations kept.
    let b = folder();
    let r = import(&b, &path).unwrap();
    assert_eq!(r.citations_kept, 2);
    // B adds that same file: the citation of it (and only that one) is back.
    b.db.with_conn(|c| add(c).map(|_| ())).unwrap();
    let cites: Vec<_> = b
        .db
        .with_conn(|c| {
            let f: String = c.query_row(
                "SELECT f.id FROM findings f JOIN studies s ON s.id = f.study_id WHERE s.project_id = ?1",
                [&r.project_id],
                |row| row.get(0),
            )?;
            Ok(findings::get(c, &f)?.sources)
        })
        .unwrap();
    let back: Vec<_> = cites.iter().filter(|c| !c.unavailable).collect();
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].title, "Notes on the Vine");
    let place =
        b.db.with_conn(|c| findings::locate_source(c, &back[0].id))
            .unwrap()
            .expect("it can be opened again");
    assert_eq!(Some(place.source_id.clone()), back[0].source_id);
    assert!(cites
        .iter()
        .any(|c| c.unavailable && c.title == "On the Vine"));
}
