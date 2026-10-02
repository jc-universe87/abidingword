//! One error model for the whole native core.
//!
//! [`AppError`] carries full technical detail for the log. The frontend never
//! sees it directly: commands convert it into an [`ErrorPayload`], which holds
//! an error kind, a stable message `code` with its `params`, and a short
//! English message. The interface shows the message for the code in the
//! user's language (docs/i18n.md); the English text is the fallback and what
//! the log records. The conversion is also where every command error gets
//! logged.

use std::collections::BTreeMap;
use std::fmt;
use std::ops::Deref;
use std::path::PathBuf;

use serde::Serialize;

/// A message meant for the user: a stable code the interface translates,
/// the values it needs, and the English wording (fallback and log).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserMessage {
    pub code: Option<&'static str>,
    pub params: BTreeMap<&'static str, String>,
    pub text: String,
}

impl UserMessage {
    pub fn new(code: &'static str, text: impl Into<String>) -> Self {
        Self {
            code: Some(code),
            params: BTreeMap::new(),
            text: text.into(),
        }
    }

    /// Adds a value the translated message can use, e.g. a file name.
    pub fn with(mut self, name: &'static str, value: impl ToString) -> Self {
        self.params.insert(name, value.to_string());
        self
    }
}

/// English-only text without a code (kept for messages that never reach
/// the interface).
impl From<String> for UserMessage {
    fn from(text: String) -> Self {
        Self {
            text,
            ..Self::default()
        }
    }
}

impl From<&str> for UserMessage {
    fn from(text: &str) -> Self {
        text.to_string().into()
    }
}

impl fmt::Display for UserMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

/// Reads as its English text, so callers can inspect it like a string.
impl Deref for UserMessage {
    type Target = str;
    fn deref(&self) -> &str {
        &self.text
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("filesystem error at {path}: {source}")]
    Filesystem {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// The message is shown to the user as written, so keep it plain.
    #[error("invalid input: {0}")]
    InvalidInput(UserMessage),

    #[error("{entity} not found: {id}")]
    NotFound { entity: &'static str, id: String },

    #[error("migration {version} ({name}) failed: {message}")]
    Migration {
        version: i64,
        name: String,
        message: String,
    },

    /// The request conflicts with what is stored: a protected built-in
    /// template, a relation that already exists, a section that still has
    /// content. The message is shown to the user as written.
    #[error("conflict: {0}")]
    Conflict(UserMessage),

    /// A Scripture reference that is not a real passage. The message is
    /// shown to the user as written.
    #[error("invalid Scripture reference: {0}")]
    InvalidReference(UserMessage),

    /// A Bible import could not be read or checked. User-facing message.
    #[error("Bible import failed: {0}")]
    Import(UserMessage),

    /// A file in a format that cannot be imported. User-facing message.
    #[error("unsupported import format: {0}")]
    UnsupportedFormat(UserMessage),

    #[error("a Bible with the short name {0} is already installed")]
    DuplicateTranslation(String),

    /// The database file failed SQLite's integrity check or is not a
    /// database at all.
    #[error("database integrity check failed: {0}")]
    Integrity(String),

    #[error("pre-migration backup to {path} failed: {message}")]
    Backup { path: PathBuf, message: String },

    #[error("unexpected error: {0}")]
    Unexpected(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Database,
    Filesystem,
    InvalidInput,
    NotFound,
    Migration,
    Conflict,
    InvalidReference,
    ImportFailed,
    UnsupportedFormat,
    DuplicateTranslation,
    Integrity,
    Backup,
    Unexpected,
}

impl AppError {
    pub fn filesystem(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Filesystem {
            path: path.into(),
            source,
        }
    }

    pub fn not_found(entity: &'static str, id: impl Into<String>) -> Self {
        Self::NotFound {
            entity,
            id: id.into(),
        }
    }

    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Database(_) => ErrorKind::Database,
            Self::Filesystem { .. } => ErrorKind::Filesystem,
            Self::InvalidInput(_) => ErrorKind::InvalidInput,
            Self::NotFound { .. } => ErrorKind::NotFound,
            Self::Migration { .. } => ErrorKind::Migration,
            Self::Conflict(_) => ErrorKind::Conflict,
            Self::InvalidReference(_) => ErrorKind::InvalidReference,
            Self::Import(_) => ErrorKind::ImportFailed,
            Self::UnsupportedFormat(_) => ErrorKind::UnsupportedFormat,
            Self::DuplicateTranslation(_) => ErrorKind::DuplicateTranslation,
            Self::Integrity(_) => ErrorKind::Integrity,
            Self::Backup { .. } => ErrorKind::Backup,
            Self::Unexpected(_) => ErrorKind::Unexpected,
        }
    }

    /// The message code and values for the interface. Kinds whose wording
    /// never varies are translated from the kind alone.
    pub fn user_code(&self) -> (Option<&'static str>, BTreeMap<&'static str, String>) {
        match self {
            Self::InvalidInput(m)
            | Self::Conflict(m)
            | Self::InvalidReference(m)
            | Self::Import(m)
            | Self::UnsupportedFormat(m) => (m.code, m.params.clone()),
            Self::DuplicateTranslation(short_name) => (
                Some("duplicateTranslation"),
                BTreeMap::from([("shortName", short_name.clone())]),
            ),
            _ => (None, BTreeMap::new()),
        }
    }

    /// A short, plain English message that is safe to show in the interface.
    pub fn user_message(&self) -> String {
        match self {
            Self::Database(_) => "Abiding Word could not read or save your data. \
                Your most recent change may not have been saved. Details are in the log file."
                .into(),
            Self::Filesystem { .. } => "Abiding Word could not use its data folder. \
                Check that the folder exists and that you have permission to write to it."
                .into(),
            Self::InvalidInput(message)
            | Self::Conflict(message)
            | Self::InvalidReference(message)
            | Self::Import(message)
            | Self::UnsupportedFormat(message) => message.text.clone(),
            Self::DuplicateTranslation(short_name) => format!(
                "A Bible called “{short_name}” is already installed. \
                 Choose a different short name."
            ),
            Self::NotFound { entity, .. } => {
                format!("This {entity} could not be found. It may have been deleted.")
            }
            Self::Migration { .. } => "Abiding Word could not update its database to this \
                version. Your data has not been changed. Details are in the log file."
                .into(),
            Self::Integrity(_) => "Your study database appears to be damaged, so Abiding Word \
                stopped before changing it. The file has not been modified. \
                Details are in the log file."
                .into(),
            Self::Backup { .. } => "Abiding Word could not make a safety backup before updating \
                its database, so nothing was changed. Check that the disk is not full."
                .into(),
            Self::Unexpected(_) => {
                "Something unexpected went wrong. Details are in the log file.".into()
            }
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// What the frontend receives when a command fails.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub kind: ErrorKind,
    /// English; shown when the interface has no translation for `code`.
    pub message: String,
    /// Stable message code, e.g. `library.passwordProtected`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Values for the message, e.g. `{"fileName": "notes.pdf"}`.
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
}

impl From<AppError> for ErrorPayload {
    fn from(error: AppError) -> Self {
        // Expected, user-caused errors are warnings; everything else is an
        // error worth investigating.
        match error.kind() {
            ErrorKind::InvalidInput
            | ErrorKind::NotFound
            | ErrorKind::Conflict
            | ErrorKind::InvalidReference
            | ErrorKind::UnsupportedFormat
            | ErrorKind::DuplicateTranslation => log::warn!("{error}"),
            _ => log::error!("{error}"),
        }
        let (code, params) = error.user_code();
        Self {
            kind: error.kind(),
            message: error.user_message(),
            code: code.map(String::from),
            params: params
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_hides_technical_detail() {
        let error = AppError::Unexpected("mutex poisoned at src/db/mod.rs:42".into());
        let payload = ErrorPayload::from(error);
        assert_eq!(payload.kind, ErrorKind::Unexpected);
        assert!(!payload.message.contains("mutex"));
    }

    #[test]
    fn invalid_input_message_is_passed_through() {
        let payload = ErrorPayload::from(AppError::InvalidInput("A title is required.".into()));
        assert_eq!(payload.message, "A title is required.");
    }

    #[test]
    fn coded_messages_carry_code_and_params() {
        let error = AppError::Import(
            UserMessage::new(
                "library.passwordProtected",
                "“a.pdf” is password-protected.",
            )
            .with("fileName", "a.pdf"),
        );
        let json = serde_json::to_value(ErrorPayload::from(error)).unwrap();
        assert_eq!(json["code"], "library.passwordProtected");
        assert_eq!(json["params"]["fileName"], "a.pdf");
        assert_eq!(json["message"], "“a.pdf” is password-protected.");
        let plain =
            serde_json::to_value(ErrorPayload::from(AppError::not_found("study", "x"))).unwrap();
        assert!(plain.get("code").is_none() && plain.get("params").is_none());
    }

    #[test]
    fn payload_serialises_with_camel_case_kind() {
        let payload = ErrorPayload::from(AppError::not_found("study", "abc"));
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["kind"], "notFound");
        assert_eq!(
            json["message"],
            "This study could not be found. It may have been deleted."
        );
    }
}
