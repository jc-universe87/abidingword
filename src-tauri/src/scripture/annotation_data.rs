//! What an annotation's `data` column holds (docs/scripture-annotations-v0.5.md).
//!
//! A highlight's colour and, for a phrase highlight or phrase note, the
//! anchor that ties it to exact wording. The anchor is built here from the
//! stored verse text, never taken from the interface as given: offsets are
//! checked, the quote is rebuilt and compared, and each covered verse is
//! hashed. A phrase is later drawn only where a translation's text hashes
//! identically, so different wording is never marked by guesswork.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult, UserMessage};
use crate::library::files::content_hash;

/// Version of the `data` JSON shape.
pub const DATA_VERSION: u32 = 1;

/// Highlight colours: visual names only, no meaning attached.
pub const HIGHLIGHT_COLORS: [&str; 5] = ["amber", "green", "blue", "rose", "grey"];

/// The colour of a highlight that has none stored (every v0.2 highlight).
pub const DEFAULT_HIGHLIGHT_COLOR: &str = "amber";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationData {
    pub v: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<StoredAnchor>,
}

/// A position in one verse's stored text. `offset` counts UTF-16 code
/// units (JavaScript string indexes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorPoint {
    /// Verse key, BBCCCVVV.
    pub verse: i64,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerseHash {
    pub verse: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAnchor {
    pub start: AnchorPoint,
    /// End position, exclusive.
    pub end: AnchorPoint,
    /// The selected words: each covered verse's selected part, joined with
    /// one space.
    pub quote: String,
    /// Every covered verse the translation had, with the hash of its
    /// complete stored text.
    pub verses: Vec<VerseHash>,
    /// Provenance, kept if the translation is removed.
    pub translation_short_name: String,
}

impl StoredAnchor {
    /// Same marked words in the same wording (provenance aside).
    pub fn same_place(&self, other: &StoredAnchor) -> bool {
        self.start == other.start && self.end == other.end && self.verses == other.verses
    }
}

impl AnnotationData {
    /// Reads a stored value. NULL or empty is valid (no colour, no anchor).
    /// A value that cannot be read is logged and treated as empty, so one
    /// damaged row never hides a chapter's other annotations.
    pub fn read(raw: Option<&str>) -> Self {
        match raw.map(str::trim).filter(|s| !s.is_empty()) {
            None => Self::default(),
            Some(text) => match serde_json::from_str::<Self>(text) {
                Ok(data) if data.v == DATA_VERSION => data,
                Ok(data) => {
                    log::warn!("annotation data version {} is not understood", data.v);
                    Self::default()
                }
                Err(error) => {
                    log::warn!("annotation data could not be read: {error}");
                    Self::default()
                }
            },
        }
    }

    /// The value to store; `None` when there is nothing to keep.
    pub fn to_stored(&self) -> Option<String> {
        if self.color.is_none() && self.anchor.is_none() {
            return None;
        }
        let data = Self {
            v: DATA_VERSION,
            ..self.clone()
        };
        Some(serde_json::to_string(&data).expect("annotation data serialises"))
    }
}

pub fn validate_color(color: &str) -> AppResult<()> {
    if HIGHLIGHT_COLORS.contains(&color) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(
            UserMessage::new(
                "invalidChoice",
                format!("“{color}” is not one of the highlight colours."),
            )
            .with("value", color),
        ))
    }
}

/// Length in UTF-16 code units.
pub fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

/// Byte index of a UTF-16 offset, or `None` if it lies beyond the text or
/// inside a character (between the halves of a surrogate pair).
pub fn utf16_to_byte(text: &str, offset: u32) -> Option<usize> {
    let mut units = 0u32;
    for (byte, ch) in text.char_indices() {
        if units == offset {
            return Some(byte);
        }
        units += ch.len_utf16() as u32;
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(text.len())
}

/// SHA-256 of a verse's stored text, lower-case hex.
pub fn verse_hash(text: &str) -> String {
    content_hash(text.as_bytes())
}

/// Builds an anchor from one translation's stored text.
///
/// `texts` holds (verse key, text) for every verse of the translation from
/// `start.verse` to `end.verse`, in order. Both ends must be among them,
/// each end must select something in its verse, and the offsets must fall
/// on character boundaries.
pub fn build_anchor(
    texts: &[(i64, String)],
    start: AnchorPoint,
    end: AnchorPoint,
    translation_short_name: &str,
) -> AppResult<StoredAnchor> {
    let mismatch = || {
        AppError::InvalidInput(UserMessage::new(
            "annotations.wordingMismatch",
            "The selected words do not match the text of this translation.",
        ))
    };
    if end.verse < start.verse || (end.verse == start.verse && end.offset <= start.offset) {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.nothingSelected",
            "Nothing is selected.",
        )));
    }
    let covered: Vec<&(i64, String)> = texts
        .iter()
        .filter(|(key, _)| (start.verse..=end.verse).contains(key))
        .collect();
    let first = covered.first().ok_or_else(mismatch)?;
    let last = covered.last().ok_or_else(mismatch)?;
    if first.0 != start.verse || last.0 != end.verse {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.noText",
            "This translation has no text for the selected verse.",
        )));
    }
    // Each end must select at least one character of its own verse.
    if start.offset >= utf16_len(&first.1) || end.offset == 0 {
        return Err(mismatch());
    }

    let mut parts = Vec::with_capacity(covered.len());
    for (key, text) in &covered {
        let from = if *key == start.verse { start.offset } else { 0 };
        let to = if *key == end.verse {
            end.offset
        } else {
            utf16_len(text)
        };
        let a = utf16_to_byte(text, from).ok_or_else(mismatch)?;
        let b = utf16_to_byte(text, to).ok_or_else(mismatch)?;
        if a > b {
            return Err(mismatch());
        }
        let part = &text[a..b];
        if !part.is_empty() {
            parts.push(part);
        }
    }
    let quote = parts.join(" ");
    if quote.trim().is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "annotations.nothingSelected",
            "Nothing is selected.",
        )));
    }
    Ok(StoredAnchor {
        start,
        end,
        quote,
        verses: covered
            .iter()
            .map(|(verse, text)| VerseHash {
                verse: *verse,
                sha256: verse_hash(text),
            })
            .collect(),
        translation_short_name: translation_short_name.into(),
    })
}

/// Whether a translation's text is the exact wording the anchor was made
/// on: the same covered verses, each with an identical hash. `texts` holds
/// that translation's verses from the anchor's start to its end verse.
pub fn wording_matches(anchor: &StoredAnchor, texts: &[(i64, String)]) -> bool {
    let covered: Vec<&(i64, String)> = texts
        .iter()
        .filter(|(key, _)| (anchor.start.verse..=anchor.end.verse).contains(key))
        .collect();
    covered.len() == anchor.verses.len()
        && covered
            .iter()
            .zip(&anchor.verses)
            .all(|((key, text), hash)| *key == hash.verse && verse_hash(text) == hash.sha256)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(verse: i64, offset: u32) -> AnchorPoint {
        AnchorPoint { verse, offset }
    }

    fn texts(list: &[(i64, &str)]) -> Vec<(i64, String)> {
        list.iter().map(|(k, t)| (*k, (*t).to_string())).collect()
    }

    #[test]
    fn utf16_offsets_follow_javascript_indexes() {
        // "é" is one unit; "𝔊" (U+1D50A) is a surrogate pair: two units.
        let text = "é𝔊a";
        assert_eq!(utf16_len(text), 4);
        assert_eq!(utf16_to_byte(text, 0), Some(0));
        assert_eq!(utf16_to_byte(text, 1), Some(2));
        assert_eq!(utf16_to_byte(text, 2), None, "inside the surrogate pair");
        assert_eq!(utf16_to_byte(text, 3), Some(6));
        assert_eq!(utf16_to_byte(text, 4), Some(7));
        assert_eq!(utf16_to_byte(text, 5), None, "beyond the end");
    }

    #[test]
    fn builds_an_anchor_within_one_verse() {
        let t = texts(&[(43015004, "Remain in me, and I in you.")]);
        let anchor = build_anchor(&t, p(43015004, 0), p(43015004, 12), "WEB").unwrap();
        assert_eq!(anchor.quote, "Remain in me");
        assert_eq!(anchor.verses.len(), 1);
        assert_eq!(
            anchor.verses[0].sha256,
            verse_hash("Remain in me, and I in you.")
        );
        assert_eq!(anchor.translation_short_name, "WEB");
    }

    #[test]
    fn builds_an_anchor_across_verses() {
        let t = texts(&[
            (43015004, "Remain in me."),
            (43015005, "I am the vine."),
            (43015006, "If a man does not remain."),
        ]);
        let anchor = build_anchor(&t, p(43015004, 7), p(43015006, 8), "WEB").unwrap();
        assert_eq!(anchor.quote, "in me. I am the vine. If a man");
        assert_eq!(anchor.verses.len(), 3);
    }

    #[test]
    fn handles_punctuation_and_non_ascii() {
        let t = texts(&[(19023001, "«Yahweh» is my shepherd—I shall lack nothing.")]);
        let anchor = build_anchor(&t, p(19023001, 0), p(19023001, 8), "X").unwrap();
        assert_eq!(anchor.quote, "«Yahweh»");
        let t = texts(&[(1001001, "In the beginning 𝔊od created")]);
        let anchor = build_anchor(&t, p(1001001, 17), p(1001001, 21), "X").unwrap();
        assert_eq!(anchor.quote, "𝔊od");
        assert!(build_anchor(&t, p(1001001, 18), p(1001001, 21), "X").is_err());
    }

    #[test]
    fn refuses_bad_ranges() {
        let t = texts(&[(43015004, "Remain in me."), (43015005, "I am the vine.")]);
        // Empty or reversed.
        assert!(build_anchor(&t, p(43015004, 3), p(43015004, 3), "X").is_err());
        assert!(build_anchor(&t, p(43015005, 0), p(43015004, 3), "X").is_err());
        // Beyond the verse.
        assert!(build_anchor(&t, p(43015004, 0), p(43015004, 99), "X").is_err());
        // Start at the very end of its verse, end at the very start of its.
        assert!(build_anchor(&t, p(43015004, 13), p(43015005, 4), "X").is_err());
        assert!(build_anchor(&t, p(43015004, 0), p(43015005, 0), "X").is_err());
        // A verse the translation lacks.
        assert!(build_anchor(&t, p(43015006, 0), p(43015006, 2), "X").is_err());
        // Whitespace only.
        let t = texts(&[(43015004, "a   b")]);
        assert!(build_anchor(&t, p(43015004, 1), p(43015004, 4), "X").is_err());
    }

    #[test]
    fn wording_must_match_exactly() {
        let a = texts(&[(43015004, "Remain in me."), (43015005, "I am the vine.")]);
        let anchor = build_anchor(&a, p(43015004, 0), p(43015005, 4), "A").unwrap();
        assert!(wording_matches(&anchor, &a));
        let other = texts(&[(43015004, "Abide in me."), (43015005, "I am the vine.")]);
        assert!(!wording_matches(&anchor, &other));
        let missing = texts(&[(43015005, "I am the vine.")]);
        assert!(!wording_matches(&anchor, &missing));
        let spaced = texts(&[(43015004, "Remain in me. "), (43015005, "I am the vine.")]);
        assert!(
            !wording_matches(&anchor, &spaced),
            "strict: whitespace counts"
        );
    }

    #[test]
    fn data_reads_leniently_and_stores_only_what_matters() {
        assert_eq!(AnnotationData::read(None), AnnotationData::default());
        assert_eq!(AnnotationData::read(Some("")), AnnotationData::default());
        assert_eq!(
            AnnotationData::read(Some("{oops")),
            AnnotationData::default()
        );
        assert_eq!(
            AnnotationData::read(Some(r#"{"v":9,"color":"amber"}"#)),
            AnnotationData::default()
        );
        assert_eq!(AnnotationData::default().to_stored(), None);
        let data = AnnotationData {
            v: 0,
            color: Some("rose".into()),
            anchor: None,
        };
        let stored = data.to_stored().unwrap();
        assert_eq!(stored, r#"{"v":1,"color":"rose"}"#);
        assert_eq!(
            AnnotationData::read(Some(&stored)).color.as_deref(),
            Some("rose")
        );
    }

    #[test]
    fn only_the_five_colours() {
        for c in HIGHLIGHT_COLORS {
            validate_color(c).unwrap();
        }
        assert!(validate_color("yellow").is_err());
        assert!(validate_color("").is_err());
    }
}
