//! Shared full-text search helpers (SQLite FTS5).

/// Turns what the user typed into a safe FTS5 query: every word must occur;
/// text in double quotes must occur as a phrase. FTS syntax characters in
/// the input have no effect.
pub fn query(input: &str) -> Option<String> {
    let words = |text: &str| -> Vec<String> {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(str::to_lowercase)
            .collect()
    };
    let mut parts = Vec::new();
    for (index, piece) in input.split('"').enumerate() {
        let found = words(piece);
        if found.is_empty() {
            continue;
        }
        if index % 2 == 1 {
            parts.push(format!("\"{}\"", found.join(" ")));
        } else {
            parts.extend(found.into_iter().map(|w| format!("\"{w}\"")));
        }
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}

#[cfg(test)]
mod tests {
    use super::query;

    #[test]
    fn straight_double_quotes_mark_an_exact_phrase() {
        // The search hints show this syntax ("exact phrase"), v0.18.10.
        assert_eq!(
            query("Palabras \"frase exacta\"").as_deref(),
            Some("\"palabras\" \"frase exacta\"")
        );
        assert_eq!(
            query("\"living water\"").as_deref(),
            Some("\"living water\"")
        );
    }

    #[test]
    fn typographic_quotes_are_not_search_syntax() {
        // « », “ ” and „ “ separate words like any other punctuation: each
        // word must occur, not the phrase. Unchanged in v0.18.10.
        for typed in ["«frase exacta»", "“frase exacta”", "„frase exacta“"] {
            assert_eq!(
                query(typed).as_deref(),
                Some("\"frase\" \"exacta\""),
                "{typed}"
            );
        }
    }

    #[test]
    fn nothing_to_search_for() {
        assert_eq!(query("\" « » \""), None);
    }
}
