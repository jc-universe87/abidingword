//! API keys, kept in the operating system's credential store (Windows
//! Credential Manager, macOS Keychain, the Linux kernel keyring) and never in
//! the database, a settings file, a study, a log or a request body other than
//! the one header each service needs.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::error::{AppError, AppResult, UserMessage};

const SERVICE: &str = "Abiding Word";

/// Which key: the AI service's or the search service's, per kind so that
/// switching services keeps each key.
pub fn provider_key_name(kind: &str) -> String {
    format!("assistant.provider.{kind}")
}

pub fn search_key_name(kind: &str) -> String {
    format!("assistant.search.{kind}")
}

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> AppResult<Option<String>>;
    /// `None` removes the key.
    fn set(&self, name: &str, value: Option<&str>) -> AppResult<()>;
}

fn store_error(error: impl std::fmt::Display) -> AppError {
    log::warn!("credential store: {error}");
    AppError::Assistant(UserMessage::new(
        "assistant.keyStore",
        "The key could not be kept in this computer's credential store.",
    ))
}

/// The operating system's credential store.
pub struct OsStore;

impl SecretStore for OsStore {
    fn get(&self, name: &str) -> AppResult<Option<String>> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(store_error)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(store_error(error)),
        }
    }

    fn set(&self, name: &str, value: Option<&str>) -> AppResult<()> {
        let entry = keyring::Entry::new(SERVICE, name).map_err(store_error)?;
        match value {
            Some(value) => entry.set_password(value).map_err(store_error),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(store_error(error)),
            },
        }
    }
}

/// For tests: nothing leaves memory.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, name: &str) -> AppResult<Option<String>> {
        Ok(self
            .0
            .lock()
            .map_err(|_| AppError::Unexpected("secret store lock".into()))?
            .get(name)
            .cloned())
    }

    fn set(&self, name: &str, value: Option<&str>) -> AppResult<()> {
        let mut map = self
            .0
            .lock()
            .map_err(|_| AppError::Unexpected("secret store lock".into()))?;
        match value {
            Some(v) => map.insert(name.to_string(), v.to_string()),
            None => map.remove(name),
        };
        Ok(())
    }
}

/// A key as typed: surrounding spaces removed; blank means "remove".
pub fn clean_key(value: &str) -> AppResult<Option<String>> {
    let key = value.trim();
    if key.is_empty() {
        return Ok(None);
    }
    if key.len() > 500 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(AppError::InvalidInput(UserMessage::new(
            "assistant.badKey",
            "That does not look like a key. Please paste it again.",
        )));
    }
    Ok(Some(key.to_string()))
}
