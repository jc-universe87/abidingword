//! Upgrading a Library v0.4–v0.8 database (schema v4) to passage-aware sources
//! (v5): backup first, nothing lost, and the derived links rebuilt from the
//! stored structure without re-importing anything. The v4 database is written
//! with plain SQL against the v4 schema; all text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::{findings, library, Database};
use abiding_word_lib::library::sections;
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::{Connection, OpenFlags};

const T: &str = "2026-09-30T10:00:00.000Z";
const W: &str = "00000000-0000-4000-8000-00000000000a";
const P: &str = "00000000-0000-4000-8000-00000000000b";
const ST: &str = "00000000-0000-4000-8000-00000000000c";
const F: &str = "00000000-0000-4000-8000-000000000400";
const MD: &str = "00000000-0000-4000-8000-000000000501";
const PDF: &str = "00000000-0000-4000-8000-000000000502";

fn segment_sql(id: &str, source: &str, position: i64, content: &str, path: Option<&str>) -> String {
    let path = path.map_or("NULL".to_string(), |p| format!("'{p}'"));
    format!(
        "INSERT INTO source_segments (id, source_id, position, content, section_path, locator, created_at, updated_at)
         VALUES ('{id}', '{source}', {position}, '{content}', {path}, 'loc {position}', '{T}', '{T}');"
    )
}

fn library_v4(path: &Path) {
    let mut conn = Connection::open(path).unwrap();
    migrations::run_with(&mut conn, &MIGRATIONS[..4]).unwrap();
    let mut sql = format!(
        "INSERT INTO workspaces (id, name, is_default, created_at, updated_at) VALUES ('{W}', 'My Workspace', 1, '{T}', '{T}');
         INSERT INTO projects (id, workspace_id, title, created_at, updated_at) VALUES ('{P}', '{W}', 'John', '{T}', '{T}');
         INSERT INTO studies (id, project_id, title, study_type, created_at, updated_at) VALUES ('{ST}', '{P}', 'John 15', 'passage', '{T}', '{T}');
         INSERT INTO findings (id, study_id, kind, content, sort_order, created_at, updated_at) VALUES ('{F}', '{ST}', 'observation', 'Abide.', 0, '{T}', '{T}');
         INSERT INTO sources (id, workspace_id, source_type, title, author, content_hash, created_at, updated_at)
             VALUES ('{MD}', '{W}', 'book', 'Invented Commentary', 'Pat Example', 'hash-md', '{T}', '{T}');
         INSERT INTO source_files (id, source_id, relative_path, format, is_primary, extraction_status, created_at, updated_at)
             VALUES ('file-md', '{MD}', 'books/md/commentary.md', 'markdown', 1, 'digital_text', '{T}', '{T}');
         INSERT INTO sources (id, workspace_id, source_type, title, author, content_hash, created_at, updated_at)
             VALUES ('{PDF}', '{W}', 'book', 'Invented PDF', NULL, 'hash-pdf', '{T}', '{T}');
         INSERT INTO source_files (id, source_id, relative_path, format, is_primary, extraction_status, created_at, updated_at)
             VALUES ('file-pdf', '{PDF}', 'books/pdf/x.pdf', 'pdf', 1, 'extracted_text', '{T}', '{T}');"
    );
    let heading = "Invented › John 15:1–11 — The True Vine";
    sql += &segment_sql(
        "seg-a",
        MD,
        0,
        "Opening paragraph about the vine.",
        Some(heading),
    );
    sql += &segment_sql(
        "seg-b",
        MD,
        1,
        "Second paragraph. See Romans 8:1.",
        Some(heading),
    );
    sql += &segment_sql(
        "seg-c",
        MD,
        2,
        "Love paragraph.",
        Some("Invented › John 15:12–17 — Love"),
    );
    sql += &segment_sql("seg-d", MD, 3, "Closing words.", Some("Invented › Closing"));
    sql += &segment_sql("seg-p", PDF, 0, "John 15:1–11 on a page.", None);
    sql += &format!(
        "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key, matched_text, start_offset, end_offset, created_at)
             VALUES ('pass-1', '{MD}', 'seg-b', 'ROM.8.1', 45008001, 45008001, 'Romans 8:1', 22, 32, '{T}');
         INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key, matched_text, start_offset, end_offset, created_at)
             VALUES ('pass-2', '{PDF}', 'seg-p', 'JHN.15.1-JHN.15.11', 43015001, 43015011, 'John 15:1–11', 0, 12, '{T}');
         INSERT INTO finding_sources (id, finding_id, source_id, source_segment_id, locator, created_at, updated_at)
             VALUES ('cite-1', '{F}', '{MD}', 'seg-c', 'loc 2', '{T}', '{T}');"
    );
    conn.execute_batch(&sql).unwrap();
}

fn reference(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

#[test]
fn an_existing_library_is_backed_up_then_gains_its_section_links_without_reimporting() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    library_v4(&path);

    let db = Database::open(&path, &backups).unwrap();

    // 1. backed up first, at the old version
    let files: Vec<_> = fs::read_dir(&backups)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    assert!(files[0]
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("abiding-word-v4-"));
    let copy = Connection::open_with_flags(&files[0], OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(migrations::current_version(&copy).unwrap(), 4);
    let in_backup: i64 = copy
        .query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(in_backup, 2, "the backup is the library as it was");

    db.with_conn(|conn| {
        assert_eq!(
            migrations::current_version(conn)?,
            MIGRATIONS.last().unwrap().version
        );

        // 2. sources, segments, the literal links and the citation are exactly as they were
        let segments: i64 =
            conn.query_row("SELECT COUNT(*) FROM source_segments", [], |r| r.get(0))?;
        assert_eq!(segments, 5);
        // (the index is rebuilt in full, so the row is a new one with the same content)
        let (origin, offset, matched): (String, i64, String) = conn.query_row(
            "SELECT origin, start_offset, matched_text FROM source_passages
             WHERE segment_id = 'seg-b' AND origin = 'explicit'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        assert_eq!(
            (origin.as_str(), offset, matched.as_str()),
            ("explicit", 22, "Romans 8:1")
        );
        let cited = findings::get(conn, F)?;
        assert_eq!(cited.sources.len(), 1);
        assert_eq!(cited.sources[0].segment_id.as_deref(), Some("seg-c"));

        // 3. derived links exist for the structured source, from its stored paths
        let derived: Vec<(String, String, String)> = conn
            .prepare(
                "SELECT segment_id, origin, passage FROM source_passages
                 WHERE origin <> 'explicit' ORDER BY segment_id",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        assert_eq!(
            derived,
            [
                (
                    "seg-a".into(),
                    "section".into(),
                    "JHN.15.1-JHN.15.11".into()
                ),
                (
                    "seg-b".into(),
                    "inherited".into(),
                    "JHN.15.1-JHN.15.11".into()
                ),
                (
                    "seg-c".into(),
                    "section".into(),
                    "JHN.15.12-JHN.15.17".into()
                ),
            ]
        );
        // none for the PDF, which has no structure to read
        let pdf_derived: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages WHERE source_id = ?1 AND origin <> 'explicit'",
            [PDF],
            |r| r.get(0),
        )?;
        assert_eq!(pdf_derived, 0);

        // 4. every source is marked as indexed, and the pane finds the commentary section
        let stale: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sources WHERE passage_index_version < ?1",
            [sections::INDEX_VERSION],
            |r| r.get(0),
        )?;
        assert_eq!(stale, 0);
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        let titles: Vec<_> = found.iter().map(|g| g.source_title.as_str()).collect();
        // equal fit: the section heading outranks the passing mention
        assert_eq!(titles, ["Invented Commentary", "Invented PDF"]);
        // the sources' own passage counts keep their meaning (literal mentions)
        assert_eq!(library::get(conn, MD)?.passage_count, 1);
        Ok(())
    })
    .unwrap();
    drop(db);

    // 5. opening again: no new backup, nothing rebuilt, nothing changes
    let again = Database::open(&path, &backups).unwrap();
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1);
    again
        .with_conn(|conn| {
            assert_eq!(library::ensure_passage_index(conn)?.rebuilt, 0);
            let rows: i64 =
                conn.query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))?;
            assert_eq!(rows, 5);
            Ok(())
        })
        .unwrap();
}
