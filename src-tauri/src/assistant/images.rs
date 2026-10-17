//! Images for teaching: found (freely licensed, from Wikimedia Commons, with
//! source, author and licence) or generated (by an image model, always
//! marked as generated and never as a photograph). Nothing is placed in a
//! teaching unless the person keeps it.

use base64::Engine as _;
use serde::Serialize;
use serde_json::{json, Value};

use super::config::{AssistantConfig, ImageCapability};
use super::http::{encode, HttpCall, HttpReply, Method};
use crate::error::{AppError, AppResult, UserMessage};

pub const COMMONS_API: &str = "https://commons.wikimedia.org/w/api.php";
const FOUND_MAX: usize = 8;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundImage {
    pub title: String,
    pub url: String,
    pub page_url: String,
    pub thumb_url: String,
    pub licence: String,
    pub licence_url: Option<String>,
    pub author: Option<String>,
    /// Wording to show with the image where the licence asks for it.
    pub attribution: String,
    /// The small picture itself, fetched by the core (the window loads no
    /// remote images).
    pub thumb_data: Option<String>,
}

/// Where image previews may be fetched from: Wikimedia's image servers only.
pub fn is_commons_file(url: &str) -> bool {
    url.starts_with("https://upload.wikimedia.org/") && crate::db::teaching::is_web_address(url)
}

pub fn thumb_call(url: &str) -> AppResult<HttpCall> {
    if !is_commons_file(url) {
        return Err(failed());
    }
    Ok(HttpCall {
        method: Method::Get,
        url: url.to_string(),
        headers: Vec::new(),
        body: None,
    })
}

/// A preview image as a data: address, when it really is an image.
pub fn thumb_data(reply: &HttpReply) -> Option<String> {
    if !(200..300).contains(&reply.status) || reply.body.len() > 3_000_000 {
        return None;
    }
    let b = &reply.body;
    let mime = if b.starts_with(b"\x89PNG") {
        "image/png"
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if b.starts_with(b"GIF8") {
        "image/gif"
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return None;
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(b)
    ))
}

fn failed() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.imagesFailed",
        "No images could be found this time. Please try again.",
    ))
}

pub fn search_call(terms: &str) -> HttpCall {
    let query = encode(&format!("{} filetype:bitmap", terms.trim()));
    HttpCall {
        method: Method::Get,
        url: format!(
            "{COMMONS_API}?action=query&format=json&generator=search&gsrnamespace=6\
             &gsrlimit={FOUND_MAX}&gsrsearch={query}&prop=imageinfo\
             &iiprop=url%7Cextmetadata&iiurlwidth=480"
        ),
        headers: vec![("accept".into(), "application/json".into())],
        body: None,
    }
}

fn plain(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Images with a known licence and address only; the rest are left out.
pub fn parse_found(reply: &HttpReply) -> AppResult<Vec<FoundImage>> {
    if !(200..300).contains(&reply.status) {
        return Err(failed());
    }
    let value: Value = serde_json::from_slice(&reply.body).map_err(|_| failed())?;
    let Some(pages) = value["query"]["pages"].as_object() else {
        return Ok(Vec::new());
    };
    let mut pages: Vec<&Value> = pages.values().collect();
    pages.sort_by_key(|p| p["index"].as_i64().unwrap_or(i64::MAX));
    let web = crate::db::teaching::is_web_address;
    Ok(pages
        .into_iter()
        .filter_map(|page| {
            let info = page["imageinfo"].get(0)?;
            let meta = &info["extmetadata"];
            let field = |name: &str| {
                meta[name]["value"]
                    .as_str()
                    .map(plain)
                    .filter(|v| !v.is_empty())
            };
            let url = info["url"].as_str()?.to_string();
            let page_url = info["descriptionurl"].as_str()?.to_string();
            let thumb_url = info["thumburl"].as_str().unwrap_or(&url).to_string();
            let licence = field("LicenseShortName")?;
            let licence_url = field("LicenseUrl").filter(|u| web(u));
            if ![&url, &page_url, &thumb_url].iter().all(|u| web(u)) {
                return None;
            }
            let author = field("Artist");
            let title = field("ObjectName").unwrap_or_else(|| {
                page["title"]
                    .as_str()
                    .unwrap_or("")
                    .trim_start_matches("File:")
                    .to_string()
            });
            let attribution = field("Attribution").unwrap_or_else(|| match &author {
                Some(a) => format!("{a}, {licence}, via Wikimedia Commons"),
                None => format!("{licence}, via Wikimedia Commons"),
            });
            Some(FoundImage {
                title,
                url,
                page_url,
                thumb_url,
                licence,
                licence_url,
                author,
                attribution,
                thumb_data: None,
            })
        })
        .take(FOUND_MAX)
        .collect())
}

/// Image generation needs a service that can make images (or may: see
/// [`ImageCapability::Unknown`]), and the person's permission.
pub fn can_generate(config: &AssistantConfig) -> bool {
    config.enabled
        && config.generate_images
        && config.image_capability() != ImageCapability::Unsupported
}

pub fn generate_call(
    config: &AssistantConfig,
    key: Option<&str>,
    description: &str,
) -> AppResult<HttpCall> {
    if !can_generate(config) {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.noImageGeneration",
            "Making images is not set up, or this AI service cannot make images. You can choose a service for images in Settings.",
        )));
    }
    let base = config
        .image_base_url()
        .ok_or_else(super::provider::not_set_up)?;
    let model = config.image_model_name();
    let mut headers = vec![("content-type".to_string(), "application/json".to_string())];
    match key {
        Some(key) => headers.push(("authorization".into(), format!("Bearer {key}"))),
        None if config.image_provider().needs_key() => {
            return Err(AppError::Assistant(UserMessage::new(
                "assistant.noKey",
                "The assistant needs its key. You can add it in Settings.",
            )))
        }
        None => {}
    }
    let prompt = format!(
        "{}\n\nA simple, clear illustration for teaching. It is an illustration, not a \
         photograph: do not imitate a photograph of a real historical scene, and add no text.",
        description.trim()
    );
    Ok(HttpCall {
        method: Method::Post,
        url: format!("{base}/images/generations"),
        headers,
        body: Some(json!({ "model": model, "prompt": prompt, "n": 1, "size": "1024x1024" })),
    })
}

/// The generated picture as PNG bytes.
pub fn parse_generated(reply: &HttpReply) -> AppResult<Vec<u8>> {
    if !(200..300).contains(&reply.status) {
        log::warn!("image service answered with status {}", reply.status);
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.imageFailed",
            "The image could not be made this time. Please try again.",
        )));
    }
    let value: Value =
        serde_json::from_slice(&reply.body).map_err(|_| super::provider::bad_reply())?;
    let data = value["data"][0]["b64_json"]
        .as_str()
        .ok_or_else(super::provider::bad_reply)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| super::provider::bad_reply())?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err(super::provider::bad_reply());
    }
    Ok(bytes)
}

pub fn data_url(png: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::config::{ImageService, ProviderKind};

    #[test]
    fn found_images_keep_licence_author_and_source() {
        let reply = HttpReply {
            status: 200,
            body: serde_json::to_vec(&json!({"query": {"pages": {
                "2": {"index": 2, "title": "File:Vine.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/vine.jpg",
                    "thumburl": "https://upload.wikimedia.org/thumb/vine.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Vine.jpg",
                    "extmetadata": {
                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                        "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
                        "Artist": {"value": "<a href=\"x\">Jane Doe</a>"}
                    }
                }]},
                "1": {"index": 1, "title": "File:Nolicence.jpg", "imageinfo": [{
                    "url": "https://upload.wikimedia.org/n.jpg",
                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:N.jpg",
                    "extmetadata": {}
                }]}
            }}}))
            .unwrap(),
        };
        let found = parse_found(&reply).unwrap();
        assert_eq!(found.len(), 1, "an image without a licence is left out");
        assert_eq!(found[0].title, "Vine.jpg");
        assert_eq!(found[0].licence, "CC BY-SA 4.0");
        assert_eq!(found[0].author.as_deref(), Some("Jane Doe"));
        assert_eq!(
            found[0].attribution,
            "Jane Doe, CC BY-SA 4.0, via Wikimedia Commons"
        );
    }

    #[test]
    fn previews_come_only_from_wikimedia_and_must_be_images() {
        assert!(is_commons_file("https://upload.wikimedia.org/a/b.jpg"));
        assert!(!is_commons_file(
            "https://upload.wikimedia.org.evil.example/a.jpg"
        ));
        assert!(!is_commons_file("http://upload.wikimedia.org/a.jpg"));
        assert!(thumb_call("https://example.org/tracker.gif").is_err());
        let jpeg = HttpReply {
            status: 200,
            body: vec![0xFF, 0xD8, 0xFF, 0xE0, 1, 2],
        };
        assert!(thumb_data(&jpeg)
            .unwrap()
            .starts_with("data:image/jpeg;base64,"));
        let html = HttpReply {
            status: 200,
            body: b"<html>".to_vec(),
        };
        assert_eq!(thumb_data(&html), None);
    }

    #[test]
    fn generation_is_only_offered_where_set_up() {
        let mut config = AssistantConfig {
            enabled: true,
            model: "m".into(),
            ..AssistantConfig::default()
        };
        assert!(
            generate_call(&config, Some("k"), "a vine").is_err(),
            "off by default"
        );
        config.generate_images = true;
        let call = generate_call(&config, Some("k"), "a vine").unwrap();
        assert!(call.url.ends_with("/images/generations"));
        assert!(call.body.unwrap()["prompt"]
            .as_str()
            .unwrap()
            .contains("not a photograph"));
        config.provider = ProviderKind::Anthropic;
        assert!(
            generate_call(&config, Some("k"), "a vine").is_err(),
            "Claude makes no images"
        );
        // Writing with Claude, images with OpenAI: the request goes to OpenAI.
        config.image_service = ImageService::Openai;
        let call = generate_call(&config, Some("k"), "a vine").unwrap();
        assert_eq!(call.url, "https://api.openai.com/v1/images/generations");
        assert!(
            generate_call(&config, None, "a vine").is_err(),
            "the OpenAI key is needed"
        );
    }
}
