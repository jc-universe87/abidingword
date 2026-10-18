//! The fonts installed on this computer (v0.18.1), so a church template's
//! fonts can be checked honestly: there exactly, there without the wanted
//! weight or slant, or missing — never quietly replaced. Read once from the
//! system's font folders (names only; outlines are loaded when a PDF needs
//! them). No font is copied, bundled or sent anywhere.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use ttf_parser::{Face, Permissions, Tag};

/// One face of an installed font.
#[derive(Debug, Clone)]
pub struct CatalogFace {
    /// The family names it answers to: the typographic family ("Montserrat")
    /// and the legacy one ("Montserrat SemiBold").
    pub families: Vec<String>,
    pub bold: bool,
    pub italic: bool,
    /// The weight class (400 regular, 600 semibold, 700 bold).
    pub weight: u16,
    pub path: PathBuf,
    pub index: u32,
    /// TrueType outlines whose licence allows embedding a subset: a PDF can
    /// carry it. Other fonts show on screen and in PowerPoint only.
    pub embeddable: bool,
}

/// An installed family as listed for choosing a replacement.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFont {
    pub family: String,
    pub bold: bool,
    pub italic: bool,
    /// A PDF can include it.
    pub embeddable: bool,
}

/// How a font a template names is found here.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FontStatus {
    /// The family with the wanted weight and slant.
    Installed,
    /// The family, but not in the wanted weight or slant.
    StyleMissing,
    Missing,
}

fn font_dirs() -> Vec<PathBuf> {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let mut dirs = Vec::new();
    if cfg!(target_os = "windows") {
        let windir = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        dirs.push(windir.join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft\\Windows\\Fonts"));
        }
    } else if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/System/Library/Fonts"));
        dirs.push(PathBuf::from("/Library/Fonts"));
        if let Some(h) = &home {
            dirs.push(h.join("Library/Fonts"));
        }
    } else {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(h) = &home {
            dirs.push(h.join(".local/share/fonts"));
            dirs.push(h.join(".fonts"));
        }
    }
    dirs
}

/// At most this many font files are looked at (a safety limit).
const FILES_MAX: usize = 6000;

fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 6 || out.len() >= FILES_MAX {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out, depth + 1);
        } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "ttc" | "otc"
            )
        }) {
            out.push(path);
            if out.len() >= FILES_MAX {
                return;
            }
        }
    }
}

fn names(face: &Face) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in [
        ttf_parser::name_id::TYPOGRAPHIC_FAMILY,
        ttf_parser::name_id::FAMILY,
    ] {
        for n in face.names() {
            if n.name_id == id && n.is_unicode() {
                if let Some(s) = n.to_string() {
                    let s = s.trim().to_string();
                    if !s.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&s)) {
                        out.push(s);
                    }
                    break;
                }
            }
        }
    }
    out
}

/// The faces in one font file.
pub fn faces_in(path: &Path) -> Vec<CatalogFace> {
    let Ok(data) = std::fs::read(path) else {
        return Vec::new();
    };
    let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
    (0..count.min(16))
        .filter_map(|index| {
            let face = Face::parse(&data, index).ok()?;
            let families = names(&face);
            if families.is_empty() {
                return None;
            }
            let raw = face.raw_face();
            let truetype = raw.table(Tag::from_bytes(b"glyf")).is_some();
            let embeddable = truetype
                && !matches!(face.permissions(), Some(Permissions::Restricted))
                && face.is_outline_embedding_allowed()
                && face.is_subsetting_allowed();
            let weight = face.weight().to_number();
            Some(CatalogFace {
                families,
                bold: face.is_bold() || weight >= 600,
                italic: face.is_italic() || face.is_oblique(),
                weight,
                path: path.to_path_buf(),
                index,
                embeddable,
            })
        })
        .collect()
}

/// Every face found in the given folders.
pub fn scan(dirs: &[PathBuf]) -> Vec<CatalogFace> {
    let mut files = Vec::new();
    for d in dirs {
        walk(d, &mut files, 0);
    }
    files.sort();
    files.iter().flat_map(|p| faces_in(p)).collect()
}

/// The computer's fonts, read once.
pub fn system() -> &'static [CatalogFace] {
    static CATALOG: OnceLock<Vec<CatalogFace>> = OnceLock::new();
    CATALOG.get_or_init(|| scan(&font_dirs()))
}

fn same(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// How a family in a given weight and slant is found among `faces`.
pub fn status(faces: &[CatalogFace], family: &str, bold: bool, italic: bool) -> FontStatus {
    let of_family: Vec<&CatalogFace> = faces
        .iter()
        .filter(|f| f.families.iter().any(|n| same(n, family)))
        .collect();
    if of_family.is_empty() {
        FontStatus::Missing
    } else if of_family
        .iter()
        .any(|f| f.bold == bold && f.italic == italic)
    {
        FontStatus::Installed
    } else {
        FontStatus::StyleMissing
    }
}

/// The face that best matches a family, weight and slant.
pub fn find<'a>(
    faces: &'a [CatalogFace],
    family: &str,
    bold: bool,
    italic: bool,
) -> Option<&'a CatalogFace> {
    let of_family = faces
        .iter()
        .filter(|f| f.families.iter().any(|n| same(n, family)));
    of_family.min_by_key(|f| {
        (
            u8::from(f.bold != bold),
            u8::from(f.italic != italic),
            // Among equals, a regular weight for regular text and a heavier one for bold.
            if bold {
                1000u16.saturating_sub(f.weight)
            } else {
                f.weight.abs_diff(400)
            },
        )
    })
}

/// The installed families with their styles, sorted by name.
pub fn installed(faces: &[CatalogFace]) -> Vec<InstalledFont> {
    let mut map: BTreeMap<(String, bool, bool), InstalledFont> = BTreeMap::new();
    for f in faces {
        let family = f.families[0].clone();
        let key = (family.to_lowercase(), f.bold, f.italic);
        let entry = map.entry(key).or_insert(InstalledFont {
            family,
            bold: f.bold,
            italic: f.italic,
            embeddable: f.embeddable,
        });
        entry.embeddable |= f.embeddable;
    }
    map.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(families: &[&str], bold: bool, italic: bool, weight: u16) -> CatalogFace {
        CatalogFace {
            families: families.iter().map(|s| s.to_string()).collect(),
            bold,
            italic,
            weight,
            path: PathBuf::new(),
            index: 0,
            embeddable: true,
        }
    }

    #[test]
    fn a_family_is_found_exactly_without_its_style_or_not_at_all() {
        let faces = vec![
            face(&["Montserrat"], false, false, 400),
            face(&["Montserrat", "Montserrat SemiBold"], true, false, 600),
            face(&["Montserrat"], true, false, 700),
        ];
        assert_eq!(
            status(&faces, "montserrat", false, false),
            FontStatus::Installed
        );
        assert_eq!(
            status(&faces, "Montserrat SemiBold", true, false),
            FontStatus::Installed
        );
        assert_eq!(
            status(&faces, "Montserrat", false, true),
            FontStatus::StyleMissing
        );
        assert_eq!(status(&faces, "Gotham", false, false), FontStatus::Missing);
        assert_eq!(find(&faces, "Montserrat", true, false).unwrap().weight, 700);
        assert_eq!(
            find(&faces, "Montserrat", false, false).unwrap().weight,
            400
        );
        let list = installed(&faces);
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn the_folders_of_this_computer_can_be_read() {
        // Whatever is installed here: every face has a name.
        for f in system().iter().take(50) {
            assert!(!f.families[0].is_empty());
        }
    }
}
