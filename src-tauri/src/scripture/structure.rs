//! Finding books, chapters and verses in an ordinary document (v0.23).
//!
//! The units of a Bible document (`scripture::documents`: PDF and text
//! lines, EPUB/DOCX/Markdown paragraphs and headings) are read in order.
//! What counts as evidence, and what never does:
//!
//! * **Book names** count only as a whole heading or line ("Genesis",
//!   "1. Mose", "창세기", "בראשית", "ΚΑΤΑ ΙΩΑΝΝΗΝ"), read with the reference
//!   dictionaries of the six interface languages and of Hebrew and Greek. A
//!   file name, a table of contents or a reference inside a sentence never
//!   names a book.
//! * **Chapters** come from a heading ("Chapter 3", "Kapitel 3", "3장",
//!   "Psalm 23"), a line reference ("3:1 …"), or a chapter number standing at
//!   the start of a paragraph where the previous chapter is complete by the
//!   standard verse counts (the large chapter numbers printed Bibles use).
//! * **Verses** come from numbers in the text that continue the count: the
//!   next verse (or a bridge such as "4–5"), at the start of a line or after
//!   punctuation, or — for the very next verse only — after a space. A
//!   number glued to a word ("God1", "5th"), followed by ":" or "," and a
//!   digit (a reference), or after a word such as "chapter" or a book name is
//!   never a verse number. Where two places could start the same verse
//!   equally well, the chapter is refused ([`Severity::Error`]), never
//!   guessed.
//!
//! Text that belongs to no verse (introductions, headings inside a chapter,
//! notes sections, a document's own front matter) is left out and reported;
//! page headers and page numbers repeated on most pages of a PDF are taken
//! out and counted. A Psalm's title before its verse 1 is kept as its title.
//! Nothing is invented: a verse without a number in the text is a missing
//! verse, except the first verse of a chapter that starts right after its
//! heading or chapter number (reported).
//!
//! The result is the same staged content every Bible import fills
//! (`scripture::import::StagedContent`), checked by the same structure
//! checks, plus where each verse came from in the document.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::OnceLock;

use serde::Serialize;

use crate::error::UserMessage;
use crate::scripture::canon::{self, Book};
use crate::scripture::documents::{Place, Unit};
use crate::scripture::import::{Severity, StagedContent};
use crate::scripture::language::ReferenceLanguage;
use crate::scripture::parser::{fold_marks, normalise, ReferenceParser};

/// A verse longer than this cannot be one verse (the longest, Esther 8:9,
/// is about 540 characters in English): the structure was not recognised.
const VERSE_MAX_CHARS: usize = 2_500;
/// How far ahead a verse number looks for a better place for the same verse.
const LOOKAHEAD: usize = 400;
/// A chapter this many verses shorter than usual may be another numbering
/// (Joel 2 has 27 verses in Hebrew Bibles, 32 in English ones); more, and
/// its end was not found.
const SHORT_TOLERANCE: u16 = 6;
/// Samples of left-out text kept for the review.
const SAMPLES: usize = 12;

/// Where a recognised verse came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub start: Place,
    pub end: Place,
}

/// A book heading found in the document, as the review lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundBook {
    /// Its place in the list (corrections name it by this).
    pub index: usize,
    /// The heading as written.
    pub heading: String,
    /// The book the heading names, if it names one.
    pub detected: Option<&'static str>,
    /// The book used: the detected one, or the person's correction (None:
    /// none, or left out).
    pub book: Option<&'static str>,
    pub left_out: bool,
    pub chapters: usize,
    pub verses: usize,
    pub place: Place,
}

/// Text left out of the verses, as the review shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftOut {
    pub sample: String,
    pub chars: usize,
    pub place: Place,
    /// "heading", "beforeVerses", "noBook", "notes", "leftOutBook".
    pub reason: &'static str,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Lines taken out as page headers or page numbers (PDF).
    pub page_lines: usize,
    /// Headings inside chapters left out of the text.
    pub headings: usize,
    /// Characters of text left out (all reasons).
    pub left_out_chars: usize,
    pub psalm_titles: usize,
    /// Chapters whose verse 1 had no number of its own.
    pub unnumbered_first: usize,
    /// Chapters found by their number alone (no heading).
    pub numbered_chapters: usize,
}

/// The person's corrections: for a found book (by index), another book or
/// none (leave it out).
#[derive(Debug, Clone, Default)]
pub struct Corrections {
    pub books: HashMap<usize, Option<&'static Book>>,
}

#[derive(Debug, Default)]
pub struct Recognition {
    pub content: StagedContent,
    pub origins: BTreeMap<(u8, u16, u16), Origin>,
    pub books: Vec<FoundBook>,
    pub left_out: Vec<LeftOut>,
    pub stats: Stats,
}

impl Recognition {
    pub fn verse_count(&self) -> usize {
        self.content.verse_count()
    }

    /// Whether the verses can be used: some were found and nothing
    /// contradicts itself.
    pub fn usable(&self) -> bool {
        self.verse_count() > 0 && !self.content.has_errors()
    }
}

// --- book names ---------------------------------------------------------------

/// A heading's text made comparable: marks folded, lower case, no full stops.
fn key(text: &str) -> String {
    normalise(&fold_marks(text))
}

/// Greek titles of the New Testament books (as printed in Greek editions).
const GREEK_TITLES: &[(&str, &str)] = &[
    ("ΚΑΤΑ ΜΑΤΘΑΙΟΝ", "MAT"),
    ("ΚΑΤΑ ΜΑΘΘΑΙΟΝ", "MAT"),
    ("ΚΑΤΑ ΜΑΡΚΟΝ", "MRK"),
    ("ΚΑΤΑ ΛΟΥΚΑΝ", "LUK"),
    ("ΚΑΤΑ ΙΩΑΝΝΗΝ", "JHN"),
    ("ΠΡΑΞΕΙΣ ΑΠΟΣΤΟΛΩΝ", "ACT"),
    ("ΠΡΑΞΕΙΣ", "ACT"),
    ("ΠΡΟΣ ΡΩΜΑΙΟΥΣ", "ROM"),
    ("ΠΡΟΣ ΚΟΡΙΝΘΙΟΥΣ Α", "1CO"),
    ("ΠΡΟΣ ΚΟΡΙΝΘΙΟΥΣ Β", "2CO"),
    ("ΠΡΟΣ ΓΑΛΑΤΑΣ", "GAL"),
    ("ΠΡΟΣ ΕΦΕΣΙΟΥΣ", "EPH"),
    ("ΠΡΟΣ ΦΙΛΙΠΠΗΣΙΟΥΣ", "PHP"),
    ("ΠΡΟΣ ΚΟΛΟΣΣΑΕΙΣ", "COL"),
    ("ΠΡΟΣ ΘΕΣΣΑΛΟΝΙΚΕΙΣ Α", "1TH"),
    ("ΠΡΟΣ ΘΕΣΣΑΛΟΝΙΚΕΙΣ Β", "2TH"),
    ("ΠΡΟΣ ΤΙΜΟΘΕΟΝ Α", "1TI"),
    ("ΠΡΟΣ ΤΙΜΟΘΕΟΝ Β", "2TI"),
    ("ΠΡΟΣ ΤΙΤΟΝ", "TIT"),
    ("ΠΡΟΣ ΦΙΛΗΜΟΝΑ", "PHM"),
    ("ΠΡΟΣ ΕΒΡΑΙΟΥΣ", "HEB"),
    ("ΙΑΚΩΒΟΥ", "JAS"),
    ("ΠΕΤΡΟΥ Α", "1PE"),
    ("ΠΕΤΡΟΥ Β", "2PE"),
    ("ΙΩΑΝΝΟΥ Α", "1JN"),
    ("ΙΩΑΝΝΟΥ Β", "2JN"),
    ("ΙΩΑΝΝΟΥ Γ", "3JN"),
    ("ΙΟΥΔΑ", "JUD"),
    ("ΑΠΟΚΑΛΥΨΙΣ ΙΩΑΝΝΟΥ", "REV"),
    ("ΑΠΟΚΑΛΥΨΙΣ", "REV"),
];

/// Words in front of a book's name in a title, dropped before looking it up.
const TITLE_PREFIXES: &[&str] = &[
    "the book of ",
    "book of ",
    // Longer forms first: the first prefix that matches is taken.
    "the gospel according to saint ",
    "the gospel according to st ",
    "the gospel according to ",
    "the gospel of ",
    "das buch ",
    "das evangelium nach ",
    "evangelium nach ",
    "le livre de ",
    "livre de ",
    "l'evangile selon ",
    "evangile selon ",
    "el libro de ",
    "libro de ",
    "el evangelio segun ",
    "evangelio segun ",
    "o livro de ",
    "livro de ",
    "o evangelho segundo ",
    "evangelho segundo ",
];

/// The languages whose book names are read: the six interface languages,
/// Hebrew and Greek.
fn name_languages() -> Vec<ReferenceLanguage> {
    let mut languages = ReferenceLanguage::REVIEWED.to_vec();
    for code in ["he", "el"] {
        if let Some(language) = ReferenceLanguage::from_label(code) {
            languages.push(language);
        }
    }
    languages
}

/// Every book name, by its key: the books it can mean, with the language.
fn names() -> &'static HashMap<String, Vec<(&'static Book, ReferenceLanguage)>> {
    static TABLE: OnceLock<HashMap<String, Vec<(&'static Book, ReferenceLanguage)>>> =
        OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table: HashMap<String, Vec<(&'static Book, ReferenceLanguage)>> = HashMap::new();
        let mut add = |name: &str, book: &'static Book, language: ReferenceLanguage| {
            let entry = table.entry(key(name)).or_default();
            if !entry
                .iter()
                .any(|(b, l)| b.code == book.code && *l == language)
            {
                entry.push((book, language));
            }
        };
        for book in canon::BOOKS.iter() {
            add(book.name, book, ReferenceLanguage::En);
        }
        for language in name_languages() {
            for (name, book) in ReferenceParser::for_language(language).lookup_entries() {
                add(name, book, language);
            }
        }
        for (title, code) in GREEK_TITLES {
            if let (Some(book), Some(greek)) =
                (canon::by_code(code), ReferenceLanguage::from_label("el"))
            {
                add(title, book, greek);
            }
        }
        table
    })
}

/// The book a whole heading names, if exactly one (the document's language
/// decides between books that share a name).
fn book_named(text: &str, language: Option<ReferenceLanguage>) -> Option<&'static Book> {
    let mut k = key(text);
    for prefix in TITLE_PREFIXES {
        if let Some(rest) = k.strip_prefix(prefix) {
            k = rest.to_string();
            break;
        }
    }
    let found = names().get(&k)?;
    let mut books: Vec<&'static Book> = Vec::new();
    for (book, _) in found {
        if !books.iter().any(|b| b.code == book.code) {
            books.push(book);
        }
    }
    match books.as_slice() {
        [one] => Some(one),
        _ => {
            let language = language?;
            let own: Vec<&'static Book> = found
                .iter()
                .filter(|(_, l)| *l == language)
                .map(|(b, _)| *b)
                .collect();
            match own.as_slice() {
                [one] => Some(one),
                _ => None,
            }
        }
    }
}

// --- numbers -------------------------------------------------------------------

fn superscript_digit(c: char) -> Option<u32> {
    match c {
        '⁰' => Some(0),
        '¹' => Some(1),
        '²' => Some(2),
        '³' => Some(3),
        '⁴'..='⁹' => Some(c as u32 - '⁴' as u32 + 4),
        _ => None,
    }
}

fn roman(text: &str) -> Option<u16> {
    if text.is_empty() || text.len() > 9 || !text.chars().all(|c| "IVXLC".contains(c)) {
        return None;
    }
    let value = |c| match c {
        'I' => 1,
        'V' => 5,
        'X' => 10,
        'L' => 50,
        _ => 100,
    };
    let chars: Vec<i32> = text.chars().map(value).collect();
    let mut total = 0i32;
    for (i, v) in chars.iter().enumerate() {
        if chars.get(i + 1).is_some_and(|next| next > v) {
            total -= v;
        } else {
            total += v;
        }
    }
    (total > 0).then_some(total as u16)
}

/// A Hebrew numeral (א = 1 … ת = 400; ט״ו = 15), its marks ignored.
fn hebrew_numeral(text: &str) -> Option<u16> {
    let mut total = 0u16;
    let mut any = false;
    for c in text.chars() {
        let v = match c {
            'א'..='ט' => c as u16 - 'א' as u16 + 1,
            'י' => 10,
            'כ' | 'ך' => 20,
            'ל' => 30,
            'מ' | 'ם' => 40,
            'נ' | 'ן' => 50,
            'ס' => 60,
            'ע' => 70,
            'פ' | 'ף' => 80,
            'צ' | 'ץ' => 90,
            'ק' => 100,
            'ר' => 200,
            'ש' => 300,
            'ת' => 400,
            '\'' | '"' | '׳' | '״' => continue,
            _ => return None,
        };
        total += v;
        any = true;
    }
    (any && total > 0).then_some(total)
}

/// A number written as a chapter number: digits, Roman, or Hebrew letters.
fn chapter_number(text: &str) -> Option<u16> {
    let t = text.trim();
    if !t.is_empty() && t.len() <= 3 && t.chars().all(|c| c.is_ascii_digit()) {
        return t.parse().ok().filter(|n| *n > 0);
    }
    roman(t).or_else(|| hebrew_numeral(t))
}

// --- headings --------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Heading {
    Book(&'static Book),
    BookChapter(&'static Book, u16),
    Chapter(u16),
}

/// Words that name a chapter, before its number ("Chapter 3").
const CHAPTER_WORDS: &[&str] = &[
    "chapter",
    "chap",
    "kapitel",
    "chapitre",
    "capitulo",
    "capítulo",
    "κεφαλαιο",
    "κεφαλαιον",
    "פרק",
];
/// Words that name a Psalm, before its number ("Psalm 23").
const PSALM_WORDS: &[&str] = &[
    "psalm",
    "psalms",
    "psaume",
    "salmo",
    "salmos",
    "ψαλμος",
    "מזמור",
];

/// Removes the invisible marks a document may carry (bidirectional
/// controls, soft hyphens, zero-width characters); they are not text.
fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{00AD}' | '\u{FEFF}'
            )
        })
        .map(|c| if c == '\u{00A0}' { ' ' } else { c })
        .collect()
}

/// What a heading or a heading-like line says, if it names a book or a
/// chapter. The whole text must be the name: nothing else on the line.
fn read_heading(text: &str, language: Option<ReferenceLanguage>) -> Option<Heading> {
    let text = text.trim().trim_end_matches(['.', ':', '·']).trim();
    if text.is_empty() || text.chars().count() > 60 {
        return None;
    }
    let lower = key(text);
    let words: Vec<&str> = lower.split(' ').collect();
    // "Chapter 3", "פרק ג", "Κεφάλαιο 3".
    if words.len() == 2 && CHAPTER_WORDS.contains(&words[0]) {
        let raw: Vec<&str> = text.split_whitespace().collect();
        let number = raw.last().map(|n| n.trim_end_matches('.'))?;
        return chapter_number(number).map(Heading::Chapter);
    }
    // "3. Kapitel"
    if words.len() == 2 && words[1] == "kapitel" {
        return chapter_number(words[0].trim_end_matches('.')).map(Heading::Chapter);
    }
    // Korean: "제3장", "3장", "제 3 장", "제3편", "3편".
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if let Some(n) = korean_unit(&compact, &['장', '편']) {
        return Some(Heading::Chapter(n));
    }
    // "Psalm 23"
    if words.len() == 2 && PSALM_WORDS.contains(&words[0]) {
        let psalms = canon::by_code("PSA")?;
        return chapter_number(text.split_whitespace().last()?)
            .map(|n| Heading::BookChapter(psalms, n));
    }
    // A book's name alone.
    if let Some(book) = book_named(text, language) {
        return Some(Heading::Book(book));
    }
    // A book's name and a chapter: "Genesis 1", "1 Mose 3", "창세기 1장", "시편 제23편".
    let mut parts: Vec<&str> = text.split_whitespace().collect();
    if parts.len() >= 2 {
        let last = parts.pop()?;
        let number =
            korean_unit(last, &['장', '편']).or_else(|| chapter_number(last.trim_end_matches('.')));
        if let Some(number) = number {
            let name = parts.join(" ");
            if let Some(book) = book_named(&name, language) {
                return Some(Heading::BookChapter(book, number));
            }
        }
    }
    // "창세기1장"
    if let Some(at) = compact.find(|c: char| c.is_ascii_digit()) {
        if at > 0 {
            if let (Some(book), Some(n)) = (
                book_named(&compact[..at], language),
                korean_unit(&compact[at..], &['장', '편']),
            ) {
                return Some(Heading::BookChapter(book, n));
            }
        }
    }
    None
}

/// "제3장" / "3장" (and 편 for Psalms) → 3.
fn korean_unit(text: &str, units: &[char]) -> Option<u16> {
    let t = text.strip_prefix('제').unwrap_or(text);
    let last = t.chars().last()?;
    if !units.contains(&last) {
        return None;
    }
    let digits = &t[..t.len() - last.len_utf8()];
    if digits.is_empty() || digits.len() > 3 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n > 0)
}

/// Headings of notes sections: what follows them is not Scripture text.
fn is_notes_heading(text: &str) -> bool {
    matches!(
        key(text).as_str(),
        "footnotes"
            | "notes"
            | "endnotes"
            | "fussnoten"
            | "fußnoten"
            | "anmerkungen"
            | "각주"
            | "미주"
            | "notes de bas de page"
            | "notas"
            | "notas al pie"
            | "notas de rodape"
            | "cross references"
            | "querverweise"
    )
}

// --- verse numbers -----------------------------------------------------------------

/// How sure a number is to be a verse number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Strength {
    /// After a space, mid-sentence: only ever the very next verse.
    Medium = 1,
    /// At the start of a line or paragraph, after punctuation, or raised.
    Strong = 2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Marker {
    value: u16,
    end: Option<u16>,
    /// A line reference names its chapter ("3:16 …").
    chapter: Option<u16>,
    /// … and sometimes its book ("Genesis 1:1 …").
    book: Option<&'static Book>,
    strength: Strength,
    unit_start: bool,
    /// The number as written ("12", "(3)", "4–5", "3:16"), put back into the
    /// text when it turns out not to be a verse number.
    raw: String,
    /// Whether the text goes on right after it, with no space ("1In").
    glued: bool,
    /// Whether it follows the text before it with no space ("away.3").
    joined: bool,
}

/// Punctuation a verse can end with, before the next verse's number.
fn ends_sentence(c: char) -> bool {
    matches!(
        c,
        '.' | ','
            | ';'
            | ':'
            | '!'
            | '?'
            | '׃'
            | '·'
            | '\u{037E}'
            | '»'
            | '”'
            | '"'
            | '’'
            | '\''
            | ')'
            | ']'
            | '…'
            | '。'
            | '」'
            | '—'
            | '–'
            | '¶'
            | '*'
    )
}

/// Words after which a number is a reference, never a verse number.
const BEFORE_NUMBER: &[&str] = &[
    "chapter",
    "chapters",
    "verse",
    "verses",
    "v",
    "vv",
    "ver",
    "kapitel",
    "vers",
    "verse",
    "chapitre",
    "chapitres",
    "verset",
    "versets",
    "capitulo",
    "capitulos",
    "versiculo",
    "versiculos",
    "psalm",
    "psalms",
    "ps",
    "page",
    "p",
    "seite",
    "s",
    "pagina",
    "anno",
    "year",
    "jahr",
    "an",
];

/// A piece of a unit's text: words, or a verse number.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Piece {
    Text(String),
    Marker(Marker),
}

/// A line reference read: chapter, verse, a bridge's last verse, the book
/// it names, and the bytes it takes.
type LineReference = (u16, u16, Option<u16>, Option<&'static Book>, usize);

/// A line reference at the very start of a unit: "3:16 …", "3.16 …",
/// "Genesis 1:1 …", "1 Mose 1,1 …" — the chapter, verse, bridge end, book
/// and the byte length taken.
fn line_reference(text: &str, language: Option<ReferenceLanguage>) -> Option<LineReference> {
    let mut book = None;
    let mut rest = text;
    let mut taken = 0usize;
    if !text.starts_with(|c: char| c.is_ascii_digit())
        || text.starts_with(|c: char| c.is_ascii_digit())
            && text.chars().nth(1).is_some_and(|c| c == ' ')
    {
        // A book name of one to four words first ("1 Mose" starts with a digit too).
        let words: Vec<(usize, &str)> = text
            .split_inclusive(' ')
            .scan(0usize, |at, w| {
                let start = *at;
                *at += w.len();
                Some((start, w))
            })
            .take(5)
            .collect();
        for n in (1..=words.len().min(4)).rev() {
            let end = words[n - 1].0 + words[n - 1].1.len();
            let name = text[..end].trim();
            if let Some(found) = book_named(name, language) {
                let after = &text[end..];
                if after.starts_with(|c: char| c.is_ascii_digit()) {
                    book = Some(found);
                    rest = after;
                    taken = end;
                    break;
                }
            }
        }
    }
    let digits = |s: &str| s.chars().take_while(|c| c.is_ascii_digit()).count();
    let c_len = digits(rest);
    if c_len == 0 || c_len > 3 {
        return None;
    }
    let sep = rest[c_len..].chars().next()?;
    if !matches!(sep, ':' | '.' | ',') {
        return None;
    }
    let after_sep = &rest[c_len + 1..];
    let v_len = digits(after_sep);
    if v_len == 0 || v_len > 3 {
        return None;
    }
    let chapter: u16 = rest[..c_len].parse().ok()?;
    let verse: u16 = after_sep[..v_len].parse().ok()?;
    // "2,300" and "1.500" are numbers, not chapter and verse: a three-digit
    // verse after "," or "." is only Psalm 119's. No chapter has more than
    // 176 verses, nor any book more than 150 chapters.
    if sep != ':' && v_len == 3 && chapter != 119 {
        return None;
    }
    if verse > 176 || chapter > 150 {
        return None;
    }
    // Far beyond the chapter's standard count (other numberings differ by a few).
    if let Some(count) = book.and_then(|b| canon::verse_count(b, chapter)) {
        if verse > count + 10 {
            return None;
        }
    }
    let mut used = c_len + 1 + v_len;
    let mut end = None;
    let tail = &rest[used..];
    if let Some(dash) = tail.chars().next().filter(|c| matches!(c, '-' | '–' | '—')) {
        let more = &tail[dash.len_utf8()..];
        let e_len = digits(more);
        if (1..=3).contains(&e_len) {
            let last: u16 = more[..e_len].parse().ok()?;
            if last > verse && last - verse <= 10 {
                end = Some(last);
                used += dash.len_utf8() + e_len;
            }
        }
    }
    // A reference ends at a space or the line's end, never inside a word or number.
    let next = rest[used..].chars().next();
    if next.is_some_and(|c| !c.is_whitespace()) {
        return None;
    }
    (chapter > 0 && verse > 0).then_some((chapter, verse, end, book, taken + used))
}

/// The text of a unit cut into words and candidate verse numbers.
fn pieces(text: &str, language: Option<ReferenceLanguage>) -> Vec<Piece> {
    let mut out: Vec<Piece> = Vec::new();
    let mut from = 0usize;
    if let Some((chapter, verse, end, book, taken)) = line_reference(text, language) {
        out.push(Piece::Marker(Marker {
            value: verse,
            end,
            chapter: Some(chapter),
            book,
            strength: Strength::Strong,
            unit_start: true,
            raw: text[..taken].to_string(),
            glued: false,
            joined: false,
        }));
        from = taken;
    }
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut i = chars
        .iter()
        .position(|(at, _)| *at >= from)
        .unwrap_or(chars.len());
    let mut text_start = from;
    while i < chars.len() {
        let (at, c) = chars[i];
        let is_digit = c.is_ascii_digit();
        let raised = superscript_digit(c).is_some();
        if !(is_digit || raised) {
            i += 1;
            continue;
        }
        // The whole run of digits of one kind.
        let mut j = i;
        while j < chars.len()
            && (if raised {
                superscript_digit(chars[j].1).is_some()
            } else {
                chars[j].1.is_ascii_digit()
            })
        {
            j += 1;
        }
        let run: String = chars[i..j].iter().map(|(_, c)| *c).collect();
        let next_index = j;
        let candidate = (|| -> Option<(Marker, usize)> {
            if run.chars().count() > 3 {
                return None;
            }
            let value: u16 = if raised {
                run.chars()
                    .filter_map(superscript_digit)
                    .fold(0, |v, d| v * 10 + d) as u16
            } else {
                run.parse().ok()?
            };
            if value == 0 {
                return None;
            }
            // What comes before: nothing (the start), a space, punctuation, or a word.
            let before = &text[..at];
            let prev = before.chars().last();
            let opened = prev.is_some_and(|p| matches!(p, '(' | '['));
            let prev_solid = before.trim_end().chars().last();
            if prev.is_some_and(|p| p.is_alphanumeric()) {
                // Glued to a word: "God1", "v2", a raised footnote mark after a word.
                return None;
            }
            let number_before = prev
                .filter(|p| matches!(p, ':' | '.' | ',' | '-' | '–'))
                .is_some_and(|p| {
                    before[..before.len() - p.len_utf8()]
                        .chars()
                        .last()
                        .is_some_and(|c| c.is_ascii_digit())
                });
            if number_before {
                // The second number of a reference or range: "3:16", "3,16", "4-5".
                return None;
            }
            let at_start = before
                .trim_start_matches(['(', '[', '“', '"', '‘', '\'', '¶'])
                .trim()
                .is_empty();
            let strength = if at_start || raised || prev_solid.is_some_and(ends_sentence) || opened
            {
                Strength::Strong
            } else if prev.is_some_and(char::is_whitespace) {
                Strength::Medium
            } else {
                return None;
            };
            if strength == Strength::Medium {
                // "chapter 3", "John 3", "page 12": a reference or a count, not a verse.
                let word = before
                    .trim_end()
                    .rsplit(|c: char| c.is_whitespace())
                    .next()
                    .unwrap_or("");
                let w = key(word.trim_matches(|c: char| !c.is_alphanumeric()));
                if BEFORE_NUMBER.contains(&w.as_str()) || book_named(word, language).is_some() {
                    return None;
                }
            }
            // What comes after.
            let mut k = next_index;
            let mut end = None;
            if !raised {
                if let Some(&(_, dash)) = chars.get(k).filter(|(_, d)| matches!(d, '-' | '–' | '—'))
                {
                    let _ = dash;
                    let mut m = k + 1;
                    while m < chars.len() && chars[m].1.is_ascii_digit() {
                        m += 1;
                    }
                    if m > k + 1 && m - (k + 1) <= 3 {
                        let last: u16 = chars[k + 1..m]
                            .iter()
                            .map(|(_, c)| *c)
                            .collect::<String>()
                            .parse()
                            .ok()?;
                        if last > value && last - value <= 10 {
                            end = Some(last);
                            k = m;
                        }
                    }
                }
            }
            if opened {
                // "(2)" or "[2]": the bracket must close right after.
                match chars.get(k) {
                    Some((_, ')' | ']')) => k += 1,
                    _ => return None,
                }
            }
            match chars.get(k).map(|(_, c)| *c) {
                None => {}
                Some(c) if c.is_whitespace() => {}
                Some(':' | ',') if chars.get(k + 1).is_some_and(|(_, d)| d.is_ascii_digit()) => {
                    return None
                }
                Some('.') if chars.get(k + 1).is_some_and(|(_, d)| d.is_ascii_digit()) => {
                    return None
                }
                // "1. In the beginning": a numbered verse.
                Some('.') if chars.get(k + 1).is_none_or(|(_, d)| d.is_whitespace()) => k += 1,
                Some('%' | '°' | '/' | ':' | ',' | '.' | '€' | '$' | '£') => return None,
                // Korean units: "3장", "4절", "23편" are references, not verse numbers.
                Some('장' | '절' | '편') => return None,
                Some(c) if c.is_alphabetic() => {
                    // "5th", "3rd", "10km": a Latin small letter glued on is a word.
                    if c.is_ascii_lowercase() {
                        return None;
                    }
                    if strength == Strength::Medium && !c.is_uppercase() && c.is_ascii() {
                        return None;
                    }
                }
                Some('“' | '"' | '‘' | '\'' | '«' | '(' | '[' | '—' | '–' | '¿' | '¡') =>
                    {}
                Some(_) => return None,
            }
            // A bracketed number keeps its opening bracket out of the text.
            Some((
                Marker {
                    value,
                    end,
                    chapter: None,
                    book: None,
                    strength,
                    unit_start: at_start,
                    raw: String::new(),
                    glued: chars.get(k).is_some_and(|(_, c)| !c.is_whitespace()),
                    joined: !at_start && {
                        let lead = if opened {
                            &before[..before.len() - 1]
                        } else {
                            before
                        };
                        lead.chars().last().is_some_and(|c| !c.is_whitespace())
                    },
                },
                k,
            ))
        })();
        match candidate {
            Some((mut marker, after)) => {
                let cut = if text[..at].ends_with(['(', '[']) {
                    at - 1
                } else {
                    at
                };
                let words = text[text_start..cut].trim();
                if !words.is_empty() {
                    out.push(Piece::Text(words.to_string()));
                }
                let until = chars.get(after).map_or(text.len(), |(a, _)| *a);
                marker.raw = text[cut..until].trim().to_string();
                out.push(Piece::Marker(marker));
                text_start = until;
                i = after;
            }
            None => i = next_index,
        }
    }
    let words = text[text_start.min(text.len())..].trim();
    if !words.is_empty() {
        out.push(Piece::Text(words.to_string()));
    }
    out
}

// --- the event stream ---------------------------------------------------------------

#[derive(Debug, Clone)]
enum Event {
    /// A book heading; `entry` is its place in the found-books list.
    Book {
        entry: usize,
        chapter: Option<u16>,
    },
    Chapter(u16),
    /// A heading that names no book or chapter.
    Other {
        notes: bool,
        text: String,
    },
    Text(String),
    Marker(Marker),
}

#[derive(Debug, Clone)]
struct Item {
    event: Event,
    unit: usize,
}

/// Lines repeated at the top or bottom of most pages (running heads, page
/// numbers): the unit indices to take out.
fn page_furniture(units: &[Unit]) -> HashSet<usize> {
    let mut out = HashSet::new();
    // Units by (document, page), in order.
    let mut pages: BTreeMap<(u16, u32), Vec<usize>> = BTreeMap::new();
    for (i, unit) in units.iter().enumerate() {
        if let (false, Some(page)) = (unit.heading, unit.place.page) {
            pages
                .entry((unit.place.document, page))
                .or_default()
                .push(i);
        }
    }
    if pages.len() < 3 {
        return out;
    }
    let shape = |text: &str| -> String {
        key(text)
            .chars()
            .map(|c| if c.is_ascii_digit() { '#' } else { c })
            .collect::<String>()
    };
    let mut counts: HashMap<String, usize> = HashMap::new();
    for lines in pages.values() {
        let mut seen = HashSet::new();
        for &i in lines.iter().take(2).chain(lines.iter().rev().take(2)) {
            if !head_like(&units[i].text) {
                continue;
            }
            let s = shape(&units[i].text);
            if seen.insert(s.clone()) {
                *counts.entry(s).or_default() += 1;
            }
        }
    }
    let needed = (pages.len() * 3 / 10).max(3);
    // A number alone as a page's first or last line counts only when it runs
    // with the pages (page 7 of the PDF reads "5", page 8 "6" …).
    let mut offsets: HashMap<i64, usize> = HashMap::new();
    for ((_, page), lines) in &pages {
        for &i in lines.iter().take(1).chain(lines.iter().rev().take(1)) {
            if let Ok(n) = units[i]
                .text
                .trim()
                .trim_matches(['-', '–', ' '])
                .parse::<i64>()
            {
                *offsets.entry(i64::from(*page) - n).or_default() += 1;
            }
        }
    }
    let page_offsets: HashSet<i64> = offsets
        .into_iter()
        .filter(|(_, n)| *n >= needed)
        .map(|(o, _)| o)
        .collect();
    for ((_, page), lines) in &pages {
        let edge: Vec<usize> = lines
            .iter()
            .take(2)
            .chain(lines.iter().rev().take(2))
            .copied()
            .collect();
        for i in edge {
            let text = units[i].text.trim();
            let numeric = text.trim_matches(['-', '–', ' ']).parse::<i64>().ok();
            if let Some(n) = numeric {
                if page_offsets.contains(&(i64::from(*page) - n)) {
                    out.insert(i);
                }
                continue;
            }
            // A running head: repeated on many pages (its numbers may change).
            if head_like(text) && counts.get(&shape(text)).is_some_and(|n| *n >= needed) {
                out.insert(i);
            }
        }
    }
    out
}

/// Whether a line could be a running head ("GENESIS 1", "THE BOOK OF RUTH",
/// "2 Kings 3:4–4:2"): short, and not ending as a sentence does. A line of
/// verse text never counts, however alike verse lines look.
fn head_like(text: &str) -> bool {
    let text = text.trim();
    text.split_whitespace().count() <= 6
        && text.chars().count() <= 50
        && !text.ends_with(['.', '!', '?', ';', ',', '׃', '。', '"', '”', '’'])
}

/// The shape of a line that can be a book's title: short, no sentence end
/// or closing quotation mark, and — in scripts with capitals — starting
/// with one.
fn book_line_shape(text: &str) -> bool {
    let text = text.trim();
    // "GENESIS." — a title in capitals may end with a full stop.
    let capitals = text.chars().filter(|c| c.is_alphabetic()).count() > 1
        && !text.chars().any(|c| c.is_lowercase());
    let text = if capitals {
        text.trim_end_matches('.')
    } else {
        text
    };
    text.chars().count() <= 60
        && !text.ends_with([
            '.', ',', ';', ':', '!', '?', '׃', '。', '"', '”', '’', '\'', ')',
        ])
        && text
            .chars()
            .find(|c| c.is_alphabetic())
            .is_some_and(|c| !c.is_lowercase())
}

struct Builder<'a> {
    units: &'a [Unit],
    language: Option<ReferenceLanguage>,
    items: Vec<Item>,
    books: Vec<FoundBook>,
    last_detected: Option<&'static str>,
}

impl Builder<'_> {
    fn found_book(&mut self, heading: &str, detected: Option<&'static Book>, unit: usize) -> usize {
        self.books.push(FoundBook {
            index: self.books.len(),
            heading: heading.to_string(),
            detected: detected.map(|b| b.code),
            book: detected.map(|b| b.code),
            left_out: false,
            chapters: 0,
            verses: 0,
            place: self.units[unit].place,
        });
        self.last_detected = detected.map(|b| b.code);
        self.books.len() - 1
    }

    /// A heading (or a short line on its own) right before "Chapter 1"
    /// that names no book: perhaps a book's title the dictionaries do not
    /// know ("The First Book of Moses"). Offered for correction.
    fn untitled_book(&self) -> Option<(String, usize)> {
        let prev = self.items.last()?;
        let before = self.items.len().checked_sub(2).map(|i| &self.items[i]);
        match &prev.event {
            Event::Other { notes: false, text } => Some((text.clone(), prev.unit)),
            // A whole line of its own: no verse number, no sentence end, short.
            Event::Text(text)
                if before.is_none_or(|b| b.unit != prev.unit)
                    && clean(&self.units[prev.unit].text).trim() == text
                    && text.chars().count() <= 60
                    && book_line_shape(text) =>
            {
                Some((text.clone(), prev.unit))
            }
            _ => None,
        }
    }

    /// Whether a PDF or text line naming a book opens it: a book begins at
    /// its chapter 1 or verse 1, so the next line (after a subtitle or two)
    /// must be "Chapter 1" or start with the number 1. A book's name wrapped
    /// onto its own line inside a verse ("Ruth.", "Acts") is followed by
    /// the next verse's number instead, and stays text. The same book named
    /// again and followed by 1 begins twice (reported).
    fn opens_chapter(&self, index: usize, skip: &HashSet<usize>) -> bool {
        // Up to three lines on: a subtitle or two may stand between the
        // title and the chapter ("The First Book of Moses", "called").
        let next: Vec<String> = self
            .units
            .iter()
            .enumerate()
            .skip(index + 1)
            .filter(|(i, _)| !skip.contains(i))
            .map(|(_, u)| clean(&u.text).trim().to_string())
            .filter(|t| !t.is_empty())
            .take(3)
            .collect();
        for line in &next {
            if let Some(heading) = read_heading(line, self.language) {
                return matches!(heading, Heading::Chapter(1) | Heading::BookChapter(_, 1));
            }
            if line
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit() || superscript_digit(c).is_some())
            {
                let number: String = line
                    .chars()
                    .map_while(|c| {
                        superscript_digit(c)
                            .and_then(|d| char::from_digit(d, 10))
                            .or(c.is_ascii_digit().then_some(c))
                    })
                    .collect();
                return number == "1";
            }
            if !head_like(line) {
                return false;
            }
        }
        false
    }

    fn push(&mut self, event: Event, unit: usize) {
        self.items.push(Item { event, unit });
    }

    /// The found-book entry for this book: a new one when the book changes.
    fn book_entry(&mut self, heading: &str, book: &'static Book, unit: usize) -> usize {
        if self.last_detected == Some(book.code) {
            if let Some(last) = self
                .books
                .iter()
                .rposition(|b| b.detected == Some(book.code))
            {
                return last;
            }
        }
        self.found_book(heading, Some(book), unit)
    }

    fn build(mut self, skip: &HashSet<usize>) -> (Vec<Item>, Vec<FoundBook>) {
        for (index, unit) in self.units.iter().enumerate() {
            if skip.contains(&index) {
                continue;
            }
            let text = clean(&unit.text);
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            // Headings: the document's own, or a line that is nothing but a book or chapter.
            if let Some(heading) = read_heading(text, self.language) {
                // A line that is only a number is a verse number in poetry layout,
                // never a chapter, unless the document marks it as a heading.
                let bare = text.chars().all(|c| c.is_ascii_digit());
                // A PDF or text line naming a book is a heading only when it
                // looks like one and a chapter or verse 1 follows it; a word
                // wrapped onto a line of its own ("Ruth.", "song") stays text.
                let line_book_ok = unit.heading
                    || match heading {
                        Heading::Book(_) => {
                            book_line_shape(text) && self.opens_chapter(index, skip)
                        }
                        Heading::BookChapter(..) => book_line_shape(text),
                        Heading::Chapter(_) => true,
                    };
                if (unit.heading || !bare) && line_book_ok {
                    match heading {
                        Heading::Book(book) => {
                            let entry = self.book_entry(text, book, index);
                            self.push(
                                Event::Book {
                                    entry,
                                    chapter: None,
                                },
                                index,
                            );
                        }
                        Heading::BookChapter(book, chapter) => {
                            let entry = self.book_entry(text, book, index);
                            self.push(
                                Event::Book {
                                    entry,
                                    chapter: Some(chapter),
                                },
                                index,
                            );
                        }
                        Heading::Chapter(n) => {
                            // A heading naming no book right before "Chapter 1": perhaps a
                            // book's title the dictionaries do not know. Offered for correction.
                            if n == 1 {
                                if let Some((title, at)) = self.untitled_book() {
                                    self.items.pop();
                                    let entry = self.found_book(&title, None, at);
                                    self.push(
                                        Event::Book {
                                            entry,
                                            chapter: None,
                                        },
                                        at,
                                    );
                                }
                            }
                            self.push(Event::Chapter(n), index);
                        }
                    }
                    continue;
                }
            }
            if unit.heading {
                // A bare number marked as a heading is a chapter number.
                if let Some(n) =
                    chapter_number(text).filter(|_| text.chars().all(|c| c.is_ascii_digit()))
                {
                    self.push(Event::Chapter(n), index);
                } else {
                    self.push(
                        Event::Other {
                            notes: is_notes_heading(text),
                            text: text.to_string(),
                        },
                        index,
                    );
                }
                continue;
            }
            for piece in pieces(text, self.language) {
                match piece {
                    Piece::Text(words) => self.push(Event::Text(words), index),
                    Piece::Marker(marker) => {
                        if let Some(book) = marker.book {
                            let entry = self.book_entry(text, book, index);
                            self.push(
                                Event::Book {
                                    entry,
                                    chapter: None,
                                },
                                index,
                            );
                        }
                        self.push(Event::Marker(marker), index);
                    }
                }
            }
        }
        (self.items, self.books)
    }
}

// --- reading the events ------------------------------------------------------------------

struct Open {
    ordinal: u8,
    chapter: u16,
    verse: u16,
    end: Option<u16>,
    text: String,
    start: Place,
    last: Place,
    last_unit: usize,
}

struct Reader<'a> {
    units: &'a [Unit],
    items: &'a [Item],
    corrections: &'a Corrections,
    out: Recognition,
    book: Option<&'static Book>,
    /// The found-book entry being read, and whether it is left out.
    entry: Option<usize>,
    skip: bool,
    notes: bool,
    chapter: Option<u16>,
    /// The next verse expected in the chapter.
    expect: u16,
    /// Whether the chapter began at a heading (or its number) just now.
    fresh: bool,
    open: Option<Open>,
    /// Text since the chapter began, before its first verse.
    before: Option<(String, Place, usize)>,
    ambiguous: HashSet<(u8, u16, u16)>,
    seen_books: HashSet<u8>,
    long: HashSet<(u8, u16, u16)>,
    /// The chapter heading named a chapter the book does not have.
    skip_chapter: bool,
    /// Verse numbers met where no book had been named.
    unplaced: usize,
    /// The next words follow the last ones with no space (a number put back).
    glue: bool,
}

impl Reader<'_> {
    fn place(&self, unit: usize) -> Place {
        self.units[unit].place
    }

    fn leave_out(&mut self, text: &str, unit: usize, reason: &'static str) {
        let chars = text.chars().count();
        self.out.stats.left_out_chars += chars;
        if self.out.left_out.len() < SAMPLES {
            self.out.left_out.push(LeftOut {
                sample: text.chars().take(80).collect(),
                chars,
                place: self.place(unit),
                reason,
            });
        } else if let Some(same) = self
            .out
            .left_out
            .iter_mut()
            .rev()
            .find(|l| l.reason == reason)
        {
            same.chars += chars;
        }
    }

    /// Appends words to the open verse: a word broken at a line's end is
    /// joined again (PDF and text lines).
    fn append(open: &mut Open, words: &str, unit: usize, place: Place, glue: bool) {
        if open.text.is_empty() || glue {
            open.text.push_str(words);
        } else if unit != open.last_unit
            && open.text.ends_with('-')
            && words.chars().next().is_some_and(char::is_lowercase)
        {
            open.text.pop();
            open.text.push_str(words);
        } else {
            open.text.push(' ');
            open.text.push_str(words);
        }
        open.last = place;
        open.last_unit = unit;
    }

    fn close(&mut self) {
        let Some(open) = self.open.take() else {
            return;
        };
        let text = open.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let key = (open.ordinal, open.chapter, open.verse);
        let book = canon::by_ordinal(open.ordinal).expect("a staged book is canonical");
        if text.is_empty() {
            self.out.content.issue(
                Severity::Warning,
                Some(book),
                Some(open.chapter),
                UserMessage::new(
                    "bibleImport.emptyVerse",
                    format!("{} {}:{} has no text.", book.name, open.chapter, open.verse),
                )
                .with("bookCode", book.code)
                .with("chapter", open.chapter)
                .with("verse", open.verse),
            );
            return;
        }
        if text.chars().count() > VERSE_MAX_CHARS {
            self.long.insert(key);
        }
        let chapter = self
            .out
            .content
            .books
            .entry(open.ordinal)
            .or_default()
            .chapters
            .entry(open.chapter)
            .or_default();
        if chapter.verses.contains_key(&open.verse) {
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(open.chapter),
                UserMessage::new(
                    "bibleImport.verseTwice",
                    format!(
                        "{} {}:{} appears twice.",
                        book.name, open.chapter, open.verse
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", open.chapter)
                .with("verse", open.verse),
            );
            return;
        }
        chapter.verses.insert(open.verse, text);
        if let Some(end) = open.end {
            chapter.bridges.insert(open.verse, end);
        }
        self.out.origins.insert(
            key,
            Origin {
                start: open.start,
                end: open.last,
            },
        );
        if let Some(entry) = self.entry {
            self.out.books[entry].verses += 1;
        }
    }

    /// Text gathered before the chapter's first verse: a Psalm's title, or
    /// left out.
    fn settle_before(&mut self, first_verse_numbered: bool) {
        let Some((text, _, unit)) = self.before.take() else {
            return;
        };
        let (Some(book), Some(chapter)) = (self.book, self.chapter) else {
            self.leave_out(&text, unit, "beforeVerses");
            return;
        };
        if book.code == "PSA" && first_verse_numbered {
            let title = text.split_whitespace().collect::<Vec<_>>().join(" ");
            self.out
                .content
                .books
                .entry(book.ordinal)
                .or_default()
                .chapters
                .entry(chapter)
                .or_default()
                .superscription = Some(title);
            self.out.stats.psalm_titles += 1;
        } else {
            self.leave_out(&text, unit, "beforeVerses");
        }
    }

    fn start_chapter(&mut self, chapter: u16, unit: usize) {
        self.close();
        if let Some((text, _, at)) = self.before.take() {
            self.leave_out(&text, at, "beforeVerses");
        }
        self.chapter = None;
        let Some(book) = self.book else {
            return;
        };
        if chapter > book.chapter_count {
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.chapterOutOfRange",
                    format!(
                        "{} {chapter}: {} has {} chapters in the standard numbering.",
                        book.name, book.name, book.chapter_count
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("count", book.chapter_count),
            );
            self.skip_chapter = true;
            return;
        }
        let _ = unit;
        let exists = self
            .out
            .content
            .books
            .get(&book.ordinal)
            .is_some_and(|b| b.chapters.contains_key(&chapter));
        if exists {
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.documentChapterTwice",
                    format!("{} {chapter} appears twice in the text.", book.name),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter),
            );
            self.skip_chapter = true;
            return;
        }
        self.skip_chapter = false;
        self.chapter = Some(chapter);
        self.expect = 1;
        self.fresh = true;
        if let Some(entry) = self.entry {
            self.out.books[entry].chapters += 1;
        }
    }

    fn open_verse(&mut self, verse: u16, end: Option<u16>, unit: usize) {
        self.close();
        let (Some(book), Some(chapter)) = (self.book, self.chapter) else {
            return;
        };
        let place = self.place(unit);
        self.open = Some(Open {
            ordinal: book.ordinal,
            chapter,
            verse,
            end,
            text: String::new(),
            start: place,
            last: place,
            last_unit: unit,
        });
        self.expect = end.unwrap_or(verse) + 1;
        self.fresh = false;
    }

    /// Whether the chapter being read has all its verses by the standard count.
    fn chapter_complete(&self) -> bool {
        match (self.book, self.chapter) {
            (Some(book), Some(chapter)) => {
                canon::verse_count(book, chapter).is_some_and(|count| self.expect > count)
            }
            _ => false,
        }
    }

    /// Looks ahead from item `at` for a better or equal place for verse `value`.
    /// Some(true): this one; Some(false): a better one comes; None: two equal places.
    fn best_place(&self, at: usize, value: u16, strength: Strength) -> Option<bool> {
        let mut equal = false;
        for item in self.items.iter().skip(at + 1).take(LOOKAHEAD) {
            match &item.event {
                Event::Book { .. } | Event::Chapter(_) => break,
                Event::Marker(m) if m.chapter.is_some() => break,
                // Numbering starting again at a paragraph: the next chapter.
                Event::Marker(m)
                    if m.unit_start && m.strength == Strength::Strong && m.value < value =>
                {
                    break
                }
                Event::Marker(m) if m.value == value => {
                    if m.strength > strength {
                        return Some(false);
                    }
                    // Two places equally good, however strong: refused, never guessed.
                    if m.strength == strength {
                        equal = true;
                    }
                }
                Event::Marker(m)
                    if (m.value == value + 1 || m.value == value + 2)
                        && m.strength == Strength::Strong =>
                {
                    break
                }
                _ => {}
            }
        }
        if equal {
            None
        } else {
            Some(true)
        }
    }

    /// The next candidate verse number after item `at` in this chapter.
    fn next_value(&self, at: usize) -> Option<u16> {
        for item in self.items.iter().skip(at + 1).take(LOOKAHEAD) {
            match &item.event {
                Event::Book { .. } | Event::Chapter(_) => return None,
                Event::Marker(m) => return Some(m.value),
                _ => {}
            }
        }
        None
    }

    fn ambiguous_issue(&mut self, verse: u16) {
        let (Some(book), Some(chapter)) = (self.book, self.chapter) else {
            return;
        };
        if self.ambiguous.insert((book.ordinal, chapter, verse)) {
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.documentAmbiguous",
                    format!(
                        "{} {chapter}:{verse}: two places in the text could be where this verse begins."
                    , book.name),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
        }
    }

    /// Reads a candidate verse number; false when it is not one (its digits
    /// then stay in the text).
    fn marker(&mut self, at: usize, m: &Marker, unit: usize) -> bool {
        if self.skip || self.notes || self.skip_chapter {
            return false;
        }
        let Some(book) = self.book else {
            if m.strength == Strength::Strong {
                self.unplaced += 1;
            }
            return false;
        };
        // A line reference names its chapter: "3:1 …".
        if let Some(chapter) = m.chapter {
            if self.chapter != Some(chapter) {
                self.start_chapter(chapter, unit);
                if self.chapter.is_none() {
                    return false;
                }
            }
            if m.value == self.expect || m.value == self.expect + 1 {
                if self.expect == 1 {
                    self.settle_before(m.value == 1);
                }
                self.open_verse(m.value, m.end, unit);
            } else {
                // Counting back, or jumping ahead, within a chapter: out of order.
                self.order_issue(book, m.value);
                self.open_verse(m.value, m.end, unit);
            }
            return true;
        }
        let strong = m.strength == Strength::Strong;
        let Some(chapter) = self.chapter else {
            // A book with no chapter yet: "1" at the start of a paragraph begins chapter 1.
            if m.unit_start && strong && m.value == 1 {
                self.start_chapter(1, unit);
                self.out.stats.numbered_chapters += 1;
                self.open_verse(1, m.end, unit);
                return true;
            }
            return false;
        };
        let expect = self.expect;
        if m.value == expect {
            match self.best_place(at, m.value, m.strength) {
                Some(true) => {}
                Some(false) => return false,
                None => self.ambiguous_issue(m.value),
            }
            if expect == 1 {
                self.settle_before(true);
            }
            self.open_verse(m.value, m.end, unit);
            return true;
        }
        // The chapter's own number where its verse 1 starts (printed Bibles):
        // verse 2 comes next. (In chapter 2, a "2" followed by verse 3 is
        // verse 2, after a verse 1 that has no number.)
        if expect == 1
            && strong
            && m.unit_start
            && m.value == chapter
            && self.next_value(at) != Some(chapter + 1)
        {
            self.drop_cap(unit, m.end);
            return true;
        }
        // The next chapter's number, or verse 1 again, at the start of a paragraph once
        // this chapter has all its verses.
        if strong
            && m.unit_start
            && self.chapter_complete()
            && (m.value == chapter + 1 || m.value == 1)
            && chapter < book.chapter_count
        {
            self.start_chapter(chapter + 1, unit);
            self.out.stats.numbered_chapters += 1;
            let end = if m.value == 1 { m.end } else { None };
            self.open_verse(1, end, unit);
            return true;
        }
        // Verse 1 had no number: the text since the heading is verse 1.
        if expect == 1 && strong && m.value == 2 && self.fresh && self.before.is_some() {
            match self.best_place(at, 2, m.strength) {
                Some(true) => {}
                Some(false) => return false,
                None => self.ambiguous_issue(2),
            }
            self.unnumbered_first(book, chapter);
            self.open_verse(2, m.end, unit);
            return true;
        }
        // One verse missing (left out by the translation, or its number lost).
        if strong && m.value == expect + 1 && expect > 1 {
            match self.best_place(at, m.value, m.strength) {
                Some(true) => {}
                Some(false) => return false,
                None => self.ambiguous_issue(m.value),
            }
            self.open_verse(m.value, m.end, unit);
            return true;
        }
        // Anything else is a number in the text.
        false
    }

    fn drop_cap(&mut self, unit: usize, end: Option<u16>) {
        if let Some((text, _, at)) = self.before.take() {
            // A Psalm's title stands before its number; elsewhere it is left out.
            self.before = Some((text, self.place(at), at));
            self.settle_before(true);
        }
        self.open_verse(1, end, unit);
    }

    fn unnumbered_first(&mut self, book: &'static Book, chapter: u16) {
        let Some((text, place, at)) = self.before.take() else {
            return;
        };
        if book.code == "PSA" {
            // A Psalm's title and its verse 1 cannot be told apart without the number.
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.documentPsalmTitle",
                    format!(
                        "Psalm {chapter}: verse 1 has no number, so its title cannot be told apart from it."
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter),
            );
            self.leave_out(&text, at, "beforeVerses");
            return;
        }
        self.out.stats.unnumbered_first += 1;
        self.open = Some(Open {
            ordinal: book.ordinal,
            chapter,
            verse: 1,
            end: None,
            text,
            start: place,
            last: place,
            last_unit: at,
        });
        self.close();
    }

    fn order_issue(&mut self, book: &'static Book, verse: u16) {
        let Some(chapter) = self.chapter else {
            return;
        };
        self.out.content.issue(
            Severity::Error,
            Some(book),
            Some(chapter),
            UserMessage::new(
                "bibleImport.documentOrder",
                format!(
                    "{} {chapter}:{verse} is out of order in the text.",
                    book.name
                ),
            )
            .with("bookCode", book.code)
            .with("chapter", chapter)
            .with("verse", verse),
        );
    }

    fn text(&mut self, words: &str, unit: usize) {
        if self.skip {
            self.leave_out(words, unit, "leftOutBook");
            return;
        }
        if self.notes {
            self.leave_out(words, unit, "notes");
            return;
        }
        if self.skip_chapter {
            self.leave_out(words, unit, "beforeVerses");
            return;
        }
        let place = self.place(unit);
        let glue = std::mem::take(&mut self.glue);
        if let Some(open) = self.open.as_mut() {
            Self::append(open, words, unit, place, glue);
            return;
        }
        if self.chapter.is_some() {
            match self.before.as_mut() {
                Some((text, _, last)) => {
                    if !glue {
                        text.push(' ');
                    }
                    text.push_str(words);
                    *last = unit;
                }
                None => self.before = Some((words.to_string(), place, unit)),
            }
            return;
        }
        let reason = if self.book.is_some() {
            "beforeVerses"
        } else {
            "noBook"
        };
        self.leave_out(words, unit, reason);
    }

    fn book(&mut self, entry: usize, chapter: Option<u16>, unit: usize) {
        self.notes = false;
        let detected = self.out.books[entry].detected.and_then(canon::by_code);
        let chosen = match self.corrections.books.get(&entry) {
            Some(choice) => *choice,
            None => detected,
        };
        let same_entry = self.entry == Some(entry);
        if !same_entry {
            self.close();
            if let Some((text, _, at)) = self.before.take() {
                self.leave_out(&text, at, "beforeVerses");
            }
            self.entry = Some(entry);
            self.chapter = None;
            self.skip_chapter = false;
            let found = &mut self.out.books[entry];
            found.book = chosen.map(|b| b.code);
            found.left_out = self
                .corrections
                .books
                .get(&entry)
                .is_some_and(Option::is_none);
            self.skip = found.left_out;
            self.book = chosen;
            if let Some(book) = chosen {
                if !self.seen_books.insert(book.ordinal) {
                    self.out.content.issue(
                        Severity::Error,
                        Some(book),
                        None,
                        UserMessage::new(
                            "bibleImport.documentBookTwice",
                            format!("{} begins twice in the text.", book.name),
                        )
                        .with("bookCode", book.code),
                    );
                    self.skip = true;
                }
            }
        }
        if let Some(chapter) = chapter {
            if !self.skip {
                self.start_chapter(chapter, unit);
            }
        }
    }

    fn run(mut self) -> Recognition {
        for (at, item) in self.items.iter().enumerate() {
            match &item.event {
                Event::Book { entry, chapter } => self.book(*entry, *chapter, item.unit),
                Event::Chapter(n) => {
                    self.notes = false;
                    if self.skip {
                        continue;
                    }
                    if self.book.is_none() {
                        self.unplaced += 1;
                        continue;
                    }
                    self.start_chapter(*n, item.unit);
                }
                Event::Other { notes, text } => {
                    if *notes {
                        self.close();
                        self.notes = true;
                    } else if !self.skip {
                        // A heading inside a chapter is not Scripture text.
                        self.out.stats.headings += 1;
                        self.leave_out(text, item.unit, "heading");
                    }
                }
                Event::Text(words) => self.text(words, item.unit),
                Event::Marker(m) => {
                    if !self.marker(at, m, item.unit) {
                        // Not a verse number: the number is part of the text.
                        self.glue = m.joined;
                        self.text(&m.raw, item.unit);
                        self.glue = m.glued;
                    }
                }
            }
        }
        self.close();
        if let Some((text, _, at)) = self.before.take() {
            self.leave_out(&text, at, "beforeVerses");
        }
        self.finish()
    }

    fn finish(mut self) -> Recognition {
        let mut long: Vec<(u8, u16, u16)> = self.long.iter().copied().collect();
        long.sort_unstable();
        for (ordinal, chapter, verse) in long {
            let book = canon::by_ordinal(ordinal).expect("canonical");
            self.out.content.issue(
                Severity::Error,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.documentLongVerse",
                    format!(
                        "{} {chapter}:{verse} is far longer than any verse: the verses after it were not found."
                    , book.name),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("verse", verse),
            );
        }
        if self.unplaced > 0 {
            self.out.content.issue(
                Severity::Warning,
                None,
                None,
                UserMessage::new(
                    "bibleImport.documentNoBook",
                    format!(
                        "{} verse numbers were found where no book name comes before them; they were left out.",
                        self.unplaced
                    ),
                )
                .with("count", self.unplaced),
            );
        }
        let s = self.out.stats.clone();
        if s.unnumbered_first > 0 {
            self.out.content.issue(
                Severity::Warning,
                None,
                None,
                UserMessage::new(
                    "bibleImport.documentUnnumbered",
                    format!(
                        "In {} chapters verse 1 has no number of its own: the text between the chapter's heading and verse 2 was taken as verse 1.",
                        s.unnumbered_first
                    ),
                )
                .with("count", s.unnumbered_first),
            );
        }
        if s.psalm_titles > 0 {
            self.out.content.issue(
                Severity::Note,
                None,
                None,
                UserMessage::new(
                    "bibleImport.documentPsalmTitles",
                    format!(
                        "{} Psalm titles were kept as titles, before verse 1.",
                        s.psalm_titles
                    ),
                )
                .with("count", s.psalm_titles),
            );
        }
        if s.page_lines > 0 {
            self.out.content.issue(
                Severity::Note,
                None,
                None,
                UserMessage::new(
                    "bibleImport.documentPageLines",
                    format!(
                        "{} page headers and page numbers repeated across the pages were left out.",
                        s.page_lines
                    ),
                )
                .with("count", s.page_lines),
            );
        }
        if s.left_out_chars > 0 {
            self.out.content.issue(
                Severity::Note,
                None,
                None,
                UserMessage::new(
                    "bibleImport.documentLeftOut",
                    format!(
                        "Text that belongs to no verse was left out ({} characters: headings, introductions, notes).",
                        s.left_out_chars
                    ),
                )
                .with("count", s.left_out_chars),
            );
        }
        self.short_chapters();
        self.out.content.check_structure();
        self.out
    }

    /// Verses missing at the end of a chapter (a chapter cut short) are not
    /// gaps the common checks see: compared with the standard verse counts.
    /// A few fewer is another numbering (a warning); many fewer means the
    /// chapter's end was not found, and its verses are not used (an error).
    fn short_chapters(&mut self) {
        let mut found = Vec::new();
        for (ordinal, staged) in &self.out.content.books {
            let Some(book) = canon::by_ordinal(*ordinal) else {
                continue;
            };
            for (chapter, text) in &staged.chapters {
                let Some(expected) = canon::verse_count(book, *chapter) else {
                    continue;
                };
                let last = text
                    .verses
                    .keys()
                    .chain(text.bridges.values())
                    .copied()
                    .max()
                    .unwrap_or(0);
                if last == 0 || last >= expected {
                    continue;
                }
                let severity = if expected - last > SHORT_TOLERANCE {
                    Severity::Error
                } else {
                    Severity::Warning
                };
                found.push((severity, book, *chapter, last, expected));
            }
        }
        for (severity, book, chapter, last, expected) in found {
            self.out.content.issue(
                severity,
                Some(book),
                Some(chapter),
                UserMessage::new(
                    "bibleImport.documentChapterShort",
                    format!(
                        "{} {chapter} ends at verse {last}; it usually has {expected} verses. The verses after {last} were not found.",
                        book.name
                    ),
                )
                .with("bookCode", book.code)
                .with("chapter", chapter)
                .with("last", last)
                .with("expected", expected),
            );
        }
    }
}

/// Reads the units of a Bible's documents for its books, chapters and verses.
/// `language` is the document's language when known (it decides between
/// books that share a name across languages).
pub fn recognise(units: &[Unit], language: Option<&str>, corrections: &Corrections) -> Recognition {
    let language = language.and_then(ReferenceLanguage::from_label);
    let furniture = page_furniture(units);
    let builder = Builder {
        units,
        language,
        items: Vec::new(),
        books: Vec::new(),
        last_detected: None,
    };
    let (items, books) = builder.build(&furniture);
    let reader = Reader {
        units,
        items: &items,
        corrections,
        out: Recognition {
            books,
            stats: Stats {
                page_lines: furniture.len(),
                ..Default::default()
            },
            ..Default::default()
        },
        book: None,
        entry: None,
        skip: false,
        notes: false,
        chapter: None,
        expect: 1,
        fresh: false,
        open: None,
        before: None,
        ambiguous: HashSet::new(),
        seen_books: HashSet::new(),
        long: HashSet::new(),
        skip_chapter: false,
        unplaced: 0,
        glue: false,
    };
    reader.run()
}
