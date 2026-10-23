//! Hebrew (Masoretic) to English verse numbers (v0.22).
//!
//! Hebrew Bibles number some chapters and verses differently from English
//! Bibles: Joel has four chapters, Malachi three, many Psalm titles are the
//! first verse. Abiding Word's canon uses the English (KJV-tradition) numbering, so a
//! Hebrew text is mapped before it is stored — but only with a verse map the
//! person supplies with the files (none is bundled): the Open Scriptures
//! Hebrew Bible's `wlc/VerseMap.xml`, which "catalogs versification
//! differences between the Westminster Leningrad Codex (wlc) and the King
//! James Version (kjv)" (CC BY 4.0, github.com/openscriptures/morphhb).
//!
//! Rules (`import::StagedContent::release_held` applies them):
//!
//! - entries whose WLC side is a whole verse are applied (`full`, and
//!   `partial` ones whose English side is part of a verse); entries whose
//!   WLC side is part of a verse (`Gen.1.1!a`) are not, because the text
//!   cannot be divided at a place the map does not give: that verse keeps
//!   its number, and the English verse it would begin may be missing;
//! - verses not in the map keep their numbers;
//! - when a mapped verse arrives where an unmapped one already is: in
//!   Psalms the unmapped one is the title (the English Bible's pre-verse
//!   material) and becomes the chapter's title; elsewhere the two are one
//!   English verse and are joined, in order;
//! - in Psalms, several Hebrew verses mapped to English verse 1 (the map does
//!   this where a title is two Hebrew verses: Ps 51, 52, 54, 60): the last is
//!   verse 1, the earlier ones the title.

use std::collections::HashMap;

use regex::Regex;

use super::canon;

/// OSIS book names, in canonical order (ordinal = index + 1).
pub const OSIS_BOOKS: [&str; 66] = [
    "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1Sam", "2Sam", "1Kgs", "2Kgs",
    "1Chr", "2Chr", "Ezra", "Neh", "Esth", "Job", "Ps", "Prov", "Eccl", "Song", "Isa", "Jer",
    "Lam", "Ezek", "Dan", "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph",
    "Hag", "Zech", "Mal", "Matt", "Mark", "Luke", "John", "Acts", "Rom", "1Cor", "2Cor", "Gal",
    "Eph", "Phil", "Col", "1Thess", "2Thess", "1Tim", "2Tim", "Titus", "Phlm", "Heb", "Jas",
    "1Pet", "2Pet", "1John", "2John", "3John", "Jude", "Rev",
];

/// The canonical book of an OSIS book name.
pub fn osis_book(name: &str) -> Option<&'static canon::Book> {
    let index = OSIS_BOOKS.iter().position(|b| *b == name)?;
    canon::by_ordinal(index as u8 + 1)
}

/// An OSIS verse reference ("Gen.32.1") as (book ordinal, chapter, verse).
pub fn osis_verse(reference: &str) -> Option<(u8, u16, u16)> {
    let mut parts = reference.split('.');
    let book = osis_book(parts.next()?)?;
    let chapter = parts.next()?.parse().ok()?;
    let verse = parts.next()?.parse().ok()?;
    if parts.next().is_some() || chapter == 0 || verse == 0 {
        return None;
    }
    Some((book.ordinal, chapter, verse))
}

/// The most entries read from a map (the WLC map has under 2,000).
const ENTRIES_MAX: usize = 20_000;
/// The largest map file read (the WLC map is about 105 KB).
pub const MAP_MAX_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VerseMap {
    /// Hebrew verse → English (chapter, verse), for whole Hebrew verses.
    pub to_english: HashMap<(u8, u16, u16), (u16, u16)>,
    /// Part of a Hebrew verse (`Ps.13.6!a`: part `a`) → English (chapter,
    /// verse). Applied only where the text itself marks where the part ends
    /// (OSHB's `KJV:` notes); otherwise the verse is kept whole and reported.
    pub parts: HashMap<(u8, u16, u16, char), (u16, u16)>,
}

/// Whether a file is a verse map this module reads.
pub fn is_verse_map(name: &str, text: &str) -> bool {
    // A managed copy may carry a numeric prefix ("3-VerseMap.xml").
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(name)
        .to_ascii_lowercase();
    base.ends_with("versemap.xml") && text.contains("<verseMap")
}

/// Reads an OSHB verse map. The whole map is refused (`None`) when any
/// entry is not understood — an unknown book, a malformed reference or
/// part, a different book on each side, the same source twice, an unknown
/// type, or a `<verse>` element of another shape: a map that is partly
/// understood would move verses silently.
pub fn parse(text: &str) -> Option<VerseMap> {
    if text.len() > MAP_MAX_BYTES {
        return None;
    }
    let entry =
        Regex::new(r#"<verse\s+wlc="([^"]+)"\s+kjv="([^"]+)"\s+type="(full|partial)"\s*/>"#)
            .ok()?;
    // Comments say nothing; every <verse …> element (in any case or
    // namespace) must be one of the entries read.
    let text = Regex::new(r"(?s)<!--.*?-->").ok()?.replace_all(text, "");
    let text = text.as_ref();
    let elements = Regex::new(r"(?i)<(?:[a-z][a-z0-9]*:)?verse[\s/>]")
        .ok()?
        .find_iter(text)
        .count();
    let mut map = VerseMap::default();
    let mut read = 0usize;
    for caps in entry.captures_iter(text) {
        read += 1;
        if read > ENTRIES_MAX {
            return None;
        }
        let (wlc, kjv) = (&caps[1], &caps[2]);
        let (wlc_ref, part) = split_part(wlc)?;
        let (kjv_ref, _) = split_part(kjv)?;
        let from = osis_verse(wlc_ref)?;
        let to = osis_verse(kjv_ref)?;
        if from.0 != to.0 {
            return None;
        }
        let fresh = match part {
            None => map.to_english.insert(from, (to.1, to.2)).is_none(),
            Some(p) => map
                .parts
                .insert((from.0, from.1, from.2, p), (to.1, to.2))
                .is_none(),
        };
        if !fresh {
            return None;
        }
    }
    if read != elements {
        return None;
    }
    // A Hebrew verse moved whole and in parts at once: not one reading.
    if map
        .parts
        .keys()
        .any(|(o, c, v, _)| map.to_english.contains_key(&(*o, *c, *v)))
    {
        return None;
    }
    (!map.to_english.is_empty()).then_some(map)
}

/// "Ps.13.6!a" → ("Ps.13.6", Some('a')); a part is one letter a–z.
pub fn split_part(reference: &str) -> Option<(&str, Option<char>)> {
    match reference.split_once('!') {
        None => Some((reference, None)),
        Some((base, part)) => {
            let mut letters = part.chars();
            let letter = letters.next().filter(|c| c.is_ascii_lowercase())?;
            letters.next().is_none().then_some((base, Some(letter)))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0"?><verseMap>
        <book osisID="Joel"><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/>
        <verse wlc="Joel.4.1" kjv="Joel.3.1" type="full"/></book>
        <verse wlc="1Kgs.22.44" kjv="1Kgs.22.43!b" type="partial"/>
        <verse wlc="Ps.13.6!a" kjv="Ps.13.5" type="partial"/>
        </verseMap>"#;

    #[test]
    fn reads_whole_verse_entries_and_skips_parts() {
        let map = parse(SAMPLE).unwrap();
        assert_eq!(map.to_english.get(&(29, 3, 1)), Some(&(2, 28)));
        assert_eq!(map.to_english.get(&(29, 4, 1)), Some(&(3, 1)));
        assert_eq!(map.to_english.get(&(11, 22, 44)), Some(&(22, 43)));
        assert_eq!(map.parts.get(&(19, 13, 6, 'a')), Some(&(13, 5)));
        assert!(is_verse_map("wlc/VerseMap.xml", SAMPLE));
        assert!(!is_verse_map("other.xml", SAMPLE));
    }

    #[test]
    fn a_comment_quoting_an_entry_is_not_an_entry() {
        let map = parse(
            r#"<verseMap><!-- e.g. <verse wlc="X" kjv="Y"> --><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/></verseMap>"#,
        );
        assert_eq!(map.unwrap().to_english.len(), 1);
    }

    #[test]
    fn refuses_a_map_that_is_partly_wrong() {
        for bad in [
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Amos.2.28" type="full"/></verseMap>"#,
            r#"<verseMap><verse wlc="Xyz.3.1" kjv="Joel.2.28" type="full"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3" kjv="Joel.2.28" type="full"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.3.1" kjv="Joel.2.29" type="full"/></verseMap>"#,
            "<verseMap></verseMap>",
            // Partly understood: every entry must be read, or none is used.
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse kjv="Joel.2.29" wlc="Joel.3.2" type="full"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.3.2" kjv="Joel.2.29" type="moved"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.3.2!ab" kjv="Joel.2.29" type="partial"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.3.2" kjv="Joel.2.29" type="full"></verse></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><vm:verse wlc="Joel.3.2" kjv="Joel.2.29" type="full"/></verseMap>"#,
            r#"<verseMap><verse wlc="Joel.3.1" kjv="Joel.2.28" type="full"/><verse wlc="Joel.3.1!a" kjv="Joel.2.27" type="partial"/></verseMap>"#,
        ] {
            assert!(parse(bad).is_none(), "{bad}");
        }
        assert_eq!(osis_book("Ps").unwrap().code, "PSA");
        assert_eq!(osis_book("Rev").unwrap().code, "REV");
    }
}
