//! Images in a presentation: where a kept image's local copy is, what kind
//! of image a file holds and how large it is. Read from the file's own
//! header; nothing is fetched.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::domain::TeachingMaterial;

/// Where kept images live on this computer.
#[derive(Debug, Clone)]
pub struct ImageStore {
    /// Generated images the person kept (v0.16).
    pub generated_dir: PathBuf,
    /// Copies of found images saved for offline use (v0.18).
    pub offline_dir: PathBuf,
    /// Church templates' images (v0.18.1).
    pub template_dir: PathBuf,
}

impl ImageStore {
    pub fn templates(&self) -> super::template_store::TemplateStore {
        super::template_store::TemplateStore {
            dir: self.template_dir.clone(),
        }
    }

    /// The local copy of a kept image, when there is one.
    pub fn path_for(&self, material: &TeachingMaterial) -> Option<PathBuf> {
        let image = material.image.as_ref()?;
        if let Some(file) = image.file.as_deref() {
            if crate::db::teaching::is_generated_file_name(file) {
                let path = self.generated_dir.join(file);
                return path.is_file().then_some(path);
            }
        }
        let url = image.url.as_deref()?;
        let path = self.offline_path(url);
        path.is_file().then_some(path)
    }

    /// Where the offline copy of a found image is (or will be) saved: named
    /// by the image's address, so the same image is saved once.
    pub fn offline_path(&self, url: &str) -> PathBuf {
        self.offline_dir.join(offline_name(url))
    }
}

pub fn offline_name(url: &str) -> String {
    let digest = Sha256::digest(url.trim().as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// An image's kind and size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageHeader {
    pub media_type: &'static str,
    pub width: u32,
    pub height: u32,
}

impl ImageHeader {
    pub fn extension(&self) -> &'static str {
        match self.media_type {
            "image/png" => "png",
            "image/jpeg" => "jpeg",
            "image/gif" => "gif",
            _ => "webp",
        }
    }
}

pub fn read_file(path: &Path) -> Option<(Vec<u8>, ImageHeader)> {
    let bytes = std::fs::read(path).ok()?;
    let header = header(&bytes)?;
    Some((bytes, header))
}

/// PNG, JPEG, GIF or WebP, read from the header only.
pub fn header(b: &[u8]) -> Option<ImageHeader> {
    let be32 =
        |i: usize| -> Option<u32> { Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?)) };
    let le16 = |i: usize| -> Option<u32> {
        Some(u32::from(u16::from_le_bytes(
            b.get(i..i + 2)?.try_into().ok()?,
        )))
    };
    if b.starts_with(b"\x89PNG\r\n\x1a\n") && b.get(12..16) == Some(b"IHDR") {
        return valid("image/png", be32(16)?, be32(20)?);
    }
    if b.starts_with(b"GIF8") {
        return valid("image/gif", le16(6)?, le16(8)?);
    }
    if b.starts_with(&[0xFF, 0xD8]) {
        return jpeg(b);
    }
    if b.len() > 30 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        let le24 = |i: usize| -> Option<u32> {
            let s = b.get(i..i + 3)?;
            Some(u32::from(s[0]) | u32::from(s[1]) << 8 | u32::from(s[2]) << 16)
        };
        return match &b[12..16] {
            b"VP8X" => valid("image/webp", le24(24)? + 1, le24(27)? + 1),
            b"VP8 " => valid("image/webp", le16(26)? & 0x3FFF, le16(28)? & 0x3FFF),
            b"VP8L" => {
                let bits = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
                valid(
                    "image/webp",
                    (bits & 0x3FFF) + 1,
                    ((bits >> 14) & 0x3FFF) + 1,
                )
            }
            _ => None,
        };
    }
    None
}

fn valid(media_type: &'static str, width: u32, height: u32) -> Option<ImageHeader> {
    (width > 0 && height > 0 && width <= 30_000 && height <= 30_000).then_some(ImageHeader {
        media_type,
        width,
        height,
    })
}

/// A JPEG's size, from its first start-of-frame segment.
fn jpeg(b: &[u8]) -> Option<ImageHeader> {
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if matches!(marker, 0xD8 | 0x01 | 0xD0..=0xD7) {
            i += 2;
            continue;
        }
        let len = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
        let is_frame = matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_frame {
            let h = u32::from(u16::from_be_bytes([*b.get(i + 5)?, *b.get(i + 6)?]));
            let w = u32::from(u16::from_be_bytes([*b.get(i + 7)?, *b.get(i + 8)?]));
            return valid("image/jpeg", w, h);
        }
        i += 2 + len;
    }
    None
}

/// The number of colour components and whether a JPEG is progressive is not
/// needed: PDF readers take any baseline or progressive JPEG as it is. This
/// is the number of components, for the PDF colour space.
pub fn jpeg_components(b: &[u8]) -> Option<u8> {
    let mut i = 2;
    while i + 4 <= b.len() {
        if b[i] != 0xFF {
            return None;
        }
        let marker = b[i + 1];
        if marker == 0xFF {
            i += 1;
            continue;
        }
        if matches!(marker, 0xD8 | 0x01 | 0xD0..=0xD7) {
            i += 2;
            continue;
        }
        let len = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
        let is_frame = matches!(marker, 0xC0..=0xCF) && !matches!(marker, 0xC4 | 0xC8 | 0xCC);
        if is_frame {
            return b.get(i + 9).copied();
        }
        i += 2 + len;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_png_and_gif_sizes() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend_from_slice(&640u32.to_be_bytes());
        png.extend_from_slice(&480u32.to_be_bytes());
        assert_eq!(
            header(&png),
            Some(ImageHeader {
                media_type: "image/png",
                width: 640,
                height: 480
            })
        );
        let gif = b"GIF89a\x20\x00\x10\x00";
        assert_eq!(header(gif).map(|h| (h.width, h.height)), Some((32, 16)));
        assert_eq!(header(b"not an image"), None);
    }

    #[test]
    fn reads_a_jpeg_frame() {
        // SOI, APP0 (len 4), SOF0 with 3 components, 200×100.
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00,
            0x64, 0x00, 0xC8, 0x03,
        ];
        let h = header(&jpeg).unwrap();
        assert_eq!((h.media_type, h.width, h.height), ("image/jpeg", 200, 100));
        assert_eq!(jpeg_components(&jpeg), Some(3));
    }
}
