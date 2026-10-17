//! The teaching assistant (v0.16): "AI assists; the human authors."
//!
//! * It acts only when the person asks, on the text they point to.
//! * It returns suggestions, comments, alternatives, checked stories and
//!   image ideas; it never changes anything. Applying a suggestion is the
//!   person's explicit action in the interface.
//! * What it is shown is assembled in [`context`], within fixed limits, from
//!   one teaching and its study, and listed for the person beforehand.
//! * Which service answers is configuration ([`config`], [`provider`]); keys
//!   live in the operating system's credential store ([`secrets`]).
//! * Real stories come only from search results and are checked against
//!   them ([`research`]); images are found with their licence or generated
//!   and marked so ([`images`]).

pub mod config;
pub mod context;
pub mod http;
pub mod images;
pub mod prompts;
pub mod provider;
pub mod research;
pub mod secrets;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::parser::ReferenceParser;
use crate::scripture::reference::ScriptureRefDto;
use config::{AssistantConfig, SearchKind};
use context::{AssistAction, AssistInput, Context, SharedItem};
use http::Transport;
use provider::ChatRequest;
use secrets::SecretStore;

/// The assistant's set-up as the Settings screen sees it: never a key, only
/// whether one is kept.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistantSettings {
    pub config: AssistantConfig,
    pub has_key: bool,
    pub has_search_key: bool,
    /// Text leaves this computer when the assistant is asked.
    pub remote: bool,
    pub can_generate_images: bool,
    /// Whether the chosen image service can make images.
    pub image_capability: config::ImageCapability,
    /// A key is kept for the image service when it is not the writing service.
    pub has_image_key: bool,
}

pub fn settings(conn: &Connection, secrets: &dyn SecretStore) -> AppResult<AssistantSettings> {
    let config = config::get(conn)?;
    let has_key = secrets
        .get(&secrets::provider_key_name(config.provider.as_str()))?
        .is_some();
    let has_search_key = match config.search {
        SearchKind::Brave => secrets.get(&secrets::search_key_name("brave"))?.is_some(),
        _ => false,
    };
    let has_image_key = secrets
        .get(&secrets::provider_key_name(
            config.image_provider().as_str(),
        ))?
        .is_some();
    // Images need their service's key too, when that service needs one.
    let image_key_ok = has_image_key || !config.image_provider().needs_key();
    Ok(AssistantSettings {
        remote: config.is_remote(),
        can_generate_images: images::can_generate(&config) && image_key_ok,
        image_capability: config.image_capability(),
        has_image_key,
        config,
        has_key,
        has_search_key,
    })
}

/// Everything needed to ask, gathered while the database is open; the
/// request itself is sent afterwards, without holding the database.
pub struct Prepared {
    pub config: AssistantConfig,
    pub key: Option<String>,
    pub search_key: Option<String>,
    pub context: Context,
}

fn off() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.off",
        "The assistant is turned off. You can turn it on in Settings.",
    ))
}

/// Checks the set-up and assembles the bounded context. Reads no key (the
/// credential store is only read when actually asking, and never while the
/// database is held).
pub fn prepare(conn: &Connection, input: &AssistInput) -> AppResult<Prepared> {
    let config = config::get(conn)?;
    if !config.enabled {
        return Err(off());
    }
    let context = context::assemble(conn, input)?;
    if context.action == AssistAction::Story && config.search == SearchKind::None {
        return Err(research::no_search());
    }
    Ok(Prepared {
        config,
        key: None,
        search_key: None,
        context,
    })
}

/// Adds the keys the request needs, from the credential store.
pub fn unlock(mut prepared: Prepared, secrets: &dyn SecretStore) -> AppResult<Prepared> {
    let config = &prepared.config;
    let key = secrets.get(&secrets::provider_key_name(config.provider.as_str()))?;
    if config.provider.needs_key() && key.is_none() {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.noKey",
            "The assistant needs its key. You can add it in Settings.",
        )));
    }
    if prepared.context.action == AssistAction::Story && config.search == SearchKind::Brave {
        prepared.search_key = secrets.get(&secrets::search_key_name("brave"))?;
    }
    prepared.key = key;
    Ok(prepared)
}

/// "Before you ask": where the text goes and what is shared.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistPreview {
    pub remote: bool,
    /// e.g. "OpenAI · gpt-4.1"
    pub assistant: String,
    pub shared: Vec<SharedItem>,
    /// The story search also sends search words to the search service.
    pub searches: bool,
}

pub fn preview(prepared: &Prepared) -> AssistPreview {
    AssistPreview {
        remote: prepared.config.is_remote(),
        assistant: prepared.config.assistant_label(),
        shared: context::shared(&prepared.context),
        searches: prepared.context.action == AssistAction::Story,
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// Words quoted from the person's text (only when they really occur).
    pub excerpt: String,
    pub comment: String,
    /// scripture, study, source or reasoning
    pub basis: String,
    /// Passages named, recognised deterministically. Suggestions only.
    pub passages: Vec<ScriptureRefDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub text: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisualIdea {
    pub description: String,
    /// photo, diagram or drawing
    pub kind: String,
    pub search_terms: String,
}

/// What came back. Nothing in it has been applied to anything.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistResult {
    /// New wording for the person's text: to replace it, or (a transition)
    /// to put at its start.
    #[serde(rename_all = "camelCase")]
    Proposal {
        suggestion: String,
        changes: String,
        placement: &'static str,
    },
    Comments {
        summary: String,
        comments: Vec<Comment>,
    },
    /// standing: "suggestion", or "hypothetical" for invented illustrations.
    Options {
        standing: &'static str,
        options: Vec<Choice>,
    },
    Stories {
        stories: Vec<research::Story>,
    },
    Visuals {
        ideas: Vec<VisualIdea>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssistReply {
    pub result: AssistResult,
    /// Which assistant answered (shown, and kept with anything saved).
    pub assistant: String,
    pub remote: bool,
}

fn text_of(value: &Value, key: &str, max: usize) -> String {
    let text = value[key].as_str().unwrap_or("").trim();
    text.chars().take(max).collect()
}

fn too_much() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.tooMuch",
        "The suggestion was much longer than your text, so it was not shown. Please try again.",
    ))
}

/// The most a wording suggestion may be, in characters. A suggestion far
/// longer than what the person wrote is new writing, not help with theirs.
pub fn proposal_limit(action: AssistAction, original: usize) -> usize {
    match action {
        AssistAction::Transition => 600,
        AssistAction::Shorten => original + 20,
        AssistAction::Translate | AssistAction::Audience | AssistAction::Spoken => {
            original * 2 + 200
        }
        _ => original * 3 / 2 + 200,
    }
}

/// Limits on the answer to a request in the person's own words.
pub const FREE_COMMENTS_MAX: usize = 5;
pub const FREE_COMMENT_MAX: usize = 400;

/// Turns the service's JSON into a result, enforcing every limit.
pub fn interpret(context: &Context, answer: &Value) -> AppResult<AssistResult> {
    let action = context.action;
    if action.is_wording() {
        let suggestion = text_of(answer, "suggestion", 40_000);
        if suggestion.is_empty() {
            return Err(provider::bad_reply());
        }
        let limit = proposal_limit(action, context.text.chars().count());
        if suggestion.chars().count() > limit {
            return Err(too_much());
        }
        return Ok(AssistResult::Proposal {
            suggestion,
            changes: text_of(answer, "changes", 600),
            placement: if action == AssistAction::Transition {
                "start"
            } else {
                "replace"
            },
        });
    }
    match action {
        AssistAction::Review
        | AssistAction::Structure
        | AssistAction::Application
        | AssistAction::Theology
        | AssistAction::Passages
        | AssistAction::Free => {
            let parser = ReferenceParser::english();
            // A free request gets shorter answers: comments and questions, not
            // passages long enough to stand in for the person's own writing.
            let (most, longest) = if action == AssistAction::Free {
                (FREE_COMMENTS_MAX, FREE_COMMENT_MAX)
            } else {
                (8, 800)
            };
            let comments = answer["comments"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .take(most)
                        .filter_map(|c| {
                            let comment = text_of(c, "comment", longest);
                            if comment.is_empty() {
                                return None;
                            }
                            let excerpt = text_of(c, "excerpt", 200);
                            // Never put words in the person's mouth.
                            let excerpt = if !excerpt.is_empty()
                                && (context.text.contains(&excerpt)
                                    || context.nearby.iter().any(|(_, t)| t.contains(&excerpt)))
                            {
                                excerpt
                            } else {
                                String::new()
                            };
                            let basis = match c["basis"].as_str().unwrap_or("").trim() {
                                b @ ("scripture" | "study" | "source") => b.to_string(),
                                _ => "reasoning".to_string(),
                            };
                            let passages = c["references"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(|r| r.as_str())
                                .take(5)
                                .filter_map(|r| parser.parse(r).ok())
                                .map(|r| r.to_dto())
                                .collect();
                            Some(Comment {
                                excerpt,
                                comment,
                                basis,
                                passages,
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(AssistResult::Comments {
                summary: text_of(answer, "summary", 400),
                comments,
            })
        }
        AssistAction::Phrasing
        | AssistAction::Question
        | AssistAction::Restructure
        | AssistAction::Illustration => {
            // Other ways to say the person's words are about as long as their words.
            let each = if action == AssistAction::Phrasing && !context.text.is_empty() {
                proposal_limit(AssistAction::Clarity, context.text.chars().count()).min(1_200)
            } else {
                1_200
            };
            let options: Vec<Choice> = answer["options"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .take(3)
                        .filter_map(|o| {
                            let text = text_of(o, "text", 40_000);
                            if text.chars().count() > each {
                                return None;
                            }
                            (!text.is_empty()).then(|| Choice {
                                text,
                                note: text_of(o, "note", 300),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            if options.is_empty() {
                return Err(provider::bad_reply());
            }
            Ok(AssistResult::Options {
                standing: if action == AssistAction::Illustration {
                    "hypothetical"
                } else {
                    "suggestion"
                },
                options,
            })
        }
        AssistAction::Visual => {
            let ideas = answer["ideas"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .take(3)
                        .filter_map(|i| {
                            let description = text_of(i, "description", 600);
                            if description.is_empty() {
                                return None;
                            }
                            let kind = match i["kind"].as_str().unwrap_or("").trim() {
                                k @ ("photo" | "diagram" | "drawing") => k.to_string(),
                                _ => "drawing".to_string(),
                            };
                            Some(VisualIdea {
                                description,
                                kind,
                                search_terms: text_of(i, "searchTerms", 100),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(AssistResult::Visuals { ideas })
        }
        _ => Err(provider::bad_reply()),
    }
}

/// Asks the assistant. Returns suggestions only; changes nothing.
pub async fn run(transport: &impl Transport, prepared: &Prepared) -> AppResult<AssistReply> {
    let config = &prepared.config;
    let context = &prepared.context;
    let system = prompts::system(&config.perspective, &context.ui_language);
    let key = prepared.key.as_deref();
    let result = if context.action == AssistAction::Story {
        stories(transport, prepared, &system).await?
    } else {
        let chat = ChatRequest {
            system,
            user: prompts::request(context),
            max_tokens: 2_000,
        };
        let answer = provider::ask(transport, config, key, &chat).await?;
        interpret(context, &provider::json_object(&answer)?)?
    };
    Ok(AssistReply {
        result,
        assistant: config.assistant_label(),
        remote: config.is_remote(),
    })
}

async fn stories(
    transport: &impl Transport,
    prepared: &Prepared,
    system: &str,
) -> AppResult<AssistResult> {
    let config = &prepared.config;
    let context = &prepared.context;
    let key = prepared.key.as_deref();
    let background = [
        context.central_message.as_deref(),
        context.audience.as_deref(),
        (!context.text.is_empty()).then_some(context.text.as_str()),
    ]
    .into_iter()
    .flatten()
    .map(|t| t.chars().take(400).collect::<String>())
    .collect::<Vec<_>>()
    .join("\n");
    let chat = ChatRequest {
        system: system.to_string(),
        user: research::queries_request(&context.request, &background),
        max_tokens: 400,
    };
    let answer = provider::ask(transport, config, key, &chat).await?;
    let queries = research::parse_queries(
        &provider::json_object(&answer).unwrap_or(Value::Null),
        &context.request,
    );
    let mut batches = Vec::new();
    for query in &queries {
        let call = research::search_call(config, prepared.search_key.as_deref(), query)?;
        let reply = transport.send(call).await?;
        batches.push(research::parse_results(config.search, &reply)?);
    }
    let results = research::merge(batches);
    if results.is_empty() {
        return Ok(AssistResult::Stories {
            stories: Vec::new(),
        });
    }
    let chat = ChatRequest {
        system: system.to_string(),
        user: research::candidates_request(&context.request, &results),
        max_tokens: 1_500,
    };
    let answer = provider::ask(transport, config, key, &chat).await?;
    Ok(AssistResult::Stories {
        stories: research::check(&provider::json_object(&answer)?, &results),
    })
}

/// A quick "is it working?" for Settings: one tiny request.
pub async fn test_connection(
    transport: &impl Transport,
    config: &AssistantConfig,
    key: Option<&str>,
) -> AppResult<()> {
    let chat = ChatRequest {
        system: "Reply with the JSON object {\"ok\": true} and nothing else.".into(),
        user: "Test.".into(),
        max_tokens: 20,
    };
    provider::ask(transport, config, key, &chat)
        .await
        .map(|_| ())
}
