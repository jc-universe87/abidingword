//! Range arithmetic for phrase highlights (docs/scripture-annotations-v0.5.md,
//! "Overlapping highlights").
//!
//! A phrase anchor is `(verse key, UTF-16 offset)` at each end. To compare
//! and cut ranges they are laid onto one line: the stored verses of a
//! chapter, in order, are placed end to end and a position becomes the
//! number of UTF-16 units before it. Two consequences make the rules simple:
//!
//! - the end of a verse and the start of the next verse are the same point,
//!   so highlights that meet across a verse boundary "touch";
//! - the order is lexicographic by (verse, offset), and ends stay exclusive.
//!
//! Nothing here reads the database or builds anchors; it only does the
//! arithmetic. The anchors that result are always rebuilt from stored
//! Bible text by `annotation_data::build_anchor`.

use crate::scripture::annotation_data::{utf16_len, utf16_to_byte, AnchorPoint};

/// A half-open range on the chapter line: `start` included, `end` excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    /// They share at least one character.
    pub fn overlaps(self, other: Span) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// One ends exactly where the other starts (no character between).
    pub fn touches(self, other: Span) -> bool {
        self.end == other.start || other.end == self.start
    }

    pub fn overlaps_or_touches(self, other: Span) -> bool {
        self.overlaps(other) || self.touches(other)
    }

    /// The smallest span holding both.
    pub fn union(self, other: Span) -> Span {
        Span {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }
}

/// What is left of `old` once `new` has been laid over it: the part before
/// `new` and the part after it. Both are `None` when `new` covers `old`; both
/// are `Some` when `new` lies strictly inside `old` (a split). Only
/// meaningful for spans that overlap.
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

/// Grows `start` over every span that overlaps or touches it, repeatedly,
/// because each growth can reach more of them. Returns the final span and
/// the indexes (ascending) of the spans it absorbed.
pub fn absorb(start: Span, others: &[Span]) -> (Span, Vec<usize>) {
    let mut span = start;
    let mut taken = vec![false; others.len()];
    loop {
        let mut grew = false;
        for (i, other) in others.iter().enumerate() {
            if !taken[i] && span.overlaps_or_touches(*other) {
                taken[i] = true;
                span = span.union(*other);
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }
    let indexes = taken
        .iter()
        .enumerate()
        .filter_map(|(i, t)| t.then_some(i))
        .collect();
    (span, indexes)
}

/// The stored text of one chapter's verses laid end to end.
pub struct Layout<'a> {
    verses: &'a [(i64, String)],
    /// Units before each verse.
    before: Vec<u32>,
    lens: Vec<u32>,
}

impl<'a> Layout<'a> {
    pub fn new(verses: &'a [(i64, String)]) -> Self {
        let mut before = Vec::with_capacity(verses.len());
        let mut lens = Vec::with_capacity(verses.len());
        let mut total = 0;
        for (_, text) in verses {
            let len = utf16_len(text);
            before.push(total);
            lens.push(len);
            total += len;
        }
        Self {
            verses,
            before,
            lens,
        }
    }

    /// Where a stored anchor position sits on the line; `None` if the verse
    /// is not in this text or the offset is beyond it.
    pub fn locate(&self, point: AnchorPoint) -> Option<u32> {
        let i = self
            .verses
            .iter()
            .position(|(key, _)| *key == point.verse)?;
        (point.offset <= self.lens[i]).then(|| self.before[i] + point.offset)
    }

    /// The anchor position for the start of a range: inside a verse, never at
    /// a verse's end.
    pub fn start_point(&self, at: u32) -> Option<AnchorPoint> {
        let i = (0..self.verses.len())
            .find(|&i| self.before[i] <= at && at < self.before[i] + self.lens[i])?;
        Some(AnchorPoint {
            verse: self.verses[i].0,
            offset: at - self.before[i],
        })
    }

    /// The anchor position for the (exclusive) end of a range: inside a
    /// verse, never at a verse's start, so a range that ends where the next
    /// verse begins ends at the previous verse's last unit.
    pub fn end_point(&self, at: u32) -> Option<AnchorPoint> {
        let i = (0..self.verses.len())
            .find(|&i| self.before[i] < at && at <= self.before[i] + self.lens[i])?;
        Some(AnchorPoint {
            verse: self.verses[i].0,
            offset: at - self.before[i],
        })
    }

    /// The span a pair of stored positions covers.
    pub fn span(&self, start: AnchorPoint, end: AnchorPoint) -> Option<Span> {
        let (start, end) = (self.locate(start)?, self.locate(end)?);
        (start < end).then_some(Span { start, end })
    }

    /// Whether the span holds any character that is not whitespace. A
    /// remainder that holds none is dropped rather than kept as an
    /// invisible highlight.
    pub fn has_visible_text(&self, span: Span) -> bool {
        self.verses.iter().enumerate().any(|(i, (_, text))| {
            let from = span.start.max(self.before[i]);
            let to = span.end.min(self.before[i] + self.lens[i]);
            if from >= to {
                return false;
            }
            let (a, b) = (from - self.before[i], to - self.before[i]);
            match (utf16_to_byte(text, a), utf16_to_byte(text, b)) {
                (Some(a), Some(b)) => text[a..b].chars().any(|c| !c.is_whitespace()),
                // Inside a character: not something we cut at; keep it and
                // let the anchor builder decide.
                _ => true,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(start: u32, end: u32) -> Span {
        Span { start, end }
    }

    #[test]
    fn remainders_cover_every_way_two_ranges_can_meet() {
        // new inside old: a split
        assert_eq!(
            remainders(s(0, 100), s(30, 60)),
            (Some(s(0, 30)), Some(s(60, 100)))
        );
        // new over old's tail / head
        assert_eq!(remainders(s(0, 50), s(30, 70)), (Some(s(0, 30)), None));
        assert_eq!(remainders(s(30, 80), s(0, 50)), (None, Some(s(50, 80))));
        // new covers old, exactly or more
        assert_eq!(remainders(s(30, 50), s(0, 80)), (None, None));
        assert_eq!(remainders(s(10, 20), s(10, 20)), (None, None));
        // new shares only one edge
        assert_eq!(remainders(s(0, 50), s(0, 20)), (None, Some(s(20, 50))));
        assert_eq!(remainders(s(0, 50), s(30, 50)), (Some(s(0, 30)), None));
    }

    #[test]
    fn overlap_and_touch_are_different_things() {
        assert!(s(0, 50).overlaps(s(30, 80)));
        assert!(!s(0, 50).overlaps(s(50, 80)));
        assert!(s(0, 50).touches(s(50, 80)));
        assert!(s(50, 80).touches(s(0, 50)));
        assert!(
            !s(0, 50).touches(s(51, 80)),
            "a character between is not touching"
        );
        assert!(s(0, 50).overlaps_or_touches(s(50, 80)));
    }

    #[test]
    fn absorbing_follows_chains() {
        // 0-10 touches 10-20, which overlaps 15-30; 40-50 is apart.
        let others = [s(15, 30), s(0, 10), s(40, 50)];
        let (span, taken) = absorb(s(10, 20), &others);
        assert_eq!(span, s(0, 30));
        assert_eq!(taken, vec![0, 1]);
    }

    fn texts() -> Vec<(i64, String)> {
        vec![
            (43_015_004, "abcd efgh".into()),
            (43_015_005, "ij kl".into()),
            (43_015_006, "mn 🍇 op".into()),
        ]
    }

    #[test]
    fn positions_are_lexicographic_and_verse_ends_meet_the_next_verse() {
        let t = texts();
        let layout = Layout::new(&t);
        let p = |verse, offset| AnchorPoint { verse, offset };
        assert_eq!(layout.locate(p(43_015_004, 0)), Some(0));
        assert_eq!(layout.locate(p(43_015_004, 9)), Some(9));
        // The end of verse 4 and the start of verse 5 are one point.
        assert_eq!(layout.locate(p(43_015_005, 0)), Some(9));
        assert_eq!(layout.locate(p(43_015_006, 0)), Some(14));
        assert_eq!(layout.locate(p(43_015_004, 10)), None, "beyond the verse");
        assert_eq!(layout.locate(p(43_015_099, 0)), None, "not in this text");
    }

    #[test]
    fn positions_come_back_inside_verses() {
        let t = texts();
        let layout = Layout::new(&t);
        // A start at a verse boundary belongs to the next verse; an end to the previous.
        assert_eq!(
            layout.start_point(9),
            Some(AnchorPoint {
                verse: 43_015_005,
                offset: 0
            })
        );
        assert_eq!(
            layout.end_point(9),
            Some(AnchorPoint {
                verse: 43_015_004,
                offset: 9
            })
        );
        assert_eq!(
            layout.start_point(0),
            Some(AnchorPoint {
                verse: 43_015_004,
                offset: 0
            })
        );
        assert_eq!(
            layout.end_point(0),
            None,
            "an end cannot be at the very start"
        );
        let last = layout.before[2] + layout.lens[2];
        assert_eq!(
            layout.start_point(last),
            None,
            "a start cannot be at the very end"
        );
        assert_eq!(
            layout.end_point(last),
            Some(AnchorPoint {
                verse: 43_015_006,
                offset: layout.lens[2]
            })
        );
    }

    #[test]
    fn surrogate_pairs_count_as_two_units() {
        let t = texts();
        let layout = Layout::new(&t);
        // "mn 🍇 op" is 3 + 2 + 3 = 8 units.
        assert_eq!(layout.lens[2], 8);
        let span = layout.span(
            AnchorPoint {
                verse: 43_015_006,
                offset: 3,
            },
            AnchorPoint {
                verse: 43_015_006,
                offset: 5,
            },
        );
        assert_eq!(span, Some(s(17, 19)));
        assert!(layout.has_visible_text(span.unwrap()));
    }

    #[test]
    fn whitespace_only_ranges_have_no_visible_text() {
        let t = texts();
        let layout = Layout::new(&t);
        assert!(
            !layout.has_visible_text(s(4, 5)),
            "the space in 'abcd efgh'"
        );
        assert!(layout.has_visible_text(s(3, 6)));
        // A range over a verse end and the next verse's start sees both.
        assert!(layout.has_visible_text(s(8, 10)));
    }

    #[test]
    fn spans_need_a_forward_range_inside_the_text() {
        let t = texts();
        let layout = Layout::new(&t);
        let p = |verse, offset| AnchorPoint { verse, offset };
        assert_eq!(layout.span(p(43_015_004, 5), p(43_015_004, 5)), None);
        assert_eq!(layout.span(p(43_015_005, 2), p(43_015_004, 3)), None);
        assert_eq!(
            layout.span(p(43_015_004, 5), p(43_015_005, 2)),
            Some(s(5, 11))
        );
    }
}
