//! Access to a source's original (managed) file for the in-app viewer.
//!
//! The viewer never sees a path. It asks by source id; the core finds that
//! source's own primary file, checks it is really inside the managed
//! `sources/<category>/<source id>/` folder, and returns only bounded byte
//! ranges, so a 200 MB PDF is never read or sent whole.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult, UserMessage};

/// The most one request returns (4 MiB).
pub const MAX_READ: u32 = 4 * 1024 * 1024;

/// What the viewer can show of a source's original file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalView {
    /// Which viewer: "pdf".
    pub kind: &'static str,
}

/// The viewer for a file format, if there is one. Only PDF has a faithful
/// in-app view so far; the format decides the viewer, never the other way
/// round.
pub fn view_for(format: &str) -> Option<OriginalView> {
    match format {
        "pdf" => Some(OriginalView { kind: "pdf" }),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalInfo {
    pub kind: &'static str,
    pub size_bytes: u64,
}

/// A verified managed file, ready to be read in ranges.
#[derive(Debug)]
pub struct OriginalFile {
    path: PathBuf,
    pub size: u64,
    pub view: OriginalView,
}

fn unavailable() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "library.originalUnavailable",
        "The original of this source can’t be opened.",
    ))
}

fn missing() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "library.originalMissing",
        "Abiding Word’s copy of this file can’t be found.",
    ))
}

/// The managed file for `source_id`, recorded as `relative` (relative to
/// `root`, the data folder's `sources/`).
///
/// The record must read `<category>/<source id>/<file name>` — three plain
/// components, the middle one this very source — and the file it names, with
/// links resolved, must be a regular file inside `root`. Anything else
/// (an absolute path, `..`, another source's folder, a link out of the
/// folder, a missing file) is refused with a coded error and no path.
pub fn open(root: &Path, source_id: &str, relative: &str, format: &str) -> AppResult<OriginalFile> {
    let view = view_for(format).ok_or_else(|| {
        AppError::InvalidInput(UserMessage::new(
            "library.originalUnsupported",
            "This source has no original view.",
        ))
    })?;
    let (path, size) = verify(root, source_id, relative)?;
    Ok(OriginalFile { path, size, view })
}

/// The whole managed file of a source (checked exactly as [`open`] checks
/// it), for formats the core reads itself, such as an EPUB's contents.
/// Refuses anything larger than `max_bytes`.
pub fn read_managed(
    root: &Path,
    source_id: &str,
    relative: &str,
    max_bytes: u64,
) -> AppResult<Vec<u8>> {
    let (path, size) = verify(root, source_id, relative)?;
    if size > max_bytes {
        return Err(unavailable());
    }
    fs::read(path).map_err(|_| missing())
}

fn verify(root: &Path, source_id: &str, relative: &str) -> AppResult<(PathBuf, u64)> {
    let parts: Vec<&std::ffi::OsStr> = Path::new(relative)
        .components()
        .map(|c| match c {
            Component::Normal(part) => Ok(part),
            _ => Err(unavailable()),
        })
        .collect::<Result<_, _>>()?;
    if parts.len() != 3 || parts[1] != std::ffi::OsStr::new(source_id) {
        return Err(unavailable());
    }
    let root = root.canonicalize().map_err(|_| missing())?;
    let path = root.join(relative).canonicalize().map_err(|_| missing())?;
    if !path.starts_with(&root) {
        return Err(unavailable());
    }
    let meta = fs::metadata(&path).map_err(|_| missing())?;
    if !meta.is_file() {
        return Err(missing());
    }
    Ok((path, meta.len()))
}

impl OriginalFile {
    /// The verified path (for tests; never sent to the interface).
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn info(&self) -> OriginalInfo {
        OriginalInfo {
            kind: self.view.kind,
            size_bytes: self.size,
        }
    }

    /// Up to `length` bytes (at most [`MAX_READ`]) from `offset`; empty at or
    /// past the end.
    pub fn read(&self, offset: u64, length: u32) -> AppResult<Vec<u8>> {
        if offset >= self.size {
            return Ok(Vec::new());
        }
        let wanted = u64::from(length.min(MAX_READ)).min(self.size - offset);
        let mut file = File::open(&self.path).map_err(|_| missing())?;
        file.seek(SeekFrom::Start(offset)).map_err(|_| missing())?;
        let mut buffer = vec![0; wanted as usize];
        file.read_exact(&mut buffer).map_err(|_| missing())?;
        Ok(buffer)
    }
}
