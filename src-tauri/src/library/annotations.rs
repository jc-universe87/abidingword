//! Source annotations (v0.14): highlights, notes and bookmarks in a library
//! source. See docs/source-annotations-v0.14.md.
//!
//! They belong to the source document and are a separate model from
//! Scripture annotations (`scripture::annotation_data`), which belong to
//! canonical verses.
//!
//! **Identity is the stored text.** An annotation on words records the
//! segments and UTF-16 offsets of the selection, the selected words (the
//! quote) and the text just before and after them. Several segments are laid
//! end to end with one `"\n"` between them, so a selection across a paragraph
//! boundary has one quote, the same in every view. Views (Reading, Original
//! PDF, formatted EPUB/DOCX) find the words again whenever they draw; nothing
//! about a screen, a page rectangle or a zoom level is stored.
//!
//! This module is pure: the text laid on one line, range arithmetic and the
//! search used to find a quote again. The database side is
//! `db::source_annotations`.

use serde::{Deserialize, Serialize};

use crate::scripture::annotation_data::{utf16_len, utf16_to_byte};

pub const SOURCE_ANNOTATION_KINDS: [&str; 3] = ["highlight", "note", "bookmark"];

/// Characters of context kept before and after a quote.
pub const CONTEXT_CHARS: usize = 32;

/// Between the stored text of two consecutive segments, in a quote and on
/// the line used to search.
pub const SEGMENT_JOINER: &str = "\n";

/// How the stored anchor relates to the text now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnchorState {
    /// Found where it was stored.
    Exact,
    /// Found again, unambiguously, after the stored text changed.
    Moved,
    /// Not found without guessing; kept, listed, never drawn.
    Unresolved,
}

impl AnchorState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Moved => "moved",
            Self::Unresolved => "unresolved",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "moved" => Self::Moved,
            "unresolved" => Self::Unresolved,
            _ => Self::Exact,
        }
    }
}

/// One end of a selection, as the interface sends it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPoint {
    pub segment_id: String,
    /// UTF-16 units into the segment's stored text.
    pub offset: u32,
}

/// A place without selected words: a paragraph, or a page of an Original
/// PDF (with how far down it, 0..1).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaceInput {
    pub segment_id: Option<String>,
    pub page: Option<i64>,
    pub fraction: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateSourceAnnotation {
    pub source_id: String,
    pub kind: String,
    pub color: Option<String>,
    pub content: Option<String>,
    /// Selected words: both ends and the quote (segments joined with "\n").
    pub start: Option<TextPoint>,
    pub end: Option<TextPoint>,
    pub quote: Option<String>,
    /// Or a place, for a bookmark or a note without selected words.
    pub place: Option<PlaceInput>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateSourceAnnotation {
    pub id: String,
    pub content: Option<String>,
    pub color: Option<String>,
}

/// Where an annotation is now (current segment positions).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPoint {
    pub segment_id: String,
    pub position: i64,
    /// UTF-16 units; `None` for a place (no selected words).
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAnnotation {
    pub id: String,
    pub source_id: String,
    pub kind: String,
    pub color: Option<String>,
    pub content: String,
    pub quote: Option<String>,
    /// Start of the words (or the place); `None` when unresolved, or for a
    /// page of a PDF without text.
    pub start: Option<AnnotationPoint>,
    /// End of the words (exclusive); `None` for a place.
    pub end: Option<AnnotationPoint>,
    /// Reading position (current when found, else where it was).
    pub position: Option<i64>,
    pub page_number: Option<i64>,
    /// Height share of a place on an Original PDF page.
    pub fraction: Option<f64>,
    pub locator: Option<String>,
    pub section_path: Option<String>,
    pub state: AnchorState,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// Format-specific placement stored in `source_annotations.anchor`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PlaceDetails {
    pub v: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fraction: Option<f64>,
}

impl PlaceDetails {
    pub const VERSION: u32 = 1;

    pub fn read(stored: Option<&str>) -> Self {
        stored
            .and_then(|s| serde_json::from_str::<Self>(s).ok())
            .filter(|d| d.v == Self::VERSION)
            .unwrap_or_default()
    }

    pub fn is_empty(&self) -> bool {
        self.page.is_none() && self.fraction.is_none()
    }

    pub fn to_stored(&self) -> Option<String> {
        (!self.is_empty()).then(|| {
            serde_json::to_string(&Self {
                v: Self::VERSION,
                ..self.clone()
            })
            .expect("place details serialise")
        })
    }
}

/// One stored segment, in reading order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSegment {
    pub id: String,
    pub position: i64,
    pub text: String,
    pub page_number: Option<i64>,
    pub section_path: Option<String>,
    pub locator: Option<String>,
}

/// A point in the source's stored text: a segment index into a [`Line`]
/// and a UTF-16 offset into that segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct LinePoint {
    pub index: usize,
    pub offset: u32,
}

/// Consecutive segments laid end to end with [`SEGMENT_JOINER`] between
/// them: the text a quote is cut from and searched in.
pub struct Line<'a> {
    pub segments: &'a [StoredSegment],
    pub text: String,
    /// Byte where each segment starts in `text`.
    starts: Vec<usize>,
}

impl<'a> Line<'a> {
    pub fn new(segments: &'a [StoredSegment]) -> Self {
        let mut text = String::new();
        let mut starts = Vec::with_capacity(segments.len());
        for (i, segment) in segments.iter().enumerate() {
            if i > 0 {
                text.push_str(SEGMENT_JOINER);
            }
            starts.push(text.len());
            text.push_str(&segment.text);
        }
        Self {
            segments,
            text,
            starts,
        }
    }

    pub fn index_of(&self, segment_id: &str) -> Option<usize> {
        self.segments.iter().position(|s| s.id == segment_id)
    }

    /// The byte on the line of a point, or `None` if the offset is beyond
    /// its segment or inside a character.
    pub fn byte(&self, point: LinePoint) -> Option<usize> {
        let segment = self.segments.get(point.index)?;
        Some(self.starts[point.index] + utf16_to_byte(&segment.text, point.offset)?)
    }

    /// The point of a byte on the line that starts a range: a joiner byte
    /// belongs to the start of the next segment.
    fn start_point(&self, byte: usize) -> LinePoint {
        let index = match self.starts.binary_search(&byte) {
            Ok(i) => i,
            Err(i) => i - 1,
        };
        let within = byte - self.starts[index];
        let text = &self.segments[index].text;
        if within >= text.len() && index + 1 < self.segments.len() {
            return LinePoint {
                index: index + 1,
                offset: 0,
            };
        }
        LinePoint {
            index,
            offset: utf16_len(&text[..within]),
        }
    }

    /// The point of a byte on the line that ends a range (exclusive): the
    /// start of a segment is the end of the previous one.
    fn end_point(&self, byte: usize) -> LinePoint {
        let index = match self.starts.binary_search(&byte) {
            Ok(i) if i > 0 => i - 1,
            Ok(i) => i,
            Err(i) => i - 1,
        };
        let text = &self.segments[index].text;
        let within = (byte - self.starts[index]).min(text.len());
        LinePoint {
            index,
            offset: utf16_len(&text[..within]),
        }
    }

    /// The quote between two points, or `None` if either is invalid or they
    /// are out of order.
    pub fn quote(&self, start: LinePoint, end: LinePoint) -> Option<&str> {
        let (from, to) = (self.byte(start)?, self.byte(end)?);
        (from <= to).then(|| &self.text[from..to])
    }

    /// Up to [`CONTEXT_CHARS`] characters before `from` and after `to`
    /// (bytes on the line).
    pub fn context(&self, from: usize, to: usize) -> (String, String) {
        let before = &self.text[..from];
        let prefix_start = before
            .char_indices()
            .rev()
            .nth(CONTEXT_CHARS - 1)
            .map_or(0, |(i, _)| i);
        let after = &self.text[to..];
        let suffix_end = after
            .char_indices()
            .nth(CONTEXT_CHARS)
            .map_or(after.len(), |(i, _)| i);
        (
            before[prefix_start..].to_string(),
            after[..suffix_end].to_string(),
        )
    }

    /// The range trimmed of white space (and joiners) at both ends, as
    /// points; `None` if nothing visible is left.
    pub fn trimmed(&self, from: usize, to: usize) -> Option<(LinePoint, LinePoint)> {
        let slice = &self.text[from..to];
        let lead = slice.len() - slice.trim_start().len();
        let trail = slice.len() - slice.trim_end().len();
        if lead + trail >= slice.len() {
            return None;
        }
        Some((self.start_point(from + lead), self.end_point(to - trail)))
    }

    /// Every place `quote` occurs, as byte ranges on the line (overlapping
    /// occurrences included: each is a different place).
    pub fn occurrences(&self, quote: &str) -> Vec<(usize, usize)> {
        if quote.is_empty() {
            return Vec::new();
        }
        let mut found = Vec::new();
        let mut from = 0;
        while let Some(at) = self.text[from..].find(quote) {
            let start = from + at;
            found.push((start, start + quote.len()));
            from = start + self.text[start..].chars().next().map_or(1, char::len_utf8);
        }
        found
    }

    /// Whether the text before `from` agrees with a stored prefix. An empty
    /// prefix (the quote began the source) agrees only at the start.
    pub fn prefix_agrees(&self, from: usize, prefix: &str) -> bool {
        if prefix.is_empty() {
            from == 0
        } else {
            self.text[..from].ends_with(prefix)
        }
    }

    /// Whether the text after `to` agrees with a stored suffix. An empty
    /// suffix (the quote ended the source) agrees only at the end.
    pub fn suffix_agrees(&self, to: usize, suffix: &str) -> bool {
        if suffix.is_empty() {
            to == self.text.len()
        } else {
            self.text[to..].starts_with(suffix)
        }
    }

    /// The byte range on the line covering segments `first..=last`.
    pub fn bytes_of(&self, first: usize, last: usize) -> (usize, usize) {
        let end = self.starts[last] + self.segments[last].text.len();
        (self.starts[first], end)
    }
}

/// How a quote was found again among candidate occurrences.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    One(usize, usize),
    None,
    Ambiguous,
}

/// Chooses among occurrences inside `window` (bytes on the line).
///
/// Without `need_context`, a single occurrence is enough. Otherwise — and to
/// decide between several — the stored context is compared: occurrences with
/// the same text on both sides win; failing those, occurrences with the same
/// text on one side (the other side may have changed). Exactly one such
/// occurrence is a pick; two or more are ambiguous; none is none. Nothing is
/// chosen by position or order.
pub fn pick(
    line: &Line,
    occurrences: &[(usize, usize)],
    window: (usize, usize),
    prefix: &str,
    suffix: &str,
    need_context: bool,
) -> Pick {
    let inside: Vec<(usize, usize)> = occurrences
        .iter()
        .copied()
        .filter(|&(from, to)| from >= window.0 && to <= window.1)
        .collect();
    if inside.is_empty() {
        return Pick::None;
    }
    if inside.len() == 1 && !need_context {
        return Pick::One(inside[0].0, inside[0].1);
    }
    let sides = |&(from, to): &(usize, usize)| {
        usize::from(line.prefix_agrees(from, prefix)) + usize::from(line.suffix_agrees(to, suffix))
    };
    for wanted in [2, 1] {
        let agreeing: Vec<&(usize, usize)> = inside.iter().filter(|o| sides(o) == wanted).collect();
        match agreeing.len() {
            0 => continue,
            1 => return Pick::One(agreeing[0].0, agreeing[0].1),
            _ => return Pick::Ambiguous,
        }
    }
    if need_context {
        Pick::None
    } else {
        Pick::Ambiguous
    }
}

/// A half-open range of source text, as `(position, offset)` pairs packed so
/// that ordinary integer order is reading order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u64,
    pub end: u64,
}

pub fn pack(position: i64, offset: u32) -> u64 {
    ((position.max(0) as u64) << 32) | u64::from(offset)
}

pub fn unpack(value: u64) -> (i64, u32) {
    ((value >> 32) as i64, (value & 0xffff_ffff) as u32)
}

impl Span {
    pub fn overlaps(self, other: Span) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// Overlapping, or one ends exactly where the other starts.
    pub fn meets(self, other: Span) -> bool {
        self.overlaps(other) || self.end == other.start || other.end == self.start
    }

    pub fn union(self, other: Span) -> Span {
        Span {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }
}

/// What is left of `old` once `new` is laid over it: the parts before and
/// after.
pub fn remainders(old: Span, new: Span) -> (Option<Span>, Option<Span>) {
    let before = (old.start < new.start).then(|| Span {
        start: old.start,
        end: old.end.min(new.start),
    });
    let after = (old.end > new.end).then(|| Span {
        start: old.start.max(new.end),
        end: old.end,
    });
    (before, after)
}

/// Grows `start` over every span that overlaps or touches it, repeatedly.
/// Returns the final span and the indexes it absorbed (ascending).
pub fn absorb(start: Span, others: &[Span]) -> (Span, Vec<usize>) {
    let mut span = start;
    let mut taken = vec![false; others.len()];
    loop {
        let mut grew = false;
        for (i, other) in others.iter().enumerate() {
            if !taken[i] && span.meets(*other) {
                taken[i] = true;
                span = span.union(*other);
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }
    (
        span,
        taken
            .iter()
            .enumerate()
            .filter_map(|(i, t)| t.then_some(i))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, position: i64, text: &str) -> StoredSegment {
        StoredSegment {
            id: id.into(),
            position,
            text: text.into(),
            page_number: None,
            section_path: None,
            locator: None,
        }
    }

    #[test]
    fn a_quote_across_segments_is_joined_with_a_newline() {
        let segments = [seg("a", 0, "Abide in me."), seg("b", 1, "As the branch")];
        let line = Line::new(&segments);
        let quote = line.quote(
            LinePoint {
                index: 0,
                offset: 6,
            },
            LinePoint {
                index: 1,
                offset: 6,
            },
        );
        assert_eq!(quote, Some("in me.\nAs the"));
    }

    #[test]
    fn offsets_are_utf16_and_never_split_a_character() {
        // "𝔊" is two UTF-16 units; Hangul syllables are one.
        let segments = [seg("a", 0, "𝔊 요한복음 15장")];
        let line = Line::new(&segments);
        let p = |offset| LinePoint { index: 0, offset };
        assert_eq!(line.quote(p(3), p(7)), Some("요한복음"));
        assert_eq!(line.quote(p(1), p(3)), None, "inside the surrogate pair");
        assert_eq!(line.quote(p(0), p(2)), Some("𝔊"));
    }

    #[test]
    fn trimming_moves_ends_off_joiners_and_spaces() {
        let segments = [seg("a", 0, "one"), seg("b", 1, "two")];
        let line = Line::new(&segments);
        // " \ntwo" from the end of "one" (byte 3) to the end of the line.
        let (start, end) = line.trimmed(3, line.text.len()).unwrap();
        assert_eq!(
            (start, end),
            (
                LinePoint {
                    index: 1,
                    offset: 0
                },
                LinePoint {
                    index: 1,
                    offset: 3
                }
            )
        );
        // "one\n" ends at the end of "one", not at the start of "two".
        let (_, end) = line.trimmed(0, 4).unwrap();
        assert_eq!(
            end,
            LinePoint {
                index: 0,
                offset: 3
            }
        );
        assert!(line.trimmed(3, 4).is_none(), "only a joiner");
    }

    #[test]
    fn context_is_cut_at_whole_characters() {
        let text = "가".repeat(40) + "QUOTE" + &"나".repeat(40);
        let segments = [seg("a", 0, &text)];
        let line = Line::new(&segments);
        let from = line.text.find("QUOTE").unwrap();
        let (prefix, suffix) = line.context(from, from + 5);
        assert_eq!(prefix.chars().count(), CONTEXT_CHARS);
        assert_eq!(suffix.chars().count(), CONTEXT_CHARS);
        assert!(line.prefix_agrees(from, &prefix));
        assert!(line.suffix_agrees(from + 5, &suffix));
    }

    #[test]
    fn a_repeated_quote_is_settled_by_context_or_left_ambiguous() {
        let segments = [seg(
            "a",
            0,
            "grace and peace; then grace and truth; grace and peace",
        )];
        let line = Line::new(&segments);
        let all = line.occurrences("grace and");
        assert_eq!(all.len(), 3);
        let whole = (0, line.text.len());
        // Context of the second occurrence picks it.
        let second = all[1];
        let (prefix, suffix) = line.context(second.0, second.1);
        assert_eq!(
            pick(&line, &all, whole, &prefix, &suffix, true),
            Pick::One(second.0, second.1)
        );
        // " peace" after it is not enough to choose between the first and third.
        assert_eq!(
            pick(&line, &all, whole, "nothing ", " peace", false),
            Pick::Ambiguous
        );
        // One side is enough when only one occurrence has it.
        assert_eq!(
            pick(&line, &all, whole, "then ", " nothing", true),
            Pick::One(second.0, second.1)
        );
        // Context that matches nothing: none, never a guess.
        assert_eq!(pick(&line, &all, whole, "xyz ", "zyx", true), Pick::None);
        // Several, and no context to choose: ambiguous, not the first.
        assert_eq!(
            pick(&line, &all, whole, "xyz ", "zyx", false),
            Pick::Ambiguous
        );
    }

    #[test]
    fn spans_merge_touching_ranges_and_cut_others() {
        let a = Span {
            start: pack(1, 0),
            end: pack(1, 5),
        };
        let b = Span {
            start: pack(1, 5),
            end: pack(2, 3),
        };
        let c = Span {
            start: pack(3, 0),
            end: pack(3, 4),
        };
        let (span, taken) = absorb(a, &[c, b]);
        assert_eq!(taken, vec![1]);
        assert_eq!(span.end, pack(2, 3));
        let (before, after) = remainders(
            Span {
                start: pack(1, 0),
                end: pack(1, 9),
            },
            Span {
                start: pack(1, 2),
                end: pack(1, 4),
            },
        );
        assert_eq!(before.map(|s| unpack(s.end)), Some((1, 2)));
        assert_eq!(after.map(|s| unpack(s.start)), Some((1, 4)));
    }

    #[test]
    fn place_details_round_trip_and_ignore_unknown_versions() {
        let details = PlaceDetails {
            v: 0,
            page: Some(3),
            fraction: Some(0.25),
        };
        let stored = details.to_stored().unwrap();
        assert_eq!(PlaceDetails::read(Some(&stored)).page, Some(3));
        assert!(PlaceDetails::read(Some(r#"{"v":9,"page":3}"#)).is_empty());
        assert!(PlaceDetails::default().to_stored().is_none());
    }
}
