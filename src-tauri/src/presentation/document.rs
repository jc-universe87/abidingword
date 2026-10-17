//! The one pipeline: Teaching → presentation → [`PresentationDocument`].
//! The live Presenter View, the audience screen, PowerPoint, PDF, Markdown
//! and the delivery package are all made from this document, so they show
//! the same slides in the same order with the same words.
//!
//! The document resolves every live link at the moment it is built (the
//! teaching's current wording, the Scripture text from an installed Bible,
//! the local copy of each image). Saved as a delivery package it is a
//! snapshot: self-contained, deterministic and readable without the
//! desktop database.

use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::images::{self, ImageStore};
use crate::db::{bibles, findings, presentations, settings, teaching};
use crate::domain::{
    ItemSource, Presentation, PresentationItem, TeachingMaterial, TeachingPreparation,
};
use crate::error::AppResult;
use crate::scripture::reference::ScriptureRef;
use crate::scripture::BibleTranslation;

pub const FORMAT: &str = "abiding-word/presentation";
/// Raised whenever a reader of an older version could misread the document.
pub const SCHEMA_VERSION: u32 = 1;

/// A long passage is shown over several slides of about this many
/// characters, never splitting a verse, so the audience text stays large.
pub const SCRIPTURE_SLIDE_CHARS: usize = 600;
/// Above this the audience text of one slide is too long to read.
pub const LONG_TEXT_CHARS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresentationDocument {
    pub format: String,
    pub schema_version: u32,
    pub presentation_id: String,
    pub teaching_id: String,
    pub title: String,
    pub teaching_kind: Option<String>,
    /// light, dark or warm.
    pub theme: String,
    pub primary_passage: Option<RefInfo>,
    /// The Bible the Scripture slides quote.
    pub bible: Option<BibleInfo>,
    /// When the presentation and the teaching were last changed: the
    /// document is the same for the same content.
    pub presentation_updated_at: String,
    pub teaching_updated_at: String,
    pub slides: Vec<Slide>,
    pub images: Vec<ImageAsset>,
    pub warnings: Vec<DocWarning>,
}

/// A canonical reference with its parts (each reader writes it in its
/// own language).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub canonical: String,
    pub book: String,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
}

impl RefInfo {
    pub fn of(reference: &ScriptureRef) -> Self {
        let dto = reference.to_dto();
        Self {
            canonical: dto.canonical,
            book: dto.book.to_string(),
            start_chapter: dto.start_chapter,
            start_verse: dto.start_verse,
            end_chapter: dto.end_chapter,
            end_verse: dto.end_verse,
        }
    }

    fn of_canonical(value: &str) -> Option<Self> {
        ScriptureRef::from_canonical(value)
            .ok()
            .map(|r| Self::of(&r))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BibleInfo {
    pub id: String,
    pub name: String,
    pub short_name: String,
    pub copyright: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    /// The item's id, with `#2`, `#3`… for the further slides of a long passage.
    pub id: String,
    pub item_id: String,
    pub index: usize,
    /// 1 for the first slide of an item; then 2, 3…
    pub part: usize,
    pub parts: usize,
    pub kind: String,
    /// What the audience sees. Nothing else is ever shown to them.
    pub audience: AudienceSlide,
    /// What only the speaker sees.
    pub speaker: SpeakerSlide,
    /// Where things on this slide come from (for the speaker and exports
    /// that ask for them; never on the audience screen).
    pub citations: Vec<Citation>,
    pub source: Option<ItemSource>,
    /// The part of the teaching it followed has been removed.
    pub source_missing: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudienceSlide {
    pub heading: Option<String>,
    pub body: Option<String>,
    /// On a title slide, the main passage; on a Scripture slide, the passage
    /// (or the part of it) shown.
    pub reference: Option<RefInfo>,
    pub verses: Vec<SlideVerse>,
    /// The Bible quoted (short name), on a Scripture slide.
    pub bible: Option<String>,
    pub image: Option<SlideImage>,
    /// A pause: an empty audience screen.
    pub blank: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlideVerse {
    pub chapter: u16,
    pub verse: u16,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlideImage {
    pub asset_id: String,
    pub caption: Option<String>,
    /// The credit a licence asks for (author, licence): shown with the image.
    pub credit: Option<String>,
    /// Made by an image generator: always said, never shown as a photograph.
    pub generated: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerSlide {
    /// The teaching's own words for this part (explanation, application…),
    /// each with the name of its field.
    pub manuscript: Vec<ManuscriptPart>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManuscriptPart {
    /// introduction, conclusion, explanation, application, illustration,
    /// standing (for kept material: how far it can be relied on).
    pub field: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    /// source, image or bible.
    pub kind: String,
    pub title: String,
    pub url: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageAsset {
    /// The kept material's id.
    pub id: String,
    pub media_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// A copy is on this computer (or in the package).
    pub available: bool,
    pub sha256: Option<String>,
    /// The image itself, base64 — only in a delivery package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocWarning {
    pub slide_id: Option<String>,
    /// scriptureUnavailable, imageUnavailable, sourceMissing, longText, noBible.
    pub code: String,
}

/// Builds the document of one presentation from its teaching as it is now.
pub fn build(conn: &Connection, id: &str, store: &ImageStore) -> AppResult<PresentationDocument> {
    let presentation = presentations::get(conn, id)?;
    let prep = teaching::get(conn, &presentation.preparation_id)?;
    let bible = choose_bible(conn, &presentation)?;
    let mut builder = Builder {
        conn,
        prep: &prep,
        store,
        bible: bible.as_ref(),
        slides: Vec::new(),
        images: BTreeMap::new(),
        warnings: Vec::new(),
    };
    if bible.is_none() {
        builder.warn(None, "noBible");
    }
    for item in presentation.items.iter().filter(|i| !i.skipped) {
        builder.item(item)?;
    }
    let Builder {
        slides,
        images,
        warnings,
        ..
    } = builder;
    let primary_passage = prep
        .passages
        .iter()
        .find(|p| p.point_id.is_none())
        .and_then(|p| RefInfo::of_canonical(&p.reference.canonical));
    Ok(PresentationDocument {
        format: FORMAT.to_string(),
        schema_version: SCHEMA_VERSION,
        presentation_id: presentation.id,
        teaching_id: prep.id.clone(),
        title: presentation.title,
        teaching_kind: prep.kind.clone(),
        theme: presentation.theme,
        primary_passage,
        bible: bible.map(|b| BibleInfo {
            id: b.id,
            name: b.name,
            short_name: b.short_name,
            copyright: b.copyright_notice,
        }),
        presentation_updated_at: presentation.updated_at,
        teaching_updated_at: prep.updated_at.clone(),
        slides,
        images: images.into_values().collect(),
        warnings,
    })
}

/// The presentation's own Bible, else the Scripture pane's, else the first
/// installed one with verses.
fn choose_bible(
    conn: &Connection,
    presentation: &Presentation,
) -> AppResult<Option<BibleTranslation>> {
    let all = bibles::list(conn)?;
    let usable = |id: &str| {
        all.iter()
            .find(|b| b.id == id && b.verse_count > 0)
            .cloned()
    };
    let preferred = presentation
        .translation_id
        .clone()
        .or(settings::get(conn)?.scripture_translation_id);
    Ok(preferred
        .as_deref()
        .and_then(usable)
        .or_else(|| all.iter().find(|b| b.verse_count > 0).cloned()))
}

struct Builder<'a> {
    conn: &'a Connection,
    prep: &'a TeachingPreparation,
    store: &'a ImageStore,
    bible: Option<&'a BibleTranslation>,
    slides: Vec<Slide>,
    images: BTreeMap<String, ImageAsset>,
    warnings: Vec<DocWarning>,
}

/// What a source says, before the person's own wording is put over it.
#[derive(Default)]
struct Resolved {
    heading: Option<String>,
    body: Option<String>,
    reference: Option<String>,
    manuscript: Vec<ManuscriptPart>,
    citations: Vec<Citation>,
    image: Option<SlideImage>,
    missing: bool,
}

fn text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn part(field: &str, value: &str) -> Option<ManuscriptPart> {
    text(value).map(|text| ManuscriptPart {
        field: field.to_string(),
        text,
    })
}

impl Builder<'_> {
    fn warn(&mut self, slide_id: Option<&str>, code: &str) {
        self.warnings.push(DocWarning {
            slide_id: slide_id.map(str::to_string),
            code: code.to_string(),
        });
    }

    fn resolve(&mut self, item: &PresentationItem) -> AppResult<Resolved> {
        let Some(source) = &item.source else {
            return Ok(Resolved::default());
        };
        let prep = self.prep;
        let missing = || Resolved {
            missing: true,
            ..Resolved::default()
        };
        Ok(match source.kind.as_str() {
            "preparation" => match source.field.as_deref().unwrap_or("title") {
                "title" => Resolved {
                    heading: text(&prep.title),
                    reference: prep
                        .passages
                        .iter()
                        .find(|p| p.point_id.is_none())
                        .map(|p| p.reference.canonical.clone()),
                    ..Resolved::default()
                },
                "central_message" => Resolved {
                    body: prep.central_message.as_deref().and_then(text),
                    ..Resolved::default()
                },
                field @ ("introduction" | "conclusion") => {
                    let value = if field == "introduction" {
                        &prep.introduction
                    } else {
                        &prep.conclusion
                    };
                    Resolved {
                        manuscript: part(field, value).into_iter().collect(),
                        ..Resolved::default()
                    }
                }
                _ => missing(),
            },
            "point" => match prep.points.iter().find(|p| p.id == source.id) {
                Some(point) => {
                    let manuscript = [
                        part("explanation", &point.explanation),
                        part("application", &point.application),
                        part("illustration", &point.illustration),
                    ]
                    .into_iter()
                    .flatten()
                    .collect();
                    // A question slide asks the point's own question.
                    if item.kind == "question" {
                        Resolved {
                            body: text(&point.title),
                            manuscript,
                            ..Resolved::default()
                        }
                    } else {
                        Resolved {
                            heading: text(&point.title),
                            manuscript,
                            ..Resolved::default()
                        }
                    }
                }
                None => missing(),
            },
            "passage" => match prep.passages.iter().find(|p| p.id == source.id) {
                Some(passage) => Resolved {
                    reference: Some(passage.reference.canonical.clone()),
                    ..Resolved::default()
                },
                None => missing(),
            },
            "material" => match prep.materials.iter().find(|m| m.id == source.id) {
                Some(material) => self.material(material),
                None => missing(),
            },
            "finding" => match findings::get(self.conn, &source.id) {
                Ok(finding) if finding.study_id == prep.study_id => Resolved {
                    body: text(&finding.content),
                    ..Resolved::default()
                },
                _ => missing(),
            },
            _ => missing(),
        })
    }

    fn material(&mut self, material: &TeachingMaterial) -> Resolved {
        let citations: Vec<Citation> = material
            .sources
            .iter()
            .map(|s| Citation {
                kind: "source".to_string(),
                title: text(&s.title).or_else(|| text(&s.site)).unwrap_or_default(),
                url: text(&s.url),
                detail: text(&s.site),
            })
            .collect();
        let standing = part("standing", &material.standing);
        if material.kind != "image" {
            return Resolved {
                heading: None,
                body: text(&material.content),
                manuscript: standing.into_iter().collect(),
                citations,
                ..Resolved::default()
            };
        }
        let info = material.image.clone().unwrap_or_default();
        let generated = material.standing == "generated";
        let credit = if generated {
            None
        } else {
            info.attribution.as_deref().and_then(text).or_else(|| {
                let parts: Vec<String> = [info.author.clone(), info.licence.clone()]
                    .into_iter()
                    .flatten()
                    .filter_map(|p| text(&p))
                    .collect();
                (!parts.is_empty()).then(|| parts.join(" · "))
            })
        };
        let mut citations = citations;
        if !generated {
            citations.push(Citation {
                kind: "image".to_string(),
                title: text(&material.title).unwrap_or_default(),
                url: info.page_url.clone().or(info.url.clone()),
                detail: credit.clone(),
            });
        }
        self.images
            .entry(material.id.clone())
            .or_insert_with(|| asset(material, self.store));
        Resolved {
            image: Some(SlideImage {
                asset_id: material.id.clone(),
                caption: text(&material.title),
                credit,
                generated,
            }),
            citations,
            ..Resolved::default()
        }
    }

    fn item(&mut self, item: &PresentationItem) -> AppResult<()> {
        let resolved = self.resolve(item)?;
        let heading = match &item.heading {
            Some(own) => text(own),
            None => resolved.heading,
        };
        let body = match &item.body {
            Some(own) => text(own),
            None => resolved.body,
        };
        let reference = item
            .reference
            .clone()
            .or(resolved.reference)
            .and_then(|r| ScriptureRef::from_canonical(&r).ok());
        let speaker = SpeakerSlide {
            manuscript: resolved.manuscript,
            notes: item.notes.trim().to_string(),
        };
        let mut citations = resolved.citations;
        let image = resolved.image;
        if let Some(image) = &image {
            if !self
                .images
                .get(&image.asset_id)
                .is_some_and(|a| a.available)
            {
                self.warn(Some(&item.id), "imageUnavailable");
            }
        }
        if resolved.missing {
            self.warn(Some(&item.id), "sourceMissing");
        }
        let base = Slide {
            id: item.id.clone(),
            item_id: item.id.clone(),
            index: 0,
            part: 1,
            parts: 1,
            kind: item.kind.clone(),
            audience: AudienceSlide::default(),
            speaker,
            citations: Vec::new(),
            source: item.source.clone(),
            source_missing: resolved.missing,
        };

        if item.kind == "pause" {
            self.push(Slide {
                audience: AudienceSlide {
                    blank: true,
                    ..AudienceSlide::default()
                },
                ..base
            });
            return Ok(());
        }

        if item.kind == "scripture" {
            let Some(reference) = reference else {
                self.push(Slide {
                    audience: AudienceSlide {
                        heading,
                        body,
                        ..AudienceSlide::default()
                    },
                    ..base
                });
                return Ok(());
            };
            let verses = match self.bible {
                Some(bible) => bibles::passage(self.conn, &bible.id, &reference)
                    .map(|p| p.verses)
                    .unwrap_or_default(),
                None => Vec::new(),
            };
            if verses.is_empty() {
                self.warn(Some(&item.id), "scriptureUnavailable");
            }
            if let Some(bible) = self.bible {
                citations.push(Citation {
                    kind: "bible".to_string(),
                    title: bible.name.clone(),
                    url: None,
                    detail: bible.copyright_notice.clone(),
                });
            }
            let groups = split_verses(
                verses
                    .into_iter()
                    .map(|v| SlideVerse {
                        chapter: v.chapter,
                        verse: v.verse,
                        text: v.text,
                    })
                    .collect(),
            );
            let parts = groups.len().max(1);
            let bible = self.bible.map(|b| b.short_name.clone());
            if groups.is_empty() {
                self.push(Slide {
                    citations,
                    audience: AudienceSlide {
                        heading,
                        body,
                        reference: Some(RefInfo::of(&reference)),
                        bible,
                        ..AudienceSlide::default()
                    },
                    ..base
                });
                return Ok(());
            }
            for (n, group) in groups.into_iter().enumerate() {
                // Each slide names the verses it shows.
                let shown = if parts == 1 {
                    RefInfo::of(&reference)
                } else {
                    part_reference(&reference, &group)
                };
                let first = n == 0;
                self.push(Slide {
                    id: if first {
                        item.id.clone()
                    } else {
                        format!("{}#{}", item.id, n + 1)
                    },
                    part: n + 1,
                    parts,
                    citations: citations.clone(),
                    // The speaker's text goes with the first slide.
                    speaker: if first {
                        base.speaker.clone()
                    } else {
                        SpeakerSlide::default()
                    },
                    audience: AudienceSlide {
                        heading: heading.clone(),
                        body: if first { body.clone() } else { None },
                        reference: Some(shown),
                        verses: group,
                        bible: bible.clone(),
                        ..AudienceSlide::default()
                    },
                    ..base.clone()
                });
            }
            return Ok(());
        }

        let long = body
            .as_deref()
            .is_some_and(|b| b.chars().count() > LONG_TEXT_CHARS);
        let reference = (item.kind == "title").then_some(reference).flatten();
        self.push(Slide {
            citations,
            audience: AudienceSlide {
                heading,
                body,
                reference: reference.as_ref().map(RefInfo::of),
                image: if item.kind == "image" { image } else { None },
                ..AudienceSlide::default()
            },
            ..base
        });
        if long {
            self.warn(Some(&item.id), "longText");
        }
        Ok(())
    }

    fn push(&mut self, mut slide: Slide) {
        slide.index = self.slides.len();
        self.slides.push(slide);
    }
}

fn asset(material: &TeachingMaterial, store: &ImageStore) -> ImageAsset {
    let file = store.path_for(material).and_then(|p| images::read_file(&p));
    match file {
        Some((bytes, header)) => ImageAsset {
            id: material.id.clone(),
            media_type: Some(header.media_type.to_string()),
            width: Some(header.width),
            height: Some(header.height),
            available: true,
            sha256: Some(images::sha256_hex(&bytes)),
            data: None,
        },
        None => ImageAsset {
            id: material.id.clone(),
            media_type: None,
            width: None,
            height: None,
            available: false,
            sha256: None,
            data: None,
        },
    }
}

/// Splits a passage into slides of about [`SCRIPTURE_SLIDE_CHARS`]
/// characters, whole verses only.
pub fn split_verses(verses: Vec<SlideVerse>) -> Vec<Vec<SlideVerse>> {
    let mut groups: Vec<Vec<SlideVerse>> = Vec::new();
    let mut size = 0;
    for verse in verses {
        let len = verse.text.chars().count();
        match groups.last_mut() {
            Some(group) if size + len <= SCRIPTURE_SLIDE_CHARS => {
                size += len;
                group.push(verse);
            }
            _ => {
                size = len;
                groups.push(vec![verse]);
            }
        }
    }
    groups
}

fn part_reference(whole: &ScriptureRef, verses: &[SlideVerse]) -> RefInfo {
    let mut info = RefInfo::of(whole);
    if let (Some(first), Some(last)) = (verses.first(), verses.last()) {
        info.start_chapter = first.chapter;
        info.start_verse = Some(first.verse);
        info.end_chapter = last.chapter;
        info.end_verse = Some(last.verse);
        info.canonical = if first.chapter == last.chapter && first.verse == last.verse {
            format!("{}.{}.{}", info.book, first.chapter, first.verse)
        } else {
            format!(
                "{b}.{}.{}-{b}.{}.{}",
                first.chapter,
                first.verse,
                last.chapter,
                last.verse,
                b = info.book
            )
        };
    }
    info
}

// ---------------------------------------------------------------------------
// What the audience screen is given
// ---------------------------------------------------------------------------

/// The audience screen's document. A separate type with no speaker text,
/// notes or citations at all, so they cannot reach the audience by mistake.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudienceDocument {
    pub format: String,
    pub schema_version: u32,
    pub presentation_id: String,
    pub title: String,
    pub theme: String,
    pub slides: Vec<AudienceOnlySlide>,
    pub images: Vec<ImageAsset>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudienceOnlySlide {
    pub id: String,
    pub index: usize,
    pub kind: String,
    pub audience: AudienceSlide,
}

impl PresentationDocument {
    pub fn audience(&self) -> AudienceDocument {
        let used: std::collections::BTreeSet<&str> = self
            .slides
            .iter()
            .filter_map(|s| s.audience.image.as_ref().map(|i| i.asset_id.as_str()))
            .collect();
        AudienceDocument {
            format: FORMAT.to_string(),
            schema_version: SCHEMA_VERSION,
            presentation_id: self.presentation_id.clone(),
            title: self.title.clone(),
            theme: self.theme.clone(),
            slides: self
                .slides
                .iter()
                .map(|s| AudienceOnlySlide {
                    id: s.id.clone(),
                    index: s.index,
                    kind: s.kind.clone(),
                    audience: s.audience.clone(),
                })
                .collect(),
            images: self
                .images
                .iter()
                .filter(|i| used.contains(i.id.as_str()))
                .map(|i| ImageAsset {
                    data: None,
                    ..i.clone()
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(n: u16, len: usize) -> SlideVerse {
        SlideVerse {
            chapter: 1,
            verse: n,
            text: "a".repeat(len),
        }
    }

    #[test]
    fn long_passages_split_on_whole_verses() {
        let groups = split_verses(vec![
            verse(1, 300),
            verse(2, 250),
            verse(3, 100),
            verse(4, 900),
        ]);
        let sizes: Vec<Vec<u16>> = groups
            .iter()
            .map(|g| g.iter().map(|v| v.verse).collect())
            .collect();
        assert_eq!(sizes, vec![vec![1, 2], vec![3], vec![4]]);
        assert!(split_verses(Vec::new()).is_empty());
    }

    #[test]
    fn a_part_names_its_own_verses() {
        let whole = ScriptureRef::from_canonical("JHN.15.1-JHN.15.17").unwrap();
        let info = part_reference(&whole, &[verse(5, 1), verse(9, 1)]);
        assert_eq!(info.canonical, "JHN.1.5-JHN.1.9");
        assert_eq!(info.start_verse, Some(5));
    }
}
