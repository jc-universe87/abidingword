//! Canonical Scripture references.
//!
//! A [`ScriptureRef`] is a validated range inside one book of the canon.
//! It has three interchangeable forms:
//!
//! | Form | Example |
//! |---|---|
//! | canonical string | `JHN.15.1-JHN.15.11`, `ROM.8`, `JHN.14-JHN.16` |
//! | structured | book + start (chapter, verse?) + end (chapter, verse?) |
//! | display | `John 15:1–11`, `Romans 8`, `John 14–16` |
//!
//! Canonical strings are translation-independent and are what the database,
//! the frontend and future integrations exchange. Anything arriving from
//! outside is parsed with [`ScriptureRef::from_canonical`] before use.
//!
//! Every verse also has a stable integer key, `BBCCCVVV` (book ordinal,
//! chapter, verse), used as `bible_verses.id`.

use std::fmt;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::scripture::canon::{self, Book};

/// No chapter in the canon has more verses than Psalm 119 (176).
pub const MAX_VERSE: u16 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Point {
    pub chapter: u16,
    /// `None` means the whole chapter (as a start: its beginning; as an
    /// end: its last verse).
    pub verse: Option<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptureRef {
    pub book: &'static Book,
    pub start: Point,
    pub end: Point,
}

impl ScriptureRef {
    /// Builds and validates a reference.
    pub fn new(book: &'static Book, start: Point, end: Point) -> AppResult<Self> {
        let reference = Self { book, start, end };
        reference.validate()?;
        Ok(reference)
    }

    pub fn verse(book: &'static Book, chapter: u16, verse: u16) -> AppResult<Self> {
        let point = Point {
            chapter,
            verse: Some(verse),
        };
        Self::new(book, point, point)
    }

    pub fn chapter(book: &'static Book, chapter: u16) -> AppResult<Self> {
        let point = Point {
            chapter,
            verse: None,
        };
        Self::new(book, point, point)
    }

    fn validate(&self) -> AppResult<()> {
        let book = self.book;
        for point in [self.start, self.end] {
            if point.chapter == 0 || point.chapter > book.chapter_count {
                return Err(AppError::InvalidReference(if book.chapter_count == 1 {
                    format!("{} has only one chapter.", book.name)
                } else {
                    format!("{} has {} chapters.", book.name, book.chapter_count)
                }));
            }
            if let Some(verse) = point.verse {
                if verse == 0 || verse > MAX_VERSE {
                    return Err(AppError::InvalidReference(format!(
                        "Verse {verse} is not a valid verse number."
                    )));
                }
            }
        }
        if self.end_key() < self.start_key() {
            return Err(AppError::InvalidReference(
                "The end of the passage comes before its start.".into(),
            ));
        }
        Ok(())
    }

    /// First verse key covered (verse 0 stands for "from the chapter start").
    pub fn start_key(&self) -> i64 {
        verse_key(
            self.book.ordinal,
            self.start.chapter,
            self.start.verse.unwrap_or(0),
        )
    }

    /// Last verse key covered (verse 999 stands for "to the chapter end").
    pub fn end_key(&self) -> i64 {
        verse_key(
            self.book.ordinal,
            self.end.chapter,
            self.end.verse.unwrap_or(999),
        )
    }

    pub fn contains_key(&self, key: i64) -> bool {
        (self.start_key()..=self.end_key()).contains(&key)
    }

    pub fn is_single_verse(&self) -> bool {
        self.start == self.end && self.start.verse.is_some()
    }

    /// e.g. `JHN.15.7`, `JHN.15.1-JHN.15.11`, `ROM.8`, `JHN.14-JHN.16`.
    pub fn canonical(&self) -> String {
        let point = |p: Point| match p.verse {
            Some(v) => format!("{}.{}.{}", self.book.code, p.chapter, v),
            None => format!("{}.{}", self.book.code, p.chapter),
        };
        if self.start == self.end {
            point(self.start)
        } else {
            format!("{}-{}", point(self.start), point(self.end))
        }
    }

    /// Parses a canonical string; anything else is rejected.
    pub fn from_canonical(value: &str) -> AppResult<Self> {
        let invalid =
            || AppError::InvalidReference(format!("“{value}” is not a valid passage reference."));
        let parse_point = |part: &str| -> AppResult<(&'static Book, Point)> {
            let mut pieces = part.split('.');
            let book = pieces.next().and_then(canon::by_code).ok_or_else(invalid)?;
            let chapter = pieces
                .next()
                .and_then(|c| c.parse().ok())
                .ok_or_else(invalid)?;
            let verse = match pieces.next() {
                Some(v) => Some(v.parse().map_err(|_| invalid())?),
                None => None,
            };
            if pieces.next().is_some() {
                return Err(invalid());
            }
            Ok((book, Point { chapter, verse }))
        };
        let mut parts = value.trim().split('-');
        let (book, start) = parse_point(parts.next().ok_or_else(invalid)?)?;
        let end = match parts.next() {
            Some(part) => {
                let (end_book, end) = parse_point(part)?;
                if end_book.code != book.code {
                    return Err(AppError::InvalidReference(
                        "A passage must stay within one book.".into(),
                    ));
                }
                end
            }
            None => start,
        };
        if parts.next().is_some() {
            return Err(invalid());
        }
        Self::new(book, start, end)
    }

    /// e.g. `John 15:7`, `John 15:1–11`, `John 15:1–16:4`, `Romans 8`,
    /// `John 14–16`, `Jude 3`.
    pub fn display(&self) -> String {
        let name = self.book.name;
        let one_chapter_book = self.book.chapter_count == 1;
        let (s, e) = (self.start, self.end);
        let point = |p: Point| match (p.verse, one_chapter_book) {
            (Some(v), true) => v.to_string(),
            (Some(v), false) => format!("{}:{}", p.chapter, v),
            (None, _) => p.chapter.to_string(),
        };
        if one_chapter_book && s.verse.is_none() && e.verse.is_none() {
            return name.to_string();
        }
        if s == e {
            return format!("{name} {}", point(s));
        }
        let end = if s.chapter == e.chapter && s.verse.is_some() && e.verse.is_some() {
            e.verse.unwrap_or_default().to_string()
        } else {
            point(e)
        };
        format!("{name} {}–{}", point(s), end)
    }

    pub fn to_dto(&self) -> ScriptureRefDto {
        ScriptureRefDto {
            canonical: self.canonical(),
            display: self.display(),
            book: self.book.code,
            start_chapter: self.start.chapter,
            start_verse: self.start.verse,
            end_chapter: self.end.chapter,
            end_verse: self.end.verse,
        }
    }
}

impl fmt::Display for ScriptureRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.canonical())
    }
}

/// The frontend's view of a reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptureRefDto {
    pub canonical: String,
    pub display: String,
    pub book: &'static str,
    pub start_chapter: u16,
    pub start_verse: Option<u16>,
    pub end_chapter: u16,
    pub end_verse: Option<u16>,
}

pub fn verse_key(book_ordinal: u8, chapter: u16, verse: u16) -> i64 {
    i64::from(book_ordinal) * 1_000_000 + i64::from(chapter) * 1_000 + i64::from(verse)
}

/// Splits a verse key back into (book ordinal, chapter, verse).
pub fn split_key(key: i64) -> (u8, u16, u16) {
    (
        (key / 1_000_000) as u8,
        ((key / 1_000) % 1_000) as u16,
        (key % 1_000) as u16,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(value: &str) -> ScriptureRef {
        ScriptureRef::from_canonical(value).unwrap()
    }

    #[test]
    fn canonical_round_trips() {
        for value in [
            "JHN.15.7",
            "JHN.15.1-JHN.15.11",
            "ROM.8",
            "JHN.14-JHN.16",
            "JHN.15.1-JHN.16.4",
            "PSA.119.176",
        ] {
            assert_eq!(r(value).canonical(), value);
        }
    }

    #[test]
    fn display_forms_read_naturally() {
        assert_eq!(r("JHN.15.7").display(), "John 15:7");
        assert_eq!(r("JHN.15.1-JHN.15.11").display(), "John 15:1–11");
        assert_eq!(r("JHN.15.1-JHN.16.4").display(), "John 15:1–16:4");
        assert_eq!(r("ROM.8").display(), "Romans 8");
        assert_eq!(r("JHN.14-JHN.16").display(), "John 14–16");
        assert_eq!(r("1CO.13.4-1CO.13.7").display(), "1 Corinthians 13:4–7");
        assert_eq!(r("JUD.1.3").display(), "Jude 3");
        assert_eq!(r("JUD.1").display(), "Jude");
    }

    #[test]
    fn invalid_canonical_strings_are_rejected() {
        for value in [
            "",
            "JHN",
            "XYZ.1.1",
            "JHN.22",
            "JHN.0",
            "JHN.3.0",
            "JHN.3.x",
            "JHN.3.16.1",
            "JHN.3.16-ROM.1.1",
            "JHN.4-JHN.3",
            "JHN.3.16-JHN.3.1",
            "JHN.1-JHN.2-JHN.3",
        ] {
            assert!(
                ScriptureRef::from_canonical(value).is_err(),
                "{value:?} accepted"
            );
        }
    }

    #[test]
    fn verse_keys_order_the_whole_canon() {
        let key = verse_key(43, 15, 7);
        assert_eq!(key, 43_015_007);
        assert_eq!(split_key(key), (43, 15, 7));
        let chapter = r("ROM.8");
        assert!(chapter.contains_key(verse_key(45, 8, 1)));
        assert!(chapter.contains_key(verse_key(45, 8, 39)));
        assert!(!chapter.contains_key(verse_key(45, 9, 1)));
    }
}
