//! Word-level annotations (v0.21): what one `\w …|attributes\w*` says about
//! its word, read by the USFM 3 attribute rules
//! (https://ubsicap.github.io/usfm/attributes/):
//!
//! - `name="value"` pairs separated by spaces; a list without any `=` is the
//!   default attribute, which for `\w` is `lemma` (`\w gracious|grace\w*`);
//! - several values in one attribute are separated by commas
//!   (`strong="H1234,G5485"`), and parts of one value by colons
//!   (`strong="b:H7225"`);
//! - user-defined attributes begin with `x-`.
//!
//! Read: `lemma`, `strong` (lexical identifiers, kept exactly as written), and
//! the morphology code in `x-morph` (or, as some exports write it, `morph`),
//! kept raw. `srcloc` and every other attribute are recorded by name only.
//! Nothing is guessed: an attribute list that does not follow the syntax, or
//! gives one attribute two different values, makes that word's annotations
//! unusable (counted, never half-read). Values are data only.

use serde::Serialize;

/// Longest attribute list read (a full UHB/UGNT `\w` list is under 200 bytes).
pub const ATTRIBUTES_MAX_BYTES: usize = 2_000;
/// Longest single value kept.
pub const VALUE_MAX_CHARS: usize = 300;

/// The annotations of one word.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WordAttributes {
    pub lemma: Option<String>,
    /// The `strong` value as written (all values, all parts).
    pub strong: Option<String>,
    pub morph: Option<String>,
    /// Which attribute held the morphology ("x-morph" or "morph").
    pub morph_attribute: Option<&'static str>,
    /// Names of the other attributes present (not read).
    pub other: Vec<String>,
}

impl WordAttributes {
    /// Whether the word carries anything this version indexes.
    pub fn is_empty(&self) -> bool {
        self.lemma.is_none() && self.strong.is_none() && self.morph.is_none()
    }

    /// Each lexical identifier the `strong` value names: every value and every
    /// part, as written (case kept, white space trimmed).
    pub fn lexical_ids(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for value in self.strong.as_deref().unwrap_or("").split(',') {
            for part in value.split(':') {
                let part = part.trim();
                if !part.is_empty() && !out.iter().any(|p| p == part) {
                    out.push(part.to_string());
                }
            }
        }
        out
    }
}

/// Why an attribute list could not be read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttributeProblem {
    /// Not `name="value"` pairs (or a default value).
    Syntax,
    /// One attribute given twice with different values.
    Conflict,
    /// Longer than the limits.
    TooLong,
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn clean(value: &str) -> Result<Option<String>, AttributeProblem> {
    let value = value.trim();
    if value.chars().count() > VALUE_MAX_CHARS {
        return Err(AttributeProblem::TooLong);
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

/// The `name="value"` pairs of a list, in order.
fn pairs(raw: &str) -> Result<Vec<(String, String)>, AttributeProblem> {
    let mut out = Vec::new();
    let mut rest = raw.trim_start();
    while !rest.is_empty() {
        let eq = rest.find('=').ok_or(AttributeProblem::Syntax)?;
        let name = rest[..eq].trim_end();
        if !valid_name(name) {
            return Err(AttributeProblem::Syntax);
        }
        let after = rest[eq + 1..].trim_start();
        let Some(body) = after.strip_prefix('"') else {
            return Err(AttributeProblem::Syntax);
        };
        let mut value = String::new();
        let mut chars = body.char_indices();
        let mut closed = None;
        while let Some((i, c)) = chars.next() {
            match c {
                '\\' => match chars.next() {
                    Some((_, e @ ('"' | '\\' | '|' | '~' | '/'))) => value.push(e),
                    _ => return Err(AttributeProblem::Syntax),
                },
                '"' => {
                    closed = Some(i);
                    break;
                }
                c => value.push(c),
            }
        }
        let end = closed.ok_or(AttributeProblem::Syntax)?;
        out.push((name.to_ascii_lowercase(), value));
        rest = body[end + 1..].trim_start();
        // Pairs are separated by white space.
        if !rest.is_empty() && body[end + 1..].starts_with(|c: char| !c.is_whitespace()) {
            return Err(AttributeProblem::Syntax);
        }
    }
    Ok(out)
}

/// Reads one `\w` attribute list.
pub fn parse_attributes(raw: &str) -> Result<WordAttributes, AttributeProblem> {
    if raw.len() > ATTRIBUTES_MAX_BYTES {
        return Err(AttributeProblem::TooLong);
    }
    let trimmed = raw.trim();
    let mut out = WordAttributes::default();
    if trimmed.is_empty() {
        return Ok(out);
    }
    // The default attribute: the whole list is the lemma.
    if !trimmed.contains('=') && !trimmed.contains('"') {
        out.lemma = clean(trimmed)?;
        return Ok(out);
    }
    let mut seen: Vec<(String, String)> = Vec::new();
    for (name, value) in pairs(trimmed)? {
        if let Some((_, before)) = seen.iter().find(|(n, _)| *n == name) {
            if before.trim() != value.trim() {
                return Err(AttributeProblem::Conflict);
            }
            continue;
        }
        seen.push((name, value));
    }
    for (name, value) in seen {
        match name.as_str() {
            "lemma" => out.lemma = clean(&value)?,
            "strong" => out.strong = clean(&value)?,
            "x-morph" | "morph" => {
                if out.morph.is_some() {
                    // Both spellings, as two attributes: which one counts is not clear.
                    return Err(AttributeProblem::Conflict);
                }
                out.morph = clean(&value)?;
                out.morph_attribute = Some(if name == "morph" { "morph" } else { "x-morph" });
            }
            _ => out.other.push(name),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_named_and_default_attributes() {
        let a =
            parse_attributes(r#"lemma="λόγος" strong="G3056" x-morph="Gr,N,,,,,NMS,""#).unwrap();
        assert_eq!(a.lemma.as_deref(), Some("λόγος"));
        assert_eq!(a.strong.as_deref(), Some("G3056"));
        assert_eq!(a.morph.as_deref(), Some("Gr,N,,,,,NMS,"));
        assert_eq!(a.morph_attribute, Some("x-morph"));
        assert_eq!(
            parse_attributes("grace").unwrap().lemma.as_deref(),
            Some("grace")
        );
        assert!(parse_attributes("  ").unwrap().is_empty());
    }

    #[test]
    fn escapes_repeats_and_unknown_names() {
        let a =
            parse_attributes(r#"lemma="say \"yes\"" srcloc="gnt5:51.1.2.1" x-note="n""#).unwrap();
        assert_eq!(a.lemma.as_deref(), Some(r#"say "yes""#));
        assert_eq!(a.other, ["srcloc", "x-note"]);
        assert!(parse_attributes(r#"lemma="a" lemma="a""#).is_ok());
        assert_eq!(
            parse_attributes(r#"lemma="a" lemma="b""#),
            Err(AttributeProblem::Conflict)
        );
        assert_eq!(
            parse_attributes(r#"x-morph="a" morph="b""#),
            Err(AttributeProblem::Conflict)
        );
    }

    #[test]
    fn malformed_lists_are_refused_whole() {
        for bad in [
            r#"lemma="open"#,
            r#"lemma=bare"#,
            r#"=“x”"#,
            r#"lemma="a"strong="b""#,
            r#"1x="a""#,
            r#"lemma="a\q""#,
        ] {
            assert_eq!(
                parse_attributes(bad),
                Err(AttributeProblem::Syntax),
                "{bad}"
            );
        }
        assert_eq!(
            parse_attributes(&format!("lemma=\"{}\"", "x".repeat(400))),
            Err(AttributeProblem::TooLong)
        );
    }

    #[test]
    fn lexical_ids_are_every_value_and_part() {
        let a = parse_attributes(r#"strong="b:H7225, H7225 ,c:d:H776""#).unwrap();
        assert_eq!(a.lexical_ids(), ["b", "H7225", "c", "d", "H776"]);
    }
}
