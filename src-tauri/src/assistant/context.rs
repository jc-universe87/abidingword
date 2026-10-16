//! What the assistant is shown, and nothing more.
//!
//! The context is assembled here, deterministically and within fixed limits,
//! from ONE teaching preparation and its study: the text being worked on, the
//! teaching's audience, purpose and central message, nearby parts of the same
//! teaching (also how the person's style is learned), the Scripture named in
//! it, and the study findings used in it (with any source quotations kept
//! apart and attributed). Never the whole library, other studies, other
//! teachings, marks or settings. [`shared`] lists the same pieces for the
//! person to see before anything is sent.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::db::{bibles, findings, settings as app_settings, study_passages, teaching};
use crate::domain::{Finding, TeachingPreparation};
use crate::error::{AppError, AppResult, UserMessage};
use crate::scripture::reference::ScriptureRef;

/// What the person asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistAction {
    // Wording: a proposal for the person's own text.
    Grammar,
    Clarity,
    Shorten,
    Natural,
    Repetition,
    Spoken,
    Audience,
    Translate,
    Transition,
    // Comments on what the person wrote.
    Review,
    Structure,
    Application,
    Theology,
    Passages,
    // Alternatives grounded in the person's material.
    Phrasing,
    Question,
    Restructure,
    // Illustrations, real stories, visuals.
    Illustration,
    Story,
    Visual,
}

impl AssistAction {
    /// Actions that change wording: they need the person's text.
    pub fn is_wording(self) -> bool {
        matches!(
            self,
            Self::Grammar
                | Self::Clarity
                | Self::Shorten
                | Self::Natural
                | Self::Repetition
                | Self::Spoken
                | Self::Audience
                | Self::Translate
                | Self::Transition
        )
    }

    /// Actions about the teaching as a whole.
    pub fn is_whole(self) -> bool {
        matches!(self, Self::Structure | Self::Restructure)
    }

    /// Checking actions also see the study's findings when none are linked.
    fn wants_study_findings(self) -> bool {
        matches!(
            self,
            Self::Review
                | Self::Application
                | Self::Theology
                | Self::Passages
                | Self::Question
                | Self::Phrasing
                | Self::Structure
        )
    }
}

/// Which part of the teaching the text comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Part {
    Audience,
    Purpose,
    CentralMessage,
    Introduction,
    Conclusion,
    Notes,
    PointTitle,
    PointExplanation,
    PointApplication,
    PointIllustration,
    /// The teaching as a whole (structure).
    Whole,
}

impl Part {
    fn is_point(self) -> bool {
        matches!(
            self,
            Self::PointTitle
                | Self::PointExplanation
                | Self::PointApplication
                | Self::PointIllustration
        )
    }

    fn label(self) -> &'static str {
        match self {
            Self::Audience => "Audience",
            Self::Purpose => "Purpose",
            Self::CentralMessage => "Central message",
            Self::Introduction => "Introduction",
            Self::Conclusion => "Conclusion",
            Self::Notes => "Teacher's notes",
            Self::PointTitle => "Point title",
            Self::PointExplanation => "Explanation",
            Self::PointApplication => "Application",
            Self::PointIllustration => "Illustration",
            Self::Whole => "Whole teaching",
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssistInput {
    pub preparation_id: String,
    pub action: Option<AssistAction>,
    pub part: Option<Part>,
    pub point_id: Option<String>,
    /// Exactly the person's text being worked on (the part, or a selection
    /// inside it), as it is on screen now.
    pub text: String,
    pub selected: bool,
    /// The person's own words about what they want (for a question, a
    /// transition, a story to look for…).
    pub request: String,
    /// For "adapt for audience".
    pub audience: String,
    /// For "translate": the language to translate into.
    pub language: String,
    /// The interface language, for comments.
    pub ui_language: String,
}

/// Limits on what is sent, in characters.
pub const TEXT_MAX: usize = 12_000;
const NEARBY_EACH_MAX: usize = 1_200;
const NEARBY_TOTAL_MAX: usize = 6_000;
const WHOLE_TOTAL_MAX: usize = 12_000;
const PASSAGES_MAX: usize = 8;
const SCRIPTURE_TEXT_MAX: usize = 5_000;
const FINDINGS_MAX: usize = 12;
const FINDING_TEXT_MAX: usize = 600;
const QUOTE_MAX: usize = 400;
const QUOTES_PER_FINDING: usize = 2;
const QUOTES_MAX: usize = 8;
const CITATION_MAX: usize = 200;
const REQUEST_MAX: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassageContext {
    pub reference: crate::scripture::reference::ScriptureRefDto,
    pub display: String,
    /// The verses in the person's chosen Bible, when installed.
    pub text: Option<String>,
    pub translation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuoteContext {
    pub quote: String,
    pub citation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindingContext {
    pub kind: String,
    pub content: String,
    pub quotes: Vec<QuoteContext>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Context {
    pub action: AssistAction,
    pub teaching_title: String,
    pub teaching_kind: Option<String>,
    pub audience: Option<String>,
    pub purpose: Option<String>,
    pub central_message: Option<String>,
    /// e.g. "Point 2 “Abide” — Explanation".
    pub focus: String,
    pub text: String,
    pub selected: bool,
    pub request: String,
    pub target_audience: String,
    pub target_language: String,
    pub ui_language: String,
    /// Other parts of the same teaching: (label, text).
    pub nearby: Vec<(String, String)>,
    pub passages: Vec<PassageContext>,
    pub findings: Vec<FindingContext>,
}

/// One line of "What will be shared".
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedItem {
    /// text, request, teaching, nearby, passage, finding, source
    pub kind: &'static str,
    pub label: String,
    /// For a passage: the reference, so the interface can name it in its language.
    pub reference: Option<crate::scripture::reference::ScriptureRefDto>,
}

fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max).collect();
    // End at a word boundary where one is near.
    if let Some(space) = out.rfind(char::is_whitespace) {
        if space > max * 3 / 4 {
            out.truncate(space);
        }
    }
    out.push('…');
    out
}

fn some_text(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(String::from)
}

pub fn write_first() -> AppError {
    AppError::Assistant(UserMessage::new(
        "assistant.writeFirst",
        "Write something here first. The assistant helps with what you have written.",
    ))
}

fn point_label(index: usize, title: &str) -> String {
    if title.trim().is_empty() {
        format!("Point {}", index + 1)
    } else {
        format!("Point {} “{}”", index + 1, cut(title, 80))
    }
}

/// Assembles the bounded context for a request, after checking that the
/// request is grounded in the person's own material.
pub fn assemble(conn: &Connection, input: &AssistInput) -> AppResult<Context> {
    let action = input.action.ok_or_else(write_first)?;
    let part = input.part.unwrap_or(Part::Whole);
    let prep = teaching::get(conn, &input.preparation_id)?;
    let point_id = input.point_id.as_deref().filter(|p| !p.is_empty());
    let point_index = match point_id {
        Some(id) => Some(
            prep.points
                .iter()
                .position(|p| p.id == id)
                .ok_or_else(|| AppError::not_found("teaching point", id))?,
        ),
        None if part.is_point() => return Err(AppError::not_found("teaching point", "")),
        None => None,
    };
    let text = input.text.trim().to_string();
    let request = cut(&input.request, REQUEST_MAX);
    if text.chars().count() > TEXT_MAX {
        return Err(AppError::Assistant(
            UserMessage::new(
                "assistant.textTooLong",
                "This text is too long to send at once. Select a part of it and try again.",
            )
            .with("max", TEXT_MAX),
        ));
    }

    // Grounded in the person's material, or not at all.
    // A structure to comment on: at least two points with something in them.
    let whole_has_content = prep
        .points
        .iter()
        .filter(|p| !p.title.trim().is_empty() || !p.explanation.trim().is_empty())
        .count()
        >= 2;
    let grounded = match action {
        a if a.is_whole() => whole_has_content,
        AssistAction::Question => !request.is_empty(),
        AssistAction::Story => !request.is_empty(),
        AssistAction::Visual => !text.is_empty() || !request.is_empty(),
        _ => !text.is_empty(),
    };
    if !grounded {
        return Err(match action {
            AssistAction::Question | AssistAction::Story => AppError::Assistant(UserMessage::new(
                "assistant.sayWhat",
                "Say in a few words what you are looking for.",
            )),
            a if a.is_whole() => AppError::Assistant(UserMessage::new(
                "assistant.structureFirst",
                "Write at least two points first. The assistant comments on the structure you have.",
            )),
            _ => write_first(),
        });
    }
    if action == AssistAction::Audience && input.audience.trim().is_empty() {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.chooseAudience",
            "Choose who this is for.",
        )));
    }
    if action == AssistAction::Translate && input.language.trim().is_empty() {
        return Err(AppError::Assistant(UserMessage::new(
            "assistant.chooseLanguage",
            "Choose the language to translate into.",
        )));
    }

    let findings = findings_for(conn, &prep, action, point_id)?;
    // A discussion question is helped from the person's own material: their
    // text here, or findings from their study, never from the request alone.
    if action == AssistAction::Question && text.is_empty() && findings.is_empty() {
        return Err(write_first());
    }

    let focus = match point_index {
        Some(i) => format!(
            "{} — {}",
            point_label(i, &prep.points[i].title),
            part.label()
        ),
        None => part.label().to_string(),
    };

    Ok(Context {
        action,
        teaching_title: prep.title.clone(),
        teaching_kind: prep.kind.clone(),
        audience: some_text(&prep.audience),
        purpose: some_text(&prep.purpose),
        central_message: some_text(&prep.central_message),
        focus,
        text,
        selected: input.selected,
        request,
        target_audience: cut(&input.audience, 200),
        target_language: cut(&input.language, 60),
        ui_language: cut(&input.ui_language, 20),
        nearby: nearby(&prep, action, part, point_index),
        passages: passages(conn, &prep, point_id)?,
        findings,
    })
}

/// Other parts of the same teaching, in order and within limits. They show
/// the assistant where the text sits and how the person writes.
fn nearby(
    prep: &TeachingPreparation,
    action: AssistAction,
    part: Part,
    point_index: Option<usize>,
) -> Vec<(String, String)> {
    let whole = action.is_whole();
    let (each, total) = if whole {
        (WHOLE_TOTAL_MAX / 4, WHOLE_TOTAL_MAX)
    } else {
        (NEARBY_EACH_MAX, NEARBY_TOTAL_MAX)
    };
    let mut parts: Vec<(String, String)> = Vec::new();
    let mut push = |label: String, text: &str, is_focus: bool| {
        if !is_focus && !text.trim().is_empty() {
            parts.push((label, text.to_string()));
        }
    };
    push(
        "Introduction".into(),
        &prep.introduction,
        point_index.is_none() && part == Part::Introduction,
    );
    for (i, point) in prep.points.iter().enumerate() {
        let here = point_index == Some(i);
        let label = point_label(i, &point.title);
        // Every point's title gives the shape; its text only when it is the
        // point being worked on, a neighbour, or the whole is reviewed.
        let close = whole || point_index.is_some_and(|p| p.abs_diff(i) <= 1);
        if !point.title.trim().is_empty() {
            push(
                format!("{label} — title"),
                &point.title,
                here && part == Part::PointTitle,
            );
        } else if !close {
            continue;
        }
        if close {
            push(
                format!("{label} — explanation"),
                &point.explanation,
                here && part == Part::PointExplanation,
            );
            push(
                format!("{label} — application"),
                &point.application,
                here && part == Part::PointApplication,
            );
            push(
                format!("{label} — illustration"),
                &point.illustration,
                here && part == Part::PointIllustration,
            );
        }
    }
    push(
        "Conclusion".into(),
        &prep.conclusion,
        point_index.is_none() && part == Part::Conclusion,
    );
    let mut used = 0;
    let mut out = Vec::new();
    for (label, text) in parts {
        if used >= total {
            break;
        }
        let piece = cut(&text, each.min(total - used));
        used += piece.chars().count();
        out.push((label, piece));
    }
    out
}

/// The study's primary passage and the passages named in the teaching (the
/// whole, and the point worked on), with their text when the person's Bible
/// is installed.
fn passages(
    conn: &Connection,
    prep: &TeachingPreparation,
    point_id: Option<&str>,
) -> AppResult<Vec<PassageContext>> {
    let mut refs: Vec<ScriptureRef> = Vec::new();
    if let Some(primary) = study_passages::primary(conn, &prep.study_id)? {
        refs.push(ScriptureRef::from_canonical(&primary.reference.canonical)?);
    }
    for p in &prep.passages {
        if p.point_id.is_none() || p.point_id.as_deref() == point_id {
            refs.push(ScriptureRef::from_canonical(&p.reference.canonical)?);
        }
    }
    let mut seen = Vec::new();
    refs.retain(|r| {
        let key = r.canonical();
        let fresh = !seen.contains(&key);
        seen.push(key);
        fresh
    });
    refs.truncate(PASSAGES_MAX);

    let translation = app_settings::get(conn)?
        .scripture_translation_id
        .and_then(|id| bibles::get(conn, &id).ok());
    let mut budget = SCRIPTURE_TEXT_MAX;
    let mut out = Vec::new();
    for reference in refs {
        let mut text = None;
        if let Some(t) = &translation {
            if budget > 0 {
                if let Ok(passage) = bibles::passage(conn, &t.id, &reference) {
                    let joined = passage
                        .verses
                        .iter()
                        .map(|v| format!("{}:{} {}", v.chapter, v.verse, v.text))
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !joined.is_empty() {
                        let piece = cut(&joined, budget);
                        budget = budget.saturating_sub(piece.chars().count());
                        text = Some(piece);
                    }
                }
            }
        }
        out.push(PassageContext {
            reference: reference.to_dto(),
            display: reference.display(),
            translation: text
                .as_ref()
                .and(translation.as_ref())
                .map(|t| t.short_name.clone()),
            text,
        });
    }
    Ok(out)
}

fn finding_context(f: &Finding) -> FindingContext {
    FindingContext {
        kind: f.finding_type.as_str().replace('_', " "),
        content: cut(&f.content, FINDING_TEXT_MAX),
        quotes: f
            .sources
            .iter()
            .filter_map(|c| {
                let quote = c.quote.as_deref()?.trim();
                if quote.is_empty() {
                    return None;
                }
                let mut citation = c.title.clone();
                if let Some(author) = c.author.as_deref().filter(|a| !a.is_empty()) {
                    citation = format!("{author}, {citation}");
                }
                if let Some(locator) = c.locator.as_deref().filter(|l| !l.is_empty()) {
                    citation = format!("{citation}, {locator}");
                }
                Some(QuoteContext {
                    quote: cut(quote, QUOTE_MAX),
                    citation: cut(&citation, CITATION_MAX),
                })
            })
            .take(QUOTES_PER_FINDING)
            .collect(),
    }
}

/// The findings used in the teaching (the point's, then the whole's). For
/// checking actions with none linked, the study's own findings (still only
/// this study's, and only up to the limit).
fn findings_for(
    conn: &Connection,
    prep: &TeachingPreparation,
    action: AssistAction,
    point_id: Option<&str>,
) -> AppResult<Vec<FindingContext>> {
    let mut chosen: Vec<&Finding> = Vec::new();
    let mut ids: Vec<&str> = Vec::new();
    let linked = prep
        .findings
        .iter()
        .filter(|l| point_id.is_some() && l.point_id.as_deref() == point_id)
        .chain(prep.findings.iter().filter(|l| l.point_id.is_none()));
    for link in linked {
        if !ids.contains(&link.finding.id.as_str()) {
            ids.push(&link.finding.id);
            chosen.push(&link.finding);
        }
    }
    let mut out: Vec<FindingContext> = if chosen.is_empty() && action.wants_study_findings() {
        let all = findings::list(conn, &prep.study_id)?;
        all.iter().take(FINDINGS_MAX).map(finding_context).collect()
    } else {
        chosen
            .into_iter()
            .take(FINDINGS_MAX)
            .map(finding_context)
            .collect()
    };
    // Source quotations within one limit for the whole request.
    let mut quotes = 0;
    for f in &mut out {
        f.quotes.truncate(QUOTES_MAX.saturating_sub(quotes));
        quotes += f.quotes.len();
    }
    Ok(out)
}

/// "What will be shared": one line per kind of thing, in plain words.
pub fn shared(context: &Context) -> Vec<SharedItem> {
    let mut items = Vec::new();
    if !context.text.is_empty() {
        items.push(SharedItem {
            kind: "text",
            label: context.focus.clone(),
            reference: None,
        });
    }
    if !context.request.is_empty() {
        items.push(SharedItem {
            kind: "request",
            label: cut(&context.request, 80),
            reference: None,
        });
    }
    // The title and kind always go; audience, purpose and message when written.
    {
        items.push(SharedItem {
            kind: "teaching",
            label: context.teaching_title.clone(),
            reference: None,
        });
    }
    for (label, _) in &context.nearby {
        items.push(SharedItem {
            kind: "nearby",
            label: label.clone(),
            reference: None,
        });
    }
    for p in &context.passages {
        items.push(SharedItem {
            kind: "passage",
            label: match &p.translation {
                Some(t) => format!("{} ({t})", p.display),
                None => p.display.clone(),
            },
            reference: Some(p.reference.clone()),
        });
    }
    if !context.findings.is_empty() {
        items.push(SharedItem {
            kind: "finding",
            label: context.findings.len().to_string(),
            reference: None,
        });
    }
    let quotes: usize = context.findings.iter().map(|f| f.quotes.len()).sum();
    if quotes > 0 {
        items.push(SharedItem {
            kind: "source",
            label: quotes.to_string(),
            reference: None,
        });
    }
    items
}

/// The context as the assistant reads it, every piece labelled with where it
/// comes from.
pub fn render(context: &Context) -> String {
    let mut out = String::new();
    out.push_str(&format!("TEACHING: “{}”", context.teaching_title));
    if let Some(kind) = &context.teaching_kind {
        out.push_str(&format!(" ({})", kind.replace('_', " ")));
    }
    out.push('\n');
    for (label, value) in [
        ("Audience", &context.audience),
        ("Purpose", &context.purpose),
        (
            "Central message (the person's own words)",
            &context.central_message,
        ),
    ] {
        if let Some(v) = value {
            out.push_str(&format!("{label}: {v}\n"));
        }
    }
    if !context.passages.is_empty() {
        out.push_str("\nSCRIPTURE (cite by reference):\n");
        for p in &context.passages {
            match (&p.text, &p.translation) {
                (Some(text), Some(t)) => out.push_str(&format!("- {} ({t}): {text}\n", p.display)),
                _ => out.push_str(&format!("- {}\n", p.display)),
            }
        }
    }
    if !context.findings.is_empty() {
        out.push_str("\nSTUDY FINDINGS (the person's own notes from their study):\n");
        for f in &context.findings {
            out.push_str(&format!("- [{}] {}\n", f.kind, f.content));
            for q in &f.quotes {
                out.push_str(&format!(
                    "  SOURCE QUOTATION (words of a book in their library, not the person's; attribute it): “{}” — {}\n",
                    q.quote, q.citation
                ));
            }
        }
    }
    if !context.nearby.is_empty() {
        out.push_str(
            "\nOTHER PARTS OF THIS TEACHING (written by the person; also shows how they write):\n",
        );
        for (label, text) in &context.nearby {
            out.push_str(&format!("[{label}]\n{text}\n"));
        }
    }
    if !context.text.is_empty() {
        out.push_str(&format!(
            "\nTEXT TO WORK ON — {}{} (written by the person):\n<<<\n{}\n>>>\n",
            context.focus,
            if context.selected {
                ", a selected passage"
            } else {
                ""
            },
            context.text
        ));
    }
    if !context.request.is_empty() {
        out.push_str(&format!(
            "\nWHAT THE PERSON ASKS (their words): {}\n",
            context.request
        ));
    }
    out
}
