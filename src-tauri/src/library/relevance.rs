//! How well a source's passage link fits the passage being read.
//!
//! Pure functions over verse-key ranges (`BBCCCVVV`, see `scripture::reference`),
//! so the order of the Sources pane is a rule that can be read and tested, not an
//! accident of a query. Deterministic: no text similarity, no scoring model.
//!
//! Two questions decide where a place goes, and the first matters most.
//!
//! **1. Is the text *about* the passage, or does it only *cite* it?**
//! (the [`Evidence`])
//!
//! - *About*: a manual link; a section whose heading names the passage; a
//!   citation inside a section whose heading is about the passage.
//! - *Neutral*: a citation in text with no passage-bearing heading around it.
//! - *Cross-reference*: a citation inside a section whose heading names a
//!   **different** passage ("Cross-references for Matthew 13:23" citing John
//!   15:5). The citation is real and stays indexed; as a suggestion for John 15:5
//!   it is incidental.
//!
//! **2. How specific is the link to the passage?** (the [`Fit`]) A link to
//! exactly the passage, or a short range containing it (John 15:1–11 for John
//! 15:5), is specific. A whole chapter is broader, two or three chapters wider,
//! and four or more (John 11–21, a whole Gospel) is too broad to suggest anything:
//! it is kept, but last. This counts chapters spanned, not raw verse-key distance
//! (a chapter's end is verse 999, which only has to order sizes).
//!
//! Together they give the **class** (smaller is better):
//!
//! | class | what |
//! |---|---|
//! | 0 | a manual link (not too broad) |
//! | 1 | about, and exact or narrow: a section on John 15:1–11 for John 15:5 |
//! | 2 | a neutral citation, exact or narrow |
//! | 3 | about, but a whole chapter or only partly overlapping |
//! | 4 | wider or neutral-but-broad: two or three chapters, a neutral chapter |
//! | 5 | a cross-reference |
//! | 6 | far too broad (four or more chapters), whatever the evidence |
//!
//! Within a class: the origin (manual, section heading, mention), then the fit
//! (exact before narrow …), then the link whose size is nearest to the passage.
//!
//! A place that shares no verse with the passage does not match, even in the same
//! chapter: the pane prefers precision to recall, so nothing is invented from a
//! shared chapter number.
//!
//! The source type (book, sermon, notes …) is deliberately not a factor.

use crate::library::sections::LinkOrigin;

/// A verse-key range, inclusive (as stored in `source_passages`).
pub type KeyRange = (i64, i64);

/// How a link relates to the passage being read, for display. A link that shares
/// no verse with it does not match at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchKind {
    Exact,
    Contained,
    Overlap,
}

/// How specific a link is to the passage, best first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Fit {
    /// The same range.
    Exact,
    /// Inside the passage, or a short range (within one chapter, or across a
    /// chapter boundary without taking whole chapters) that contains it.
    Narrow,
    /// A whole chapter that contains the passage.
    Chapter,
    /// Shares some verses without containing it, or being inside it.
    Overlap,
    /// Two or three chapters.
    Wide,
    /// Four or more chapters: a book-scale range.
    Broad,
}

/// What kind of evidence a place is that the text concerns the passage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Evidence {
    /// A manual link.
    Manual,
    /// A section heading, or a citation inside a section about the passage.
    About,
    /// A citation with no passage-bearing heading around it.
    Neutral,
    /// A citation inside a section whose heading names another passage.
    CrossReference,
}

/// What the headings around a citation say, for the passage being read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Context {
    /// No passage-bearing section around it.
    Neutral,
    /// A section about (a specific part of) the passage.
    About,
    /// Sections around it name other passages only.
    Elsewhere,
}

/// Sort key of a place (smaller is better): class, origin, fit, closeness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Rank {
    pub class: u8,
    pub origin: u8,
    pub fit: Fit,
    pub closeness: i64,
}

/// The chapter a key belongs to: `BBCCC000`.
fn chapter_of(key: i64) -> i64 {
    key / 1_000
}

/// How much of the text a range covers, independent of any passage.
enum Scale {
    /// Within a chapter, or a pericope across a chapter boundary.
    Verses,
    /// Exactly one whole chapter.
    Chapter,
    /// Two or three chapters.
    Wide,
    /// Four or more.
    Broad,
}

fn scale(range: KeyRange) -> Scale {
    let (start, end) = range;
    let chapters = chapter_of(end) - chapter_of(start) + 1;
    let whole_start = start % 1_000 == 0;
    let whole_end = end % 1_000 == 999;
    match chapters {
        1 if whole_start && whole_end => Scale::Chapter,
        1 => Scale::Verses,
        // John 15:20–16:4 is a passage; John 15–16 is a stretch of the book
        2 if !whole_start && !whole_end => Scale::Verses,
        2 | 3 => Scale::Wide,
        _ => Scale::Broad,
    }
}

fn shares_a_verse(active: KeyRange, link: KeyRange) -> bool {
    link.0 <= active.1 && link.1 >= active.0
}

fn contains(outer: KeyRange, inner: KeyRange) -> bool {
    outer.0 <= inner.0 && outer.1 >= inner.1
}

/// How the link relates to the passage, or `None` when they share no verse.
pub fn kind_of(active: KeyRange, link: KeyRange) -> Option<MatchKind> {
    if !shares_a_verse(active, link) {
        return None;
    }
    Some(if link == active {
        MatchKind::Exact
    } else if contains(active, link) || contains(link, active) {
        MatchKind::Contained
    } else {
        MatchKind::Overlap
    })
}

/// How specific the link is to the passage, or `None` when they share no verse.
pub fn fit(active: KeyRange, link: KeyRange) -> Option<Fit> {
    if !shares_a_verse(active, link) {
        return None;
    }
    if link == active {
        return Some(Fit::Exact);
    }
    if contains(active, link) {
        return Some(Fit::Narrow);
    }
    let encloses = contains(link, active);
    Some(match (scale(link), encloses) {
        (Scale::Broad, _) => Fit::Broad,
        (Scale::Wide, _) => Fit::Wide,
        (Scale::Chapter, true) => Fit::Chapter,
        (Scale::Verses, true) => Fit::Narrow,
        (_, false) => Fit::Overlap,
    })
}

/// What the passage-bearing sections around a citation say about the passage
/// being read. A section only counts as *about* it when it is itself reasonably
/// specific (not a book-scale range); one that only touches it broadly neither
/// makes the citation about it nor a cross-reference.
pub fn section_context(active: KeyRange, sections: &[KeyRange]) -> Context {
    if sections.is_empty() {
        return Context::Neutral;
    }
    let fits: Vec<Fit> = sections.iter().filter_map(|s| fit(active, *s)).collect();
    if fits.iter().any(|f| *f <= Fit::Overlap) {
        Context::About
    } else if !fits.is_empty() {
        Context::Neutral
    } else {
        Context::Elsewhere
    }
}

/// Smaller is closer: the difference in the sizes of the ranges (a chapter's end
/// counts as verse 999, which only has to order sizes, not count verses).
fn closeness(active: KeyRange, link: KeyRange) -> i64 {
    ((active.1 - active.0) - (link.1 - link.0)).abs()
}

fn origin_rank(origin: LinkOrigin) -> u8 {
    match origin {
        LinkOrigin::Manual => 0,
        LinkOrigin::Section => 1,
        LinkOrigin::Explicit => 2,
        LinkOrigin::Inherited => 3,
    }
}

fn evidence(origin: LinkOrigin, context: Context) -> Evidence {
    match origin {
        LinkOrigin::Manual => Evidence::Manual,
        LinkOrigin::Section | LinkOrigin::Inherited => Evidence::About,
        LinkOrigin::Explicit => match context {
            Context::About => Evidence::About,
            Context::Neutral => Evidence::Neutral,
            Context::Elsewhere => Evidence::CrossReference,
        },
    }
}

fn class_of(evidence: Evidence, fit: Fit) -> u8 {
    if fit == Fit::Broad {
        return 6;
    }
    match (evidence, fit) {
        (Evidence::CrossReference, _) => 5,
        (Evidence::Manual, Fit::Wide) => 4,
        (Evidence::Manual, _) => 0,
        (Evidence::About, Fit::Exact | Fit::Narrow) => 1,
        (Evidence::About, Fit::Chapter | Fit::Overlap) => 3,
        (Evidence::About, _) => 4,
        (Evidence::Neutral, Fit::Exact | Fit::Narrow) => 2,
        (Evidence::Neutral, _) => 4,
    }
}

/// Sort key of a place for the active passage (smaller is better), or `None`
/// when it shares no verse with it. `context` is only read for a literal mention.
pub fn rank(
    active: KeyRange,
    link: KeyRange,
    origin: LinkOrigin,
    context: Context,
) -> Option<Rank> {
    let fit = fit(active, link)?;
    Some(Rank {
        class: class_of(evidence(origin, context), fit),
        origin: origin_rank(origin),
        fit,
        closeness: closeness(active, link),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use LinkOrigin::{Explicit, Manual, Section};

    // John is book 43: John 15:5 = 43015005 …
    const fn v(chapter: i64, verse: i64) -> i64 {
        43_000_000 + chapter * 1_000 + verse
    }
    const fn chapters(from: i64, to: i64) -> KeyRange {
        (v(from, 0), v(to, 999))
    }
    const fn chapter(c: i64) -> KeyRange {
        chapters(c, c)
    }
    const fn verses(c: i64, from: i64, to: i64) -> KeyRange {
        (v(c, from), v(c, to))
    }
    const JOHN_15_5: KeyRange = verses(15, 5, 5);

    fn rank_of(link: KeyRange, origin: LinkOrigin, context: Context) -> Rank {
        rank(JOHN_15_5, link, origin, context).unwrap()
    }

    #[test]
    fn a_link_shares_verses_or_it_does_not_match() {
        assert_eq!(fit(JOHN_15_5, verses(15, 12, 17)), None);
        assert_eq!(
            fit(JOHN_15_5, verses(15, 3, 4)),
            None,
            "adjacent is not overlapping"
        );
        assert_eq!(fit(JOHN_15_5, verses(15, 6, 6)), None);
        assert_eq!(fit(JOHN_15_5, chapter(16)), None);
        assert_eq!(fit(JOHN_15_5, verses(14, 1, 3)), None);
        assert_eq!(kind_of(JOHN_15_5, verses(15, 12, 17)), None);
    }

    #[test]
    fn fit_says_how_specific_a_link_is() {
        assert_eq!(fit(JOHN_15_5, JOHN_15_5), Some(Fit::Exact));
        assert_eq!(fit(JOHN_15_5, verses(15, 1, 11)), Some(Fit::Narrow));
        assert_eq!(fit(JOHN_15_5, verses(15, 5, 6)), Some(Fit::Narrow));
        assert_eq!(fit(JOHN_15_5, chapter(15)), Some(Fit::Chapter));
        assert_eq!(fit(JOHN_15_5, chapters(14, 16)), Some(Fit::Wide));
        assert_eq!(fit(JOHN_15_5, chapters(15, 16)), Some(Fit::Wide));
        assert_eq!(fit(JOHN_15_5, chapters(11, 21)), Some(Fit::Broad));
        // a whole Gospel
        assert_eq!(fit(JOHN_15_5, chapters(1, 21)), Some(Fit::Broad));
    }

    #[test]
    fn a_passage_across_a_chapter_boundary_is_narrow_but_chapters_are_not() {
        assert_eq!(
            fit(verses(15, 25, 25), (v(15, 20), v(16, 4))),
            Some(Fit::Narrow)
        );
        assert_eq!(
            fit(verses(15, 25, 25), (v(15, 0), v(16, 4))),
            Some(Fit::Wide)
        );
    }

    #[test]
    fn a_link_inside_the_passage_is_narrow_and_a_partial_overlap_is_just_that() {
        // reading John 15: a note on 15:5 is inside it
        assert_eq!(fit(chapter(15), JOHN_15_5), Some(Fit::Narrow));
        assert_eq!(fit(chapter(15), chapter(15)), Some(Fit::Exact));
        // reading 15:1–11 against 15:8–17
        assert_eq!(
            fit(verses(15, 1, 11), verses(15, 8, 17)),
            Some(Fit::Overlap)
        );
        assert_eq!(
            kind_of(verses(15, 1, 11), verses(15, 8, 17)),
            Some(MatchKind::Overlap)
        );
        assert_eq!(
            kind_of(JOHN_15_5, verses(15, 1, 11)),
            Some(MatchKind::Contained)
        );
        assert_eq!(kind_of(JOHN_15_5, JOHN_15_5), Some(MatchKind::Exact));
    }

    #[test]
    fn reading_a_whole_chapter_still_ranks_the_broad_ranges_down() {
        assert_eq!(fit(chapter(15), chapters(11, 21)), Some(Fit::Broad));
        assert_eq!(fit(chapter(15), chapters(14, 16)), Some(Fit::Wide));
    }

    #[test]
    fn a_section_context_is_about_neutral_or_elsewhere() {
        assert_eq!(section_context(JOHN_15_5, &[]), Context::Neutral);
        assert_eq!(
            section_context(JOHN_15_5, &[verses(15, 1, 11)]),
            Context::About
        );
        assert_eq!(section_context(JOHN_15_5, &[chapter(15)]), Context::About);
        // Matthew 13:23 (book 40)
        assert_eq!(
            section_context(JOHN_15_5, &[(40_013_023, 40_013_023)]),
            Context::Elsewhere
        );
        // another part of the chapter is another passage
        assert_eq!(
            section_context(JOHN_15_5, &[verses(15, 12, 17)]),
            Context::Elsewhere
        );
        // a book-scale heading says nothing either way
        assert_eq!(
            section_context(JOHN_15_5, &[chapters(11, 21)]),
            Context::Neutral
        );
        // one heading naming several passages is about it if any of them is
        assert_eq!(
            section_context(JOHN_15_5, &[(40_013_023, 40_013_023), verses(15, 1, 11)]),
            Context::About
        );
    }

    #[test]
    fn a_section_about_the_passage_beats_a_citation_from_another_sections_heading() {
        let section = rank_of(verses(15, 1, 11), Section, Context::Neutral);
        let cross = rank_of(JOHN_15_5, Explicit, Context::Elsewhere);
        assert!(section < cross);
        assert_eq!(section.class, 1);
        assert_eq!(cross.class, 5);
    }

    #[test]
    fn an_exact_section_beats_a_neutral_mention_which_beats_a_cross_reference() {
        let exact = rank_of(JOHN_15_5, Section, Context::Neutral);
        let neutral = rank_of(JOHN_15_5, Explicit, Context::Neutral);
        let cross = rank_of(JOHN_15_5, Explicit, Context::Elsewhere);
        assert!(exact < neutral && neutral < cross);
    }

    #[test]
    fn a_neutral_mention_beats_a_chapter_wide_section() {
        let neutral = rank_of(JOHN_15_5, Explicit, Context::Neutral);
        let chapter_section = rank_of(chapter(15), Section, Context::Neutral);
        assert!(neutral < chapter_section);
        assert_eq!(chapter_section.class, 3);
    }

    #[test]
    fn a_citation_inside_a_section_about_the_passage_is_about_it() {
        let inside = rank_of(JOHN_15_5, Explicit, Context::About);
        assert_eq!(inside.class, 1);
        // but the heading itself still comes first among equals
        let heading = rank_of(verses(15, 1, 11), Section, Context::Neutral);
        assert!(heading < inside);
    }

    #[test]
    fn a_manual_link_comes_first_unless_it_is_far_too_broad() {
        let manual = rank_of(verses(15, 1, 11), Manual, Context::Neutral);
        let section = rank_of(JOHN_15_5, Section, Context::Neutral);
        assert!(manual < section);
        assert!(rank_of(chapters(11, 21), Manual, Context::Neutral).class == 6);
    }

    #[test]
    fn a_book_scale_range_is_last_whatever_the_evidence() {
        let broad_section = rank_of(chapters(11, 21), Section, Context::Neutral);
        for other in [
            rank_of(verses(15, 1, 11), Section, Context::Neutral),
            rank_of(JOHN_15_5, Explicit, Context::Neutral),
            rank_of(chapter(15), Section, Context::Neutral),
            rank_of(chapters(14, 16), Section, Context::Neutral),
            rank_of(JOHN_15_5, Explicit, Context::Elsewhere),
        ] {
            assert!(other < broad_section, "{other:?}");
        }
        assert_eq!(broad_section.class, 6);
        assert_eq!(
            rank_of(chapters(11, 21), Explicit, Context::Elsewhere).class,
            6
        );
    }

    #[test]
    fn two_or_three_chapters_are_weaker_than_a_chapter() {
        assert!(
            rank_of(chapter(15), Section, Context::Neutral)
                < rank_of(chapters(14, 16), Section, Context::Neutral)
        );
    }

    #[test]
    fn within_a_class_nearer_and_narrower_comes_first() {
        let exact = rank_of(JOHN_15_5, Section, Context::Neutral);
        let narrow = rank_of(verses(15, 1, 11), Section, Context::Neutral);
        let wider_narrow = rank_of(verses(15, 1, 20), Section, Context::Neutral);
        assert!(exact < narrow && narrow < wider_narrow);
    }

    #[test]
    fn a_partial_overlap_is_weaker_than_containment() {
        let active = verses(15, 1, 11);
        let contained = rank(active, verses(15, 1, 20), Section, Context::Neutral).unwrap();
        let overlap = rank(active, verses(15, 8, 17), Section, Context::Neutral).unwrap();
        assert!(contained < overlap);
        assert_eq!(overlap.class, 3);
    }

    #[test]
    fn a_neutral_range_that_is_not_specific_is_weak() {
        assert_eq!(rank_of(chapter(15), Explicit, Context::Neutral).class, 4);
        assert_eq!(
            rank_of(chapters(14, 16), Explicit, Context::Neutral).class,
            4
        );
    }
}
