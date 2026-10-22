//! One project as a package (`.awproject`, v0.19).
//!
//! The package holds the project's own work: its Bible Studies with their
//! parts, notes, tags, passages and relations between them; their Bible
//! Teachings with steps, passages, links, materials and presentations; the
//! user study templates those studies were made from; and the images the
//! person generated and kept for its materials. It never holds library
//! files, Bible texts, church presentation templates or settings: those are
//! listed by name as what the project refers to, so an import can say what
//! this computer does not have.
//!
//! An import always creates a new project. Every row gets a new id, every
//! reference between rows follows it, and the whole import is one
//! transaction: it is all there, or nothing is.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

use super::{not_a_package, Limits, PackageFile, Reader, Staging, Writer};
use crate::db::{migrations, new_id, now, workspaces};
use crate::error::{AppError, AppResult, UserMessage};

pub const FORMAT: &str = "abiding-word-project";
pub const FORMAT_VERSION: u32 = 1;
pub const EXTENSION: &str = "awproject";

const DATA: &str = "project.json";
const IMAGES: &str = "files/teaching-images/";

const LIMITS: Limits = Limits {
    entries: 5_000,
    entry: 200 * 1024 * 1024,
    total: 2 * 1024 * 1024 * 1024,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    pub studies: u32,
    pub teachings: u32,
    pub presentations: u32,
    pub notes: u32,
    pub images: u32,
}

/// Something the project refers to that is not in the package.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct External {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Externals {
    /// Library sources the project's notes cite.
    pub sources: Vec<External>,
    /// Church presentation templates its presentations use.
    pub presentation_templates: Vec<External>,
    /// Bibles its presentations show.
    pub bibles: Vec<External>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    pub schema_version: i64,
    pub app_version: String,
    pub created_at: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub counts: Counts,
    #[serde(default)]
    pub external: Externals,
    /// Kept images the project uses that were missing when it was saved.
    #[serde(default)]
    pub missing_images: u32,
    pub files: Vec<PackageFile>,
}

/// What a package's own `project.json` holds: rows by table.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Data {
    tables: BTreeMap<String, Vec<Map<String, Json>>>,
}

/// What this computer does not have of what a package refers to.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Missing {
    pub sources: Vec<String>,
    pub presentation_templates: Vec<String>,
    pub bibles: Vec<String>,
    pub images: u32,
}

impl Missing {
    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
            && self.presentation_templates.is_empty()
            && self.bibles.is_empty()
            && self.images == 0
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub title: String,
    pub description: Option<String>,
    pub created_at: String,
    pub app_version: String,
    pub counts: Counts,
    /// The title the project will have here ("John (2)" when "John" exists).
    pub import_title: String,
    pub missing: Missing,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub title: String,
    pub counts: Counts,
    pub external: Externals,
    pub missing_images: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub project_id: String,
    pub title: String,
    pub counts: Counts,
    pub missing: Missing,
    /// Rows left out because what they belonged to is not here (a note's
    /// citation of a library source this computer does not have).
    pub left_out: u32,
}

// ---------------------------------------------------------------------------
// What belongs to a project.

const S: &str = "SELECT id FROM studies WHERE project_id = ?1 AND deleted_at IS NULL";

fn sections() -> String {
    format!("SELECT id FROM study_sections WHERE study_id IN ({S}) AND deleted_at IS NULL")
}
fn findings() -> String {
    format!("SELECT id FROM findings WHERE study_id IN ({S}) AND deleted_at IS NULL")
}
fn preparations() -> String {
    format!("SELECT id FROM teaching_preparations WHERE study_id IN ({S}) AND deleted_at IS NULL")
}
fn presentations() -> String {
    format!(
        "SELECT id FROM presentations WHERE preparation_id IN ({}) AND deleted_at IS NULL",
        preparations()
    )
}

/// How a column refers to another row.
#[derive(Clone, Copy)]
enum Ref {
    /// Required: a row whose target is not in the package is left out.
    Own(&'static str),
    /// Empty stays empty; a target that is not in the package leaves the row out.
    OwnIfSet(&'static str),
    /// A target that is not in the package becomes empty.
    OwnOrEmpty(&'static str),
}

struct Table {
    name: &'static str,
    has_id: bool,
    refs: &'static [(&'static str, Ref)],
}

/// In the order they are inserted: every table after the tables it refers to.
const TABLES: &[Table] = &[
    Table {
        name: "studies",
        has_id: true,
        refs: &[("project_id", Ref::Own("projects"))],
    },
    Table {
        name: "study_sections",
        has_id: true,
        refs: &[("study_id", Ref::Own("studies"))],
    },
    Table {
        name: "study_blocks",
        has_id: true,
        refs: &[("section_id", Ref::Own("study_sections"))],
    },
    Table {
        name: "findings",
        has_id: true,
        refs: &[
            ("study_id", Ref::Own("studies")),
            ("section_id", Ref::OwnOrEmpty("study_sections")),
        ],
    },
    Table {
        name: "finding_tags",
        has_id: false,
        refs: &[("finding_id", Ref::Own("findings"))],
    },
    Table {
        name: "finding_sources",
        has_id: true,
        refs: &[("finding_id", Ref::Own("findings"))],
    },
    Table {
        name: "passage_references",
        has_id: true,
        refs: &[
            ("study_id", Ref::OwnIfSet("studies")),
            ("block_id", Ref::OwnIfSet("study_blocks")),
            ("finding_id", Ref::OwnIfSet("findings")),
        ],
    },
    Table {
        name: "study_relations",
        has_id: true,
        refs: &[
            ("from_study_id", Ref::Own("studies")),
            ("to_study_id", Ref::Own("studies")),
        ],
    },
    Table {
        name: "teaching_preparations",
        has_id: true,
        refs: &[("study_id", Ref::Own("studies"))],
    },
    Table {
        name: "teaching_points",
        has_id: true,
        refs: &[("preparation_id", Ref::Own("teaching_preparations"))],
    },
    Table {
        name: "teaching_finding_links",
        has_id: true,
        refs: &[
            ("preparation_id", Ref::Own("teaching_preparations")),
            ("point_id", Ref::OwnIfSet("teaching_points")),
            ("finding_id", Ref::Own("findings")),
        ],
    },
    Table {
        name: "teaching_passages",
        has_id: true,
        refs: &[
            ("preparation_id", Ref::Own("teaching_preparations")),
            ("point_id", Ref::OwnIfSet("teaching_points")),
        ],
    },
    Table {
        name: "teaching_materials",
        has_id: true,
        refs: &[
            ("preparation_id", Ref::Own("teaching_preparations")),
            ("point_id", Ref::OwnIfSet("teaching_points")),
        ],
    },
    Table {
        name: "presentations",
        has_id: true,
        refs: &[("preparation_id", Ref::Own("teaching_preparations"))],
    },
    Table {
        name: "presentation_items",
        has_id: true,
        refs: &[("presentation_id", Ref::Own("presentations"))],
    },
];

/// The rows of `table` that belong to the project.
fn selection(table: &str) -> String {
    match table {
        "projects" => "SELECT * FROM projects WHERE id = ?1 AND deleted_at IS NULL".into(),
        "study_templates" => format!(
            "SELECT * FROM study_templates WHERE id IN (SELECT template_id FROM studies WHERE id IN ({S}))"
        ),
        "studies" => "SELECT * FROM studies WHERE project_id = ?1 AND deleted_at IS NULL".into(),
        "study_sections" => format!("SELECT * FROM study_sections WHERE id IN ({})", sections()),
        "study_blocks" => format!(
            "SELECT * FROM study_blocks WHERE section_id IN ({}) AND deleted_at IS NULL",
            sections()
        ),
        "findings" => format!("SELECT * FROM findings WHERE id IN ({})", findings()),
        "finding_tags" => format!(
            "SELECT * FROM finding_tags WHERE finding_id IN ({})",
            findings()
        ),
        "finding_sources" => format!(
            "SELECT * FROM finding_sources WHERE finding_id IN ({}) AND deleted_at IS NULL",
            findings()
        ),
        "passage_references" => format!(
            "SELECT * FROM passage_references WHERE deleted_at IS NULL AND (study_id IN ({S})
             OR finding_id IN ({}) OR block_id IN (SELECT id FROM study_blocks WHERE section_id IN ({})))",
            findings(),
            sections()
        ),
        "study_relations" => format!(
            "SELECT * FROM study_relations WHERE from_study_id IN ({S}) AND to_study_id IN ({S}) AND deleted_at IS NULL"
        ),
        "teaching_preparations" => format!(
            "SELECT * FROM teaching_preparations WHERE id IN ({})",
            preparations()
        ),
        "teaching_points" | "teaching_finding_links" | "teaching_passages" | "teaching_materials" => {
            format!(
                "SELECT * FROM {table} WHERE preparation_id IN ({}) AND deleted_at IS NULL",
                preparations()
            )
        }
        "presentations" => format!("SELECT * FROM presentations WHERE id IN ({})", presentations()),
        "presentation_items" => format!(
            "SELECT * FROM presentation_items WHERE presentation_id IN ({}) AND deleted_at IS NULL",
            presentations()
        ),
        _ => unreachable!("not a project table: {table}"),
    }
}

/// Every table a package may hold rows for.
fn package_tables() -> impl Iterator<Item = &'static str> {
    ["projects", "study_templates"]
        .into_iter()
        .chain(TABLES.iter().map(|t| t.name))
}

fn to_json(value: Value) -> AppResult<Json> {
    Ok(match value {
        Value::Null => Json::Null,
        Value::Integer(i) => Json::from(i),
        Value::Real(f) => serde_json::Number::from_f64(f)
            .map(Json::Number)
            .unwrap_or(Json::Null),
        Value::Text(s) => Json::String(s),
        Value::Blob(_) => {
            return Err(AppError::Unexpected(
                "a project table holds binary data".into(),
            ))
        }
    })
}

fn from_json(value: &Json) -> AppResult<Value> {
    Ok(match value {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or_else(not_a_package)?),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(_) | Json::Object(_) => return Err(not_a_package()),
    })
}

fn rows(conn: &Connection, table: &str, project_id: &str) -> AppResult<Vec<Map<String, Json>>> {
    let mut stmt = conn.prepare(&selection(table))?;
    let names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = stmt.query([project_id])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut map = Map::new();
        for (i, name) in names.iter().enumerate() {
            map.insert(name.clone(), to_json(row.get::<_, Value>(i)?)?);
        }
        out.push(map);
    }
    Ok(out)
}

fn text<'a>(row: &'a Map<String, Json>, column: &str) -> Option<&'a str> {
    row.get(column).and_then(Json::as_str)
}

fn image_file(row: &Map<String, Json>) -> Option<String> {
    let image: Json = serde_json::from_str(text(row, "image")?).ok()?;
    image
        .get("file")
        .and_then(Json::as_str)
        .filter(|f| crate::db::teaching::is_generated_file_name(f))
        .map(String::from)
}

fn count(data: &Data, table: &str) -> u32 {
    data.tables.get(table).map_or(0, |r| r.len() as u32)
}

fn counts(data: &Data, images: u32) -> Counts {
    Counts {
        studies: count(data, "studies"),
        teachings: count(data, "teaching_preparations"),
        presentations: count(data, "presentations"),
        notes: count(data, "findings"),
        images,
    }
}

// ---------------------------------------------------------------------------
// Export.

/// Saves the project `project_id` as a package at `target`. `images` is
/// the folder of kept generated images.
pub fn export(
    conn: &Connection,
    project_id: &str,
    images: &Path,
    target: &Path,
) -> AppResult<ExportReport> {
    // One read transaction: every table from the same moment.
    let tx = conn.unchecked_transaction()?;
    let mut data = Data::default();
    for table in package_tables() {
        data.tables
            .insert(table.to_string(), rows(&tx, table, project_id)?);
    }
    let project = data
        .tables
        .get("projects")
        .and_then(|r| r.first())
        .cloned()
        .ok_or_else(|| AppError::not_found("project", project_id))?;
    let external = externals(&tx, project_id)?;
    let schema_version = migrations::current_version(&tx)?;
    drop(tx);

    let mut package = Writer::create(target)?;
    package.add_bytes(
        DATA,
        &serde_json::to_vec(&data).map_err(|e| AppError::Unexpected(e.to_string()))?,
    )?;
    let mut missing_images = 0;
    let mut added = HashSet::new();
    for row in data.tables.get("teaching_materials").into_iter().flatten() {
        let Some(file) = image_file(row) else {
            continue;
        };
        if !added.insert(file.clone()) {
            continue;
        }
        let path = images.join(&file);
        if path.is_file() {
            package.add_file(&format!("{IMAGES}{file}"), &path)?;
        } else {
            missing_images += 1;
        }
    }
    let title = text(&project, "title").unwrap_or_default().to_string();
    let counts = counts(&data, added.len() as u32 - missing_images);
    let manifest = Manifest {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        schema_version,
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: now(),
        title: title.clone(),
        description: text(&project, "description").map(String::from),
        counts: counts.clone(),
        external: external.clone(),
        missing_images,
        files: package.files.clone(),
    };
    package.finish(&manifest)?;
    Ok(ExportReport {
        title,
        counts,
        external,
        missing_images,
    })
}

fn externals(conn: &Connection, project_id: &str) -> AppResult<Externals> {
    let list = |sql: String| -> AppResult<Vec<External>> {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([project_id], |r| {
            Ok(External {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    };
    Ok(Externals {
        sources: list(format!(
            "SELECT DISTINCT s.id, s.title FROM finding_sources fs JOIN sources s ON s.id = fs.source_id
             WHERE fs.finding_id IN ({}) AND fs.deleted_at IS NULL ORDER BY s.title",
            findings()
        ))?,
        presentation_templates: list(format!(
            "SELECT DISTINCT t.id, t.name FROM presentations p JOIN presentation_templates t ON t.id = p.template_id
             WHERE p.id IN ({}) ORDER BY t.name",
            presentations()
        ))?,
        bibles: list(format!(
            "SELECT DISTINCT b.id, b.name FROM presentations p JOIN bible_translations b ON b.id = p.translation_id
             WHERE p.id IN ({}) ORDER BY b.name",
            presentations()
        ))?,
    })
}

// ---------------------------------------------------------------------------
// Reading a package.

struct Opened {
    reader: Reader,
    manifest: Manifest,
    data: Data,
}

fn accepted(path: &str) -> bool {
    path == DATA
        || path
            .strip_prefix(IMAGES)
            .is_some_and(crate::db::teaching::is_generated_file_name)
}

fn open(conn: &Connection, path: &Path) -> AppResult<Opened> {
    let (mut reader, manifest) = Reader::open::<Manifest>(path, LIMITS, accepted, |m| &m.files)?;
    if manifest.format != FORMAT {
        return Err(not_a_package());
    }
    if manifest.format_version > FORMAT_VERSION
        || manifest.schema_version > migrations::current_version(conn)?
    {
        return Err(AppError::Import(
            UserMessage::new(
                "portability.newer",
                format!(
                    "This file was saved by a newer version of Abiding Word ({}). Please update Abiding Word first.",
                    manifest.app_version
                ),
            )
            .with("version", &manifest.app_version),
        ));
    }
    let bytes = reader.read(DATA)?;
    let data: Data = serde_json::from_slice(&bytes).map_err(|_| not_a_package())?;
    let known: HashSet<&str> = package_tables().collect();
    if data.tables.keys().any(|t| !known.contains(t.as_str())) || count(&data, "projects") != 1 {
        return Err(not_a_package());
    }
    Ok(Opened {
        reader,
        manifest,
        data,
    })
}

fn exists(conn: &Connection, sql: &str, id: &str) -> AppResult<bool> {
    Ok(conn.query_row(sql, [id], |_| Ok(())).optional()?.is_some())
}

fn missing(conn: &Connection, opened: &Opened) -> AppResult<Missing> {
    let absent = |items: &[External], sql: &str| -> AppResult<Vec<String>> {
        let mut out = Vec::new();
        for item in items {
            if !exists(conn, sql, &item.id)? {
                out.push(item.name.clone());
            }
        }
        Ok(out)
    };
    let external = &opened.manifest.external;
    let images = opened
        .data
        .tables
        .get("teaching_materials")
        .into_iter()
        .flatten()
        .filter_map(image_file)
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|f| {
            !opened
                .reader
                .files
                .iter()
                .any(|p| p.path == format!("{IMAGES}{f}"))
        })
        .count() as u32;
    Ok(Missing {
        sources: absent(
            &external.sources,
            "SELECT 1 FROM sources WHERE id = ?1 AND deleted_at IS NULL",
        )?,
        presentation_templates: absent(
            &external.presentation_templates,
            "SELECT 1 FROM presentation_templates WHERE id = ?1 AND deleted_at IS NULL",
        )?,
        bibles: absent(
            &external.bibles,
            "SELECT 1 FROM bible_translations WHERE id = ?1",
        )?,
        images,
    })
}

/// "John", or "John (2)" when the workspace already has a project "John".
fn free_title(conn: &Connection, workspace_id: &str, title: &str) -> AppResult<String> {
    let taken = |t: &str| -> AppResult<bool> {
        Ok(conn
            .query_row(
                "SELECT 1 FROM projects WHERE workspace_id = ?1 AND deleted_at IS NULL
                 AND lower(title) = lower(?2)",
                params![workspace_id, t],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    };
    let title = title.trim();
    let title = if title.is_empty() { "Project" } else { title };
    if !taken(title)? {
        return Ok(title.to_string());
    }
    for n in 2.. {
        let candidate = format!("{title} ({n})");
        if !taken(&candidate)? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

/// What a package holds and what it refers to that this computer lacks;
/// nothing is changed.
pub fn inspect(conn: &Connection, path: &Path) -> AppResult<Preview> {
    let opened = open(conn, path)?;
    let workspace = workspaces::get_default(conn)?;
    let images = opened
        .reader
        .files
        .iter()
        .filter(|f| f.path.starts_with(IMAGES))
        .count() as u32;
    Ok(Preview {
        title: opened.manifest.title.clone(),
        description: opened.manifest.description.clone(),
        created_at: opened.manifest.created_at.clone(),
        app_version: opened.manifest.app_version.clone(),
        counts: counts(&opened.data, images),
        import_title: free_title(conn, &workspace.id, &opened.manifest.title)?,
        missing: missing(conn, &opened)?,
    })
}

// ---------------------------------------------------------------------------
// Import.

struct Import<'c> {
    conn: &'c Connection,
    /// Old id → new id, per table.
    ids: HashMap<&'static str, HashMap<String, String>>,
    columns: HashMap<&'static str, HashSet<String>>,
    left_out: u32,
}

impl<'c> Import<'c> {
    fn columns(&mut self, table: &'static str) -> AppResult<&HashSet<String>> {
        if !self.columns.contains_key(table) {
            let mut stmt = self
                .conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<HashSet<_>, _>>()?;
            self.columns.insert(table, names);
        }
        Ok(&self.columns[table])
    }

    fn new_id_of(&self, table: &str, old: &str) -> Option<&String> {
        self.ids.get(table).and_then(|m| m.get(old))
    }

    fn insert(&mut self, table: &'static str, row: &Map<String, Json>) -> AppResult<()> {
        let columns = self.columns(table)?;
        if row.keys().any(|k| !columns.contains(k)) || row.is_empty() {
            return Err(not_a_package());
        }
        let names: Vec<&String> = row.keys().collect();
        let values = row.values().map(from_json).collect::<AppResult<Vec<_>>>()?;
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({})",
            names
                .iter()
                .map(|n| format!("\"{n}\""))
                .collect::<Vec<_>>()
                .join(", "),
            (1..=names.len())
                .map(|i| format!("?{i}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        self.conn
            .execute(&sql, rusqlite::params_from_iter(values))
            .map_err(|e| {
                log::warn!("project import: a {table} row was refused: {e}");
                not_a_package()
            })?;
        Ok(())
    }

    fn fresh_id(&mut self, table: &'static str, row: &mut Map<String, Json>) -> AppResult<String> {
        let old = text(row, "id").ok_or_else(not_a_package)?.to_string();
        let new = new_id();
        if self
            .ids
            .entry(table)
            .or_default()
            .insert(old, new.clone())
            .is_some()
        {
            return Err(not_a_package());
        }
        row.insert("id".into(), Json::String(new.clone()));
        Ok(new)
    }

    /// Points `column` at the new row; false when the row must be left out.
    fn follow(&self, row: &mut Map<String, Json>, column: &str, reference: Ref) -> AppResult<bool> {
        let (target, required, empty_if_missing) = match reference {
            Ref::Own(t) => (t, true, false),
            Ref::OwnIfSet(t) => (t, false, false),
            Ref::OwnOrEmpty(t) => (t, false, true),
        };
        let old = match row.get(column) {
            None | Some(Json::Null) => return Ok(!required),
            Some(Json::String(s)) => s.clone(),
            Some(_) => return Err(not_a_package()),
        };
        match self.new_id_of(target, &old) {
            Some(new) => {
                row.insert(column.into(), Json::String(new.clone()));
                Ok(true)
            }
            None if empty_if_missing => {
                row.insert(column.into(), Json::Null);
                Ok(true)
            }
            None => Ok(false),
        }
    }
}

/// Imports a package as a new project in the default workspace. Kept images
/// are copied into `images` under new names; if anything fails, nothing of
/// the import is left: no rows and no files.
pub fn import(
    conn: &Connection,
    path: &Path,
    images: &Path,
    cache: &Path,
) -> AppResult<ImportReport> {
    let mut opened = open(conn, path)?;
    let missing = missing(conn, &opened)?;

    // Images first, checked, into a staging folder; they are moved into
    // place under new names only once the rows are written.
    let staging = Staging::new(cache, "project-import")?;
    let mut staged = HashMap::new();
    let image_paths: Vec<String> = opened
        .reader
        .files
        .iter()
        .filter(|f| f.path.starts_with(IMAGES))
        .map(|f| f.path.clone())
        .collect();
    for entry in image_paths {
        let old = entry[IMAGES.len()..].to_string();
        let new = format!("{}.png", uuid::Uuid::new_v4().simple());
        opened.reader.extract(&entry, &staging.path().join(&new))?;
        staged.insert(old, new);
    }

    let workspace = workspaces::get_default(conn)?;
    let tx = conn.unchecked_transaction()?;
    let mut job = Import {
        conn: &tx,
        ids: HashMap::new(),
        columns: HashMap::new(),
        left_out: 0,
    };
    let data = &mut opened.data;
    let stamp = now();

    // The project: always new, in this computer's workspace, under a free title.
    let mut project = data.tables["projects"][0].clone();
    let project_id = job.fresh_id("projects", &mut project)?;
    let title = free_title(
        &tx,
        &workspace.id,
        text(&project, "title").unwrap_or_default(),
    )?;
    project.insert("workspace_id".into(), Json::String(workspace.id.clone()));
    project.insert("title".into(), Json::String(title.clone()));
    project.insert("deleted_at".into(), Json::Null);
    project.insert("created_at".into(), Json::String(stamp.clone()));
    project.insert("updated_at".into(), Json::String(stamp.clone()));
    job.insert("projects", &project)?;

    // Study templates: a built-in one is this computer's own; a person's own
    // template is reused when the same one is here, otherwise added.
    let mut template_ids: HashMap<String, Option<String>> = HashMap::new();
    for row in data
        .tables
        .get("study_templates")
        .cloned()
        .unwrap_or_default()
    {
        let old = text(&row, "id").ok_or_else(not_a_package)?.to_string();
        let local = study_template(&mut job, row)?;
        template_ids.insert(old, local);
    }

    for spec in TABLES {
        let rows = data.tables.remove(spec.name).unwrap_or_default();
        let mut parents = Vec::new();
        'rows: for mut row in rows {
            for (column, reference) in spec.refs {
                if !job.follow(&mut row, column, *reference)? {
                    job.left_out += 1;
                    continue 'rows;
                }
            }
            if !external_refs(&mut job, spec.name, &mut row, &template_ids, &staged)? {
                job.left_out += 1;
                continue;
            }
            if spec.name == "findings" {
                // Notes under other notes: linked once all of them are in.
                if let Some(parent) = row.insert("parent_id".into(), Json::Null) {
                    if let Some(parent) = parent.as_str() {
                        parents.push((
                            text(&row, "id").unwrap_or_default().to_string(),
                            parent.to_string(),
                        ));
                    }
                }
            }
            if spec.has_id {
                job.fresh_id(spec.name, &mut row)?;
            }
            job.insert(spec.name, &row)?;
        }
        for (old_child, old_parent) in parents {
            if let (Some(child), Some(parent)) = (
                job.new_id_of("findings", &old_child).cloned(),
                job.new_id_of("findings", &old_parent).cloned(),
            ) {
                tx.execute(
                    "UPDATE findings SET parent_id = ?2 WHERE id = ?1",
                    params![child, parent],
                )?;
            }
        }
    }
    let left_out = job.left_out;
    // Nothing points anywhere it should not.
    let broken: Option<String> = tx
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(table) = broken {
        log::warn!("project import: broken reference in {table}");
        return Err(not_a_package());
    }

    // The images, under their new names, then the rows.
    std::fs::create_dir_all(images).map_err(|e| AppError::filesystem(images, e))?;
    let mut placed = Vec::new();
    let moved = (|| {
        for new in staged.values() {
            let target = images.join(new);
            std::fs::rename(staging.path().join(new), &target)
                .or_else(|_| std::fs::copy(staging.path().join(new), &target).map(|_| ()))
                .map_err(|e| AppError::filesystem(&target, e))?;
            placed.push(target);
        }
        tx.commit()?;
        Ok::<_, AppError>(())
    })();
    if let Err(e) = moved {
        for file in placed {
            let _ = std::fs::remove_file(file);
        }
        return Err(e);
    }

    let images_count = staged.len() as u32;
    let counts = Counts {
        studies: job_count(conn, "SELECT COUNT(*) FROM studies WHERE project_id = ?1", &project_id)?,
        teachings: job_count(
            conn,
            "SELECT COUNT(*) FROM teaching_preparations WHERE study_id IN (SELECT id FROM studies WHERE project_id = ?1)",
            &project_id,
        )?,
        presentations: job_count(
            conn,
            "SELECT COUNT(*) FROM presentations WHERE preparation_id IN (SELECT id FROM teaching_preparations
             WHERE study_id IN (SELECT id FROM studies WHERE project_id = ?1))",
            &project_id,
        )?,
        notes: job_count(
            conn,
            "SELECT COUNT(*) FROM findings WHERE study_id IN (SELECT id FROM studies WHERE project_id = ?1)",
            &project_id,
        )?,
        images: images_count,
    };
    log::info!("project imported as {project_id} ({left_out} row(s) left out)");
    Ok(ImportReport {
        project_id,
        title,
        counts,
        missing,
        left_out,
    })
}

fn job_count(conn: &Connection, sql: &str, id: &str) -> AppResult<u32> {
    Ok(conn.query_row(sql, [id], |r| r.get(0))?)
}

fn study_template(job: &mut Import<'_>, mut row: Map<String, Json>) -> AppResult<Option<String>> {
    let builtin = row.get("is_builtin").and_then(Json::as_i64) == Some(1);
    if builtin {
        let key = text(&row, "key").ok_or_else(not_a_package)?;
        return Ok(job
            .conn
            .query_row(
                "SELECT id FROM study_templates WHERE key = ?1 AND is_builtin = 1 AND deleted_at IS NULL",
                [key],
                |r| r.get(0),
            )
            .optional()?);
    }
    let same: Option<String> = job
        .conn
        .query_row(
            "SELECT id FROM study_templates WHERE is_builtin = 0 AND deleted_at IS NULL
             AND name = ?1 AND definition = ?2",
            params![text(&row, "name"), text(&row, "definition")],
            |r| r.get(0),
        )
        .optional()?;
    if same.is_some() {
        return Ok(same);
    }
    json_column(&row, "definition")?;
    let id = job.fresh_id("study_templates", &mut row)?;
    row.insert("key".into(), Json::String(format!("user-{id}")));
    row.insert("is_builtin".into(), Json::from(0));
    row.insert("deleted_at".into(), Json::Null);
    job.insert("study_templates", &row)?;
    Ok(Some(id))
}

/// A column that holds JSON must hold readable JSON.
fn json_column(row: &Map<String, Json>, column: &str) -> AppResult<()> {
    match row.get(column) {
        None | Some(Json::Null) => Ok(()),
        Some(Json::String(s)) => serde_json::from_str::<Json>(s)
            .map(|_| ())
            .map_err(|_| not_a_package()),
        Some(_) => Err(not_a_package()),
    }
}

/// References to what is not in the package, and the JSON columns. False
/// when the row must be left out.
fn external_refs(
    job: &mut Import<'_>,
    table: &str,
    row: &mut Map<String, Json>,
    templates: &HashMap<String, Option<String>>,
    images: &HashMap<String, String>,
) -> AppResult<bool> {
    let here =
        |job: &Import<'_>, sql: &str, row: &Map<String, Json>, column: &str| -> AppResult<bool> {
            match text(row, column) {
                Some(id) => exists(job.conn, sql, id),
                None => Ok(true),
            }
        };
    match table {
        "studies" => {
            json_column(row, "details")?;
            let template =
                text(row, "template_id").and_then(|old| templates.get(old).cloned().flatten());
            row.insert(
                "template_id".into(),
                template.map(Json::String).unwrap_or(Json::Null),
            );
        }
        "study_blocks" | "findings" => json_column(row, "data")?,
        "finding_sources" => {
            // The citation of a library source this computer does not have
            // cannot be kept: it is listed as missing instead.
            if !here(
                job,
                "SELECT 1 FROM sources WHERE id = ?1 AND deleted_at IS NULL",
                row,
                "source_id",
            )? || text(row, "source_id").is_none()
            {
                return Ok(false);
            }
            if !here(
                job,
                "SELECT 1 FROM source_segments WHERE id = ?1",
                row,
                "source_segment_id",
            )? {
                row.insert("source_segment_id".into(), Json::Null);
            }
            if !here(
                job,
                "SELECT 1 FROM source_annotations WHERE id = ?1 AND deleted_at IS NULL",
                row,
                "annotation_id",
            )? {
                row.insert("annotation_id".into(), Json::Null);
            }
        }
        "teaching_materials" => {
            json_column(row, "sources")?;
            json_column(row, "image")?;
            if let Some(old) = image_file(row) {
                if let Some(new) = images.get(&old) {
                    let mut image: Json = serde_json::from_str(text(row, "image").unwrap_or("{}"))
                        .map_err(|_| not_a_package())?;
                    image["file"] = Json::String(new.clone());
                    row.insert("image".into(), Json::String(image.to_string()));
                }
            }
        }
        "presentations" => {
            if !here(
                job,
                "SELECT 1 FROM presentation_templates WHERE id = ?1 AND deleted_at IS NULL",
                row,
                "template_id",
            )? {
                row.insert("template_id".into(), Json::Null);
            }
            if !here(
                job,
                "SELECT 1 FROM bible_translations WHERE id = ?1",
                row,
                "translation_id",
            )? {
                row.insert("translation_id".into(), Json::Null);
            }
        }
        "presentation_items" => {
            // A slide made from a part of the teaching follows that part.
            if let Some(old) = text(row, "source_id").map(String::from) {
                let new = job.ids.values().find_map(|m| m.get(&old)).cloned();
                if let Some(new) = new {
                    row.insert("source_id".into(), Json::String(new));
                }
            }
        }
        _ => {}
    }
    Ok(true)
}
