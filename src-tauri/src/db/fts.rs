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
