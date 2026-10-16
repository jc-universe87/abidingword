//! How the assistant is set up: which AI service, which search service, and
//! whether images may be found or generated. Stored in the settings table,
//! apart from all study data. API keys are never stored here (see
//! [`super::secrets`]).

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::settings;
use crate::error::{AppError, AppResult, UserMessage};

const KEY: &str = "assistant.config";

/// The AI services the assistant can talk to. All but Anthropic use the
/// widely shared "chat completions" interface, so a service not listed here
/// works through [`ProviderKind::OpenaiCompatible`]. None is preferred: the
/// list is alphabetical in the interface apart from the local ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    #[default]
    Openai,
    Anthropic,
    /// Google Gemini through its OpenAI-compatible endpoint.
    Google,
    /// xAI (Grok).
    Xai,
    Perplexity,
    Deepseek,
    /// Alibaba Cloud Model Studio (Qwen), international endpoint.
    Qwen,
    /// Runs on this computer (or one the person chooses).
    Ollama,
    /// Runs on this computer (or one the person chooses).
    Lmstudio,
    /// Any other server with an OpenAI-compatible interface.
    OpenaiCompatible,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
            Self::Google => "google",
            Self::Xai => "xai",
            Self::Perplexity => "perplexity",
            Self::Deepseek => "deepseek",
            Self::Qwen => "qwen",
            Self::Ollama => "ollama",
            Self::Lmstudio => "lmstudio",
            Self::OpenaiCompatible => "openai_compatible",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Openai => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Google => "Google Gemini",
            Self::Xai => "xAI (Grok)",
            Self::Perplexity => "Perplexity",
            Self::Deepseek => "DeepSeek",
            Self::Qwen => "Qwen",
            Self::Ollama => "Ollama",
            Self::Lmstudio => "LM Studio",
            Self::OpenaiCompatible => "Other compatible service",
        }
    }

    pub fn default_base_url(self) -> Option<&'static str> {
        match self {
            Self::Openai => Some("https://api.openai.com/v1"),
            Self::Anthropic => Some("https://api.anthropic.com/v1"),
            Self::Google => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
            Self::Xai => Some("https://api.x.ai/v1"),
            Self::Perplexity => Some("https://api.perplexity.ai"),
            Self::Deepseek => Some("https://api.deepseek.com/v1"),
            Self::Qwen => Some("https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
            Self::Ollama => Some("http://localhost:11434/v1"),
            Self::Lmstudio => Some("http://localhost:1234/v1"),
            Self::OpenaiCompatible => None,
        }
    }

    /// Whether the service needs an API key at all.
    pub fn needs_key(self) -> bool {
        !matches!(self, Self::Ollama | Self::Lmstudio | Self::OpenaiCompatible)
    }

    pub fn is_anthropic(self) -> bool {
        self == Self::Anthropic
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchKind {
    /// No search: real stories and quotations cannot be checked.
    #[default]
    None,
    /// Brave Search API (needs a key).
    Brave,
    /// A SearXNG instance the person runs or trusts (no key).
    Searxng,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssistantConfig {
    /// Off until the person turns it on.
    pub enabled: bool,
    pub provider: ProviderKind,
    /// Empty: the provider's usual address.
    pub base_url: String,
    pub model: String,
    pub search: SearchKind,
    /// For SearXNG: the instance's address.
    pub search_url: String,
    /// Find freely licensed images on Wikimedia Commons.
    pub find_images: bool,
    /// Generate images (OpenAI image models only).
    pub generate_images: bool,
    pub image_model: String,
    /// The person's own description of their theological tradition or way of
    /// reading Scripture, in their words. Empty: no position is assumed.
    pub perspective: String,
}

impl Default for AssistantConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: ProviderKind::default(),
            base_url: String::new(),
            model: String::new(),
            search: SearchKind::None,
            search_url: String::new(),
            find_images: true,
            generate_images: false,
            image_model: String::new(),
            perspective: String::new(),
        }
    }
}

const PERSPECTIVE_MAX_CHARS: usize = 1_000;

fn invalid(code: &'static str, text: &str) -> AppError {
    AppError::InvalidInput(UserMessage::new(code, text))
}

/// A service address must be a plain web address.
fn check_url(url: &str) -> AppResult<()> {
    if url.is_empty() {
        return Ok(());
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://"))
        || url.chars().any(char::is_whitespace)
        || url.len() > 500
    {
        return Err(invalid(
            "assistant.badAddress",
            "Please enter a web address beginning with http:// or https://.",
        ));
    }
    Ok(())
}

impl AssistantConfig {
    /// Trims and checks what the person entered.
    pub fn normalised(mut self) -> AppResult<Self> {
        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();
        self.search_url = self.search_url.trim().trim_end_matches('/').to_string();
        self.model = self.model.trim().to_string();
        self.image_model = self.image_model.trim().to_string();
        self.perspective = self.perspective.trim().to_string();
        check_url(&self.base_url)?;
        check_url(&self.search_url)?;
        if self.model.chars().count() > 200 || self.image_model.chars().count() > 200 {
            return Err(invalid(
                "assistant.badModel",
                "That model name is too long.",
            ));
        }
        if self.perspective.chars().count() > PERSPECTIVE_MAX_CHARS {
            return Err(AppError::InvalidInput(
                UserMessage::new(
                    "validation.textTooLong",
                    format!("The description is too long. Please keep it under {PERSPECTIVE_MAX_CHARS} characters."),
                )
                .with("max", PERSPECTIVE_MAX_CHARS),
            ));
        }
        Ok(self)
    }

    /// The address requests go to.
    pub fn base_url(&self) -> Option<String> {
        if self.base_url.is_empty() {
            self.provider.default_base_url().map(String::from)
        } else {
            Some(self.base_url.clone())
        }
    }

    /// Whether text leaves this computer when the assistant is asked.
    pub fn is_remote(&self) -> bool {
        self.base_url().is_none_or(|url| !is_local_address(&url))
    }

    /// e.g. "OpenAI · gpt-4.1": recorded with what the person keeps.
    pub fn assistant_label(&self) -> String {
        if self.model.is_empty() {
            self.provider.label().to_string()
        } else {
            format!("{} · {}", self.provider.label(), self.model)
        }
    }
}

/// Addresses on this computer: text sent there does not leave it.
/// The address is parsed as the request will be (user names, ports and
/// look-alike names such as `127.0.0.1.example.com` cannot pass), and only
/// `localhost` or a loopback address counts.
pub fn is_local_address(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    match parsed.host() {
        Some(url::Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

pub fn get(conn: &Connection) -> AppResult<AssistantConfig> {
    Ok(settings::read(conn, KEY)?.unwrap_or_default())
}

pub fn set(conn: &Connection, config: AssistantConfig) -> AppResult<AssistantConfig> {
    let config = config.normalised()?;
    settings::write(conn, KEY, &config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses_are_recognised() {
        assert!(is_local_address("http://localhost:11434/v1"));
        assert!(is_local_address("http://127.0.0.1:1234/v1"));
        assert!(is_local_address("http://[::1]:8080"));
        assert!(!is_local_address("https://api.openai.com/v1"));
        assert!(!is_local_address("http://localhost.example.com/v1"));
        assert!(!is_local_address("http://192.168.1.4:11434"));
        // Look-alikes and tricks: never "this computer".
        assert!(!is_local_address("http://127.0.0.1.nip.io/v1"));
        assert!(!is_local_address("http://127.evil.com"));
        assert!(!is_local_address("http://localhost:x@evil.com/v1"));
        assert!(!is_local_address("http://localhost@evil.com/v1"));
        assert!(is_local_address("http://user@localhost:11434/v1"));
        assert!(is_local_address("http://127.1.2.3:8080"));
    }

    #[test]
    fn remote_unless_on_this_computer() {
        let mut config = AssistantConfig::default();
        assert!(config.is_remote());
        config.provider = ProviderKind::Ollama;
        assert!(!config.is_remote());
        config.base_url = "http://gpu-box.lan:11434/v1".into();
        assert!(config.is_remote());
        config.provider = ProviderKind::OpenaiCompatible;
        config.base_url = String::new();
        assert!(config.is_remote(), "no address yet: treated as remote");
    }

    #[test]
    fn every_cloud_service_has_an_address_and_needs_a_key() {
        use ProviderKind::*;
        for kind in [Openai, Anthropic, Google, Xai, Perplexity, Deepseek, Qwen] {
            let url = kind.default_base_url().unwrap();
            assert!(url.starts_with("https://"), "{url}");
            assert!(!is_local_address(url));
            assert!(kind.needs_key(), "{}", kind.as_str());
        }
        for kind in [Ollama, Lmstudio] {
            assert!(is_local_address(kind.default_base_url().unwrap()));
            assert!(!kind.needs_key());
        }
        // The generic choice: the person gives the address, and a key only if theirs needs one.
        assert!(OpenaiCompatible.default_base_url().is_none());
        assert!(!OpenaiCompatible.needs_key());
        let parsed: ProviderKind = serde_json::from_str("\"xai\"").unwrap();
        assert_eq!(parsed, Xai);
    }

    #[test]
    fn bad_addresses_are_refused() {
        let config = AssistantConfig {
            base_url: "file:///etc/passwd".into(),
            ..AssistantConfig::default()
        };
        assert!(config.normalised().is_err());
        let config = AssistantConfig {
            base_url: " https://example.org/v1/ ".into(),
            ..AssistantConfig::default()
        };
        assert_eq!(
            config.normalised().unwrap().base_url,
            "https://example.org/v1"
        );
    }
}
