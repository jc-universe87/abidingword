//! Input validation. Messages are shown to the user as written.

use crate::error::{AppError, AppResult, UserMessage};

pub const TITLE_MAX_CHARS: usize = 200;
pub const DESCRIPTION_MAX_CHARS: usize = 2_000;
pub const BLOCK_MAX_CHARS: usize = 200_000;

/// Trims a title and checks it is present and not too long.
/// `what` names the thing in the message, e.g. "project".
pub fn title(value: &str, what: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(UserMessage::new(
            "validation.titleRequired",
            format!("Please give the {what} a title."),
        )));
    }
    if trimmed.chars().count() > TITLE_MAX_CHARS {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "validation.titleTooLong",
                format!(
                    "The {what} title is too long. Please keep it under {TITLE_MAX_CHARS} characters."
                ),
            )
            .with("max", TITLE_MAX_CHARS),
        ));
    }
    Ok(trimmed.to_owned())
}

/// Trims optional text; blank becomes `None`.
pub fn optional_text(
    value: Option<&str>,
    max_chars: usize,
    what: &str,
) -> AppResult<Option<String>> {
    let Some(trimmed) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if trimmed.chars().count() > max_chars {
        return Err(AppError::InvalidInput(
            UserMessage::new(
                "validation.textTooLong",
                format!("The {what} is too long. Please keep it under {max_chars} characters."),
            )
            .with("max", max_chars),
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

/// Block content is stored exactly as typed (no trimming), within a size limit.
pub fn block_content(value: &str) -> AppResult<()> {
    if value.chars().count() > BLOCK_MAX_CHARS {
        return Err(AppError::InvalidInput(UserMessage::new(
            "validation.blockTooLong",
            "This block is too long to save. Please split it into several blocks.",
        )));
    }
    Ok(())
}

/// The stable key of a template part or starting step (v0.18.7): at most 64
/// lowercase letters, digits and hyphens ("key-words", "own-k3x9"). Empty
/// means none.
pub fn part_key(key: Option<&str>) -> AppResult<Option<String>> {
    match key.map(str::trim).filter(|k| !k.is_empty()) {
        None => Ok(None),
        Some(k)
            if k.len() <= 64
                && k.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') =>
        {
            Ok(Some(k.to_owned()))
        }
        Some(other) => Err(AppError::InvalidInput(
            UserMessage::new("templates.invalidKey", "This part's key is not valid.")
                .with("value", other),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_is_trimmed_and_required() {
        assert_eq!(title("  Romans  ", "project").unwrap(), "Romans");
        assert!(matches!(
            title("   ", "project"),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn title_length_counts_characters_not_bytes() {
        let greek = "λ".repeat(TITLE_MAX_CHARS);
        assert!(title(&greek, "study").is_ok());
        assert!(title(&format!("{greek}λ"), "study").is_err());
    }

    #[test]
    fn blank_optional_text_becomes_none() {
        assert_eq!(optional_text(Some("  "), 10, "description").unwrap(), None);
        assert_eq!(optional_text(None, 10, "description").unwrap(), None);
    }
}
