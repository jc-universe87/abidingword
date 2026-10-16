//! Talking to an AI service, independent of which one. Two wire formats cover
//! the services offered: the widely shared "chat completions" format (OpenAI,
//! Google's compatible endpoint, Ollama, LM Studio and other servers) and
//! Anthropic's Messages format. Adding a service means adding a case here;
//! nothing in Teaching Preparation knows which service answers.

use serde_json::{json, Value};

use super::config::{AssistantConfig, ProviderKind};
use super::http::{HttpCall, HttpReply, Method, Transport};
use crate::error::{AppError, AppResult, UserMessage};

/// What is asked: the standing instructions and the request itself.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatRequest {
    pub system: String,
    pub user: String,
    pub max_tokens: u32,
}

fn assistant_error(code: &'static str, text: &str) -> AppError {
    AppError::Assistant(UserMessage::new(code, text))
}

pub fn not_set_up() -> AppError {
    assistant_error(
        "assistant.notSetUp",
        "The assistant is not set up yet. You can set it up in Settings.",
    )
}

/// Builds the request for the configured service. The key goes in the one
/// header the service reads, never in the body or the address.
pub fn build(
    config: &AssistantConfig,
    key: Option<&str>,
    chat: &ChatRequest,
) -> AppResult<HttpCall> {
    let base = config.base_url().ok_or_else(not_set_up)?;
    if config.model.is_empty() {
        return Err(assistant_error(
            "assistant.noModel",
            "Choose which model to use in Settings.",
        ));
    }
    if config.provider.needs_key() && key.is_none() {
        return Err(assistant_error(
            "assistant.noKey",
            "The assistant needs its key. You can add it in Settings.",
        ));
    }
    let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
    if config.provider.is_anthropic() {
        if let Some(key) = key {
            headers.push(("x-api-key".into(), key.into()));
        }
        headers.push(("anthropic-version".into(), "2023-06-01".into()));
        return Ok(HttpCall {
            method: Method::Post,
            url: format!("{base}/messages"),
            headers,
            body: Some(json!({
                "model": config.model,
                "max_tokens": chat.max_tokens,
                "system": chat.system,
                "messages": [{"role": "user", "content": chat.user}],
            })),
        });
    }
    if let Some(key) = key {
        headers.push(("authorization".into(), format!("Bearer {key}")));
    }
    Ok(HttpCall {
        method: Method::Post,
        url: format!("{base}/chat/completions"),
        headers,
        body: Some(json!({
            "model": config.model,
            "messages": [
                {"role": "system", "content": chat.system},
                {"role": "user", "content": chat.user},
            ],
        })),
    })
}

/// Reads the service's answer text, or says plainly why there is none.
pub fn parse(kind: ProviderKind, reply: &HttpReply) -> AppResult<String> {
    match reply.status {
        200..=299 => {}
        401 | 403 => {
            return Err(assistant_error(
                "assistant.keyRefused",
                "The assistant service did not accept the key. Check it in Settings.",
            ))
        }
        404 => {
            return Err(assistant_error(
                "assistant.modelMissing",
                "The assistant service does not know that model. Check the model name in Settings.",
            ))
        }
        429 => {
            return Err(assistant_error(
                "assistant.busy",
                "The assistant service is busy or the account's limit is reached. Please try again later.",
            ))
        }
        status => {
            log::warn!("assistant service answered with status {status}");
            return Err(assistant_error(
                "assistant.failed",
                "The assistant service could not answer this time. Please try again.",
            ));
        }
    }
    let value: Value = serde_json::from_slice(&reply.body).map_err(|_| bad_reply())?;
    let text = if kind.is_anthropic() {
        value["content"]
            .as_array()
            .map(|parts| {
                parts
                    .iter()
                    .filter(|p| p["type"] == "text")
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default()
    } else {
        value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_default()
            .to_string()
    };
    if text.trim().is_empty() {
        return Err(bad_reply());
    }
    Ok(text)
}

pub fn bad_reply() -> AppError {
    assistant_error(
        "assistant.badReply",
        "The assistant's answer could not be used. Nothing was changed. Please try again.",
    )
}

/// Asks the configured service once.
pub async fn ask(
    transport: &impl Transport,
    config: &AssistantConfig,
    key: Option<&str>,
    chat: &ChatRequest,
) -> AppResult<String> {
    let call = build(config, key, chat)?;
    let reply = transport.send(call).await?;
    parse(config.provider, &reply)
}

/// The first JSON object in an answer (services sometimes wrap it in prose
/// or a code fence).
pub fn json_object(text: &str) -> AppResult<Value> {
    let trimmed = text.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if value.is_object() {
            return Ok(value);
        }
    }
    let start = trimmed.find('{').ok_or_else(bad_reply)?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, c) in trimmed[start..].char_indices() {
        if in_string {
            match c {
                '\\' if !escaped => escaped = true,
                '"' if !escaped => in_string = false,
                _ => escaped = false,
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let candidate = &trimmed[start..start + i + 1];
                    return serde_json::from_str(candidate).map_err(|_| bad_reply());
                }
            }
            _ => {}
        }
    }
    Err(bad_reply())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat() -> ChatRequest {
        ChatRequest {
            system: "S".into(),
            user: "U".into(),
            max_tokens: 100,
        }
    }

    #[test]
    fn the_key_travels_only_in_its_header() {
        let config = AssistantConfig {
            enabled: true,
            model: "m".into(),
            ..AssistantConfig::default()
        };
        let call = build(&config, Some("sk-secret"), &chat()).unwrap();
        assert_eq!(call.url, "https://api.openai.com/v1/chat/completions");
        assert!(!call.url.contains("sk-secret"));
        assert!(!call
            .body
            .as_ref()
            .unwrap()
            .to_string()
            .contains("sk-secret"));
        assert!(call
            .headers
            .iter()
            .any(|(n, v)| n == "authorization" && v == "Bearer sk-secret"));

        let anthropic = AssistantConfig {
            provider: ProviderKind::Anthropic,
            ..config
        };
        let call = build(&anthropic, Some("sk-secret"), &chat()).unwrap();
        assert_eq!(call.url, "https://api.anthropic.com/v1/messages");
        assert!(!call
            .body
            .as_ref()
            .unwrap()
            .to_string()
            .contains("sk-secret"));
        assert_eq!(call.body.as_ref().unwrap()["system"], "S");
        assert!(call
            .headers
            .iter()
            .any(|(n, v)| n == "x-api-key" && v == "sk-secret"));
    }

    #[test]
    fn a_remote_service_without_its_key_is_not_called() {
        let config = AssistantConfig {
            model: "m".into(),
            ..AssistantConfig::default()
        };
        let error = build(&config, None, &chat()).unwrap_err();
        assert!(matches!(error, AppError::Assistant(ref m) if m.code == Some("assistant.noKey")));
        // A local service needs none.
        let local = AssistantConfig {
            provider: ProviderKind::Ollama,
            ..config
        };
        let call = build(&local, None, &chat()).unwrap();
        assert_eq!(call.url, "http://localhost:11434/v1/chat/completions");
        assert!(!call.headers.iter().any(|(n, _)| n == "authorization"));
    }

    #[test]
    fn answers_and_refusals_are_read() {
        let ok = HttpReply {
            status: 200,
            body: br#"{"choices":[{"message":{"content":"hello"}}]}"#.to_vec(),
        };
        assert_eq!(parse(ProviderKind::Openai, &ok).unwrap(), "hello");
        let anthropic = HttpReply {
            status: 200,
            body: br#"{"content":[{"type":"text","text":"hi"},{"type":"text","text":" there"}]}"#
                .to_vec(),
        };
        assert_eq!(
            parse(ProviderKind::Anthropic, &anthropic).unwrap(),
            "hi there"
        );
        let refused = HttpReply {
            status: 401,
            body: b"{}".to_vec(),
        };
        let error = parse(ProviderKind::Openai, &refused).unwrap_err();
        assert!(
            matches!(error, AppError::Assistant(ref m) if m.code == Some("assistant.keyRefused"))
        );
        let empty = HttpReply {
            status: 200,
            body: br#"{"choices":[{"message":{"content":"  "}}]}"#.to_vec(),
        };
        assert!(parse(ProviderKind::Openai, &empty).is_err());
    }

    #[test]
    fn json_is_found_inside_prose_or_a_fence() {
        let v = json_object("Sure!\n```json\n{\"a\": \"x } y\", \"b\": {\"c\": 1}}\n```").unwrap();
        assert_eq!(v["a"], "x } y");
        assert_eq!(v["b"]["c"], 1);
        assert!(json_object("no json here").is_err());
    }
}
