//! How well a source's passage link fits the passage being read.
//!
//! Pure functions over verse-key ranges (`BBCCCVVV`, see
//! `scripture::reference`), so the order of the Sources pane is a rule that
//! can be read and tested, not an accident of a query. Deterministic: no text
//! similarity, no scoring model.
//!
//! A link is compared with the active passage, best first:
//!
//! 1. **Exact**: the same range.
//! 2. **Contained**: one range lies inside the other (a section on John 15:1–11
//!    for a reader at John 15:5; a note on John 15:5 for a reader at John 15).
//! 3. **Overlap**: the ranges share verses without either containing the other.
//! 4. **Chapter**: no shared verse, but the same chapter.
//!
//! Anything else (another chapter, another book) does not match: a whole book
//! mentioned somewhere would flood the pane.
//!
//! Within a kind, **evidence of aboutness comes before a passing mention**
//! (the tier): a manual link or a section heading says the text is *about* a
//! passage, a literal mention only says it is cited. So a commentary section on
//! John 15:1–11 outranks a paragraph that happens to say "John 15:5–6" when the
//! reader is at John 15:5, while a mention of exactly John 15:5 still outranks
//! the section because the kind (exact) is decided first. The tier does not
//! apply to the chapter kind, where being nearer is what matters.
//!
//! Then the link whose size is nearest to the active passage comes first
//! (narrower before broader for a single verse; for the chapter kind the nearer
//! verses). Last the origin (manual, section, mention, inherited), so equal
//! evidence is ordered the same way every time.
//!
//! The source type (book, sermon, notes …) is deliberately not a factor: nothing
//! in a realistic library showed it improving the order, and a rule such as
//! "books before notes" would hide a pastor's own sermon on the verse.

use crate::library::sections::LinkOrigin;

/// How a link relates to the active passage, best first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchKind {
    Exact,
    Contained,
    Overlap,
    Chapter,
}

/// A verse-key range, inclusive (as stored in `source_passages`).
pub type KeyRange = (i64, i64);

/// The chapter a key belongs to: `BBCCC000`.
fn chapter_of(key: i64) -> i64 {
    key / 1_000
}

pub fn classify(active: KeyRange, link: KeyRange) -> Option<MatchKind> {
    let (a_start, a_end) = active;
    let (l_start, l_end) = link;
    if (l_start, l_end) == (a_start, a_end) {
        return Some(MatchKind::Exact);
    }
    let contains = |outer: KeyRange, inner: KeyRange| outer.0 <= inner.0 && outer.1 >= inner.1;
    if contains(active, link) || contains(link, active) {
        return Some(MatchKind::Contained);
    }
    if l_start <= a_end && l_end >= a_start {
        return Some(MatchKind::Overlap);
    }
    let shares_chapter =
        chapter_of(l_start) <= chapter_of(a_end) && chapter_of(l_end) >= chapter_of(a_start);
    shares_chapter.then_some(MatchKind::Chapter)
}

/// Smaller is closer. For the chapter kind it is the gap between the ranges;
/// otherwise the difference in their size (a chapter's end counts as verse 999,
/// which only has to order sizes, not count verses).
fn closeness(kind: MatchKind, active: KeyRange, link: KeyRange) -> i64 {
    match kind {
        MatchKind::Chapter => {
            if link.1 < active.0 {
                active.0 - link.1
            } else {
                link.0 - active.1
            }
        }
        _ => ((active.1 - active.0) - (link.1 - link.0)).abs(),
    }
}

fn origin_rank(origin: LinkOrigin) -> u8 {
    match origin {
        LinkOrigin::Manual => 0,
        LinkOrigin::Section => 1,
        LinkOrigin::Explicit => 2,
        LinkOrigin::Inherited => 3,
    }
}

/// 0 for evidence that the text is about the passage (manual link, section
/// heading), 1 for a passing mention. Not used for the chapter kind.
fn tier(kind: MatchKind, origin: LinkOrigin) -> u8 {
    match (kind, origin) {
        (MatchKind::Chapter, _) => 0,
        (_, LinkOrigin::Manual | LinkOrigin::Section) => 0,
        _ => 1,
    }
}

/// Sort key of a link for the active passage (smaller is better), or `None`
/// when it does not match at all: (kind, tier, closeness, origin).
pub fn rank(
    active: KeyRange,
    link: KeyRange,
    origin: LinkOrigin,
) -> Option<(MatchKind, u8, i64, u8)> {
    let kind = classify(active, link)?;
    Some((
        kind,
        tier(kind, origin),
        closeness(kind, active, link),
        origin_rank(origin),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    // John is book 43: John 15:5 = 43015005 …
    const fn v(chapter: i64, verse: i64) -> i64 {
        43_000_000 + chapter * 1_000 + verse
    }
    const fn chapter(c: i64) -> KeyRange {
        (v(c, 0), v(c, 999))
    }
    const fn verses(c: i64, from: i64, to: i64) -> KeyRange {
        (v(c, from), v(c, to))
    }

    #[test]
    fn classifies_by_how_the_ranges_relate() {
        let active = verses(15, 5, 5);
        assert_eq!(classify(active, verses(15, 5, 5)), Some(MatchKind::Exact));
        assert_eq!(
            classify(active, verses(15, 1, 11)),
            Some(MatchKind::Contained)
        );
        assert_eq!(classify(active, chapter(15)), Some(MatchKind::Contained));
        assert_eq!(
            classify(chapter(15), verses(15, 5, 5)),
            Some(MatchKind::Contained)
        );
        assert_eq!(
            classify(verses(15, 1, 11), verses(15, 8, 17)),
            Some(MatchKind::Overlap)
        );
        assert_eq!(
            classify(active, verses(15, 12, 17)),
            Some(MatchKind::Chapter)
        );
        assert_eq!(classify(active, chapter(16)), None);
        assert_eq!(classify(active, verses(14, 1, 3)), None);
    }

    #[test]
    fn a_range_across_chapters_matches_each_chapter_it_touches() {
        // John 15:20–16:4 for a reader at John 16:10: same chapter, no shared verse.
        assert_eq!(
            classify(verses(16, 10, 10), (v(15, 20), v(16, 4))),
            Some(MatchKind::Chapter)
        );
        assert_eq!(
            classify(verses(16, 2, 2), (v(15, 20), v(16, 4))),
            Some(MatchKind::Contained)
        );
    }

    #[test]
    fn kinds_order_exact_contained_overlap_chapter() {
        assert!(MatchKind::Exact < MatchKind::Contained);
        assert!(MatchKind::Contained < MatchKind::Overlap);
        assert!(MatchKind::Overlap < MatchKind::Chapter);
    }

    #[test]
    fn a_narrower_section_outranks_a_broader_one_for_a_verse() {
        let active = verses(15, 5, 5);
        let narrow = rank(active, verses(15, 1, 11), LinkOrigin::Section).unwrap();
        let broad = rank(active, chapter(15), LinkOrigin::Section).unwrap();
        assert!(narrow < broad);
    }

    #[test]
    fn for_a_passage_the_nearest_sized_link_comes_first() {
        let active = verses(15, 1, 11);
        let close = rank(active, verses(15, 1, 10), LinkOrigin::Explicit).unwrap();
        let single = rank(active, verses(15, 5, 5), LinkOrigin::Explicit).unwrap();
        let whole = rank(active, chapter(15), LinkOrigin::Explicit).unwrap();
        assert!(close < single && single < whole);
    }

    #[test]
    fn nearer_verses_come_first_within_the_chapter_kind() {
        let active = verses(15, 5, 5);
        let near = rank(active, verses(15, 7, 7), LinkOrigin::Explicit).unwrap();
        let far = rank(active, verses(15, 16, 16), LinkOrigin::Explicit).unwrap();
        let before = rank(active, verses(15, 2, 2), LinkOrigin::Explicit).unwrap();
        assert!(near < far);
        assert!(before < far);
    }

    #[test]
    fn an_explicit_reference_outranks_an_inherited_one_that_is_otherwise_equal() {
        let active = verses(15, 5, 5);
        let link = verses(15, 1, 11);
        let explicit = rank(active, link, LinkOrigin::Explicit).unwrap();
        let inherited = rank(active, link, LinkOrigin::Inherited).unwrap();
        assert!(explicit < inherited);
    }

    #[test]
    fn a_section_heading_outranks_a_passing_mention_of_the_same_passage() {
        let active = verses(15, 1, 11);
        let section = rank(active, active, LinkOrigin::Section).unwrap();
        let mention = rank(active, active, LinkOrigin::Explicit).unwrap();
        let manual = rank(active, active, LinkOrigin::Manual).unwrap();
        assert!(manual < section && section < mention);
    }

    #[test]
    fn a_section_about_the_passage_outranks_a_nearer_passing_mention_of_the_same_kind() {
        let active = verses(15, 5, 5);
        // a paragraph citing John 15:5–6 versus a section on 15:1–11 and one on the chapter
        let mention = rank(active, verses(15, 5, 6), LinkOrigin::Explicit).unwrap();
        let section = rank(active, verses(15, 1, 11), LinkOrigin::Section).unwrap();
        let whole = rank(active, chapter(15), LinkOrigin::Section).unwrap();
        assert!(section < whole && whole < mention);
    }

    #[test]
    fn nearness_not_the_tier_orders_the_same_chapter_kind() {
        let active = verses(15, 5, 5);
        let near_mention = rank(active, verses(15, 7, 7), LinkOrigin::Explicit).unwrap();
        let far_section = rank(active, verses(15, 16, 17), LinkOrigin::Section).unwrap();
        assert!(near_mention < far_section);
    }

    #[test]
    fn the_kind_decides_before_closeness_or_origin() {
        let active = verses(15, 5, 5);
        // a literal mention of exactly this verse beats a section that contains it
        let exact = rank(active, active, LinkOrigin::Explicit).unwrap();
        let section = rank(active, verses(15, 5, 6), LinkOrigin::Section).unwrap();
        assert!(exact < section);
    }
}
