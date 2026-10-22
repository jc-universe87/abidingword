//! Moving work between computers (v0.19): one project as a package, and
//! everything as a backup.
//!
//! Both are ordinary `.zip` files with a `manifest.json` that lists every
//! other entry with its size and SHA-256. Reading one is defensive:
//!
//! - only entry names this module knows are accepted: no absolute paths, no
//!   `..`, no backslashes, no drive letters, nothing outside the listed
//!   folders;
//! - every entry must be listed in the manifest, and every listed entry must
//!   be there, with the size and hash it was listed with;
//! - the number of entries, each entry's size and the total are limited, and
//!   sizes are counted while reading, never trusted from the archive;
//! - nothing in a package is ever run: the project itself is JSON data,
//!   images are copied as files under names the app chooses, and a backup's
//!   database is checked before it replaces anything.
//!
//! The formats are documented in `docs/portability.md`.

pub mod backup;
pub mod project;

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult, UserMessage};

/// The name of the manifest inside every package.
pub const MANIFEST: &str = "manifest.json";

/// A manifest is small: a few lines per listed file.
const MANIFEST_MAX: u64 = 16 * 1024 * 1024;

/// One file inside a package, as the manifest lists it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

/// How much a package may hold.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    pub entries: usize,
    pub entry: u64,
    pub total: u64,
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub(crate) fn invalid(code: &'static str, text: &str) -> AppError {
    AppError::Import(UserMessage::new(code, text))
}

pub(crate) fn not_a_package() -> AppError {
    invalid(
        "portability.notPackage",
        "Abiding Word cannot read this file, or it is damaged.",
    )
}

pub(crate) fn too_large() -> AppError {
    invalid(
        "portability.tooLarge",
        "This file holds more than Abiding Word reads from one file.",
    )
}

/// An entry name as it may appear in a package: relative, with `/` between
/// plain parts (letters, digits, `.`, `-`, `_`, spaces), none of them `.` or
/// `..`, and at most 240 characters. Anything else is refused, whatever the
/// operating system would make of it.
pub(crate) fn safe_entry_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 240 || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    name.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.starts_with(' ')
            && !part.ends_with(' ')
            && !part.ends_with('.')
            && part
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')'))
    }) && Path::new(name)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
}

/// A package opened for reading: its entries are checked against the
/// manifest as they are read.
pub(crate) struct Reader {
    archive: zip::ZipArchive<fs::File>,
    pub files: Vec<PackageFile>,
    limits: Limits,
}

impl Reader {
    /// Opens `path`, reads the manifest with `parse`, and checks that the
    /// entries in the archive are exactly the manifest's files (plus the
    /// manifest), each with a safe name and within the limits.
    pub fn open<M: for<'de> Deserialize<'de>>(
        path: &Path,
        limits: Limits,
        accepted: impl Fn(&str) -> bool,
        files_of: impl Fn(&M) -> &Vec<PackageFile>,
    ) -> AppResult<(Self, M)> {
        let file = fs::File::open(path).map_err(|e| AppError::filesystem(path, e))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|_| not_a_package())?;
        if archive.len() > limits.entries + 1 {
            return Err(too_large());
        }
        let manifest: M = {
            let mut entry = archive.by_name(MANIFEST).map_err(|_| not_a_package())?;
            let bytes = read_limited(&mut entry, MANIFEST_MAX)?;
            serde_json::from_slice(&bytes).map_err(|_| not_a_package())?
        };
        let files = files_of(&manifest).clone();
        if files.len() > limits.entries {
            return Err(too_large());
        }
        let mut listed = std::collections::HashSet::new();
        let mut total = 0u64;
        for f in &files {
            if !safe_entry_name(&f.path)
                || f.path == MANIFEST
                || !accepted(&f.path)
                || f.sha256.len() != 64
                || !listed.insert(f.path.as_str())
            {
                return Err(not_a_package());
            }
            if f.size > limits.entry {
                return Err(too_large());
            }
            total = total.saturating_add(f.size);
        }
        if total > limits.total {
            return Err(too_large());
        }
        // Every entry in the archive is listed; nothing extra rides along.
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index).map_err(|_| not_a_package())?;
            let name = entry.name();
            if name == MANIFEST {
                continue;
            }
            if entry.is_dir() || !listed.contains(name) {
                return Err(not_a_package());
            }
        }
        if listed.len() + 1 != archive.len() {
            return Err(not_a_package());
        }
        Ok((
            Self {
                archive,
                files,
                limits,
            },
            manifest,
        ))
    }

    fn listed(&self, path: &str) -> AppResult<PackageFile> {
        self.files
            .iter()
            .find(|f| f.path == path)
            .cloned()
            .ok_or_else(not_a_package)
    }

    /// A listed entry's bytes, read whole (for small entries), checked.
    pub fn read(&mut self, path: &str) -> AppResult<Vec<u8>> {
        let listed = self.listed(path)?;
        let mut entry = self.archive.by_name(path).map_err(|_| not_a_package())?;
        let bytes = read_limited(&mut entry, listed.size.min(self.limits.entry))?;
        if bytes.len() as u64 != listed.size || sha256(&bytes) != listed.sha256 {
            return Err(damaged());
        }
        Ok(bytes)
    }

    /// Copies a listed entry to `target` (a new file), checking its size and
    /// hash while copying. A file that does not match is removed again.
    pub fn extract(&mut self, path: &str, target: &Path) -> AppResult<()> {
        let listed = self.listed(path)?;
        let mut entry = self.archive.by_name(path).map_err(|_| not_a_package())?;
        if let Some(dir) = target.parent() {
            fs::create_dir_all(dir).map_err(|e| AppError::filesystem(dir, e))?;
        }
        let result = (|| {
            let mut out =
                fs::File::create_new(target).map_err(|e| AppError::filesystem(target, e))?;
            let mut hasher = Sha256::new();
            let mut written = 0u64;
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                let n = entry.read(&mut buffer).map_err(|_| damaged())?;
                if n == 0 {
                    break;
                }
                written += n as u64;
                if written > listed.size {
                    return Err(damaged());
                }
                hasher.update(&buffer[..n]);
                out.write_all(&buffer[..n])
                    .map_err(|e| AppError::filesystem(target, e))?;
            }
            out.sync_all()
                .map_err(|e| AppError::filesystem(target, e))?;
            if written != listed.size || hex(&hasher.finalize()) != listed.sha256 {
                return Err(damaged());
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(target);
        }
        result
    }
}

pub(crate) fn damaged() -> AppError {
    invalid(
        "portability.damaged",
        "Part of this file does not match its list of contents: it is damaged or was changed. Nothing was changed here.",
    )
}

/// Reads at most `max` bytes; more is an error, not a truncation.
fn read_limited(reader: &mut impl Read, max: u64) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| damaged())?;
    if bytes.len() as u64 > max {
        return Err(too_large());
    }
    Ok(bytes)
}

/// Writes a package: entries are added one by one and listed with their
/// size and hash; `finish` adds the manifest and moves the complete file
/// into place. Until then the target is untouched, and a writer dropped
/// without finishing leaves nothing behind.
pub(crate) struct Writer {
    zip: Option<zip::ZipWriter<fs::File>>,
    temp: PathBuf,
    target: PathBuf,
    pub files: Vec<PackageFile>,
}

impl Writer {
    pub fn create(target: &Path) -> AppResult<Self> {
        if let Some(dir) = target.parent() {
            fs::create_dir_all(dir).map_err(|e| AppError::filesystem(dir, e))?;
        }
        let mut name = target
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        name.push(".abidingword-part");
        let temp = target.with_file_name(name);
        let file = fs::File::create(&temp).map_err(|e| AppError::filesystem(&temp, e))?;
        Ok(Self {
            zip: Some(zip::ZipWriter::new(file)),
            temp,
            target: target.to_path_buf(),
            files: Vec::new(),
        })
    }

    fn options() -> zip::write::SimpleFileOptions {
        zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .large_file(true)
    }

    fn zip(&mut self) -> &mut zip::ZipWriter<fs::File> {
        self.zip
            .as_mut()
            .expect("package writer used after finishing")
    }

    fn zip_error(&self, e: impl std::fmt::Display) -> AppError {
        AppError::Unexpected(format!("{}: {e}", self.temp.display()))
    }

    pub fn add_bytes(&mut self, path: &str, bytes: &[u8]) -> AppResult<()> {
        debug_assert!(safe_entry_name(path));
        self.zip()
            .start_file(path, Self::options())
            .map_err(|e| self.zip_error(e))?;
        let temp = self.temp.clone();
        self.zip()
            .write_all(bytes)
            .map_err(|e| AppError::filesystem(&temp, e))?;
        self.files.push(PackageFile {
            path: path.to_string(),
            size: bytes.len() as u64,
            sha256: sha256(bytes),
        });
        Ok(())
    }

    /// Adds a file from disk, streamed, hashing it as it goes.
    pub fn add_file(&mut self, path: &str, source: &Path) -> AppResult<()> {
        debug_assert!(safe_entry_name(path));
        let mut input = fs::File::open(source).map_err(|e| AppError::filesystem(source, e))?;
        self.zip()
            .start_file(path, Self::options())
            .map_err(|e| self.zip_error(e))?;
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let n = input
                .read(&mut buffer)
                .map_err(|e| AppError::filesystem(source, e))?;
            if n == 0 {
                break;
            }
            size += n as u64;
            hasher.update(&buffer[..n]);
            let temp = self.temp.clone();
            self.zip()
                .write_all(&buffer[..n])
                .map_err(|e| AppError::filesystem(&temp, e))?;
        }
        self.files.push(PackageFile {
            path: path.to_string(),
            size,
            sha256: hex(&hasher.finalize()),
        });
        Ok(())
    }

    pub fn finish(mut self, manifest: &impl Serialize) -> AppResult<()> {
        let json =
            serde_json::to_vec_pretty(manifest).map_err(|e| AppError::Unexpected(e.to_string()))?;
        self.zip()
            .start_file(MANIFEST, Self::options())
            .map_err(|e| self.zip_error(e))?;
        let temp = self.temp.clone();
        self.zip()
            .write_all(&json)
            .map_err(|e| AppError::filesystem(&temp, e))?;
        let file = self
            .zip
            .take()
            .expect("package writer used after finishing")
            .finish()
            .map_err(|e| self.zip_error(e))?;
        file.sync_all()
            .map_err(|e| AppError::filesystem(&temp, e))?;
        drop(file);
        fs::rename(&self.temp, &self.target).map_err(|e| AppError::filesystem(&self.target, e))
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        if self.zip.is_some() {
            self.zip = None;
            let _ = fs::remove_file(&self.temp);
        }
    }
}

/// A folder for unpacking, inside the data folder's `cache/`, removed when
/// dropped.
pub(crate) struct Staging(PathBuf);

impl Staging {
    pub fn new(cache: &Path, what: &str) -> AppResult<Self> {
        let dir = cache.join(format!("{what}-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).map_err(|e| AppError::filesystem(&dir, e))?;
        Ok(Self(dir))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        crate::filesystem::remove_managed(&self.0);
    }
}

/// A UTC timestamp usable in file names on every system (no colons).
pub(crate) fn file_stamp() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H-%M-%S%.3fZ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_are_plain_relative_paths() {
        for good in [
            "project.json",
            "files/teaching-images/0a1b.png",
            "sources/bibles/web/John (1).usfm",
        ] {
            assert!(safe_entry_name(good), "{good}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../outside.txt",
            "files/../../outside",
            "files/./x",
            "files\\..\\x",
            "C:/Windows/x",
            "files//x",
            "files/x/",
            "files/x.",
            "files/ x",
            "files/x\u{0}",
            "files/%2e%2e/x",
        ] {
            assert!(!safe_entry_name(bad), "{bad:?}");
        }
    }
}
