//! Real stories, events and quotations: searched, never remembered.
//!
//! 1. The assistant turns the person's request into a few search queries.
//! 2. The configured search service is asked; its results are numbered.
//! 3. The assistant picks candidate stories and names, by number, the results
//!    that support each one. It never writes an address.
//! 4. Here, deterministically: every address comes from step 2 (numbers that
//!    do not exist are dropped); a story counts as checked only when results
//!    from at least two different sites support it; anything less is offered
//!    as "not checked". With no search service, no story is offered at all.

use serde::Serialize;
use serde_json::Value;

use super::config::{AssistantConfig, SearchKind};
use super::http::{encode, HttpCall, HttpReply, Method};
use crate::domain::ExternalSource;
use crate::error::{AppError, AppResult, UserMessage};

pub const RESULTS_PER_QUERY: usize = 6;
pub const RESULTS_MAX: usize = 12;
const QUERIES_MAX: usize = 3;
const STORIES_MAX: usize = 3;

pub fn no_search() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.noSearch",
        "Real stories can only be found and checked with a search service, which is not set up. \
         You can add one in Settings, or ask for an invented illustration instead.",
    ))
}

/// The site an address belongs to, for counting independent sources:
/// "https://www.bbc.co.uk/news/x" → "bbc.co.uk".
/// The address is parsed as a browser would open it, so a trick such as
/// `https://evil.com\@bbc.co.uk/` counts as evil.com; a raw IP address is its
/// own site.
pub fn site_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    let host = match parsed.host()? {
        url::Host::Domain(name) => name.trim_end_matches('.').to_ascii_lowercase(),
        url::Host::Ipv4(ip) => return Some(ip.to_string()),
        url::Host::Ipv6(ip) => return Some(ip.to_string()),
    };
    if host.is_empty() || !host.contains('.') {
        return None;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let n = labels.len();
    // e.g. bbc.co.uk, abc.net.au: a short second level under a country code.
    let short_second = n >= 3
        && labels[n - 1].len() == 2
        && matches!(
            labels[n - 2],
            "co" | "com" | "net" | "org" | "ac" | "gov" | "edu"
        );
    let keep = if short_second { 3 } else { 2 };
    Some(labels[n.saturating_sub(keep)..].join("."))
}

fn no_search_key() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.noSearchKey",
        "The search service needs its key. You can add it in Settings.",
    ))
}

/// A search request for the configured service. Each service only finds
/// candidate web pages: nothing here, or in what a service returns, decides
/// whether a story is true.
pub fn search_call(
    config: &AssistantConfig,
    key: Option<&str>,
    query: &str,
) -> AppResult<HttpCall> {
    let q = encode(query);
    let key = || key.filter(|k| !k.is_empty()).ok_or_else(no_search_key);
    let json = ("accept".to_string(), "application/json".to_string());
    match config.search {
        SearchKind::None => Err(no_search()),
        SearchKind::Brave => Ok(HttpCall {
            method: Method::Get,
            url: format!(
                "https://api.search.brave.com/res/v1/web/search?q={q}&count={RESULTS_PER_QUERY}"
            ),
            headers: vec![json, ("x-subscription-token".into(), key()?.into())],
            body: None,
        }),
        SearchKind::Tavily => Ok(HttpCall {
            method: Method::Post,
            url: "https://api.tavily.com/search".into(),
            headers: vec![json, ("authorization".into(), format!("Bearer {}", key()?))],
            body: Some(serde_json::json!({
                "query": query,
                "max_results": RESULTS_PER_QUERY,
                "search_depth": "basic",
                "include_answer": false,
            })),
        }),
        SearchKind::Exa => Ok(HttpCall {
            method: Method::Post,
            url: "https://api.exa.ai/search".into(),
            headers: vec![json, ("x-api-key".into(), key()?.into())],
            body: Some(serde_json::json!({
                "query": query,
                "numResults": RESULTS_PER_QUERY,
                "contents": { "highlights": true },
            })),
        }),
        SearchKind::Searxng => {
            if config.search_url.is_empty() {
                return Err(no_search());
            }
            Ok(HttpCall {
                method: Method::Get,
                url: format!("{}/search?q={q}&format=json", config.search_url),
                headers: vec![json],
                body: None,
            })
        }
        // SerpApi takes its key only in the address. The transport logs the
        // host alone and never follows a redirect, so it goes nowhere else.
        SearchKind::Serpapi => Ok(HttpCall {
            method: Method::Get,
            url: format!(
                "https://serpapi.com/search.json?engine=google&q={q}&num={RESULTS_PER_QUERY}&api_key={}",
                encode(key()?)
            ),
            headers: vec![json],
            body: None,
        }),
    }
}

fn plain(text: &str) -> String {
    // Search snippets may carry <strong> and entities.
    let mut out = String::new();
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        let mut out: String = text.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// The results of one search, in order.
pub fn parse_results(kind: SearchKind, reply: &HttpReply) -> AppResult<Vec<ExternalSource>> {
    if !(200..300).contains(&reply.status) {
        log::warn!("search service answered with status {}", reply.status);
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.searchFailed",
            "The search service could not answer. Nothing was found or checked.",
        )));
    }
    let value: Value = serde_json::from_slice(&reply.body).map_err(|_| {
        AppError::Assistant(UserMessage::new(
            "assistant.searchFailed",
            "The search service could not answer. Nothing was found or checked.",
        ))
    })?;
    let list = |v: &Value| v.as_array().cloned().unwrap_or_default();
    let items = match kind {
        SearchKind::Brave => list(&value["web"]["results"]),
        SearchKind::Tavily | SearchKind::Exa | SearchKind::Searxng => list(&value["results"]),
        SearchKind::Serpapi => list(&value["organic_results"]),
        SearchKind::None => Vec::new(),
    };
    Ok(items
        .iter()
        .filter_map(|item| {
            let url = item["url"]
                .as_str()
                .or_else(|| item["link"].as_str())?
                .trim()
                .to_string();
            if !crate::db::teaching::is_web_address(&url) {
                return None;
            }
            // Each service names its excerpt differently; Exa gives passages.
            let highlights = item["highlights"].as_array().map(|h| {
                h.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" … ")
            });
            let excerpt = item["description"]
                .as_str()
                .or_else(|| item["content"].as_str())
                .or_else(|| item["snippet"].as_str())
                .map(String::from)
                .or(highlights)
                .or_else(|| item["text"].as_str().map(String::from))
                .unwrap_or_default();
            Some(ExternalSource {
                title: truncate(&plain(item["title"].as_str().unwrap_or("")), 300),
                site: site_of(&url).unwrap_or_default(),
                url,
                excerpt: truncate(&plain(&excerpt), 600),
            })
        })
        .take(RESULTS_PER_QUERY)
        .collect())
}

/// Collects results of several searches: no address twice, within the limit.
pub fn merge(batches: Vec<Vec<ExternalSource>>) -> Vec<ExternalSource> {
    let mut out: Vec<ExternalSource> = Vec::new();
    for batch in batches {
        for result in batch {
            if out.len() >= RESULTS_MAX {
                return out;
            }
            if !out.iter().any(|r| r.url == result.url) {
                out.push(result);
            }
        }
    }
    out
}

/// Step 1: what to search for.
pub fn queries_request(request: &str, context_summary: &str) -> String {
    format!(
        "The person is preparing to teach and is looking for a REAL story, event, example or \
quotation: {request}\n\nWrite up to {QUERIES_MAX} short web search queries that would find \
reliable reports of such real examples (news reports, history, biographies, reputable \
organisations). Reply as {{\"queries\": [\"…\"]}}.\n\nFor background only:\n{context_summary}"
    )
}

pub fn parse_queries(value: &Value, fallback: &str) -> Vec<String> {
    let mut queries: Vec<String> = value["queries"]
        .as_array()
        .map(|qs| {
            qs.iter()
                .filter_map(|q| q.as_str())
                .map(|q| truncate(q.trim(), 200))
                .filter(|q| !q.is_empty())
                .take(QUERIES_MAX)
                .collect()
        })
        .unwrap_or_default();
    if queries.is_empty() {
        queries.push(truncate(fallback.trim(), 200));
    }
    queries
}

/// Step 3: which results support which stories.
pub fn candidates_request(request: &str, results: &[ExternalSource]) -> String {
    let mut list = String::new();
    for (i, r) in results.iter().enumerate() {
        list.push_str(&format!(
            "[{}] {} — {} — {}\n",
            i + 1,
            r.title,
            r.site,
            r.excerpt
        ));
    }
    format!(
        "The person is looking for a REAL story, event, example or quotation: {request}\n\n\
These are search results, numbered. Use ONLY what these results say. Do not add facts, names, \
dates or quotations that are not in them, and do not use your own memory of famous stories.\n\n\
{list}\nPick up to {STORIES_MAX} real examples that these results report. For each, give a short \
title, a summary in two or three sentences of what the results say happened, and the numbers \
of the results that report it. If the results do not report a suitable real example, return \
no stories. Reply as {{\"stories\": [{{\"title\": \"…\", \"summary\": \"…\", \"sources\": [1, 2]}}]}}."
    )
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Story {
    pub title: String,
    pub summary: String,
    /// verified (two different sites) or unverified.
    pub standing: &'static str,
    /// Only results the search returned.
    pub sources: Vec<ExternalSource>,
}

/// Step 4: keeps only what the search results can stand behind.
pub fn check(value: &Value, results: &[ExternalSource]) -> Vec<Story> {
    let Some(stories) = value["stories"].as_array() else {
        return Vec::new();
    };
    stories
        .iter()
        .filter_map(|s| {
            let title = truncate(s["title"].as_str()?.trim(), 200);
            let summary = truncate(s["summary"].as_str().unwrap_or("").trim(), 1_200);
            if title.is_empty() {
                return None;
            }
            let mut sources: Vec<ExternalSource> = Vec::new();
            for n in s["sources"].as_array().into_iter().flatten() {
                let Some(index) = n.as_u64().map(|n| n as usize) else {
                    continue;
                };
                if index == 0 {
                    continue;
                }
                if let Some(result) = results.get(index - 1) {
                    if !sources.iter().any(|r| r.url == result.url) {
                        sources.push(result.clone());
                    }
                }
            }
            if sources.is_empty() {
                // A story no result reports is not offered at all.
                return None;
            }
            let mut sites: Vec<&str> = sources.iter().map(|s| s.site.as_str()).collect();
            sites.sort_unstable();
            sites.dedup();
            let standing = if sites.iter().filter(|s| !s.is_empty()).count() >= 2 {
                "verified"
            } else {
                "unverified"
            };
            Some(Story {
                title,
                summary,
                standing,
                sources,
            })
        })
        .take(STORIES_MAX)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn result(n: usize, url: &str) -> ExternalSource {
        ExternalSource {
            title: format!("Result {n}"),
            url: url.into(),
            site: site_of(url).unwrap_or_default(),
            excerpt: "…".into(),
        }
    }

    #[test]
    fn sites_are_counted_once_per_organisation() {
        assert_eq!(
            site_of("https://www.bbc.co.uk/news/x").as_deref(),
            Some("bbc.co.uk")
        );
        assert_eq!(
            site_of("https://news.bbc.co.uk/y").as_deref(),
            Some("bbc.co.uk")
        );
        assert_eq!(
            site_of("https://en.wikipedia.org/wiki/X").as_deref(),
            Some("wikipedia.org")
        );
        assert_eq!(
            site_of("http://user@example.com:8080/a").as_deref(),
            Some("example.com")
        );
        assert_eq!(site_of("not a url"), None);
        // Parsed as a browser opens it.
        assert_eq!(
            site_of("https://evil.com\\@bbc.co.uk/").as_deref(),
            Some("evil.com")
        );
        assert_eq!(
            site_of("https://bbc%2Eco.uk/x").as_deref(),
            Some("bbc.co.uk")
        );
        assert_eq!(site_of("http://10.0.0.1/a").as_deref(), Some("10.0.0.1"));
        assert_ne!(site_of("http://10.0.0.1/a"), site_of("http://10.0.0.2/a"));
    }

    #[test]
    fn only_returned_addresses_survive_and_two_sites_make_it_checked() {
        let results = vec![
            result(1, "https://www.bbc.co.uk/a"),
            result(2, "https://news.bbc.co.uk/b"),
            result(3, "https://www.theguardian.com/c"),
        ];
        let answer = json!({"stories": [
            {"title": "Two sites", "summary": "s", "sources": [1, 3]},
            {"title": "One site twice", "summary": "s", "sources": [1, 2]},
            {"title": "Made up", "summary": "s", "sources": [7, 0]},
            {"title": "No sources", "summary": "s", "sources": []},
            {"title": "Smuggled", "summary": "s", "sources": [2], "url": "https://fake.example/x"}
        ]});
        let stories = check(&answer, &results);
        assert_eq!(stories.len(), 3);
        assert_eq!(stories[0].standing, "verified");
        assert_eq!(
            stories[1].standing, "unverified",
            "one organisation is one source"
        );
        assert_eq!(stories[2].title, "Smuggled");
        assert_eq!(stories[2].sources.len(), 1);
        for story in &stories {
            for source in &story.sources {
                assert!(
                    results.iter().any(|r| r.url == source.url),
                    "never an invented address"
                );
            }
        }
    }

    #[test]
    fn search_results_are_read_and_unsafe_links_dropped() {
        let reply = HttpReply {
            status: 200,
            body: serde_json::to_vec(&json!({"web": {"results": [
                {"title": "A <strong>story</strong>", "url": "https://example.org/a", "description": "It &amp; more"},
                {"title": "Bad", "url": "javascript:alert(1)", "description": "x"}
            ]}}))
            .unwrap(),
        };
        let results = parse_results(SearchKind::Brave, &reply).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "A story");
        assert_eq!(results[0].excerpt, "It & more");
        assert_eq!(results[0].site, "example.org");
    }

    fn reply(value: Value) -> HttpReply {
        HttpReply {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    #[test]
    fn every_service_is_read_the_same_way() {
        let tavily = reply(json!({"results": [
            {"title": "T", "url": "https://a.example.org/t", "content": "Tavily text", "score": 0.9}
        ]}));
        let exa = reply(json!({"results": [
            {"title": "E", "url": "https://b.example.org/e", "highlights": ["One.", "Two."]}
        ]}));
        let serp = reply(json!({"organic_results": [
            {"title": "S", "link": "https://c.example.org/s", "snippet": "Serp text"},
            {"title": "Bad", "link": "file:///etc/passwd", "snippet": "x"}
        ]}));
        let searx = reply(json!({"results": [
            {"title": "X", "url": "https://d.example.org/x", "content": "Searx text"}
        ]}));
        let t = parse_results(SearchKind::Tavily, &tavily).unwrap();
        assert_eq!(
            (t[0].url.as_str(), t[0].excerpt.as_str()),
            ("https://a.example.org/t", "Tavily text")
        );
        let e = parse_results(SearchKind::Exa, &exa).unwrap();
        assert_eq!(e[0].excerpt, "One. … Two.");
        let s = parse_results(SearchKind::Serpapi, &serp).unwrap();
        assert_eq!(s.len(), 1, "unsafe links are dropped");
        assert_eq!(
            (s[0].url.as_str(), s[0].excerpt.as_str()),
            ("https://c.example.org/s", "Serp text")
        );
        let x = parse_results(SearchKind::Searxng, &searx).unwrap();
        assert_eq!(x[0].site, "example.org");
    }

    #[test]
    fn keys_travel_only_where_each_service_expects_them() {
        let base = AssistantConfig::default();
        for kind in [
            SearchKind::Brave,
            SearchKind::Tavily,
            SearchKind::Exa,
            SearchKind::Serpapi,
        ] {
            let config = AssistantConfig {
                search: kind,
                ..base.clone()
            };
            assert!(kind.needs_key());
            let missing = search_call(&config, None, "grace").unwrap_err();
            assert!(
                matches!(missing, AppError::Assistant(ref m) if m.code == Some("assistant.noSearchKey"))
            );
            let call = search_call(&config, Some("SECRETKEY"), "grace").unwrap();
            let in_headers = call.headers.iter().any(|(_, v)| v.contains("SECRETKEY"));
            let in_body = call
                .body
                .as_ref()
                .is_some_and(|b| b.to_string().contains("SECRETKEY"));
            assert!(!in_body, "{kind:?}: never in the body");
            if kind == SearchKind::Serpapi {
                assert!(call.url.contains("api_key=SECRETKEY") && !in_headers);
            } else {
                assert!(
                    in_headers && !call.url.contains("SECRETKEY"),
                    "{kind:?}: a header, never the address"
                );
            }
        }
        assert!(!SearchKind::Searxng.needs_key());
        let searx = AssistantConfig {
            search: SearchKind::Searxng,
            search_url: "https://search.example.org".into(),
            ..base
        };
        let call = search_call(&searx, None, "a b").unwrap();
        assert_eq!(
            call.url,
            "https://search.example.org/search?q=a%20b&format=json"
        );
    }

    #[test]
    fn without_a_search_service_nothing_is_searched() {
        let config = AssistantConfig::default();
        let error = search_call(&config, None, "forgiveness").unwrap_err();
        assert!(
            matches!(error, AppError::Assistant(ref m) if m.code == Some("assistant.noSearch"))
        );
        let brave = AssistantConfig {
            search: SearchKind::Brave,
            ..config
        };
        let call = search_call(&brave, Some("SECRETKEY"), "a b&c").unwrap();
        assert!(call.url.contains("q=a%20b%26c"));
        assert!(
            !call.url.contains("SECRETKEY"),
            "the key is a header, never the address"
        );
    }
}
