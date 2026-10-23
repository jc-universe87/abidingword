//! Study and research help (v0.20): one way of asking for the Bible Study,
//! a library source and a comparison of sources.
//!
//! The person's own words stay the person's. What the assistant returns is
//! kept apart from them, in a temporary panel, until the person accepts a
//! piece of it. The pipeline is the same for every kind of help:
//!
//! 1. **Context** ([`study`], [`source`], [`compare`]): numbered, labelled
//!    blocks assembled deterministically from the database, within fixed
//!    limits. Scripture (P), the person's writing (W), their notes (N),
//!    quotations kept in notes (Q), library passages (S) and the request (R).
//!    Nothing else: never another study, the rest of the library, settings,
//!    keys or file paths.
//! 2. **Preview** ([`preview`]): every block, word for word, the service and
//!    whether text leaves the computer. Its fingerprint covers exactly what
//!    would be sent.
//! 3. **Ask** ([`run`]): the request is assembled again; it is sent only when
//!    its fingerprint is the one the person saw. Nothing holds the database
//!    while waiting.
//! 4. **Check** ([`interpret`]): every quotation in the answer is looked for
//!    in the block it names; one that is not there is dropped. A claim about
//!    what a text or an author says without such a quotation is shown as the
//!    assistant's inference. Places in a source come from the source's stored
//!    text, never from the answer.
//! 5. **Keep** ([`keep`]): a note in the study, only from words the person
//!    accepted, marked with the assistant's name, citing the source passages
//!    it rests on (checked against the stored text again).

pub mod compare;
pub mod keep;
pub mod prompts;
pub mod source;
pub mod study;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::config::{self, AssistantConfig};
use super::context::AssistAction;
use super::http::Transport;
use super::provider::{self, ChatRequest};
use super::secrets::{self, SecretStore};
use crate::db::source_annotations::Excerpt;
use crate::error::{AppError, AppResult, UserMessage};
use crate::library::annotations::TextPoint;
use crate::scripture::reference::ScriptureRefDto;

/// Limits on what is sent, in characters.
pub const SCRIPTURE_MAX: usize = 4_000;
pub const WRITING_MAX: usize = 12_000;
pub const NOTES_MAX: usize = 8;
pub const NOTE_MAX: usize = 500;
pub const QUOTES_MAX: usize = 4;
pub const QUOTE_MAX: usize = 400;
pub const EXCERPT_MAX: usize = 12_000;
pub const COMPARE_EACH_MAX: usize = 6_000;
pub const COMPARE_TOTAL_MAX: usize = 15_000;
pub const REQUEST_MAX: usize = 1_000;

/// Limits on the answer.
const POINTS_MAX: usize = 8;
const COMPARE_POINTS_MAX: usize = 12;
const POINT_MAX: usize = 700;
const SUMMARY_MAX: usize = 500;
const EVIDENCE_MAX: usize = 3;
const EVIDENCE_QUOTE_MAX: usize = 300;
const REFERENCES_MAX: usize = 5;

/// What kind of help is asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Inquiry {
    // Bible Study.
    /// What the passage says: observations from the text.
    Understand,
    /// Its literary and historical setting.
    Context,
    /// What selected words or an expression mean here.
    Expression,
    /// Whether the person's conclusion follows from the text.
    Follows,
    /// What in the text the person may have overlooked.
    Overlooked,
    /// What the person's writing assumes.
    Assumptions,
    /// How Christians read the passage differently.
    Readings,
    /// Questions to study further.
    Questions,
    /// Thinking through an open question the person recorded.
    Unresolved,
    /// Related passages.
    Related,
    /// Clearer wording for the person's writing (a proposal).
    Clarify,
    /// Grammar and spelling only (a proposal).
    Grammar,
    // A library source.
    /// What the author says here.
    Summary,
    /// How the argument proceeds.
    Argument,
    /// What the author assumes.
    SourceAssumptions,
    /// The Scripture the author appeals to, and how.
    SourcePassages,
    /// Whether the conclusion follows from the reasons given.
    Conclusion,
    /// What to check further.
    Investigate,
    /// How the passage bears on the person's study.
    RelateStudy,
    // Sources side by side.
    Compare,
    /// The person's own question, in their words.
    Free,
}

impl Inquiry {
    pub fn is_wording(self) -> bool {
        matches!(self, Self::Clarify | Self::Grammar)
    }

    fn is_study(self) -> bool {
        matches!(
            self,
            Self::Understand
                | Self::Context
                | Self::Expression
                | Self::Follows
                | Self::Overlooked
                | Self::Assumptions
                | Self::Readings
                | Self::Questions
                | Self::Unresolved
                | Self::Related
                | Self::Clarify
                | Self::Grammar
                | Self::Free
        )
    }

    fn is_source(self) -> bool {
        matches!(
            self,
            Self::Summary
                | Self::Argument
                | Self::SourceAssumptions
                | Self::SourcePassages
                | Self::Conclusion
                | Self::Investigate
                | Self::RelateStudy
                | Self::Free
        )
    }
}

/// One selected passage of a library source, as the reader sends it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcerptInput {
    pub source_id: String,
    pub start: TextPoint,
    pub end: TextPoint,
    pub quote: String,
}

/// What the help is about.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Scope {
    /// A part of a Bible Study: its writing, selected words in it, or a note.
    #[serde(rename_all = "camelCase")]
    Study {
        study_id: String,
        section_id: Option<String>,
        /// The piece of writing in focus.
        #[serde(default)]
        block_id: Option<String>,
        /// That writing as it is on screen now (it may not be saved yet).
        #[serde(default)]
        text: String,
        /// Words selected in it, exactly.
        #[serde(default)]
        selected: String,
        /// Or a note in focus.
        #[serde(default)]
        finding_id: Option<String>,
    },
    /// Words selected in a library source.
    #[serde(rename_all = "camelCase")]
    Source {
        excerpt: ExcerptInput,
        /// A study to relate it to, only when the person chose to include it.
        #[serde(default)]
        study_id: Option<String>,
    },
    /// Two or three selected passages, side by side.
    #[serde(rename_all = "camelCase")]
    Compare {
        excerpts: Vec<ExcerptInput>,
        #[serde(default)]
        study_id: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InquiryInput {
    pub scope: Scope,
    pub action: Inquiry,
    /// The person's own words: what they want to know.
    #[serde(default)]
    pub request: String,
    /// The interface language, for explanations.
    #[serde(default)]
    pub ui_language: String,
}

/// Where a block comes from, and so how its words may be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockKind {
    /// Bible text from a named translation installed here.
    Scripture,
    /// The person's own writing.
    Writing,
    /// One of the person's notes.
    Note,
    /// A quotation the person kept in a note.
    Quote,
    /// Words of a library source.
    Source,
    /// What the person asks.
    Request,
}

impl BlockKind {
    fn letter(self) -> &'static str {
        match self {
            Self::Scripture => "P",
            Self::Writing => "W",
            Self::Note => "N",
            Self::Quote => "Q",
            Self::Source => "S",
            Self::Request => "R",
        }
    }

    /// How the assistant is told to treat the block.
    fn standing(self) -> &'static str {
        match self {
            Self::Scripture => "Bible text",
            Self::Writing => "the person's own writing",
            Self::Note => "the person's own note",
            Self::Quote => {
                "a quotation from a book, kept in the person's note; not the person's words"
            }
            Self::Source => "words of a book in the person's library; not the person's words",
            Self::Request => "the person's question to you",
        }
    }
}

/// A source passage's identity and place, from the database only.
#[derive(Debug, Clone)]
pub struct SourcePlace {
    pub source_id: String,
    pub title: String,
    pub author: Option<String>,
    /// e.g. "Chapter 4 › Grace, p. 52, paragraphs 12–16".
    pub location: String,
    pub excerpt: Excerpt,
}

/// One labelled piece of what is sent.
#[derive(Debug, Clone)]
pub struct Block {
    /// "P1", "W1", "S2"…
    pub id: String,
    pub kind: BlockKind,
    /// What it is, for the person and for the assistant.
    pub label: String,
    pub text: String,
    pub reference: Option<ScriptureRefDto>,
    /// For a Bible text: the translation's short name.
    pub translation: Option<String>,
    pub source: Option<SourcePlace>,
}

/// Everything the request is made from.
#[derive(Debug, Clone)]
pub struct Material {
    pub action: Inquiry,
    /// "Bible Study “Abide”", "Source", "Comparison".
    pub setting: String,
    pub blocks: Vec<Block>,
    pub ui_language: String,
    /// The original text of a wording request (what a proposal replaces).
    pub original: Option<String>,
}

impl Material {
    pub fn new(action: Inquiry, setting: String, ui_language: &str) -> Self {
        Self {
            action,
            setting,
            blocks: Vec::new(),
            ui_language: cut(ui_language, 20),
            original: None,
        }
    }

    /// Adds a block, numbered within its kind. Fence markers inside the text
    /// are broken up so that text can never close its own block.
    pub fn push(&mut self, kind: BlockKind, label: String, text: &str) -> &mut Block {
        let n = self.blocks.iter().filter(|b| b.kind == kind).count() + 1;
        self.blocks.push(Block {
            id: format!("{}{n}", kind.letter()),
            kind,
            label: defuse(&label),
            text: defuse(text),
            reference: None,
            translation: None,
            source: None,
        });
        self.blocks.last_mut().expect("just pushed")
    }

    fn block(&self, id: &str) -> Option<&Block> {
        self.blocks.iter().find(|b| b.id == id)
    }

    fn has(&self, kind: BlockKind) -> bool {
        self.blocks.iter().any(|b| b.kind == kind)
    }
}

/// Text cut to `max` characters, at a word where one is near.
pub fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    if let Some(space) = out.rfind(char::is_whitespace) {
        if space > max * 3 / 4 {
            out.truncate(space);
        }
    }
    out.push('…');
    out
}

const FENCE: &str = "<<<";

/// "<<<" in material becomes "<< <": it reads the same and cannot fence.
fn defuse(text: &str) -> String {
    let mut out = text.to_string();
    while out.contains(FENCE) {
        out = out.replace(FENCE, "<< <");
    }
    out
}

pub fn off() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.off",
        "The assistant is turned off. You can turn it on in Settings.",
    ))
}

pub fn not_for_this() -> AppError {
    AppError::InvalidInput(UserMessage::new(
        "inquiry.notHere",
        "This kind of help is not available here.",
    ))
}

/// Gathers the material for a request (with the database held; no key and
/// no network).
pub fn assemble(conn: &Connection, input: &InquiryInput) -> AppResult<(AssistantConfig, Material)> {
    let config = config::get(conn)?;
    if !config.enabled {
        return Err(off());
    }
    let request = cut(&input.request, REQUEST_MAX);
    let material = match &input.scope {
        Scope::Study { .. } if input.action.is_study() => study::assemble(conn, input, &request)?,
        Scope::Source { .. } if input.action.is_source() => {
            source::assemble(conn, input, &request)?
        }
        Scope::Compare { .. } if matches!(input.action, Inquiry::Compare | Inquiry::Free) => {
            compare::assemble(conn, input, &request)?
        }
        _ => return Err(not_for_this()),
    };
    if input.action == Inquiry::Free && request.is_empty() {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.sayWhat",
            "Say in a few words what you are looking for.",
        )));
    }
    Ok((config, material))
}

/// The request exactly as it would be sent.
pub fn chat(config: &AssistantConfig, material: &Material) -> ChatRequest {
    ChatRequest {
        system: prompts::system(&config.perspective, &material.ui_language),
        user: prompts::request(material),
        max_tokens: 2_500,
    }
}

/// Covers the service, the model and every word that would be sent.
pub fn fingerprint(config: &AssistantConfig, chat: &ChatRequest) -> String {
    let mut hash = Sha256::new();
    for part in [
        config.provider.as_str(),
        &config.assistant_label(),
        &config.base_url,
        &config.model,
        &chat.system,
        &chat.user,
    ] {
        hash.update(part.len().to_le_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

/// A block as the person sees it before asking: all of its words.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedBlock {
    pub id: String,
    pub kind: BlockKind,
    pub label: String,
    pub text: String,
    pub reference: Option<ScriptureRefDto>,
    pub translation: Option<String>,
    pub source_id: Option<String>,
    pub location: Option<String>,
}

/// "Before you ask".
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InquiryPreview {
    pub remote: bool,
    pub assistant: String,
    pub blocks: Vec<SharedBlock>,
    /// Words of library books are included.
    pub source_text: bool,
    /// Never: this help does not search the web.
    pub searches: bool,
    pub fingerprint: String,
}

pub fn preview(config: &AssistantConfig, material: &Material) -> InquiryPreview {
    InquiryPreview {
        remote: config.is_remote(),
        assistant: config.assistant_label(),
        blocks: material
            .blocks
            .iter()
            .map(|b| SharedBlock {
                id: b.id.clone(),
                kind: b.kind,
                label: b.label.clone(),
                text: b.text.clone(),
                reference: b.reference.clone(),
                translation: b.translation.clone(),
                source_id: b.source.as_ref().map(|s| s.source_id.clone()),
                location: b.source.as_ref().map(|s| s.location.clone()),
            })
            .collect(),
        source_text: material.has(BlockKind::Source) || material.has(BlockKind::Quote),
        searches: false,
        fingerprint: fingerprint(config, &chat(config, material)),
    }
}

pub fn changed() -> AppError {
    AppError::Assistant(UserMessage::new(
        "inquiry.changed",
        "What would be sent has changed since you looked. Please look at it again before asking.",
    ))
}

/// Everything needed to send, with the database released.
pub struct Ready {
    pub config: AssistantConfig,
    pub key: Option<String>,
    pub material: Material,
    pub chat: ChatRequest,
}

/// Checks that the request is the one the person saw.
pub fn prepare(conn: &Connection, input: &InquiryInput, seen: &str) -> AppResult<Ready> {
    let (config, material) = assemble(conn, input)?;
    let chat = chat(&config, &material);
    if fingerprint(&config, &chat) != seen {
        return Err(changed());
    }
    Ok(Ready {
        config,
        key: None,
        material,
        chat,
    })
}

/// Reads the service's key (never while the database is held).
pub fn unlock(mut ready: Ready, store: &dyn SecretStore) -> AppResult<Ready> {
    let key = store.get(&secrets::provider_key_name(ready.config.provider.as_str()))?;
    if ready.config.provider.needs_key() && key.is_none() {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.noKey",
            "The assistant needs its key. You can add it in Settings.",
        )));
    }
    ready.key = key;
    Ok(ready)
}

/// Where quoted words are in a library source, from its stored text.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub source_id: String,
    pub title: String,
    pub author: Option<String>,
    pub location: String,
    pub start: TextPoint,
    pub end: TextPoint,
    /// The words exactly as stored (the reader opens, and a note cites, these).
    pub quote: String,
}

/// Words the answer quotes, found in the block it names.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub block: String,
    pub kind: BlockKind,
    /// The block's label: "John 15:1–8 (BSB)", "Source: …".
    pub label: String,
    /// The words as they are in the block.
    pub quote: String,
    pub source: Option<SourceLink>,
}

/// What a point is, as shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PointKind {
    /// What the Bible text itself says (shown with its words).
    Text,
    /// What the author of a source states explicitly (shown with their words).
    Source,
    /// About the person's own writing or notes.
    Writing,
    /// A reading of the text or of an author.
    Interpretation,
    /// The assistant's own reasoning.
    Inference,
    /// General background knowledge, not from the material: to be checked.
    Knowledge,
    Question,
    /// Where the material does not settle the matter.
    Uncertain,
    /// What one author holds (comparison).
    Position,
    /// Where authors agree (comparison).
    Agreement,
    /// Where they disagree (comparison).
    Disagreement,
    /// Something taken for granted.
    Assumption,
    /// Something claimed that the material does not support.
    Unsupported,
}

impl PointKind {
    fn parse(value: &str) -> Self {
        match value.trim() {
            "text" | "scripture" => Self::Text,
            "source" => Self::Source,
            "writing" | "note" => Self::Writing,
            "interpretation" => Self::Interpretation,
            "knowledge" => Self::Knowledge,
            "question" => Self::Question,
            "uncertain" | "uncertainty" => Self::Uncertain,
            "position" => Self::Position,
            "agreement" => Self::Agreement,
            "disagreement" => Self::Disagreement,
            "assumption" => Self::Assumption,
            "unsupported" => Self::Unsupported,
            _ => Self::Inference,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub kind: PointKind,
    pub text: String,
    /// The block the point is about (a source, for a position).
    pub about: Option<String>,
    pub about_label: Option<String>,
    pub evidence: Vec<Evidence>,
    /// Passages the assistant names, recognised here. They were not part of
    /// what was sent unless they are among its Scripture blocks.
    pub references: Vec<ScriptureRefDto>,
    /// The answer claimed more than its quotations show, so the point is
    /// shown as inference (or as unsupported).
    pub downgraded: bool,
}

/// How far the compared sources agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Agree,
    Disagree,
    Partly,
    /// The selected passages do not say enough to tell.
    Insufficient,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InquiryResult {
    /// New wording for the person's text, shown as changes to accept or not.
    #[serde(rename_all = "camelCase")]
    Proposal {
        original: String,
        suggestion: String,
        changes: String,
    },
    #[serde(rename_all = "camelCase")]
    Insight {
        summary: String,
        points: Vec<Point>,
        verdict: Option<Verdict>,
        /// Quotations in the answer that are not in the material: left out.
        unverified: usize,
        /// Points shown as inference because their quotations were missing.
        downgraded: usize,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InquiryReply {
    pub result: InquiryResult,
    pub assistant: String,
    pub remote: bool,
}

fn text_of(value: &Value, key: &str, max: usize) -> String {
    let text = value[key].as_str().unwrap_or("").trim();
    text.chars().take(max).collect()
}

/// Text compared loosely: case, quotation marks, dashes and runs of white
/// space do not matter. Each char of the result records the byte range of
/// the original it came from.
fn loose(text: &str) -> (Vec<char>, Vec<(usize, usize)>) {
    let mut chars = Vec::new();
    let mut spans = Vec::new();
    let mut space = false;
    for (at, c) in text.char_indices() {
        let end = at + c.len_utf8();
        if c.is_whitespace() || c == '\u{00AD}' {
            if c != '\u{00AD}' && !space && !chars.is_empty() {
                chars.push(' ');
                spans.push((at, end));
                space = true;
            }
            continue;
        }
        space = false;
        let mapped = match c {
            '‘' | '’' | '‚' | '‛' | '′' | '`' | '´' => '\'',
            '“' | '”' | '„' | '‟' | '″' | '«' | '»' | '‹' | '›' => '"',
            '‐' | '‑' | '‒' | '–' | '—' | '―' => '-',
            _ => c,
        };
        for lower in mapped.to_lowercase() {
            chars.push(lower);
            spans.push((at, end));
        }
    }
    if chars.last() == Some(&' ') {
        chars.pop();
        spans.pop();
    }
    (chars, spans)
}

/// Where `needle` is in `hay` (loosely), as a byte range of `hay` within
/// `window`; the first such place.
pub fn find_loosely(hay: &str, needle: &str, window: (usize, usize)) -> Option<(usize, usize)> {
    let plain = needle.trim_matches(|c: char| c.is_whitespace() || c == '…');
    // As quoted; then without quotation marks the answer may have put around it.
    find_in(hay, plain, window).or_else(|| {
        let bare = plain.trim_matches(|c: char| {
            c.is_whitespace() || matches!(c, '"' | '“' | '”' | '„' | '«' | '»' | '…')
        });
        (bare != plain)
            .then(|| find_in(hay, bare, window))
            .flatten()
    })
}

fn find_in(hay: &str, needle: &str, window: (usize, usize)) -> Option<(usize, usize)> {
    let (n, _) = loose(needle);
    // Too short to mean anything as a quotation.
    if n.iter().filter(|c| c.is_alphanumeric()).count() < 3 {
        return None;
    }
    let (h, spans) = loose(hay);
    if n.len() > h.len() {
        return None;
    }
    (0..=h.len() - n.len()).find_map(|i| {
        if h[i..i + n.len()] != n[..] {
            return None;
        }
        let (from, to) = (spans[i].0, spans[i + n.len() - 1].1);
        (from >= window.0 && to <= window.1).then_some((from, to))
    })
}

/// Looks for an answer's quotation in the block it names.
fn verify(material: &Material, block: &str, quote: &str) -> Option<Evidence> {
    let block = material.block(block)?;
    if block.kind == BlockKind::Request {
        return None;
    }
    let quote = quote.trim();
    let (evidence_quote, source) = match &block.source {
        Some(place) => {
            let excerpt = &place.excerpt;
            let joined = crate::library::annotations::Line::new(&excerpt.segments)
                .text
                .clone();
            let (from, to) = find_loosely(&joined, quote, (excerpt.from, excerpt.to))?;
            let (start, end, words) = excerpt.points(from, to)?;
            (
                words.clone(),
                Some(SourceLink {
                    source_id: place.source_id.clone(),
                    title: place.title.clone(),
                    author: place.author.clone(),
                    location: place.location.clone(),
                    start,
                    end,
                    quote: words,
                }),
            )
        }
        None => {
            let (from, to) = find_loosely(&block.text, quote, (0, block.text.len()))?;
            (block.text[from..to].to_string(), None)
        }
    };
    Some(Evidence {
        block: block.id.clone(),
        kind: block.kind,
        label: block.label.clone(),
        quote: evidence_quote,
        source,
    })
}

fn too_much() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.tooMuch",
        "The suggestion was much longer than your text, so it was not shown. Please try again.",
    ))
}

/// Turns the service's JSON into a result. Every limit and every check is
/// applied here, whatever the answer says about itself.
pub fn interpret(material: &Material, answer: &Value) -> AppResult<InquiryResult> {
    if material.action.is_wording() {
        let original = material.original.clone().unwrap_or_default();
        let suggestion = text_of(answer, "suggestion", 40_000);
        if suggestion.is_empty() {
            return Err(provider::bad_reply());
        }
        let action = if material.action == Inquiry::Grammar {
            AssistAction::Grammar
        } else {
            AssistAction::Clarity
        };
        if suggestion.chars().count() > super::proposal_limit(action, original.chars().count()) {
            return Err(too_much());
        }
        return Ok(InquiryResult::Proposal {
            original,
            suggestion,
            changes: text_of(answer, "changes", 600),
        });
    }
    let comparing = material.action == Inquiry::Compare
        || (material.action == Inquiry::Free && material.setting == compare::SETTING);
    let most = if comparing {
        COMPARE_POINTS_MAX
    } else {
        POINTS_MAX
    };
    let Some(list) = answer["points"].as_array() else {
        return Err(provider::bad_reply());
    };
    let mut unverified = 0;
    let mut downgraded = 0;
    let mut points = Vec::new();
    for raw in list.iter().take(most) {
        let text = text_of(raw, "text", POINT_MAX);
        if text.is_empty() {
            continue;
        }
        let mut evidence: Vec<Evidence> = Vec::new();
        for e in raw["evidence"].as_array().into_iter().flatten() {
            let block = e["block"].as_str().unwrap_or("").trim();
            let quote: String = e["quote"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(EVIDENCE_QUOTE_MAX)
                .collect();
            if quote.trim().is_empty() {
                continue;
            }
            match verify(material, block, &quote) {
                Some(found) if !evidence.contains(&found) => {
                    if evidence.len() < EVIDENCE_MAX {
                        evidence.push(found);
                    }
                }
                Some(_) => {}
                None => unverified += 1,
            }
        }
        let about = raw["block"]
            .as_str()
            .or_else(|| raw["about"].as_str())
            .map(str::trim)
            .and_then(|id| material.block(id))
            .filter(|b| b.kind != BlockKind::Request);
        let claimed = PointKind::parse(raw["kind"].as_str().unwrap_or(""));
        let from = |kinds: &[BlockKind]| evidence.iter().any(|e| kinds.contains(&e.kind));
        // Distinct source passages quoted (two passages of one book count).
        let mut sources: Vec<&str> = Vec::new();
        for e in evidence.iter().filter(|e| e.kind == BlockKind::Source) {
            if !sources.contains(&e.block.as_str()) {
                sources.push(&e.block);
            }
        }
        // A claim stands as made only on the words it needs.
        let kind = match claimed {
            PointKind::Text if !from(&[BlockKind::Scripture]) => None,
            PointKind::Source if !from(&[BlockKind::Source, BlockKind::Quote]) => None,
            PointKind::Writing if !from(&[BlockKind::Writing, BlockKind::Note]) => None,
            PointKind::Position
                if !about.is_some_and(|b| {
                    b.kind == BlockKind::Source && evidence.iter().any(|e| e.block == b.id)
                }) =>
            {
                None
            }
            PointKind::Agreement | PointKind::Disagreement if sources.len() < 2 => None,
            k => Some(k),
        };
        let (kind, was_downgraded) = match kind {
            Some(k) => (k, false),
            None => {
                downgraded += 1;
                let fallback = match claimed {
                    PointKind::Agreement | PointKind::Disagreement | PointKind::Position => {
                        PointKind::Unsupported
                    }
                    _ => PointKind::Inference,
                };
                (fallback, true)
            }
        };
        let references = raw["references"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|r| r.as_str())
            .take(REFERENCES_MAX)
            .filter_map(|r| crate::scripture::resolve::resolve(r, Default::default()).ok())
            .map(|r| r.to_dto())
            .collect();
        points.push(Point {
            kind,
            text,
            about: about.map(|b| b.id.clone()),
            about_label: about.map(|b| b.label.clone()),
            evidence,
            references,
            downgraded: was_downgraded,
        });
    }
    let summary = text_of(answer, "summary", SUMMARY_MAX);
    if points.is_empty() && summary.is_empty() {
        return Err(provider::bad_reply());
    }
    let verdict = comparing.then(|| {
        let shown = |k: PointKind| points.iter().any(|p| p.kind == k && !p.downgraded);
        match answer["verdict"].as_str().unwrap_or("").trim() {
            "agree" if shown(PointKind::Agreement) => Verdict::Agree,
            "disagree" if shown(PointKind::Disagreement) => Verdict::Disagree,
            "partly" if shown(PointKind::Agreement) && shown(PointKind::Disagreement) => {
                Verdict::Partly
            }
            _ => Verdict::Insufficient,
        }
    });
    Ok(InquiryResult::Insight {
        summary,
        points,
        verdict,
        unverified,
        downgraded,
    })
}

/// Asks. Returns help only; changes nothing.
pub async fn run(transport: &impl Transport, ready: &Ready) -> AppResult<InquiryReply> {
    let answer = provider::ask(transport, &ready.config, ready.key.as_deref(), &ready.chat).await?;
    let result = interpret(&ready.material, &provider::json_object(&answer)?)?;
    Ok(InquiryReply {
        result,
        assistant: ready.config.assistant_label(),
        remote: ready.config.is_remote(),
    })
}
