//! Where a template's images live (v0.18.1): in the app's own data folder,
//! one file per image named by its SHA-256, so the same logo or background
//! is kept once however many templates use it, and no template depends on a
//! file elsewhere on the computer. Also the template package: a template
//! with its images in one JSON file, to back up or to use on another
//! installation (fonts are named, never included).

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::images::{self, sha256_hex};
use super::template::{self, TemplateAsset, TemplateDefinition};
use crate::error::{AppError, AppResult, UserMessage};

pub const PACKAGE_FORMAT: &str = "abiding-word/presentation-template-package";
pub const PACKAGE_VERSION: u32 = 1;
/// A single template image is at most this large (bytes).
pub const ASSET_MAX: usize = 40 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct TemplateStore {
    pub dir: PathBuf,
}

fn extension(media_type: &str) -> &'static str {
    match media_type {
        "image/png" => "png",
        "image/jpeg" => "jpeg",
        "image/gif" => "gif",
        _ => "webp",
    }
}

fn not_an_image() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "presentation.templateImage",
        "This file is not a PNG, JPEG, GIF or WebP image.",
    ))
}

/// A SHA-256 written as 64 hexadecimal digits: a template image's id.
pub fn is_asset_id(id: &str) -> bool {
    id.len() == 64 && id.chars().all(|c| c.is_ascii_hexdigit())
}

impl TemplateStore {
    pub fn path(&self, asset: &TemplateAsset) -> PathBuf {
        self.dir
            .join(format!("{}.{}", asset.id, extension(&asset.media_type)))
    }

    /// Keeps an image (once) and describes it.
    pub fn add(&self, bytes: &[u8], name: &str) -> AppResult<TemplateAsset> {
        if bytes.len() > ASSET_MAX {
            return Err(AppError::InvalidInput(UserMessage::new(
                "presentation.templateImageLarge",
                "This image is too large for a template.",
            )));
        }
        let header = images::header(bytes).ok_or_else(not_an_image)?;
        let asset = TemplateAsset {
            id: sha256_hex(bytes),
            media_type: header.media_type.to_string(),
            width: header.width,
            height: header.height,
            name: name.trim().chars().take(200).collect(),
        };
        let path = self.path(&asset);
        if !path.is_file() {
            std::fs::create_dir_all(&self.dir).map_err(|e| AppError::filesystem(&self.dir, e))?;
            // Written beside, then moved: a file is never half there.
            let partial = path.with_extension("partial");
            std::fs::write(&partial, bytes).map_err(|e| AppError::filesystem(&partial, e))?;
            std::fs::rename(&partial, &path).map_err(|e| AppError::filesystem(&path, e))?;
        }
        Ok(asset)
    }

    pub fn add_file(&self, path: &Path) -> AppResult<TemplateAsset> {
        let bytes = std::fs::read(path).map_err(|e| AppError::filesystem(path, e))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        self.add(&bytes, name)
    }

    /// The image, when it is there and still the same.
    pub fn read(&self, asset: &TemplateAsset) -> Option<Vec<u8>> {
        let bytes = std::fs::read(self.path(asset)).ok()?;
        (sha256_hex(&bytes) == asset.id).then_some(bytes)
    }

    pub fn has(&self, asset: &TemplateAsset) -> bool {
        self.path(asset).is_file()
    }
}

/// A template with its images, for another installation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePackage {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub definition: TemplateDefinition,
    /// Each image, base64, by its id (its SHA-256).
    pub images: Vec<PackagedImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagedImage {
    pub id: String,
    pub data: String,
}

pub fn package(
    name: &str,
    description: &str,
    def: &TemplateDefinition,
    store: &TemplateStore,
) -> AppResult<String> {
    let mut images = Vec::new();
    for asset in &def.assets {
        let bytes = store.read(asset).ok_or_else(|| {
            AppError::InvalidInput(UserMessage::new(
                "presentation.templateImageGone",
                "An image of this template is missing on this computer.",
            ))
        })?;
        images.push(PackagedImage {
            id: asset.id.clone(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
    let package = TemplatePackage {
        format: PACKAGE_FORMAT.into(),
        version: PACKAGE_VERSION,
        name: name.to_string(),
        description: description.to_string(),
        definition: def.clone(),
        images,
    };
    serde_json::to_string_pretty(&package)
        .map(|mut s| {
            s.push('\n');
            s
        })
        .map_err(|e| AppError::Unexpected(format!("template package: {e}")))
}

fn not_a_package() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "presentation.templatePackage",
        "This file is not an Abiding Word template.",
    ))
}

/// Reads a package and keeps its images; the template itself is kept by the
/// caller. Every image must be the one the package names.
pub fn unpack(text: &str, store: &TemplateStore) -> AppResult<TemplatePackage> {
    let package: TemplatePackage = serde_json::from_str(text).map_err(|_| not_a_package())?;
    if package.format != PACKAGE_FORMAT {
        return Err(not_a_package());
    }
    if package.version > PACKAGE_VERSION {
        return Err(AppError::InvalidInput(UserMessage::new(
            "presentation.templateNewer",
            "This template was made by a newer version of Abiding Word.",
        )));
    }
    template::validate(&package.definition)?;
    let mut package = package;
    let mut kept_assets = Vec::new();
    for asset in &package.definition.assets {
        let image = package
            .images
            .iter()
            .find(|i| i.id == asset.id)
            .ok_or_else(not_a_package)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .map_err(|_| not_a_package())?;
        let kept = store.add(&bytes, &asset.name)?;
        if kept.id != asset.id {
            return Err(not_a_package());
        }
        // What the image really is, not what the package says it is.
        kept_assets.push(kept);
    }
    package.definition.assets = kept_assets;
    Ok(package)
}

impl From<&Path> for TemplateStore {
    fn from(dir: &Path) -> Self {
        TemplateStore {
            dir: dir.to_path_buf(),
        }
    }
}

impl From<PathBuf> for TemplateStore {
    fn from(dir: PathBuf) -> Self {
        TemplateStore { dir }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, 2, 1);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[255, 0, 0, 0, 0, 255]).unwrap();
        }
        out
    }

    #[test]
    fn an_image_is_kept_once_and_a_package_brings_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let store = TemplateStore {
            dir: dir.path().join("t"),
        };
        let a = store.add(&png(), "logo.png").unwrap();
        let b = store.add(&png(), "again.png").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(
            (a.width, a.height, a.media_type.as_str()),
            (2, 1, "image/png")
        );
        assert_eq!(std::fs::read_dir(&store.dir).unwrap().count(), 1);
        assert!(store.add(b"not an image", "x.txt").is_err());

        let mut def = template::builtin("dark");
        def.logo = Some(template::Placed {
            asset_id: a.id.clone(),
            x: 10.0,
            y: 10.0,
            w: 40.0,
            h: 20.0,
            ..Default::default()
        });
        def.assets.push(a.clone());
        let text = package("Sunday", "Our church", &def, &store).unwrap();

        let other = TemplateStore {
            dir: dir.path().join("other"),
        };
        let back = unpack(&text, &other).unwrap();
        assert_eq!(back.definition, def);
        assert_eq!(other.read(&a).unwrap(), png());
        // What the image really is counts, not what the package says.
        let lying = text.replace(
            "\"mediaType\": \"image/png\"",
            "\"mediaType\": \"image/jpeg\"",
        );
        let third = TemplateStore {
            dir: dir.path().join("third"),
        };
        let back = unpack(&lying, &third).unwrap();
        assert_eq!(back.definition.assets[0].media_type, "image/png");
        assert!(third.read(&back.definition.assets[0]).is_some());
        // A changed image is refused.
        let broken = text.replacen(&a.id, &"0".repeat(64), 1);
        assert!(unpack(&broken, &dir.path().join("x").into()).is_err());
    }
}
