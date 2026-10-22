//! Moving work between computers (v0.19): a project as a package, and
//! everything as a backup. Every destructive step runs on temporary data
//! folders; nothing here touches a real one. All text is invented.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::{
    findings, migrations, projects, relations, studies, study_passages, teaching, workspaces,
    Database,
};
use abiding_word_lib::domain::{
    AddTeachingPassage, CreateFinding, CreateProject, CreateStudy, CreateStudyRelation,
    CreateTeaching, CreateTeachingPoint, FindingType, ImageInfo, KeepTeachingMaterial,
    LinkTeachingFinding, RelationType,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::filesystem::DataDirs;
use abiding_word_lib::portability::{backup, project};
use abiding_word_lib::scripture::AddStudyPassage;
use rusqlite::{params, Connection};

/// A data folder with its database, as the app has it.
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

const IMAGE: &str = "0123456789abcdef0123456789abcdef.png";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n not really an image, only bytes to carry";

struct Made {
    project: String,
}

/// A project with two studies, notes (one under another), passages, a
/// relation, a teaching with steps, links, passages, a kept generated image
/// and a presentation, and a note citing a library source.
fn make_project(conn: &Connection, images: &Path, title: &str) -> AppResult<Made> {
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id.clone(),
            title: title.into(),
            description: Some("Sermons on the Upper Room.".into()),
        },
    )?
    .id;
    let study = |t: &str| -> AppResult<String> {
        Ok(studies::create(
            conn,
            &CreateStudy {
                project_id: project.clone(),
                title: t.into(),
                ..Default::default()
            },
        )?
        .study
        .id)
    };
    let abide = study("Abiding")?;
    let love = study("Love one another")?;
    study_passages::add(
        conn,
        &AddStudyPassage {
            study_id: abide.clone(),
            reference: "JHN.15.1-JHN.15.11".into(),
            role: None,
        },
    )?;
    relations::create(
        conn,
        &CreateStudyRelation {
            from_study_id: love.clone(),
            to_study_id: abide.clone(),
            relation_type: RelationType::Continues,
            note: None,
        },
    )?;
    let note = |text: &str, passage: Option<&str>| -> AppResult<String> {
        Ok(findings::create(
            conn,
            &CreateFinding {
                study_id: abide.clone(),
                finding_type: FindingType::Observation,
                content: Some(text.into()),
                section_id: None,
                passage: passage.map(String::from),
            },
        )?
        .id)
    };
    let vine = note("The vine bears the branches.", Some("JHN.15.5"))?;
    let child = note("Fruit is the vine's, not the branch's.", None)?;
    conn.execute(
        "UPDATE findings SET parent_id = ?1 WHERE id = ?2",
        params![vine, child],
    )?;
    conn.execute(
        "INSERT INTO finding_tags (finding_id, tag, created_at) VALUES (?1, 'fruit', '2026-01-01')",
        [&vine],
    )?;
    // A library source the note cites.
    conn.execute(
        "INSERT INTO sources (id, workspace_id, source_type, title, created_at, updated_at)
         VALUES ('lib-1', ?1, 'book', 'Commentary on John', '2026-01-01', '2026-01-01')",
        [&workspace.id],
    )?;
    conn.execute(
        "INSERT INTO finding_sources (id, finding_id, source_id, locator, created_at, updated_at, cited_title)
         VALUES ('fs-1', ?1, 'lib-1', 'p. 12', '2026-01-01', '2026-01-01', 'Commentary on John')",
        [&vine],
    )?;

    let prep = teaching::create(
        conn,
        &CreateTeaching {
            study_id: abide.clone(),
            title: "Abide in me".into(),
            kind: Some("sermon".into()),
            points: Vec::new(),
        },
    )?
    .id;
    let point = teaching::create_point(
        conn,
        &CreateTeachingPoint {
            preparation_id: prep.clone(),
            title: Some("The true vine".into()),
            after_point_id: None,
            kind: None,
        },
    )?
    .points[0]
        .id
        .clone();
    teaching::link_finding(
        conn,
        &LinkTeachingFinding {
            preparation_id: prep.clone(),
            point_id: Some(point.clone()),
            finding_id: vine.clone(),
        },
    )?;
    teaching::add_passage(
        conn,
        &AddTeachingPassage {
            preparation_id: prep.clone(),
            point_id: Some(point.clone()),
            reference: "JHN.15.1-JHN.15.8".into(),
        },
    )?;
    fs::create_dir_all(images).unwrap();
    fs::write(images.join(IMAGE), PNG).unwrap();
    teaching::keep_material(
        conn,
        &KeepTeachingMaterial {
            preparation_id: prep.clone(),
            point_id: Some(point.clone()),
            kind: "image".into(),
            standing: "generated".into(),
            title: "A vine".into(),
            content: "Generated: a vine with branches.".into(),
            sources: Vec::new(),
            image: Some(ImageInfo {
                file: Some(IMAGE.into()),
                ..Default::default()
            }),
            assistant: Some("Example · model".into()),
        },
    )?;
    // A presentation with a slide made from the step.
    conn.execute(
        "INSERT INTO presentations (id, preparation_id, title, theme, position, created_at, updated_at)
         VALUES ('pres-1', ?1, 'Abide in me', 'light', 0, '2026-01-01', '2026-01-01')",
        [&prep],
    )?;
    conn.execute(
        "INSERT INTO presentation_items (id, presentation_id, position, kind, source_kind, source_id, heading, created_at, updated_at)
         VALUES ('item-1', 'pres-1', 0, 'point', 'point', ?1, 'The true vine', '2026-01-01', '2026-01-01')",
        [&point],
    )?;
    Ok(Made { project })
}

fn scalar(conn: &Connection, sql: &str, p: &str) -> i64 {
    conn.query_row(sql, [p], |r| r.get(0)).unwrap()
}

/// What a project is, without ids: the same for an original and its import.
fn shape(conn: &Connection, project: &str) -> Vec<String> {
    let mut out = Vec::new();
    let q = |sql: &str| -> Vec<String> {
        let mut stmt = conn.prepare(sql).unwrap();
        let mut v: Vec<String> = stmt
            .query_map([project], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        v.sort();
        v
    };
    const S: &str = "(SELECT id FROM studies WHERE project_id = ?1)";
    out.extend(q(&format!(
        "SELECT 'study ' || title FROM studies WHERE id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'part ' || s.title || '/' || sec.title FROM study_sections sec JOIN studies s ON s.id = sec.study_id WHERE s.id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'note ' || f.content || ' under ' || COALESCE(p.content, '-') FROM findings f LEFT JOIN findings p ON p.id = f.parent_id WHERE f.study_id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'tag ' || t.tag FROM finding_tags t JOIN findings f ON f.id = t.finding_id WHERE f.study_id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'passage ' || label FROM passage_references WHERE study_id IN {S} OR finding_id IN (SELECT id FROM findings WHERE study_id IN {S})"
    )));
    out.extend(q(&format!(
        "SELECT 'relation ' || a.title || ' -> ' || b.title FROM study_relations r JOIN studies a ON a.id = r.from_study_id JOIN studies b ON b.id = r.to_study_id WHERE a.id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'step ' || p.title || '/' || COALESCE(pt.title, '') FROM teaching_points pt JOIN teaching_preparations p ON p.id = pt.preparation_id WHERE p.study_id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'link ' || pt.title || ' -> ' || f.content FROM teaching_finding_links l JOIN teaching_points pt ON pt.id = l.point_id JOIN findings f ON f.id = l.finding_id WHERE f.study_id IN {S}"
    )));
    out.extend(q(&format!(
        "SELECT 'teaching passage ' || pt.title || ' ' || tp.book || tp.start_chapter FROM teaching_passages tp JOIN teaching_points pt ON pt.id = tp.point_id WHERE pt.preparation_id IN (SELECT id FROM teaching_preparations WHERE study_id IN {S})"
    )));
    out.extend(q(&format!(
        "SELECT 'material ' || m.title || ' at ' || pt.title FROM teaching_materials m JOIN teaching_points pt ON pt.id = m.point_id WHERE m.preparation_id IN (SELECT id FROM teaching_preparations WHERE study_id IN {S})"
    )));
    out.extend(q(&format!(
        "SELECT 'slide ' || i.heading || ' from ' || COALESCE(pt.title, 'nothing') FROM presentation_items i LEFT JOIN teaching_points pt ON pt.id = i.source_id
         WHERE i.presentation_id IN (SELECT id FROM presentations WHERE preparation_id IN (SELECT id FROM teaching_preparations WHERE study_id IN {S}))"
    )));
    out
}

fn export(f: &Folder, project: &str, dir: &Path) -> PathBuf {
    let path = dir.join("john.awproject");
    f.db.with_conn(|conn| project::export(conn, project, &f.dirs.teaching_images(), &path))
        .unwrap();
    path
}

fn import(f: &Folder, path: &Path) -> AppResult<project::ImportReport> {
    f.db.with_conn(|conn| project::import(conn, path, &f.dirs.teaching_images(), &f.dirs.cache()))
}

fn code<T: std::fmt::Debug>(result: AppResult<T>) -> String {
    match result {
        Err(AppError::Import(m)) | Err(AppError::InvalidInput(m)) => {
            m.code.unwrap_or_default().to_string()
        }
        other => format!("{other:?}"),
    }
}

#[test]
fn a_project_moves_to_another_computer_whole_with_new_ids() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let made = here
        .db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John"))
        .unwrap();
    let before = here.db.with_conn(|c| Ok(shape(c, &made.project))).unwrap();
    let path = export(&here, &made.project, out.path());

    let there = folder();
    let preview = there.db.with_conn(|c| project::inspect(c, &path)).unwrap();
    assert_eq!(preview.title, "John");
    assert_eq!(preview.import_title, "John");
    assert_eq!(preview.counts.studies, 2);
    assert_eq!(preview.counts.teachings, 1);
    assert_eq!(preview.counts.images, 1);
    // What the other computer does not have is said before importing.
    assert_eq!(
        preview.missing.sources,
        vec!["Commentary on John".to_string()]
    );

    let report = import(&there, &path).unwrap();
    assert_eq!(report.title, "John");
    assert_eq!(report.counts.studies, 2);
    assert_eq!(report.counts.notes, 2);
    assert_eq!(
        report.missing.sources,
        vec!["Commentary on John".to_string()]
    );
    // The citation of the missing source is the one row left out.
    assert_eq!(report.left_out, 1);
    let after = there
        .db
        .with_conn(|c| Ok(shape(c, &report.project_id)))
        .unwrap();
    assert_eq!(after, before);
    assert!(before.iter().any(|l| l.contains("under The vine bears")));
    assert!(before
        .iter()
        .any(|l| l == "slide The true vine from The true vine"));

    // The kept image came along under a new name the app chose.
    let file: String = there
        .db
        .with_conn(|c| {
            Ok(c.query_row(
                "SELECT json_extract(image, '$.file') FROM teaching_materials",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_ne!(file, IMAGE);
    assert_eq!(
        fs::read(there.dirs.teaching_images().join(&file)).unwrap(),
        PNG
    );
    // Nothing is left in the cache.
    assert_eq!(fs::read_dir(there.dirs.cache()).unwrap().count(), 0);
}

#[test]
fn importing_never_overwrites_a_project_and_never_reuses_ids() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let made = here
        .db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John"))
        .unwrap();
    let before = here.db.with_conn(|c| Ok(shape(c, &made.project))).unwrap();
    let path = export(&here, &made.project, out.path());

    // Into the same computer, twice: two new projects, the original untouched.
    let first = import(&here, &path).unwrap();
    let second = import(&here, &path).unwrap();
    assert_eq!(first.title, "John (2)");
    assert_eq!(second.title, "John (3)");
    assert_ne!(first.project_id, made.project);
    here.db
        .with_conn(|c| {
            assert_eq!(shape(c, &made.project), before);
            assert_eq!(shape(c, &first.project_id), before);
            // Here the library source exists, so the citation came along.
            assert_eq!(
                scalar(
                    c,
                    "SELECT COUNT(*) FROM finding_sources WHERE finding_id IN
                     (SELECT id FROM findings WHERE study_id IN (SELECT id FROM studies WHERE project_id = ?1))",
                    &first.project_id
                ),
                1
            );
            let studies: i64 = c.query_row("SELECT COUNT(DISTINCT id) FROM studies", [], |r| r.get(0))?;
            assert_eq!(studies, 6);
            Ok(())
        })
        .unwrap();
    assert!(first.missing.is_empty());
}

#[test]
fn a_deleted_part_of_a_project_stays_behind() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let made = here
        .db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John"))
        .unwrap();
    here.db
        .with_conn(|c| {
            c.execute(
                "UPDATE studies SET deleted_at = '2026-02-01' WHERE title = 'Love one another'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let path = export(&here, &made.project, out.path());
    let there = folder();
    let report = import(&there, &path).unwrap();
    assert_eq!(report.counts.studies, 1);
    // The relation to the deleted study is not carried.
    there
        .db
        .with_conn(|c| {
            assert_eq!(
                scalar(c, "SELECT COUNT(*) FROM study_relations WHERE ?1 = ?1", "x"),
                0
            );
            Ok(())
        })
        .unwrap();
}

// ---------------------------------------------------------------------------
// Packages that must be refused, with nothing changed.

fn rows_everywhere(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT (SELECT COUNT(*) FROM projects) + (SELECT COUNT(*) FROM studies) + (SELECT COUNT(*) FROM findings)",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

/// Rewrites a package: `change` gets each entry and may alter or drop it,
/// then `extra` entries are added.
fn rewrite(
    path: &Path,
    target: &Path,
    change: impl Fn(&str, Vec<u8>) -> Option<Vec<u8>>,
    extra: &[(&str, &[u8])],
) {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    let mut out = zip::ZipWriter::new(fs::File::create(target).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).unwrap();
        if let Some(bytes) = change(&name, bytes) {
            out.start_file(name, options).unwrap();
            out.write_all(&bytes).unwrap();
        }
    }
    for (name, bytes) in extra {
        out.start_file(*name, options).unwrap();
        out.write_all(bytes).unwrap();
    }
    out.finish().unwrap();
}

fn manifest_edit(bytes: Vec<u8>, edit: impl Fn(&mut serde_json::Value)) -> Vec<u8> {
    let mut m: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    edit(&mut m);
    serde_json::to_vec(&m).unwrap()
}

#[test]
fn damaged_or_crafted_project_packages_are_refused_and_change_nothing() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let made = here
        .db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John"))
        .unwrap();
    let good = export(&here, &made.project, out.path());
    let there = folder();
    let before = there.db.with_conn(|c| Ok(rows_everywhere(c))).unwrap();
    let images_before = fs::read_dir(there.dirs.teaching_images()).map_or(0, |d| d.count());
    let case = |name: &str| out.path().join(format!("{name}.awproject"));

    // Not a zip at all.
    fs::write(case("text"), b"just text").unwrap();
    // A changed byte in the project data.
    rewrite(
        &good,
        &case("tampered"),
        |name, mut b| {
            if name == "project.json" {
                let i = b.len() / 2;
                b[i] = if b[i] == b'a' { b'b' } else { b'a' };
            }
            Some(b)
        },
        &[],
    );
    // An entry the manifest does not list.
    rewrite(
        &good,
        &case("extra"),
        |_, b| Some(b),
        &[("files/teaching-images/ffff.png", b"x")],
    );
    // A listed entry missing.
    rewrite(
        &good,
        &case("missing"),
        |name, b| (!name.starts_with("files/")).then_some(b),
        &[],
    );
    // Path traversal and absolute paths, listed in the manifest too.
    for (label, evil) in [
        ("dots", "../../outside.txt"),
        ("absolute", "/tmp/outside.txt"),
        ("windows", "C:\\Windows\\x.png"),
    ] {
        rewrite(
            &good,
            &case(label),
            |name, b| {
                if name == "manifest.json" {
                    Some(manifest_edit(b, |m| {
                        m["files"].as_array_mut().unwrap().push(serde_json::json!({
                            "path": evil, "size": 1, "sha256": "0".repeat(64)
                        }));
                    }))
                } else {
                    Some(b)
                }
            },
            &[(evil, b"x")],
        );
    }
    // A size the manifest claims beyond what is read.
    rewrite(
        &good,
        &case("oversize"),
        |name, b| {
            if name == "manifest.json" {
                Some(manifest_edit(b, |m| {
                    for f in m["files"].as_array_mut().unwrap() {
                        f["size"] = serde_json::json!(u64::MAX / 2);
                    }
                }))
            } else {
                Some(b)
            }
        },
        &[],
    );
    // From a newer version of the app.
    rewrite(
        &good,
        &case("newer"),
        |name, b| {
            if name == "manifest.json" {
                Some(manifest_edit(b, |m| {
                    m["schemaVersion"] = serde_json::json!(9999)
                }))
            } else {
                Some(b)
            }
        },
        &[],
    );
    // Another kind of file.
    rewrite(
        &good,
        &case("format"),
        |name, b| {
            if name == "manifest.json" {
                Some(manifest_edit(b, |m| {
                    m["format"] = serde_json::json!("something-else")
                }))
            } else {
                Some(b)
            }
        },
        &[],
    );

    for (name, expected) in [
        ("text", "portability.notPackage"),
        ("tampered", "portability.damaged"),
        ("extra", "portability.notPackage"),
        ("missing", "portability.notPackage"),
        ("dots", "portability.notPackage"),
        ("absolute", "portability.notPackage"),
        ("windows", "portability.notPackage"),
        ("oversize", "portability.tooLarge"),
        ("newer", "portability.newer"),
        ("format", "portability.notPackage"),
    ] {
        assert_eq!(code(import(&there, &case(name))), expected, "{name}");
        assert_eq!(
            code(there.db.with_conn(|c| project::inspect(c, &case(name)))),
            expected,
            "{name} (inspect)"
        );
    }
    assert_eq!(
        there.db.with_conn(|c| Ok(rows_everywhere(c))).unwrap(),
        before
    );
    assert_eq!(
        fs::read_dir(there.dirs.teaching_images()).map_or(0, |d| d.count()),
        images_before
    );
    assert!(!out.path().join("outside.txt").exists());
    assert_eq!(fs::read_dir(there.dirs.cache()).unwrap().count(), 0);
}

/// Builds a package by hand with the given project data, correctly listed.
fn handmade(path: &Path, data: &serde_json::Value) {
    let bytes = serde_json::to_vec(data).unwrap();
    let sha = {
        use sha2::Digest;
        sha2::Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let manifest = serde_json::json!({
        "format": "abiding-word-project", "formatVersion": 1, "schemaVersion": 1,
        "appVersion": "0.0.0", "createdAt": "2026-01-01", "title": "Handmade",
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

#[test]
fn project_data_is_data_only_and_malformed_references_roll_everything_back() {
    let out = tempfile::tempdir().unwrap();
    let there = folder();
    let before = there.db.with_conn(|c| Ok(rows_everywhere(c))).unwrap();
    let project = serde_json::json!({ "id": "p", "workspace_id": "w", "title": "Handmade",
        "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1 });
    let study = serde_json::json!({ "id": "s", "project_id": "p", "title": "S",
        "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1, "study_type": "custom", "status": "active" });
    let cases = [
        // A column that is not in the table (SQL in a name).
        (
            "column",
            serde_json::json!({ "tables": { "projects": [project],
            "studies": [{ "id": "s", "project_id": "p", "title\" ) ; DROP TABLE studies; --": "x" }] } }),
        ),
        // A table that is not a project's.
        (
            "table",
            serde_json::json!({ "tables": { "projects": [project], "settings": [{ "key": "k", "value": "1" }] } }),
        ),
        // Two projects.
        (
            "two",
            serde_json::json!({ "tables": { "projects": [project, project] } }),
        ),
        // A nested value where a column value belongs.
        (
            "nested",
            serde_json::json!({ "tables": { "projects": [project],
            "studies": [{ "id": "s", "project_id": "p", "title": { "x": 1 } }] } }),
        ),
        // The same id twice.
        (
            "twice",
            serde_json::json!({ "tables": { "projects": [project], "studies": [study, study] } }),
        ),
        // A row the database refuses (a value its checks do not allow): the
        // project row written before it is rolled back too.
        (
            "refused",
            serde_json::json!({ "tables": { "projects": [project], "studies": [study],
            "passage_references": [{ "id": "r", "study_id": "s", "book": "JHN", "start_chapter": 0,
                          "created_at": "2026-01-01", "updated_at": "2026-01-01", "revision": 1 }] } }),
        ),
        // Unreadable JSON inside a JSON column.
        (
            "json",
            serde_json::json!({ "tables": { "projects": [project],
            "studies": [{ "id": "s", "project_id": "p", "title": "S", "created_at": "2026-01-01",
                          "updated_at": "2026-01-01", "revision": 1, "study_type": "custom", "status": "active", "details": "{not json" }] } }),
        ),
    ];
    for (name, data) in cases {
        let path = out.path().join(format!("{name}.awproject"));
        handmade(&path, &data);
        assert_eq!(
            code(import(&there, &path)),
            "portability.notPackage",
            "{name}"
        );
    }
    there
        .db
        .with_conn(|c| {
            assert_eq!(rows_everywhere(c), before);
            let tables: i64 = c.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'studies'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(tables, 1);
            Ok(())
        })
        .unwrap();

    // A row pointing at nothing in the package is left out, not linked to
    // something on this computer.
    let path = out.path().join("dangling.awproject");
    let mut foreign = study.clone();
    foreign["project_id"] = serde_json::json!("some-other-project");
    handmade(
        &path,
        &serde_json::json!({ "tables": { "projects": [project], "studies": [foreign] } }),
    );
    let report = import(&there, &path).unwrap();
    assert_eq!(report.counts.studies, 0);
    assert_eq!(report.left_out, 1);
}

// ---------------------------------------------------------------------------
// Backup and restore.

fn backup_to(f: &Folder, dir: &Path) -> PathBuf {
    let path = dir.join("everything.awbackup");
    backup::create(&f.db, &f.dirs, &path).unwrap();
    path
}

#[test]
fn a_backup_restores_everything_after_a_safety_copy() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let made = here
        .db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John"))
        .unwrap();
    let library = here
        .dirs
        .sources()
        .join("lib-1")
        .join("Commentary, John (1).pdf");
    fs::create_dir_all(library.parent().unwrap()).unwrap();
    fs::write(&library, b"%PDF- a book").unwrap();
    let before = here.db.with_conn(|c| Ok(shape(c, &made.project))).unwrap();
    let path = backup_to(&here, out.path());

    let preview = backup::inspect(&here.db, &path).unwrap();
    assert_eq!(preview.counts.projects, 1);
    assert_eq!(preview.counts.studies, 2);
    assert_eq!(preview.counts.files, 2);

    // Onto another computer with its own, different work.
    let there = folder();
    there
        .db
        .with_conn(|c| make_project(c, &there.dirs.teaching_images(), "Romans").map(|_| ()))
        .unwrap();
    fs::write(
        there.dirs.teaching_images().join(IMAGE),
        b"a different image",
    )
    .unwrap();
    let report = backup::restore(&there.db, &there.dirs, &path).unwrap();
    assert_eq!(report.counts.studies, 2);
    there
        .db
        .with_conn(|c| {
            assert_eq!(shape(c, &made.project), before);
            let romans: i64 = c.query_row(
                "SELECT COUNT(*) FROM projects WHERE title = 'Romans'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(romans, 0);
            assert_eq!(
                migrations::current_version(c)?,
                migrations::MIGRATIONS.last().unwrap().version
            );
            let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            assert_eq!(ok, "ok");
            Ok(())
        })
        .unwrap();
    // The files are back; the different one was set aside, not deleted.
    assert_eq!(
        fs::read(there.dirs.teaching_images().join(IMAGE)).unwrap(),
        PNG
    );
    assert_eq!(
        fs::read(
            there
                .dirs
                .sources()
                .join("lib-1")
                .join("Commentary, John (1).pdf")
        )
        .unwrap(),
        b"%PDF- a book"
    );
    assert_eq!(report.files_set_aside, 1);
    let aside: Vec<_> = fs::read_dir(there.dirs.pre_restore_backups())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect();
    let folder_aside = aside.iter().find(|p| p.is_dir()).unwrap();
    assert_eq!(
        fs::read(
            folder_aside
                .join("sources")
                .join("teaching-images")
                .join(IMAGE)
        )
        .unwrap(),
        b"a different image"
    );
    // The safety copy holds the work as it was: Romans.
    let safety = Connection::open(&report.safety_copy).unwrap();
    let romans: i64 = safety
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE title = 'Romans'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(romans, 1);
    assert_eq!(fs::read_dir(there.dirs.cache()).unwrap().count(), 0);
}

#[test]
fn a_backup_is_a_consistent_snapshot_and_holds_no_secrets() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    here.db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John").map(|_| ()))
        .unwrap();
    // Recent changes still in the WAL file are in the backup.
    here.db
        .with_conn(|c| {
            c.execute(
                "UPDATE projects SET title = 'John, latest' WHERE title = 'John'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    // Things that are never backed up.
    fs::write(here.dirs.cache().join("disposable.bin"), b"cache").unwrap();
    fs::write(here.dirs.logs().join("abiding-word.log"), b"log").unwrap();
    let path = backup_to(&here, out.path());

    let mut archive = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    let names: Vec<String> = archive.file_names().map(String::from).collect();
    assert!(names.contains(&"database.db".to_string()));
    assert!(names
        .iter()
        .all(|n| n == "manifest.json" || n == "database.db" || n.starts_with("files/")));
    let manifest: serde_json::Value = {
        let mut entry = archive.by_name("manifest.json").unwrap();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    };
    let places: Vec<&str> = manifest["places"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["to"].as_str().unwrap())
        .collect();
    assert!(
        places.iter().all(|p| p.starts_with("sources/")),
        "{places:?}"
    );

    let snapshot = out.path().join("snapshot.db");
    {
        let mut entry = archive.by_name("database.db").unwrap();
        let mut file = fs::File::create(&snapshot).unwrap();
        std::io::copy(&mut entry, &mut file).unwrap();
    }
    let copy = Connection::open(&snapshot).unwrap();
    let title: String = copy
        .query_row(
            "SELECT title FROM projects WHERE title LIKE 'John%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(title, "John, latest");
    // The settings table holds no keys, tokens or passwords: those are only
    // in the operating system's credential store.
    let mut stmt = copy.prepare("SELECT key, value FROM settings").unwrap();
    let settings: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for (key, value) in settings {
        let lower = format!("{key} {value}").to_lowercase();
        assert!(
            !["api_key", "apikey", "password", "token", "secret"]
                .iter()
                .any(|w| lower.contains(w)),
            "{key}"
        );
    }
}

#[test]
fn a_damaged_backup_changes_nothing() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    here.db
        .with_conn(|c| make_project(c, &here.dirs.teaching_images(), "John").map(|_| ()))
        .unwrap();
    let good = backup_to(&here, out.path());
    let there = folder();
    there
        .db
        .with_conn(|c| make_project(c, &there.dirs.teaching_images(), "Romans").map(|_| ()))
        .unwrap();
    let before = there.db.with_conn(|c| Ok(rows_everywhere(c))).unwrap();
    let case = |name: &str| out.path().join(format!("{name}.awbackup"));

    // A changed database.
    rewrite(
        &good,
        &case("tampered"),
        |name, mut b| {
            if name == "database.db" {
                let i = b.len() / 2;
                b[i] ^= 0xff;
            }
            Some(b)
        },
        &[],
    );
    // A file placed outside sources/.
    rewrite(
        &good,
        &case("escape"),
        |name, b| {
            if name == "manifest.json" {
                Some(manifest_edit(b, |m| {
                    m["places"][0]["to"] = serde_json::json!("sources/../database/abiding-word.db");
                }))
            } else {
                Some(b)
            }
        },
        &[],
    );
    // Not an Abiding Word database, correctly listed.
    let not_ours = out.path().join("other.db");
    {
        let c = Connection::open(&not_ours).unwrap();
        c.execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (1);")
            .unwrap();
    }
    let other = fs::read(&not_ours).unwrap();
    let sha = {
        use sha2::Digest;
        sha2::Sha256::digest(&other)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    rewrite(
        &good,
        &case("foreign"),
        |name, b| match name {
            "database.db" => Some(other.clone()),
            "manifest.json" => Some(manifest_edit(b, |m| {
                for f in m["files"].as_array_mut().unwrap() {
                    if f["path"] == "database.db" {
                        f["size"] = serde_json::json!(other.len());
                        f["sha256"] = serde_json::json!(sha);
                    }
                }
            })),
            _ => Some(b),
        },
        &[],
    );
    // A project package is not a backup.
    let made = here
        .db
        .with_conn(|c| {
            Ok(
                c.query_row("SELECT id FROM projects WHERE title = 'John'", [], |r| {
                    r.get::<_, String>(0)
                })?,
            )
        })
        .unwrap();
    let package = export(&here, &made, out.path());

    for (path, expected) in [
        (case("tampered"), "portability.damaged"),
        (case("escape"), "portability.notPackage"),
        (case("foreign"), "portability.notBackupDatabase"),
        (package, "portability.notPackage"),
    ] {
        assert_eq!(
            code(backup::restore(&there.db, &there.dirs, &path)),
            expected,
            "{path:?}"
        );
    }
    there
        .db
        .with_conn(|c| {
            assert_eq!(rows_everywhere(c), before);
            let romans: i64 = c.query_row(
                "SELECT COUNT(*) FROM projects WHERE title = 'Romans'",
                [],
                |r| r.get(0),
            )?;
            assert_eq!(romans, 1);
            Ok(())
        })
        .unwrap();
    // Nothing was restored, so no safety copy was needed.
    assert!(!there.dirs.pre_restore_backups().exists());
    assert_eq!(fs::read_dir(there.dirs.cache()).unwrap().count(), 0);
}

#[test]
fn a_backup_from_a_newer_version_is_refused() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let good = backup_to(&here, out.path());
    let newer = out.path().join("newer.awbackup");
    rewrite(
        &good,
        &newer,
        |name, b| {
            if name == "manifest.json" {
                Some(manifest_edit(b, |m| {
                    m["schemaVersion"] = serde_json::json!(9999)
                }))
            } else {
                Some(b)
            }
        },
        &[],
    );
    assert_eq!(code(backup::inspect(&here.db, &newer)), "portability.newer");
    assert_eq!(
        code(backup::restore(&here.db, &here.dirs, &newer)),
        "portability.newer"
    );
}

#[test]
fn a_restore_that_fails_part_way_puts_the_safety_copy_back() {
    let out = tempfile::tempdir().unwrap();
    let here = folder();
    let good = backup_to(&here, out.path());
    // A backup whose database claims to be one version older than it is:
    // it passes every check, and then its upgrade fails half-way.
    let staged = out.path().join("staged.db");
    {
        let mut archive = zip::ZipArchive::new(fs::File::open(&good).unwrap()).unwrap();
        let mut entry = archive.by_name("database.db").unwrap();
        std::io::copy(&mut entry, &mut fs::File::create(&staged).unwrap()).unwrap();
    }
    {
        let c = Connection::open(&staged).unwrap();
        c.execute("DELETE FROM schema_versions WHERE version = (SELECT MAX(version) FROM schema_versions)", [])
            .unwrap();
        c.execute_batch("PRAGMA journal_mode = DELETE; VACUUM;")
            .unwrap();
    }
    let bytes = fs::read(&staged).unwrap();
    let sha = {
        use sha2::Digest;
        sha2::Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    };
    let broken = out.path().join("broken.awbackup");
    rewrite(
        &good,
        &broken,
        |name, b| match name {
            "database.db" => Some(bytes.clone()),
            "manifest.json" => Some(manifest_edit(b, |m| {
                for f in m["files"].as_array_mut().unwrap() {
                    if f["path"] == "database.db" {
                        f["size"] = serde_json::json!(bytes.len());
                        f["sha256"] = serde_json::json!(sha);
                    }
                }
            })),
            _ => Some(b),
        },
        &[],
    );

    let there = folder();
    there
        .db
        .with_conn(|c| make_project(c, &there.dirs.teaching_images(), "Romans").map(|_| ()))
        .unwrap();
    let before = there.db.with_conn(|c| Ok(shape_of_all(c))).unwrap();
    assert_eq!(
        code(backup::restore(&there.db, &there.dirs, &broken)),
        "portability.restoreFailed"
    );
    there
        .db
        .with_conn(|c| {
            assert_eq!(shape_of_all(c), before);
            let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            assert_eq!(ok, "ok");
            assert_eq!(
                migrations::current_version(c)?,
                migrations::MIGRATIONS.last().unwrap().version
            );
            // Still a working database: new work can be saved.
            let workspace = workspaces::get_default(c)?;
            projects::create(
                c,
                &CreateProject {
                    workspace_id: workspace.id,
                    title: "After".into(),
                    description: None,
                },
            )?;
            Ok(())
        })
        .unwrap();
    // The safety copy stays where it was made.
    assert!(
        fs::read_dir(there.dirs.pre_restore_backups())
            .unwrap()
            .count()
            >= 1
    );
}

fn shape_of_all(conn: &Connection) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT id FROM projects ORDER BY id").unwrap();
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    ids.iter().flat_map(|id| shape(conn, id)).collect()
}
