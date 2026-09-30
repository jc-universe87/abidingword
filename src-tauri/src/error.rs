//! One error model for the whole native core.
//!
//! [`AppError`] carries full technical detail for the log. The frontend never
//! sees it directly: commands convert it into an [`ErrorPayload`], which holds
//! only an error kind and a short message written for the user. The
//! conversion is also where every command error gets logged.

use std::path::PathBuf;

use serde::Serialize;

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
    InvalidInput(String),

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
    Conflict(String),

    /// A Scripture reference that is not a real passage. The message is
    /// shown to the user as written.
    #[error("invalid Scripture reference: {0}")]
    InvalidReference(String),

    /// A Bible import could not be read or checked. User-facing message.
    #[error("Bible import failed: {0}")]
    Import(String),

    /// A file in a format that cannot be imported. User-facing message.
    #[error("unsupported import format: {0}")]
    UnsupportedFormat(String),

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

    /// A short, plain message that is safe to show in the interface.
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
            | Self::UnsupportedFormat(message) => message.clone(),
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
    pub message: String,
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
        Self {
            kind: error.kind(),
            message: error.user_message(),
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
