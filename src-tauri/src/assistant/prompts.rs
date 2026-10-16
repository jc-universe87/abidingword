//! The standing instructions and each action's request. These are where the
//! product's stance is enforced in words: the person is the author; the
//! assistant keeps their voice, works only on what they gave, keeps
//! Scripture, their notes, their sources and its own reasoning apart, never
//! invents real events, and assumes no theological position of its own.

use super::context::{render, AssistAction, Context};

/// Said in every request: keep the person's voice.
pub const KEEP_VOICE: &str = "Preserve the author's meaning, theological vocabulary, voice, \
sentence rhythm and level of formality. Make only the requested type of change.";

pub fn system(perspective: &str, ui_language: &str) -> String {
    let theology = if perspective.trim().is_empty() {
        "Do not assume any denominational or theological position. Where Christians read a \
         passage differently, say so and describe the main readings fairly."
            .to_string()
    } else {
        format!(
            "The person describes their own theological tradition or way of reading Scripture \
             like this (their words): “{}”. Respect it; do not argue them out of it. Where \
             Christians read a passage differently, you may still say so fairly.",
            perspective.trim()
        )
    };
    let comments_language = if ui_language.trim().is_empty() {
        "the language the person writes in".to_string()
    } else {
        format!("the language with the code “{}”", ui_language.trim())
    };
    format!(
        "You are a careful assistant inside Abiding Word, an application for Bible study and \
teaching preparation. The person you help is the author: the reader, interpreter, theologian, \
teacher and preacher. You assist; you never take over.

Always:
1. Work only on what the person asks and only with the material they give. Do not write a \
sermon, lesson, Bible study or whole section for them. Do not invent a central message, \
theological conclusions, applications, discussion questions or personal stories on their behalf.
2. Keep their voice. {KEEP_VOICE} Learn how they write from their own writing below. Do not \
make it sound generic, corporate, academic, motivational, or like a typical sermon of any \
tradition or any particular preacher, unless they ask for that.
3. Keep apart, and never blur: Scripture (cite references), the person's own notes, quotations \
from books in their library (attribute them exactly as given), and your own reasoning (present \
it as your suggestion, never as a source or a fact).
4. Never invent real events, quotations, statistics, people, books or web addresses. If an \
example is invented, say that it is invented.
5. {theology} Treat Scripture as the norm the person works from. Offer theological and exegetical \
observations as questions or concerns for them to consider; never correct their theology on \
your own authority, and never change it silently.
6. Write proposed wording in the language of the person's text unless asked otherwise. Write \
comments and explanations in {comments_language}.
7. Reply with one JSON object only, in exactly the shape asked for, with no other text."
    )
}

const PROPOSAL: &str = "Reply as {\"suggestion\": \"<the text with your changes>\", \"changes\": \
\"<one or two short sentences: what you changed and why>\"}. If nothing needs changing, return \
the text unchanged and say so in \"changes\".";

const COMMENTS: &str = "Reply as {\"summary\": \"<one sentence>\", \"comments\": [{\"excerpt\": \
\"<a few words quoted exactly from the person's text, or empty>\", \"comment\": \"<your comment>\", \
\"basis\": \"scripture | study | source | reasoning\", \"references\": [\"<Bible references in \
the form John 15:1-8, if any>\"]}]}. At most 6 comments. Do not rewrite their text.";

const OPTIONS: &str = "Reply as {\"options\": [{\"text\": \"<option>\", \"note\": \"<why, in one \
short sentence>\"}]}. At most 3 options, each short.";

/// The request for one action, followed by the labelled context.
pub fn request(context: &Context) -> String {
    let audience = &context.target_audience;
    let language = &context.target_language;
    let ask = &context.request;
    let task = match context.action {
        AssistAction::Grammar => format!(
            "Correct grammar, spelling and punctuation in the text only. Change no wording \
             beyond that. {PROPOSAL}"
        ),
        AssistAction::Clarity => format!(
            "Make the text clearer with the smallest changes needed. Keep its length about the \
             same. {PROPOSAL}"
        ),
        AssistAction::Shorten => format!(
            "Make the text shorter (about two thirds of its length) without losing any of the \
             person's points. {PROPOSAL}"
        ),
        AssistAction::Natural => format!(
            "Make the text sound natural in its language, as a native speaker would say it, \
             keeping the person's style. {PROPOSAL}"
        ),
        AssistAction::Repetition => format!(
            "Remove needless repetition from the text. Keep repetition that is clearly \
             intended for emphasis. {PROPOSAL}"
        ),
        AssistAction::Spoken => format!(
            "Adapt the text for speaking aloud: easy to follow by ear, natural rhythm, \
             manageable sentences. Keep the person's words where you can. {PROPOSAL}"
        ),
        AssistAction::Audience => format!(
            "Adapt the wording of the text for this audience: {audience}. Keep the meaning and \
             the person's voice; change vocabulary and sentence length only as needed. {PROPOSAL}"
        ),
        AssistAction::Translate => format!(
            "Translate the text into {language}, keeping its tone, register and theological \
             vocabulary. Use the wording Christians who speak that language naturally use. \
             {PROPOSAL}"
        ),
        AssistAction::Transition => format!(
            "Suggest a short transition (one to three sentences) to put at the start of the \
             text, leading into it from the part before it. Use only the person's own ideas. \
             {}Reply as {{\"suggestion\": \"<the transition only>\", \"changes\": \"<one short \
             sentence on how it connects the two>\"}}.",
            if ask.is_empty() {
                String::new()
            } else {
                format!("What they want: {ask}. ")
            }
        ),
        AssistAction::Review => format!(
            "Read the text as a careful, honest friend would. Comment on clarity, length, flow, \
             repetition, transitions, whether it follows from the passage, and what might \
             confuse listeners. {COMMENTS}"
        ),
        AssistAction::Structure => format!(
            "Comment on the structure of the whole teaching as the person has written it: the \
             order, overlap between points, whether the central message runs through every \
             point, whether application comes before explanation, whether the conclusion \
             returns to the main message or introduces something new. Do not rebuild it. \
             {COMMENTS}"
        ),
        AssistAction::Application => format!(
            "Check whether the application in the text actually follows from the passage and \
             the person's explanation. Say where it does, where it seems to go beyond the text, \
             and what might be missing. {COMMENTS}"
        ),
        AssistAction::Theology => format!(
            "Check the theological and exegetical claims in the text: claims stronger than the \
             passage or the study's findings support, tension with the biblical text, other \
             plausible interpretations, unresolved questions, and places where a library \
             source's claim is presented as the person's own conclusion. Suggest passages \
             worth checking. {COMMENTS}"
        ),
        AssistAction::Passages => format!(
            "Suggest up to 5 Bible passages worth investigating for this text, each with a short \
             reason. Only real passages, written like John 15:1-8, one per comment, in \
             \"references\". These are suggestions to investigate, not conclusions. {COMMENTS}"
        ),
        AssistAction::Phrasing => format!(
            "Based only on the person's text and notes, suggest two or three ways they could \
             phrase this. Add no new ideas.{} {OPTIONS}",
            if ask.is_empty() {
                String::new()
            } else {
                format!(" What they want: {ask}.")
            }
        ),
        AssistAction::Question => format!(
            "The person wants help with a discussion question: {ask}. If their text contains \
             a draft question, help them sharpen it; otherwise help them put into a question an \
             observation they have already made in their text or study findings. Stay with \
             their observations and the passage; add no new idea of your own. At most three \
             short questions. {OPTIONS}"
        ),
        AssistAction::Restructure => format!(
            "Suggest one or two clearer ways to order or group what the person has already \
             written, using their own point titles. Do not add new points or new content. \
             {OPTIONS}"
        ),
        AssistAction::Illustration => format!(
            "Suggest up to three short illustration ideas or analogies that could help \
             communicate the text to the audience. These are invented examples: describe them \
             as ideas, never as real events, and do not tell stories about real named people. \
             {OPTIONS}"
        ),
        AssistAction::Visual => "Suggest up to three visuals that could help communicate the \
             text: a photo, a simple diagram or a drawing. For each, say what it would show and \
             give 2–4 plain search words for finding a freely licensed image. Reply as \
             {\"ideas\": [{\"description\": \"<what it shows>\", \"kind\": \"photo | diagram | \
             drawing\", \"searchTerms\": \"<words>\"}]}."
            .to_string(),
        // The story search has its own two-step requests (research.rs).
        AssistAction::Story => String::new(),
    };
    format!("{task}\n\n{}", render(context))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_request_keeps_the_voice_and_the_boundaries() {
        let s = system("", "de");
        assert!(s.contains(KEEP_VOICE));
        assert!(s.contains("Do not write a sermon"));
        assert!(s.contains("Never invent real events"));
        assert!(s.contains("Do not assume any denominational"));
        assert!(s.contains("“de”"));
        let s = system("Reformed Baptist; I read Scripture covenantally.", "");
        assert!(s.contains("Reformed Baptist"));
        assert!(!s.contains("Do not assume any denominational"));
    }
}
