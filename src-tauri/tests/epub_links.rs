//! Links inside an EPUB's text: which ones are found, where they sit in the
//! extracted segments and where they lead. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use abiding_word_lib::library::adapters::epub;
use abiding_word_lib::library::adapters::SourceImportAdapter;
use abiding_word_lib::library::contents::SourceLink;
use fixtures::{epub_raw, xhtml};

const XHTML: &str = r#"media-type="application/xhtml+xml""#;

fn build(files: &[(&str, String)]) -> Vec<u8> {
    let manifest: String = files
        .iter()
        .enumerate()
        .map(|(i, (path, _))| {
            let href = path.trim_start_matches("OEBPS/");
            format!(r#"<item id="d{i}" href="{href}" {XHTML}/>"#)
        })
        .collect();
    let spine: String = (0..files.len())
        .map(|i| format!(r#"<itemref idref="d{i}"/>"#))
        .collect();
    let raw: Vec<(&str, &str)> = files.iter().map(|(p, c)| (*p, c.as_str())).collect();
    epub_raw(&manifest, "", &spine, &raw)
}

fn segments(bytes: &[u8]) -> Vec<String> {
    epub::EpubImporter
        .extract(bytes, "book.epub")
        .unwrap()
        .segments
        .into_iter()
        .map(|s| s.text)
        .collect()
}

fn links(bytes: &[u8]) -> Vec<SourceLink> {
    epub::links(bytes, segments(bytes).len())
}

/// The text a link covers, counting UTF-16 units as the interface does.
fn covered(texts: &[String], link: &SourceLink) -> String {
    let units: Vec<u16> = texts[link.position as usize].encode_utf16().collect();
    String::from_utf16(&units[link.start..link.end]).unwrap()
}

fn book() -> Vec<u8> {
    build(&[
        (
            "OEBPS/ch1.xhtml",
            xhtml(
                r##"<h1>One</h1><p>Body text with a note<a href="#fn1" id="r1">1</a> and a <a href="text/ch2.xhtml">next chapter</a>.</p><p id="mid">Middle.</p><aside id="fn1"><p>Footnote one. <a href="#r1">back</a></p></aside>"##,
            ),
        ),
        (
            "OEBPS/text/ch2.xhtml",
            xhtml(
                r##"<h1>Two</h1><p>See <a href="../ch1.xhtml#mid">the middle of one</a>, <a href="../notes/end.xhtml#n2">end note</a>, <a href="https://example.org/x">the web</a>, <a href="#nowhere">broken</a>, <a href="../gone.xhtml">missing file</a> and <a href="javascript:alert(1)">script</a>.</p>"##,
            ),
        ),
        (
            "OEBPS/notes/end.xhtml",
            xhtml(
                r##"<h1>Notes</h1><ol><li id="n1">First note.</li><li id="n2">Second note.</li></ol>"##,
            ),
        ),
    ])
}

#[test]
fn a_footnote_marker_leads_to_the_note_and_the_note_back() {
    let bytes = book();
    let texts = segments(&bytes);
    let found = links(&bytes);
    let marker = found.iter().find(|l| covered(&texts, l) == "1").unwrap();
    let note = texts
        .iter()
        .position(|t| t.starts_with("Footnote one."))
        .unwrap() as i64;
    assert_eq!(marker.target, note);
    let back = found.iter().find(|l| covered(&texts, l) == "back").unwrap();
    assert_eq!(back.target, marker.position);
}

#[test]
fn links_to_other_documents_and_their_anchors_are_found() {
    let bytes = book();
    let texts = segments(&bytes);
    let found = links(&bytes);
    let at = |s: &str| texts.iter().position(|t| t.starts_with(s)).unwrap() as i64;
    let next = found
        .iter()
        .find(|l| covered(&texts, l) == "next chapter")
        .unwrap();
    assert_eq!(
        next.target,
        at("See "),
        "a document without a fragment: its first segment"
    );
    let middle = found
        .iter()
        .find(|l| covered(&texts, l) == "the middle of one")
        .unwrap();
    assert_eq!(
        middle.target,
        at("Middle."),
        "a fragment in another chapter, by a relative path"
    );
    let note = found
        .iter()
        .find(|l| covered(&texts, l) == "end note")
        .unwrap();
    assert_eq!(
        note.target,
        at("Second note."),
        "a path that climbs out of a subdirectory"
    );
}

#[test]
fn external_broken_and_unsafe_links_are_left_out() {
    let bytes = book();
    let texts = segments(&bytes);
    let shown: Vec<String> = links(&bytes).iter().map(|l| covered(&texts, l)).collect();
    for hidden in ["the web", "broken", "missing file", "script"] {
        assert!(
            !shown.iter().any(|s| s == hidden),
            "{hidden} must not be a link"
        );
    }
    assert_eq!(shown.len(), 5, "{shown:?}");
}

#[test]
fn ranges_count_utf16_units_and_survive_long_paragraphs() {
    let long = "Sentence number one is here. ".repeat(80);
    let body = format!(
        r##"<h1>T</h1><p>😀 ünï <a href="#t">emoji link</a> {long}and <a href="#t">late link</a>.</p><p id="t">Target.</p>"##
    );
    let bytes = build(&[("OEBPS/a.xhtml", xhtml(&body))]);
    let texts = segments(&bytes);
    assert!(
        texts.len() > 2,
        "the long paragraph is split into several segments"
    );
    let found = links(&bytes);
    let shown: Vec<String> = found.iter().map(|l| covered(&texts, l)).collect();
    assert_eq!(shown, ["emoji link", "late link"]);
    assert!(
        found[1].position > found[0].position,
        "the late link is in a later segment"
    );
    let target = texts.iter().position(|t| t == "Target.").unwrap() as i64;
    assert!(found.iter().all(|l| l.target == target));
}

#[test]
fn a_book_whose_text_changed_gives_no_links() {
    let bytes = book();
    assert!(epub::links(&bytes, segments(&bytes).len() + 1).is_empty());
}

#[test]
fn a_link_across_nested_markup_covers_all_its_text() {
    let bytes = build(&[(
        "OEBPS/a.xhtml",
        xhtml(
            r##"<h1>T</h1><p>Read <a href="#t"><em>very</em> <b>bold</b>  text</a> now.</p><p id="t">Target.</p>"##,
        ),
    )]);
    let texts = segments(&bytes);
    let found = links(&bytes);
    assert_eq!(covered(&texts, &found[0]), "very bold text");
}
