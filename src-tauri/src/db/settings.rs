//! Typed application settings over the key/value `settings` table.
//! Values are stored as JSON so each key can hold any shape.

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::db::now;
use crate::domain::{AppSettings, UpdateSettings};
use crate::error::{AppError, AppResult};

const THEME: &str = "appearance.theme";

pub fn get(conn: &Connection) -> AppResult<AppSettings> {
    let defaults = AppSettings::default();
    Ok(AppSettings {
        theme: read(conn, THEME)?.unwrap_or(defaults.theme),
    })
}

pub fn update(conn: &Connection, input: &UpdateSettings) -> AppResult<AppSettings> {
    if let Some(theme) = input.theme {
        write(conn, THEME, &theme)?;
    }
    get(conn)
}

fn read<T: DeserializeOwned>(conn: &Connection, key: &str) -> AppResult<Option<T>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()?;
    match raw {
        None => Ok(None),
        Some(json) => match serde_json::from_str(&json) {
            Ok(value) => Ok(Some(value)),
            // An unreadable value falls back to the default instead of
            // blocking startup.
            Err(e) => {
                log::warn!("ignoring unreadable setting {key}: {e}");
                Ok(None)
            }
        },
    }
}

fn write<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    let json = serde_json::to_string(value).map_err(|e| AppError::Unexpected(e.to_string()))?;
    let now = now();
    conn.execute(
        "INSERT INTO settings (key, value, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, json, now],
    )?;
    Ok(())
}
