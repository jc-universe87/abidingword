//! The assistant's commands. Requests to a service are `async` and never
//! hold the database while waiting for an answer.

use serde::{Deserialize, Serialize};
use tauri::State;

use super::CommandResult;
use crate::assistant::config::{self, AssistantConfig};
use crate::assistant::context::AssistInput;
use crate::assistant::images::{self, FoundImage};
use crate::assistant::{self, secrets, AssistPreview, AssistReply, AssistantSettings};
use crate::error::{AppError, UserMessage};
use crate::state::AppState;

#[tauri::command(async)]
pub fn assistant_settings_get(state: State<'_, AppState>) -> CommandResult<AssistantSettings> {
    state.db(|conn| assistant::settings(conn, state.secrets()))
}

#[tauri::command(async)]
pub fn assistant_settings_set(
    state: State<'_, AppState>,
    config: AssistantConfig,
) -> CommandResult<AssistantSettings> {
    state.db(|conn| {
        config::set(conn, config)?;
        assistant::settings(conn, state.secrets())
    })
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyKind {
    Provider,
    Search,
}

/// Keeps (or, when blank, removes) a key in the credential store. The key
/// is never sent back.
#[tauri::command(async)]
pub fn assistant_key_set(
    state: State<'_, AppState>,
    which: KeyKind,
    key: String,
) -> CommandResult<AssistantSettings> {
    let key = secrets::clean_key(&key)?;
    state.db(|conn| {
        let config = config::get(conn)?;
        let name = match which {
            KeyKind::Provider => secrets::provider_key_name(config.provider.as_str()),
            KeyKind::Search => secrets::search_key_name("brave"),
        };
        state.secrets().set(&name, key.as_deref())?;
        assistant::settings(conn, state.secrets())
    })
}

#[tauri::command]
pub async fn assistant_test(state: State<'_, AppState>) -> CommandResult<()> {
    let (config, key) = state.db(|conn| {
        let config = config::get(conn)?;
        let key = state
            .secrets()
            .get(&secrets::provider_key_name(config.provider.as_str()))?;
        Ok((config, key))
    })?;
    assistant::test_connection(state.transport()?, &config, key.as_deref())
        .await
        .map_err(Into::into)
}

/// What would be shared, and with whom, before anything is sent.
#[tauri::command(async)]
pub fn assistant_preview(
    state: State<'_, AppState>,
    input: AssistInput,
) -> CommandResult<AssistPreview> {
    state.db(|conn| {
        Ok(assistant::preview(&assistant::prepare(
            conn,
            state.secrets(),
            &input,
        )?))
    })
}

/// Asks the assistant. The answer is a suggestion; nothing is changed.
#[tauri::command]
pub async fn assistant_ask(
    state: State<'_, AppState>,
    input: AssistInput,
) -> CommandResult<AssistReply> {
    let prepared = state.db(|conn| assistant::prepare(conn, state.secrets(), &input))?;
    assistant::run(state.transport()?, &prepared)
        .await
        .map_err(Into::into)
}

fn images_off() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.noImageSearch",
        "Finding images is turned off. You can turn it on in Settings.",
    ))
}

/// Freely licensed images on Wikimedia Commons, with their licence. Only
/// the search words are sent.
#[tauri::command]
pub async fn assistant_find_images(
    state: State<'_, AppState>,
    terms: String,
) -> CommandResult<Vec<FoundImage>> {
    let config = state.db(config::get)?;
    if !config.enabled || !config.find_images {
        return Err(images_off().into());
    }
    let terms: String = terms.trim().chars().take(200).collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    use crate::assistant::http::Transport as _;
    let reply = state.transport()?.send(images::search_call(&terms)).await?;
    images::parse_found(&reply).map_err(Into::into)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    /// The name it will have if kept.
    pub file: String,
    pub data_url: String,
    pub assistant: String,
}

/// Makes an image from a description. It is held in memory and written to
/// the data folder only if the person keeps it.
#[tauri::command]
pub async fn assistant_generate_image(
    state: State<'_, AppState>,
    description: String,
) -> CommandResult<GeneratedImage> {
    let (config, key) = state.db(|conn| {
        let config = config::get(conn)?;
        let key = state
            .secrets()
            .get(&secrets::provider_key_name(config.provider.as_str()))?;
        Ok((config, key))
    })?;
    let description: String = description.trim().chars().take(1_000).collect();
    if description.is_empty() {
        return Err(crate::assistant::context::write_first().into());
    }
    let call = images::generate_call(&config, key.as_deref(), &description)?;
    use crate::assistant::http::Transport as _;
    let reply = state.transport()?.send(call).await?;
    let png = images::parse_generated(&reply)?;
    let file = format!("{}.png", crate::db::new_id());
    let data_url = images::data_url(&png);
    state.hold_generated(file.clone(), png)?;
    Ok(GeneratedImage {
        file,
        data_url,
        assistant: if config.image_model.is_empty() {
            format!("{} · gpt-image-1", config.provider.label())
        } else {
            format!("{} · {}", config.provider.label(), config.image_model)
        },
    })
}
