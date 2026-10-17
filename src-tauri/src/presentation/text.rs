//! Measuring and wrapping text with the fonts a PDF will use, so that the
//! slide layout (shared by PDF and PowerPoint) knows how much fits.

use super::fonts::FontSet;

/// Which font draws a run of text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontRef {
    /// An embedded font: index into regular fonts, then bold fonts.
    Embedded(usize),
    /// The PDF's built-in Helvetica (Latin-1 only).
    Builtin { bold: bool },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub font: FontRef,
    /// Glyph numbers (embedded) or Latin-1 codes (built-in).
    pub codes: Vec<u16>,
    /// The characters drawn, for the PDF's text map.
    pub chars: Vec<char>,
    /// Width at size 1.
    pub width: f32,
}

pub struct Shaper<'a> {
    pub fonts: &'a FontSet,
}

/// Approximate Helvetica advance widths (per 1000) for the built-in font.
fn helvetica_width(c: char, bold: bool) -> f32 {
    let w = match c {
        'i' | 'j' | 'l' | '\'' | '.' | ',' | ':' | ';' | '!' | '|' => 278.0,
        'f' | 't' | 'r' | 'I' | ' ' | '(' | ')' | '-' => 333.0,
        'm' | 'M' => 833.0,
        'w' | 'W' => 778.0,
        'A'..='Z' => 667.0,
        _ => 556.0,
    };
    if bold {
        w * 1.05
    } else {
        w
    }
}

/// A character's code in the built-in font's WinAnsi encoding; `?` when it has none.
fn winansi(c: char) -> u16 {
    match c as u32 {
        0x20..=0x7E | 0xA0..=0xFF => c as u16,
        0x2013 => 0x96,
        0x2014 => 0x97,
        0x2018 => 0x91,
        0x2019 => 0x92,
        0x201C => 0x93,
        0x201D => 0x94,
        0x2022 => 0x95,
        0x2026 => 0x85,
        _ => u16::from(b'?'),
    }
}

/// Characters a line may break after even without a space (Hangul, CJK).
pub fn breaks_anywhere(c: char) -> bool {
    matches!(c as u32,
        0x1100..=0x11FF | 0x2E80..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF)
}

impl Shaper<'_> {
    /// Splits text into runs, each drawn with one font.
    pub fn runs(&self, text: &str, bold: bool) -> Vec<Run> {
        let regular = self.fonts.regular.len();
        let mut runs: Vec<Run> = Vec::new();
        for c in text.chars() {
            let c = if c == '\t' { ' ' } else { c };
            if c.is_control() {
                continue;
            }
            let lists: Vec<(usize, &crate::presentation::fonts::Font)> = if bold {
                self.fonts
                    .bold
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (regular + i, f))
                    .chain(self.fonts.regular.iter().enumerate())
                    .collect()
            } else {
                self.fonts.regular.iter().enumerate().collect()
            };
            let found = lists
                .into_iter()
                .find_map(|(i, f)| f.glyph(c).filter(|(g, _)| *g != 0).map(|g| (i, f, g)));
            let (font, code, width) = match found {
                Some((i, f, (gid, advance))) => (
                    FontRef::Embedded(i),
                    gid,
                    f32::from(advance) / f32::from(f.units_per_em.max(1)),
                ),
                None => {
                    let code = winansi(c);
                    let shown = if !(0x80..0xA0).contains(&code) {
                        char::from_u32(u32::from(code)).unwrap_or('?')
                    } else {
                        'n'
                    };
                    (
                        FontRef::Builtin { bold },
                        code,
                        helvetica_width(shown, bold) / 1000.0,
                    )
                }
            };
            match runs.last_mut() {
                Some(run) if run.font == font => {
                    run.codes.push(code);
                    run.chars.push(c);
                    run.width += width;
                }
                _ => runs.push(Run {
                    font,
                    codes: vec![code],
                    chars: vec![c],
                    width,
                }),
            }
        }
        runs
    }

    pub fn width(&self, text: &str, bold: bool, size: f32) -> f32 {
        self.runs(text, bold).iter().map(|r| r.width).sum::<f32>() * size
    }

    /// Wraps one paragraph to lines no wider than `max` points.
    pub fn wrap(&self, text: &str, bold: bool, size: f32, max: f32) -> Vec<String> {
        let mut lines = Vec::new();
        for paragraph in text.split('\n') {
            let mut line = String::new();
            for word in tokens(paragraph) {
                let candidate = format!("{line}{word}");
                if line.is_empty() || self.width(candidate.trim_end(), bold, size) <= max {
                    line = candidate;
                } else {
                    lines.push(line.trim_end().to_string());
                    line = word.trim_start().to_string();
                }
                // A word wider than the line is broken between characters.
                if self.width(line.trim_end(), bold, size) > max {
                    let mut part = String::new();
                    for c in line.chars() {
                        let next = format!("{part}{c}");
                        if !part.is_empty() && self.width(&next, bold, size) > max {
                            lines.push(part.trim_end().to_string());
                            part = c.to_string();
                        } else {
                            part = next;
                        }
                    }
                    line = part;
                }
            }
            lines.push(line.trim_end().to_string());
        }
        lines
    }
}

/// How much room a text takes, counting a Hangul or CJK character as two:
/// they are about twice as wide as Latin letters.
pub fn weight(text: &str) -> usize {
    text.chars()
        .map(|c| if breaks_anywhere(c) { 2 } else { 1 })
        .sum()
}

/// Words with their following space; CJK characters each on their own.
fn tokens(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        if breaks_anywhere(c) {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            out.push(c.to_string());
        } else if c == ' ' {
            current.push(c);
            out.push(std::mem::take(&mut current));
        } else {
            if current.ends_with(' ') {
                out.push(std::mem::take(&mut current));
            }
            current.push(c);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_words_and_hangul() {
        let fonts = FontSet::empty();
        let shaper = Shaper { fonts: &fonts };
        let lines = shaper.wrap("I am the true vine and my Father", false, 10.0, 60.0);
        assert!(lines.len() > 1);
        assert!(lines
            .iter()
            .all(|l| shaper.width(l, false, 10.0) <= 60.0 || !l.contains(' ')));
        assert_eq!(lines.join(" "), "I am the true vine and my Father");
        assert_eq!(
            tokens("나는 참포도나무"),
            vec!["나", "는", " ", "참", "포", "도", "나", "무"]
        );
    }
}
