//! The one place requests leave the app. Everything else builds a plain
//! [`HttpCall`] and reads a plain [`HttpReply`], so tests can see exactly
//! what would be sent (and that no key is in it) without a network.

use std::future::Future;
use std::sync::Once;
use std::time::Duration;

use crate::error::{AppError, AppResult, UserMessage};

#[derive(Debug, Clone, PartialEq)]
pub enum Method {
    Get,
    Post,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpCall {
    pub method: Method,
    pub url: String,
    /// Headers, including the one that carries a key. Never logged.
    pub headers: Vec<(String, String)>,
    pub body: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct HttpReply {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait Transport: Send + Sync {
    fn send(&self, call: HttpCall) -> impl Future<Output = AppResult<HttpReply>> + Send;
}

pub fn unreachable() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.unreachable",
        "The assistant could not be reached. Check the internet connection or the address in Settings.",
    ))
}

/// Sends requests with reqwest, using the system's proxy settings.
pub struct WebTransport {
    client: reqwest::Client,
}

static CRYPTO: Once = Once::new();

impl WebTransport {
    pub fn new() -> AppResult<Self> {
        // The TLS backend is shared with the updater (rustls with ring).
        CRYPTO.call_once(|| {
            let _ = rustls::crypto::ring::default_provider().install_default();
        });
        let client = reqwest::Client::builder()
            .user_agent(concat!("AbidingWord/", env!("CARGO_PKG_VERSION")))
            // A redirect could carry a key header to another host: never follow one.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| AppError::Unexpected(format!("http client: {e}")))?;
        Ok(Self { client })
    }
}

impl Transport for WebTransport {
    async fn send(&self, call: HttpCall) -> AppResult<HttpReply> {
        let mut request = match call.method {
            Method::Get => self.client.get(&call.url),
            Method::Post => self.client.post(&call.url),
        };
        for (name, value) in &call.headers {
            request = request.header(name, value);
        }
        if let Some(body) = &call.body {
            request = request.json(body);
        }
        // Only the address's host is logged: never a header, key, body or user name.
        let host = reqwest::Url::parse(&call.url)
            .ok()
            .and_then(|u| u.host_str().map(String::from))
            .unwrap_or_default();
        let response = request.send().await.map_err(|e| {
            log::warn!("assistant request to {host} failed: {}", e.without_url());
            unreachable()
        })?;
        let status = response.status().as_u16();
        let body = response.bytes().await.map_err(|e| {
            log::warn!("assistant reply from {host} failed: {}", e.without_url());
            unreachable()
        })?;
        Ok(HttpReply {
            status,
            body: body.to_vec(),
        })
    }
}

/// A plain query-string encoder (letters, digits and `-_.~` stay as they are).
pub fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
