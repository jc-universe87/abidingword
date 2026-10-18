//! Fonts for PDF exports. The app ships no fonts of its own for this: it
//! uses the computer's own TrueType fonts (Segoe UI and Malgun Gothic on
//! Windows, Arial and Arial Unicode or Apple Gothic on macOS, DejaVu Sans
//! and Nanum Gothic or WenQuanYi on Linux), only where their licence allows
//! embedding, and embeds just the glyphs a PDF uses. Characters no font has
//! are written with the PDF's built-in Helvetica when it has them.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use ttf_parser::{Face, Permissions, Tag};

/// One usable TrueType face.
pub struct Font {
    pub name: String,
    data: Arc<Vec<u8>>,
    index: u32,
    pub units_per_em: u16,
    pub ascender: i16,
    pub descender: i16,
    pub cap_height: i16,
    pub bbox: [i16; 4],
    pub glyph_count: u16,
    glyphs: std::sync::Mutex<HashMap<char, Option<(u16, u16)>>>,
}

impl Font {
    /// A face from a font file, when it has TrueType outlines and its
    /// licence allows embedding.
    pub fn load(path: &Path) -> Vec<Font> {
        let Ok(data) = std::fs::read(path) else {
            return Vec::new();
        };
        let data = Arc::new(data);
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        (0..count.min(4))
            .filter_map(|index| Font::from_data(data.clone(), index))
            .collect()
    }

    pub fn from_data(data: Arc<Vec<u8>>, index: u32) -> Option<Font> {
        let face = Face::parse(&data, index).ok()?;
        let raw = face.raw_face();
        raw.table(Tag::from_bytes(b"glyf"))?;
        raw.table(Tag::from_bytes(b"loca"))?;
        // Only fonts whose licence allows embedding a subset of their outlines.
        if matches!(face.permissions(), Some(Permissions::Restricted))
            || !face.is_outline_embedding_allowed()
            || !face.is_subsetting_allowed()
        {
            return None;
        }
        // A font whose tables cannot be read is left out, so it never stops an export.
        subset(&face, &BTreeSet::new())?;
        let name = face
            .names()
            .into_iter()
            .find(|n| n.name_id == ttf_parser::name_id::POST_SCRIPT_NAME && n.is_unicode())
            .and_then(|n| n.to_string())
            .unwrap_or_else(|| "Font".to_string());
        let name: String = name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        let bbox = face.global_bounding_box();
        let font = Font {
            name: if name.is_empty() { "Font".into() } else { name },
            units_per_em: face.units_per_em(),
            ascender: face.ascender(),
            descender: face.descender(),
            cap_height: face.capital_height().unwrap_or(face.ascender()),
            bbox: [bbox.x_min, bbox.y_min, bbox.x_max, bbox.y_max],
            glyph_count: face.number_of_glyphs(),
            glyphs: std::sync::Mutex::new(HashMap::new()),
            data: data.clone(),
            index,
        };
        Some(font)
    }

    /// The glyph for a character and its advance (in font units).
    pub fn glyph(&self, c: char) -> Option<(u16, u16)> {
        let mut cache = self.glyphs.lock().ok()?;
        *cache.entry(c).or_insert_with(|| {
            let face = Face::parse(&self.data, self.index).ok()?;
            let gid = face.glyph_index(c)?;
            let advance = face.glyph_hor_advance(gid).unwrap_or(0);
            Some((gid.0, advance))
        })
    }

    pub fn advance(&self, gid: u16) -> u16 {
        Face::parse(&self.data, self.index)
            .ok()
            .and_then(|f| f.glyph_hor_advance(ttf_parser::GlyphId(gid)))
            .unwrap_or(0)
    }

    /// A TrueType file holding only the given glyphs (glyph numbers kept, so
    /// the PDF can name them directly).
    pub fn subset(&self, used: &BTreeSet<u16>) -> Option<Vec<u8>> {
        let face = Face::parse(&self.data, self.index).ok()?;
        subset(&face, used)
    }
}

/// A list of faces tried in order for each character.
pub struct FontSet {
    pub regular: Vec<Font>,
    pub bold: Vec<Font>,
    /// A template's own fonts (v0.18.1), tried first for its text boxes.
    pub families: Vec<FamilyFaces>,
}

/// The faces of one installed family a template uses.
pub struct FamilyFaces {
    /// The family name, as the template resolves it.
    pub name: String,
    pub regular: Vec<Font>,
    pub bold: Vec<Font>,
}

/// Where each system keeps the fonts tried, regular and bold, in order.
fn candidates() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut regular = Vec::new();
    let mut bold = Vec::new();
    if cfg!(target_os = "windows") {
        let dir = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\Windows"))
            .join("Fonts");
        for f in ["segoeui.ttf", "arial.ttf", "malgun.ttf", "Nirmala.ttf"] {
            regular.push(dir.join(f));
        }
        for f in ["segoeuib.ttf", "arialbd.ttf", "malgunbd.ttf"] {
            bold.push(dir.join(f));
        }
    } else if cfg!(target_os = "macos") {
        let sup = PathBuf::from("/System/Library/Fonts/Supplemental");
        regular.push(sup.join("Arial.ttf"));
        regular.push(sup.join("Arial Unicode.ttf"));
        regular.push(PathBuf::from("/Library/Fonts/Arial Unicode.ttf"));
        regular.push(sup.join("AppleGothic.ttf"));
        bold.push(sup.join("Arial Bold.ttf"));
    } else {
        for f in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ] {
            regular.push(PathBuf::from(f));
        }
        for f in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
        ] {
            bold.push(PathBuf::from(f));
        }
    }
    (regular, bold)
}

impl FontSet {
    /// The computer's usable fonts (none on a computer without any: then
    /// the PDF uses its built-in font).
    pub fn system() -> FontSet {
        let (regular, bold) = candidates();
        let load = |paths: Vec<PathBuf>| -> Vec<Font> {
            paths
                .iter()
                .filter(|p| p.is_file())
                .flat_map(|p| Font::load(p))
                .collect()
        };
        FontSet {
            regular: load(regular),
            bold: load(bold),
            families: Vec::new(),
        }
    }

    pub fn empty() -> FontSet {
        FontSet {
            regular: Vec::new(),
            bold: Vec::new(),
            families: Vec::new(),
        }
    }

    /// Adds installed families (by name) a template uses, from `catalog`.
    /// A family whose fonts a PDF may not carry is left out here: the PDF
    /// then uses the usual fonts, which the template's report says.
    pub fn with_families(
        mut self,
        names: &[&str],
        catalog: &[super::font_catalog::CatalogFace],
    ) -> FontSet {
        for name in names {
            let name = name.trim();
            if name.is_empty()
                || self
                    .families
                    .iter()
                    .any(|f| f.name.eq_ignore_ascii_case(name))
            {
                continue;
            }
            let load = |bold: bool| -> Vec<Font> {
                super::font_catalog::find(catalog, name, bold, false)
                    .filter(|f| f.embeddable && f.bold == bold)
                    .and_then(|f| {
                        let data = std::fs::read(&f.path).ok()?;
                        Font::from_data(Arc::new(data), f.index)
                    })
                    .into_iter()
                    .collect()
            };
            let regular = load(false);
            let bold = load(true);
            if !regular.is_empty() || !bold.is_empty() {
                self.families.push(FamilyFaces {
                    name: name.to_string(),
                    regular,
                    bold,
                });
            }
        }
        self
    }

    /// Whether an installed family was loaded (and so measures its own text).
    pub fn has_family(&self, name: &str) -> bool {
        self.families
            .iter()
            .any(|f| f.name.eq_ignore_ascii_case(name.trim()))
    }

    /// Every face, numbered in one order: the usual regular, the usual bold,
    /// then each family's regular and bold.
    pub fn at(&self, index: usize) -> &Font {
        let mut i = index;
        for list in self.lists() {
            if i < list.len() {
                return &list[i];
            }
            i -= list.len();
        }
        &self.regular[0]
    }

    fn lists(&self) -> Vec<&Vec<Font>> {
        let mut out = vec![&self.regular, &self.bold];
        for f in &self.families {
            out.push(&f.regular);
            out.push(&f.bold);
        }
        out
    }

    /// The faces tried for a character, in order, with their numbers: the
    /// family's (bold first for bold text), then the usual ones.
    pub fn chain(&self, family: Option<&str>, bold: bool) -> Vec<(usize, &Font)> {
        let mut offset = self.regular.len() + self.bold.len();
        let mut out: Vec<(usize, &Font)> = Vec::new();
        for f in &self.families {
            let here = family.is_some_and(|name| f.name.eq_ignore_ascii_case(name.trim()));
            if here {
                let regular_at = offset;
                let bold_at = offset + f.regular.len();
                let regular = f
                    .regular
                    .iter()
                    .enumerate()
                    .map(|(i, x)| (regular_at + i, x));
                let bolds = f.bold.iter().enumerate().map(|(i, x)| (bold_at + i, x));
                if bold {
                    out.extend(bolds.chain(regular));
                } else {
                    out.extend(regular);
                }
            }
            offset += f.regular.len() + f.bold.len();
        }
        let regular = self.regular.len();
        if bold {
            out.extend(self.bold.iter().enumerate().map(|(i, f)| (regular + i, f)));
        }
        out.extend(self.regular.iter().enumerate());
        out
    }
}

// ---------------------------------------------------------------------------
// Subsetting: glyph numbers are kept; unused glyphs become empty.
// ---------------------------------------------------------------------------

fn be16(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(i..i + 2)?.try_into().ok()?))
}

fn be32(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(i..i + 4)?.try_into().ok()?))
}

/// The byte range of each glyph in `glyf`, from `loca`.
fn glyph_ranges(loca: &[u8], long: bool, count: usize) -> Option<Vec<(usize, usize)>> {
    let offset = |i: usize| -> Option<usize> {
        if long {
            be32(loca, i * 4).map(|v| v as usize)
        } else {
            be16(loca, i * 2).map(|v| v as usize * 2)
        }
    };
    (0..count)
        .map(|i| Some((offset(i)?, offset(i + 1)?)))
        .collect()
}

/// The glyphs a composite glyph is made of.
fn components(glyph: &[u8]) -> Vec<u16> {
    let mut out = Vec::new();
    if glyph.len() < 10 || (be16(glyph, 0).unwrap_or(0) as i16) >= 0 {
        return out;
    }
    let mut i = 10;
    while let (Some(flags), Some(gid)) = (be16(glyph, i), be16(glyph, i + 2)) {
        out.push(gid);
        i += 4;
        i += if flags & 0x0001 != 0 { 4 } else { 2 };
        if flags & 0x0008 != 0 {
            i += 2;
        } else if flags & 0x0040 != 0 {
            i += 4;
        } else if flags & 0x0080 != 0 {
            i += 8;
        }
        if flags & 0x0020 == 0 {
            break;
        }
    }
    out
}

fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

fn subset(face: &Face, used: &BTreeSet<u16>) -> Option<Vec<u8>> {
    let raw = face.raw_face();
    let table = |t: &[u8; 4]| raw.table(Tag::from_bytes(t));
    let head = table(b"head")?;
    let glyf = table(b"glyf")?;
    let loca = table(b"loca")?;
    let count = usize::from(face.number_of_glyphs());
    let long = be16(head, 50)? == 1;
    let ranges = glyph_ranges(loca, long, count)?;

    // Every glyph used, with the glyphs composite glyphs are made of.
    let mut keep: BTreeSet<u16> = used
        .iter()
        .copied()
        .filter(|g| usize::from(*g) < count)
        .collect();
    keep.insert(0);
    let mut todo: Vec<u16> = keep.iter().copied().collect();
    while let Some(gid) = todo.pop() {
        let (start, end) = ranges[usize::from(gid)];
        if let Some(bytes) = glyf.get(start..end) {
            for c in components(bytes) {
                if usize::from(c) < count && keep.insert(c) {
                    todo.push(c);
                }
            }
        }
    }

    let mut new_glyf = Vec::new();
    let mut new_loca = Vec::with_capacity((count + 1) * 4);
    for (gid, (start, end)) in ranges.iter().enumerate() {
        new_loca.extend_from_slice(&(new_glyf.len() as u32).to_be_bytes());
        if keep.contains(&(gid as u16)) && end > start {
            new_glyf.extend_from_slice(glyf.get(*start..*end)?);
            while new_glyf.len() % 4 != 0 {
                new_glyf.push(0);
            }
        }
    }
    new_loca.extend_from_slice(&(new_glyf.len() as u32).to_be_bytes());

    let mut new_head = head.to_vec();
    new_head.get_mut(8..12)?.copy_from_slice(&[0, 0, 0, 0]);
    new_head
        .get_mut(50..52)?
        .copy_from_slice(&1u16.to_be_bytes());

    let mut tables: BTreeMap<[u8; 4], Vec<u8>> = BTreeMap::new();
    tables.insert(*b"glyf", new_glyf);
    tables.insert(*b"head", new_head);
    tables.insert(*b"loca", new_loca);
    for tag in [
        b"hhea", b"hmtx", b"maxp", b"cvt ", b"fpgm", b"prep", b"OS/2", b"post",
    ] {
        if let Some(data) = table(tag) {
            tables.insert(*tag, data.to_vec());
        }
    }
    // The PDF names glyphs by number; a one-entry cmap keeps strict readers content.
    tables.insert(*b"cmap", empty_cmap());

    let n = tables.len() as u16;
    let mut out = Vec::new();
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    out.extend_from_slice(&n.to_be_bytes());
    let mut power = 1u16;
    let mut log = 0u16;
    while power * 2 <= n {
        power *= 2;
        log += 1;
    }
    out.extend_from_slice(&(power * 16).to_be_bytes());
    out.extend_from_slice(&log.to_be_bytes());
    out.extend_from_slice(&(n * 16 - power * 16).to_be_bytes());
    let mut offset = 12 + 16 * usize::from(n);
    let mut body = Vec::new();
    for (tag, data) in &tables {
        out.extend_from_slice(tag);
        out.extend_from_slice(&checksum(data).to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        body.extend_from_slice(data);
        while body.len() % 4 != 0 {
            body.push(0);
        }
        offset = 12 + 16 * usize::from(n) + body.len();
    }
    out.extend_from_slice(&body);
    // head.checkSumAdjustment, over the whole file.
    let head_offset = {
        let index = tables.keys().position(|t| t == b"head")?;
        be32(&out, 12 + 16 * index + 8)? as usize
    };
    let adjust = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
    out.get_mut(head_offset + 8..head_offset + 12)?
        .copy_from_slice(&adjust.to_be_bytes());
    Some(out)
}

/// A format 4 cmap with only the closing segment.
fn empty_cmap() -> Vec<u8> {
    let mut c = Vec::new();
    for v in [0u16, 1, 3, 1] {
        c.extend_from_slice(&v.to_be_bytes());
    }
    c.extend_from_slice(&12u32.to_be_bytes());
    // format 4, length 24, language 0, segCountX2 2, searchRange 2, entrySelector 0, rangeShift 0
    for v in [4u16, 24, 0, 2, 2, 0, 0, 0xFFFF, 0, 0xFFFF, 1, 0] {
        c.extend_from_slice(&v.to_be_bytes());
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composite_glyph_components_are_found() {
        // numberOfContours -1, bbox, then two components (words args, more, then last).
        let mut g = vec![0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0];
        g.extend_from_slice(&[0x00, 0x21, 0x00, 0x05, 0, 0, 0, 0]);
        g.extend_from_slice(&[0x00, 0x00, 0x00, 0x07, 0, 0]);
        assert_eq!(components(&g), vec![5, 7]);
    }

    #[test]
    fn a_subset_is_a_readable_font_with_the_glyphs_used() {
        let set = FontSet::system();
        let Some(font) = set.regular.first() else {
            return; // no system font on this computer: nothing to test
        };
        let (gid, advance) = font.glyph('A').unwrap();
        let used: BTreeSet<u16> = [gid].into_iter().collect();
        let data = font.subset(&used).unwrap();
        let face = Face::parse(&data, 0).unwrap();
        assert_eq!(face.number_of_glyphs(), font.glyph_count);
        assert_eq!(
            face.glyph_hor_advance(ttf_parser::GlyphId(gid)),
            Some(advance)
        );
        assert!(face
            .outline_glyph(ttf_parser::GlyphId(gid), &mut Sink)
            .is_some());
        assert!(data.len() < 2_000_000);
    }

    struct Sink;
    impl ttf_parser::OutlineBuilder for Sink {
        fn move_to(&mut self, _: f32, _: f32) {}
        fn line_to(&mut self, _: f32, _: f32) {}
        fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {}
        fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {}
        fn close(&mut self) {}
    }
}
