//! Managed library files: content hashing, safe file names, folders.
//!
//! Imported files are copied into `sources/<category>/<source id>/<name>`
//! inside the data folder. The name is rebuilt from safe characters only, so
//! nothing in an imported file name can reach outside that folder, and each
//! source has its own folder, so names never collide.

use sha2::{Digest, Sha256};

/// SHA-256 of the file content, lower-case hex.
pub fn content_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `sources/` sub-folder for a format.
pub fn category(format: &str) -> &'static str {
    match format {
        "pdf" | "epub" => "books",
        "markdown" | "text" => "notes",
        _ => "documents",
    }
}

const MAX_NAME_CHARS: usize = 120;

/// A file name that is safe on Windows, macOS and Linux: letters, digits,
/// spaces and `. _ - ( )` only; no leading dots; no reserved Windows names;
/// the extension kept.
pub fn safe_file_name(original: &str, extension: &str) -> String {
    let last = original.rsplit(['/', '\\']).next().unwrap_or(original);
    let stem = last.strip_suffix(&format!(".{extension}")).unwrap_or(last);
    let mut clean: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-' | '(' | ')') {
                c
            } else {
                '_'
            }
        })
        .collect();
    // No ".." anywhere, even though a single path component could not
    // escape its folder: such names only confuse.
    while clean.contains("..") {
        clean = clean.replace("..", ".");
    }
    clean = clean
        .trim_matches(|c: char| c == '.' || c == ' ')
        .to_string();
    clean = clean.chars().take(MAX_NAME_CHARS).collect();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3",
    ];
    if clean.is_empty() || reserved.contains(&clean.to_ascii_uppercase().as_str()) {
        clean = format!("source_{clean}");
    }
    format!("{clean}.{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_are_stable_sha256() {
        assert_eq!(
            content_hash(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn file_names_cannot_escape_or_misbehave() {
        assert_eq!(safe_file_name("../../etc/passwd.pdf", "pdf"), "passwd.pdf");
        assert_eq!(
            safe_file_name("C:\\\\Users\\\\x\\\\Stott: Cross?.pdf", "pdf"),
            "Stott_ Cross_.pdf"
        );
        assert_eq!(safe_file_name("...hidden.md", "md"), "hidden.md");
        assert_eq!(safe_file_name("CON.txt", "txt"), "source_CON.txt");
        assert_eq!(
            safe_file_name("Römerbrief Notizen.md", "md"),
            "Römerbrief Notizen.md"
        );
        assert_eq!(safe_file_name("a\u{0}b\nc.txt", "txt"), "a_b_c.txt");
        assert!(safe_file_name(&"x".repeat(500), "pdf").chars().count() <= MAX_NAME_CHARS + 4);
    }
}
