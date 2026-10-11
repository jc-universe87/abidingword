//! Generated contents (v0.13): a table of contents made from a source's own
//! structure when the source carries none (no EPUB navigation, no PDF
//! outline). It is always presented as generated, never as the source's own.
//!
//! - EPUB and Markdown: the headings the text is already divided by (the
//!   section path stored with each segment, h1 › h2 › h3), first three levels.
//! - DOCX: the Word headings (heading styles / outline levels), read by the
//!   DOCX adapter.
//! - PDF: probable headings, from evidence in the text layer only: type size
//!   against the body text, short standalone lines, space above, chapter or
//!   section numbering ("Chapter 1", "Kapitel 1", "1.2 …"), and position on
//!   the page, with running headers, footers and page numbers left out.
//!   Precision over recall: a line that is not clearly a heading is left out,
//!   and a document where the evidence is noisy gets no generated contents.
//!
//! Deterministic: the same file always gives the same contents. Nothing is
//! stored; nothing is guessed from meaning.

use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::OnceLock;

use regex::Regex;

use super::contents::{clean_title, ContentsItem, ContentsTarget, MAX_ITEMS};

/// Deepest level a generated contents has.
pub const MAX_LEVELS: usize = 3;
/// A PDF with more pages than this is not examined (the cost of reading it
/// whole would outweigh a fallback).
pub const MAX_PDF_PAGES: u32 = 3_000;
/// Characters read from a PDF at most.
const MAX_PDF_CHARS: usize = 8_000_000;

/// Entries at their levels (1 = top), nested into a tree. A level that skips
/// (1 then 3) nests under the nearest shallower entry.
pub fn nest(entries: &[(usize, String, ContentsTarget)]) -> Vec<ContentsItem> {
    let mut roots: Vec<ContentsItem> = Vec::new();
    let mut stack: Vec<(usize, ContentsItem)> = Vec::new();
    fn close(stack: &mut Vec<(usize, ContentsItem)>, roots: &mut Vec<ContentsItem>) {
        if let Some((_, done)) = stack.pop() {
            match stack.last_mut() {
                Some((_, parent)) => parent.children.push(done),
                None => roots.push(done),
            }
        }
    }
    for (n, (level, title, target)) in entries.iter().take(MAX_ITEMS).enumerate() {
        while stack.last().is_some_and(|(l, _)| *l >= *level) {
            close(&mut stack, &mut roots);
        }
        stack.push((
            *level,
            ContentsItem {
                id: format!("g{n}"),
                title: clean_title(title),
                target: Some(*target),
                children: Vec::new(),
            },
        ));
    }
    while !stack.is_empty() {
        close(&mut stack, &mut roots);
    }
    roots
}

/// Contents from the section path of each segment (EPUB, Markdown): an entry
/// wherever a heading starts, at its depth, leading to the first segment
/// under it. Fewer than two entries is no contents.
pub fn from_sections(segments: &[(i64, Option<String>)]) -> Vec<ContentsItem> {
    let mut entries: Vec<(usize, String, ContentsTarget)> = Vec::new();
    let mut previous: Vec<&str> = Vec::new();
    for (position, path) in segments {
        let parts: Vec<&str> = path
            .as_deref()
            .map(|p| {
                p.split(" › ")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .take(MAX_LEVELS)
                    .collect()
            })
            .unwrap_or_default();
        let same = parts
            .iter()
            .zip(previous.iter())
            .take_while(|(a, b)| a == b)
            .count();
        for (depth, title) in parts.iter().enumerate().skip(same) {
            entries.push((
                depth + 1,
                (*title).to_string(),
                ContentsTarget::Segment {
                    position: *position,
                },
            ));
        }
        if !parts.is_empty() {
            previous = parts;
        }
    }
    if entries.len() < 2 {
        return Vec::new();
    }
    nest(&entries)
}

/// One line of a PDF page's text, as the text layer draws it.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// Physical page, 1 = first.
    pub page: u32,
    /// Distance of the baseline from the top of the page, as a fraction of its height.
    pub top: f64,
    /// The type size most of the line is set in (points, as drawn).
    pub size: f64,
    /// Space above the line, in multiples of its type size (large for the first line of a page).
    pub gap_above: f64,
    pub text: String,
}

/// Contents for a PDF without an outline: its probable headings, each
/// leading to its page. Empty when the PDF cannot be read, has no text
/// layer, or the evidence is not clear enough.
pub fn from_pdf(bytes: &[u8]) -> Vec<ContentsItem> {
    let lines = catch_unwind(AssertUnwindSafe(|| pdf_lines(bytes))).unwrap_or_default();
    let Some(lines) = lines else {
        return Vec::new();
    };
    let pages = lines.iter().map(|l| l.page).max().unwrap_or(0);
    let entries: Vec<(usize, String, ContentsTarget)> = headings(&lines, pages)
        .into_iter()
        .map(|(level, page, title)| {
            (
                level,
                title,
                ContentsTarget::Page {
                    page: i64::from(page),
                },
            )
        })
        .collect();
    nest(&entries)
}

fn chapter_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?ix)^(
                (chapter|kapitel|chapitre|cap[ií]tulo|part|teil|partie|parte|book|buch|livre|libro|livro|section|abschnitt|lesson|lektion|le[cç]on|lecci[oó]n|li[cç][aã]o)
                \s+([0-9]{1,3}|[ivxlc]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eins|zwei|drei|vier|f[uü]nf)\b
              | 제\s*[0-9]{1,3}\s*(장|부|편|과)
            )",
        )
        .unwrap()
    })
}

fn numbered_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^[0-9]{1,2}(\.[0-9]{1,2}){0,2}\.?\s+\p{L}").unwrap())
}

/// Whether a line is a page number or similar furniture: digits, roman numerals, dashes.
fn is_folio(text: &str) -> bool {
    let t = text.trim_matches(|c: char| c == '-' || c == '–' || c == '—' || c.is_whitespace());
    !t.is_empty()
        && t.chars().count() <= 8
        && (t.chars().all(|c| c.is_ascii_digit())
            || t.chars().all(|c| "ivxlcdmIVXLCDM".contains(c))
            || t.to_lowercase().starts_with("page ")
                && t[5..].trim().chars().all(|c| c.is_ascii_digit()))
}

/// A size bucket (half points), to compare sizes that differ only by rounding.
fn bucket(size: f64) -> i64 {
    (size * 2.0).round() as i64
}

/// The probable headings among a PDF's lines: (level, page, title), in order.
pub fn headings(lines: &[Line], pages: u32) -> Vec<(usize, u32, String)> {
    if lines.is_empty() || pages == 0 {
        return Vec::new();
    }
    // Running headers and footers: the same text (numbers aside) near the top
    // or bottom of three or more pages. Page numbers alone are furniture too.
    let margin = |l: &Line| l.top < 0.1 || l.top > 0.9;
    let key = |text: &str| -> String {
        text.chars()
            .filter(|c| !c.is_ascii_digit())
            .collect::<String>()
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let mut seen: HashMap<String, HashSet<u32>> = HashMap::new();
    for l in lines.iter().filter(|l| margin(l)) {
        seen.entry(key(&l.text)).or_default().insert(l.page);
    }
    let running: HashSet<String> = seen
        .into_iter()
        .filter(|(_, p)| p.len() >= 3)
        .map(|(k, _)| k)
        .collect();
    let kept: Vec<&Line> = lines
        .iter()
        .filter(|l| !(margin(l) && (is_folio(&l.text) || running.contains(&key(&l.text)))))
        .collect();

    // The body size: the size most characters are set in.
    let mut weight: HashMap<i64, usize> = HashMap::new();
    for l in &kept {
        *weight.entry(bucket(l.size)).or_default() += l.text.chars().count();
    }
    let Some(body) = weight
        .iter()
        .max_by_key(|(b, w)| (**w, -**b))
        .map(|(b, _)| *b as f64 / 2.0)
    else {
        return Vec::new();
    };
    if body <= 0.0 {
        return Vec::new();
    }

    let is_candidate = |l: &Line| -> bool {
        let text = l.text.trim();
        let chars = text.chars().count();
        let letters = text.chars().filter(|c| c.is_alphabetic()).count();
        let words = text.split_whitespace().count();
        if !(2..=120).contains(&chars) || letters < 2 || words > 15 || is_folio(text) {
            return false;
        }
        if text.ends_with([',', ';', '-', '‐']) {
            return false;
        }
        let ratio = l.size / body;
        let standalone = l.gap_above >= 1.5;
        if ratio >= 1.25 {
            return true;
        }
        if numbered_pattern().is_match(text) && ratio >= 1.1 && standalone && words <= 12 {
            return true;
        }
        chapter_pattern().is_match(text) && ratio >= 0.98 && l.gap_above >= 2.0 && words <= 8
    };

    // Candidates, with a heading set over two or three lines joined.
    let mut found: Vec<(u32, f64, String)> = Vec::new();
    let mut last: Option<(u32, i64, usize)> = None; // page, size bucket, lines joined
    for (index, l) in kept.iter().enumerate() {
        if !is_candidate(l) {
            last = None;
            continue;
        }
        let continues = last.is_some_and(|(page, size, joined)| {
            page == l.page && size == bucket(l.size) && joined < 3 && l.gap_above <= 1.6
        }) && index > 0;
        if continues {
            if let Some(entry) = found.last_mut() {
                entry.2.push(' ');
                entry.2.push_str(l.text.trim());
            }
            last = last.map(|(p, s, j)| (p, s, j + 1));
        } else {
            found.push((l.page, l.size, l.text.trim().to_string()));
            last = Some((l.page, bucket(l.size), 1));
        }
    }

    // Levels by size: the largest heading size is level 1. Sizes below the
    // third are left out (too close to the text to trust).
    let mut sizes: Vec<i64> = found.iter().map(|(_, s, _)| bucket(*s)).collect();
    sizes.sort_unstable_by(|a, b| b.cmp(a));
    sizes.dedup();
    let out: Vec<(usize, u32, String)> = found
        .into_iter()
        .filter_map(|(page, size, title)| {
            let rank = sizes.iter().position(|s| *s == bucket(size))?;
            (rank < MAX_LEVELS).then(|| (rank + 1, page, title))
        })
        .collect();

    // Noisy evidence is no evidence: too many "headings", or too few to help.
    let limit = (pages as usize) * 2 + 10;
    if out.len() < 2 || out.len() > limit || out.len() > MAX_ITEMS {
        return Vec::new();
    }
    out
}

/// The text lines of a PDF, page by page, as the text layer draws them.
/// None when the file cannot be read or is too large to examine.
fn pdf_lines(bytes: &[u8]) -> Option<Vec<Line>> {
    let document = pdf_extract::Document::load_mem(bytes).ok()?;
    if document.is_encrypted() || document.get_pages().len() as u32 > MAX_PDF_PAGES {
        return None;
    }
    let mut collector = Collector::default();
    pdf_extract::output_doc(&document, &mut collector).ok()?;
    collector.finish_line();
    Some(collector.lines)
}

/// Gathers drawn characters into lines (pdf-extract's output device).
#[derive(Default)]
struct Collector {
    lines: Vec<Line>,
    page: u32,
    top_y: f64,
    height: f64,
    current: Option<Building>,
    /// Baseline and size of the last finished line on this page (for the space above the next).
    previous: Option<(f64, f64)>,
    chars: usize,
}

struct Building {
    y: f64,
    x_end: f64,
    sizes: Vec<f64>,
    text: String,
    gap_above: f64,
}

impl Collector {
    fn finish_line(&mut self) {
        let Some(line) = self.current.take() else {
            return;
        };
        let text = line.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            return;
        }
        // The size most of the line's characters are set in.
        let mut counts: HashMap<i64, usize> = HashMap::new();
        for s in &line.sizes {
            *counts.entry(bucket(*s)).or_default() += 1;
        }
        let size = counts
            .into_iter()
            .max_by_key(|(b, n)| (*n, *b))
            .map_or(0.0, |(b, _)| b as f64 / 2.0);
        self.previous = Some((line.y, size));
        self.lines.push(Line {
            page: self.page,
            top: if self.height > 0.0 {
                ((self.top_y - line.y) / self.height).clamp(0.0, 1.0)
            } else {
                0.5
            },
            size,
            gap_above: line.gap_above,
            text,
        });
    }
}

impl pdf_extract::OutputDev for Collector {
    fn begin_page(
        &mut self,
        page_num: u32,
        media_box: &pdf_extract::MediaBox,
        _art_box: Option<(f64, f64, f64, f64)>,
    ) -> Result<(), pdf_extract::OutputError> {
        self.finish_line();
        self.page = page_num;
        self.top_y = media_box.ury;
        self.height = (media_box.ury - media_box.lly).abs();
        self.previous = None;
        Ok(())
    }

    fn end_page(&mut self) -> Result<(), pdf_extract::OutputError> {
        self.finish_line();
        Ok(())
    }

    fn output_character(
        &mut self,
        trm: &pdf_extract::Transform,
        width: f64,
        spacing: f64,
        font_size: f64,
        char: &str,
    ) -> Result<(), pdf_extract::OutputError> {
        if self.chars >= MAX_PDF_CHARS {
            return Ok(());
        }
        self.chars += char.chars().count();
        // Only upright text: rotated or vertical text is left out.
        if trm.m12.abs() > 1e-3 || trm.m21.abs() > 1e-3 || trm.m11 <= 0.0 || trm.m22 <= 0.0 {
            return Ok(());
        }
        let size = font_size * (trm.m11 * trm.m22).sqrt();
        if size <= 0.0 || !size.is_finite() {
            return Ok(());
        }
        let (x, y) = (trm.m31, trm.m32);
        let advance = (width * font_size + spacing) * trm.m11;
        let same_line = self.current.as_ref().is_some_and(|line| {
            (line.y - y).abs() <= 0.4 * size.max(1.0) && x >= line.x_end - 2.0 * size
        });
        if !same_line {
            self.finish_line();
            let gap_above = match self.previous {
                Some((py, _)) if py > y => (py - y) / size,
                _ => 99.0,
            };
            self.current = Some(Building {
                y,
                x_end: x,
                sizes: Vec::new(),
                text: String::new(),
                gap_above,
            });
        }
        let line = self.current.as_mut().expect("a line is being built");
        if x - line.x_end > 0.2 * size && !line.text.ends_with(' ') {
            line.text.push(' ');
        }
        line.text.push_str(char);
        if !char.trim().is_empty() {
            line.sizes.push(size);
        }
        line.x_end = x + advance;
        Ok(())
    }

    fn begin_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }

    fn end_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }

    fn end_line(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(page: u32, top: f64, size: f64, gap: f64, text: &str) -> Line {
        Line {
            page,
            top,
            size,
            gap_above: gap,
            text: text.into(),
        }
    }

    fn body(page: u32, from: f64, n: usize) -> Vec<Line> {
        (0..n)
            .map(|i| {
                line(
                    page,
                    from + i as f64 * 0.02,
                    11.0,
                    1.3,
                    "An ordinary line of body text that runs across the page, as prose does.",
                )
            })
            .collect()
    }

    fn titles(found: &[(usize, u32, String)]) -> Vec<(usize, u32, &str)> {
        found.iter().map(|(l, p, t)| (*l, *p, t.as_str())).collect()
    }

    #[test]
    fn sections_become_nested_contents_at_their_first_segment() {
        let segments = vec![
            (0, None),
            (1, Some("Part One".to_string())),
            (2, Some("Part One › Abiding".to_string())),
            (3, Some("Part One › Abiding".to_string())),
            (4, Some("Part One › Fruit".to_string())),
            (5, Some("Part Two".to_string())),
            (6, Some("Part Two › A › B › C deeper".to_string())),
        ];
        let items = from_sections(&segments);
        let shape: Vec<(String, usize)> = items
            .iter()
            .map(|i| (i.title.clone(), i.children.len()))
            .collect();
        assert_eq!(
            shape,
            [("Part One".to_string(), 2), ("Part Two".to_string(), 1)]
        );
        assert_eq!(
            items[0].children[1].target,
            Some(ContentsTarget::Segment { position: 4 })
        );
        // three levels at most
        assert!(items[1].children[0].children[0].children.is_empty());
        assert!(from_sections(&[(0, Some("Only".into()))]).is_empty());
        assert!(from_sections(&[(0, None), (1, None)]).is_empty());
    }

    #[test]
    fn larger_type_is_a_heading_and_its_size_gives_the_level() {
        let mut lines = vec![line(1, 0.12, 24.0, 99.0, "The Vine and the Branches")];
        lines.extend(body(1, 0.2, 30));
        lines.push(line(2, 0.12, 16.0, 99.0, "Remaining in Him"));
        lines.extend(body(2, 0.2, 30));
        lines.push(line(3, 0.3, 16.0, 2.5, "Bearing Fruit"));
        lines.extend(body(3, 0.35, 20));
        lines.push(line(4, 0.12, 24.0, 99.0, "Love One Another"));
        lines.extend(body(4, 0.2, 30));
        assert_eq!(
            titles(&headings(&lines, 4)),
            [
                (1, 1, "The Vine and the Branches"),
                (2, 2, "Remaining in Him"),
                (2, 3, "Bearing Fruit"),
                (1, 4, "Love One Another"),
            ]
        );
    }

    #[test]
    fn running_headers_footers_and_page_numbers_are_left_out() {
        let mut lines = Vec::new();
        for page in 1..=5 {
            lines.push(line(page, 0.05, 14.0, 99.0, "A STUDY OF JOHN 15"));
            if page == 1 || page == 4 {
                lines.push(line(page, 0.15, 20.0, 3.0, &format!("Chapter {page}")));
            }
            lines.extend(body(page, 0.2, 30));
            lines.push(line(page, 0.95, 14.0, 4.0, &format!("{page}")));
            lines.push(line(page, 0.96, 14.0, 1.2, &format!("Page {page}")));
        }
        assert_eq!(
            titles(&headings(&lines, 5)),
            [(1, 1, "Chapter 1"), (1, 4, "Chapter 4")]
        );
    }

    #[test]
    fn numbered_and_keyword_headings_need_space_above() {
        let mut lines = Vec::new();
        lines.push(line(1, 0.15, 11.0, 3.0, "Kapitel 1"));
        lines.extend(body(1, 0.2, 10));
        lines.push(line(1, 0.5, 12.5, 2.0, "1.2 Bleiben im Weinstock"));
        lines.extend(body(1, 0.55, 10));
        // the same shapes inside running text are not headings
        lines.push(line(1, 0.8, 11.0, 1.3, "Kapitel 2 sagt mehr dazu."));
        lines.push(line(1, 0.82, 12.5, 1.2, "1. Ein Punkt in einer Liste"));
        lines.push(line(2, 0.15, 11.0, 3.0, "제 2 장"));
        lines.extend(body(2, 0.2, 30));
        let found = headings(&lines, 2);
        let names: Vec<&str> = found.iter().map(|(_, _, t)| t.as_str()).collect();
        assert_eq!(names, ["Kapitel 1", "1.2 Bleiben im Weinstock", "제 2 장"]);
    }

    #[test]
    fn a_heading_over_two_lines_is_one_entry_and_sentences_are_not_headings() {
        let mut lines = vec![
            line(1, 0.12, 20.0, 99.0, "Abiding in Christ:"),
            line(1, 0.15, 20.0, 1.2, "A Study of John 15"),
            line(
                1,
                0.2,
                20.0,
                1.2,
                "Large type can set a sentence too, and a sentence of this length is prose, not a heading.",
            ),
        ];
        lines.extend(body(1, 0.25, 30));
        lines.push(line(2, 0.12, 20.0, 99.0, "Second Part"));
        lines.extend(body(2, 0.2, 30));
        let found = headings(&lines, 2);
        assert_eq!(found[0].2, "Abiding in Christ: A Study of John 15");
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn noisy_or_flat_documents_get_no_contents() {
        // every line large: there is no body to stand out from
        let flat: Vec<Line> = (1..=3).flat_map(|p| body(p, 0.2, 20)).collect();
        assert!(headings(&flat, 3).is_empty());
        // a single heading does not make contents
        let mut one = vec![line(1, 0.12, 22.0, 99.0, "Introduction")];
        one.extend(body(1, 0.2, 30));
        assert!(headings(&one, 1).is_empty());
        // many short large lines on every page: a layout, not headings
        let mut noisy = Vec::new();
        for page in 1..=2 {
            for i in 0..20 {
                noisy.push(line(
                    page,
                    0.1 + i as f64 * 0.04,
                    18.0,
                    2.0,
                    &format!("Label {i}x"),
                ));
            }
            noisy.extend(body(page, 0.2, 40));
        }
        assert!(headings(&noisy, 2).is_empty());
    }
}
