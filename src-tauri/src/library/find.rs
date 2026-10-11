//! Find in this source (v0.13): where a query occurs in one source's
//! extracted text, segment by segment, as exact UTF-16 ranges of the stored
//! text (the interface's string offsets).
//!
//! Matching is deterministic and forgiving in the ways a reader expects of a
//! "find" box, and nothing more:
//! - case is ignored (Unicode lowercase);
//! - accents and other combining marks are ignored (canonical decomposition,
//!   marks dropped), so "Rom" finds "Röm" and Hebrew points are not needed;
//!   Greek final sigma counts as sigma;
//! - Hangul syllables are compared whole (never split into letters), so a
//!   query does not match half a syllable;
//! - any run of whitespace (including a non-breaking space) counts as one space.
//!
//! A match never spans two segments. Matches do not overlap.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Text folded for matching, with each folded character's range in the
/// original text (UTF-16 code units, end exclusive).
pub struct Folded {
    chars: Vec<char>,
    spans: Vec<(usize, usize)>,
}

fn is_hangul_syllable(c: char) -> bool {
    ('\u{AC00}'..='\u{D7A3}').contains(&c)
}

/// Folds `text` for matching (see the module notes).
pub fn fold(text: &str) -> Folded {
    let mut chars = Vec::with_capacity(text.len());
    let mut spans: Vec<(usize, usize)> = Vec::with_capacity(text.len());
    let mut at = 0usize;
    for c in text.chars() {
        let width = c.len_utf16();
        let range = (at, at + width);
        at += width;
        if c.is_whitespace() {
            if chars.last() == Some(&' ') {
                if let Some(last) = spans.last_mut() {
                    last.1 = range.1;
                }
            } else {
                chars.push(' ');
                spans.push(range);
            }
            continue;
        }
        let mut push = |f: char| {
            let f = if f == 'ς' { 'σ' } else { f };
            chars.push(f);
            spans.push(range);
        };
        if is_hangul_syllable(c) {
            push(c);
            continue;
        }
        for d in std::iter::once(c).nfd().filter(|d| !is_combining_mark(*d)) {
            for l in d.to_lowercase() {
                push(l);
            }
        }
    }
    Folded { chars, spans }
}

/// The folded form of a query: as [`fold`], with surrounding whitespace removed.
pub fn fold_query(query: &str) -> Vec<char> {
    fold(query.trim()).chars
}

/// The non-overlapping occurrences of `query` (already folded) in `text`, as
/// UTF-16 ranges of `text`. At most `limit` are returned.
pub fn occurrences(text: &str, query: &[char], limit: usize) -> Vec<(usize, usize)> {
    if query.is_empty() || limit == 0 {
        return Vec::new();
    }
    let folded = fold(text);
    let n = query.len();
    let mut out = Vec::new();
    let mut i = 0;
    while i + n <= folded.chars.len() {
        if folded.chars[i..i + n] == *query {
            out.push((folded.spans[i].0, folded.spans[i + n - 1].1));
            if out.len() >= limit {
                break;
            }
            i += n;
        } else {
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find(text: &str, query: &str) -> Vec<String> {
        let units: Vec<u16> = text.encode_utf16().collect();
        occurrences(text, &fold_query(query), 100)
            .into_iter()
            .map(|(a, b)| String::from_utf16(&units[a..b]).unwrap())
            .collect()
    }

    #[test]
    fn case_and_accents_are_ignored_and_the_original_text_is_returned() {
        assert_eq!(
            find("Remain in me. REMAIN!", "remain"),
            ["Remain", "REMAIN"]
        );
        assert_eq!(find("Vergleiche Röm 6,1", "rom"), ["Röm"]);
        assert_eq!(find("Römer und Roemer", "Röm"), ["Röm"]);
        assert_eq!(find("Ἐν ἀρχῇ ἦν ὁ λόγος", "λογος"), ["λόγος"]);
        assert_eq!(find("בְּרֵאשִׁית בָּרָא", "בראשית"), ["בְּרֵאשִׁית"]);
    }

    #[test]
    fn whitespace_runs_count_as_one_space() {
        assert_eq!(
            find("abide\u{a0}in  me", "abide in me"),
            ["abide\u{a0}in  me"]
        );
        assert_eq!(find("abide in me", "  abide   in "), ["abide in"]);
    }

    #[test]
    fn hangul_is_matched_by_whole_syllables() {
        assert_eq!(find("하나님이 세상을", "하나님"), ["하나님"]);
        assert!(
            find("한 사람", "하").is_empty(),
            "half a syllable is not a match"
        );
    }

    #[test]
    fn matches_do_not_overlap_and_ranges_are_utf16() {
        assert_eq!(find("aaaa", "aa"), ["aa", "aa"]);
        // a character outside the BMP is two UTF-16 units
        let text = "𝔄 abide";
        let ranges = occurrences(text, &fold_query("abide"), 10);
        assert_eq!(ranges, [(3, 8)]);
        assert!(find("anything", "").is_empty());
        assert!(find("anything", "   ").is_empty());
    }
}
