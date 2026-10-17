//! Markdown: the presentation as simple structured text, from the same
//! document as every other output. Scripture text is included; the
//! speaker's manuscript and notes and the sources only when asked for.

use super::document::{PresentationDocument, Slide};
use super::ExportOptions;

/// A line of the person's own text that Markdown would read as structure.
fn line(text: &str) -> String {
    let t = text.trim_start();
    let structural = t.starts_with('#')
        || t.starts_with('>')
        || t.starts_with("---")
        || t.starts_with("- ")
        || t.starts_with("* ")
        || t.starts_with("+ ");
    if structural {
        format!("\\{t}")
    } else {
        t.to_string()
    }
}

fn paragraphs(out: &mut String, text: &str, prefix: &str) {
    for l in text.trim().lines() {
        if l.trim().is_empty() {
            out.push_str(prefix.trim_end());
            out.push('\n');
        } else {
            out.push_str(prefix);
            out.push_str(&line(l));
            out.push_str("  \n");
        }
    }
}

pub fn render(doc: &PresentationDocument, options: &ExportOptions) -> String {
    let loc = &options.locale;
    let mut out = String::new();
    out.push_str(&format!("# {}\n\n", line(&doc.title)));
    if let Some(passage) = &doc.primary_passage {
        out.push_str(&format!("*{}*\n\n", loc.reference(passage)));
    }
    for slide in &doc.slides {
        if slide.kind == "title" && slide.index == 0 {
            // The document's own title already says it.
            if let Some(body) = &slide.audience.body {
                paragraphs(&mut out, body, "");
                out.push('\n');
            }
            speaker(&mut out, slide, options);
            continue;
        }
        out.push_str("---\n\n");
        render_slide(&mut out, slide, doc, options);
    }
    if options.citations {
        let mut seen = Vec::new();
        for c in doc.slides.iter().flat_map(|s| &s.citations) {
            if !seen.contains(&c) {
                seen.push(c);
            }
        }
        if !seen.is_empty() {
            out.push_str(&format!("---\n\n## {}\n\n", loc.labels.citations));
            for c in seen {
                let mut entry = line(&c.title);
                if let Some(detail) = &c.detail {
                    entry.push_str(&format!(" — {}", detail.trim()));
                }
                if let Some(url) = &c.url {
                    entry.push_str(&format!(" <{url}>"));
                }
                out.push_str(&format!("- {entry}\n"));
            }
            out.push('\n');
        }
    }
    out
}

fn render_slide(
    out: &mut String,
    slide: &Slide,
    doc: &PresentationDocument,
    options: &ExportOptions,
) {
    let loc = &options.locale;
    let a = &slide.audience;
    if a.blank {
        out.push_str(&format!("*({})*\n\n", loc.labels.pause));
        speaker(out, slide, options);
        return;
    }
    let level = if slide.kind == "section" || slide.kind == "title" {
        "##"
    } else {
        "###"
    };
    if let Some(heading) = &a.heading {
        out.push_str(&format!("{level} {}\n\n", line(heading)));
    }
    match slide.kind.as_str() {
        "scripture" => {
            if let Some(r) = &a.reference {
                let bible = a
                    .bible
                    .as_deref()
                    .map(|b| format!(" ({b})"))
                    .unwrap_or_default();
                out.push_str(&format!("> **{}**{bible}\n>\n", loc.reference(r)));
                if a.verses.is_empty() {
                    out.push_str(&format!("> *{}*\n", loc.labels.scripture_unavailable));
                }
                for v in &a.verses {
                    out.push_str(&format!("> <sup>{}</sup> {}\n", v.verse, v.text.trim()));
                }
                out.push('\n');
            }
            if let Some(body) = &a.body {
                paragraphs(out, body, "");
                out.push('\n');
            }
        }
        "quote" => {
            if let Some(body) = &a.body {
                paragraphs(out, body, "> ");
                out.push('\n');
            }
        }
        "question" => {
            if let Some(body) = &a.body {
                for l in body.trim().lines().filter(|l| !l.trim().is_empty()) {
                    out.push_str(&format!("**{}**  \n", line(l)));
                }
                out.push('\n');
            }
        }
        "image" => {
            if let Some(image) = &a.image {
                let available = doc
                    .images
                    .iter()
                    .any(|i| i.id == image.asset_id && i.available);
                let mut text = image.caption.clone().unwrap_or_default();
                if image.generated {
                    text = format!("{text} ({})", loc.labels.generated_image)
                        .trim()
                        .to_string();
                }
                out.push_str(&format!("*[{}]*", line(&text)));
                if let Some(credit) = &image.credit {
                    out.push_str(&format!(" — {}", credit.trim()));
                }
                if !available {
                    out.push_str(&format!(" *({})*", loc.labels.image_unavailable));
                }
                out.push_str("\n\n");
            }
            if let Some(body) = &a.body {
                paragraphs(out, body, "");
                out.push('\n');
            }
        }
        _ => {
            if let Some(r) = &a.reference {
                out.push_str(&format!("*{}*\n\n", loc.reference(r)));
            }
            if let Some(body) = &a.body {
                paragraphs(out, body, "");
                out.push('\n');
            }
        }
    }
    speaker(out, slide, options);
}

fn speaker(out: &mut String, slide: &Slide, options: &ExportOptions) {
    if !options.speaker_notes {
        return;
    }
    let loc = &options.locale;
    let s = &slide.speaker;
    if s.manuscript.is_empty() && s.notes.is_empty() {
        return;
    }
    out.push_str(&format!("**{}**\n\n", loc.labels.speaker_notes));
    for part in &s.manuscript {
        out.push_str(&format!("*{}:*  \n", loc.field(&part.field)));
        paragraphs(out, loc.part_text(&part.field, &part.text), "");
        out.push('\n');
    }
    if !s.notes.is_empty() {
        paragraphs(out, &s.notes, "");
        out.push('\n');
    }
}
