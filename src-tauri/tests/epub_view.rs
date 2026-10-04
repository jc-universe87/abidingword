//! The formatted EPUB view: what is kept, what is dropped, where links lead,
//! and that nothing in a book can run, load or reach outside it. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use abiding_word_lib::library::adapters::epub::{self, EpubImporter};
use abiding_word_lib::library::adapters::epub_view::{render_item, EpubItem, Node};
use abiding_word_lib::library::adapters::SourceImportAdapter;
use fixtures::{epub_raw_binary, xhtml};

const XHTML: &str = r#"media-type="application/xhtml+xml""#;

/// A 1 x 1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

const CSS: &str = r#"
@import url("http://evil.example/x.css");
@font-face { font-family: Evil; src: url("http://evil.example/f.woff"); }
body { background-color: #fffbe6; margin: 0; position: absolute; top: 0; }
p.lead { text-indent: 1.5em; font-size: 400%; background-image: url(http://evil.example/track.png); }
.overlay { position: fixed; z-index: 9999; top: 0; left: 0; width: 100%; height: 100%; }
.note { font-size: 0.8em; color: #333; }
"#;

fn ch1() -> String {
    xhtml(
        r##"<h1 id="top">Chapter One — Εἰς τὸ ὄνομα · 하나님 · שלום</h1>
<p class="lead" onclick="alert('x')" style="color: red; position: fixed; background: url(http://evil.example/a.png)">First <strong>bold</strong>, <em>italic</em> and <sup>sup</sup>/<sub>sub</sub> text<a id="r1" epub:type="noteref" href="#fn1">1</a>.</p>
<blockquote><p>A quotation.</p></blockquote>
<ol start="3"><li>One</li><li>Two<ul><li>Nested<ul><li>Deep</li></ul></li></ul></li></ol>
<table><caption>Cap</caption><thead><tr><th scope="col" colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>
<hr/>
<figure><img src="images/pic.png" alt="A picture" width="40"/><figcaption>Caption</figcaption></figure>
<p><img src="https://evil.example/pixel.png" alt="remote one"/> <img src="../../../../etc/passwd" alt="outside"/> <img src="images/absent.png" alt="absent"/></p>
<p><a href="javascript:alert(1)">script link</a> <a href="https://example.org/page">web link</a> <a href="text/ch2.xhtml#sec">to chapter two</a> <a href="../../../x.xhtml">outside</a> <a href="#nope-but-same-doc">same doc</a></p>
<script>window.pwned = true;</script><script src="http://evil.example/x.js"></script>
<iframe src="http://evil.example/"></iframe><object data="x"></object><embed src="x"/>
<div class="overlay" onmouseover="steal()">overlay text</div>
<form action="http://evil.example/"><input type="text" name="x"/><button>Send</button></form>
<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>svg text</text></svg>
<aside id="fn1" epub:type="footnote"><p class="note">Footnote text. <a href="#r1" epub:type="backlink">↩</a></p></aside>"##,
    )
    .replace(
        "<head><title>t</title></head>",
        r#"<head><title>t</title><link rel="stylesheet" type="text/css" href="styles/book.css"/><link rel="stylesheet" href="http://evil.example/remote.css"/><link rel="stylesheet" href="../../outside.css"/><style>.note { font-style: italic; position: absolute; } @import "x.css";</style></head>"#,
    )
}

fn ch2() -> String {
    xhtml(
        r##"<h2 id="sec">Chapter Two</h2><p>See <a href="../ch1.xhtml#r1">the marker</a>, <a href="../notes.xhtml#n2">note two</a> and <a href="../notes.xhtml">the notes</a>.</p>"##,
    )
}

fn notes() -> String {
    xhtml(r##"<h1>Notes</h1><ol><li id="n1">First.</li><li id="n2">Second.</li></ol>"##)
}

fn book() -> Vec<u8> {
    let ch1 = ch1();
    let ch2 = ch2();
    let notes = notes();
    let manifest = format!(
        r#"<item id="c1" href="ch1.xhtml" {XHTML}/><item id="c2" href="text/ch2.xhtml" {XHTML}/><item id="nt" href="notes.xhtml" {XHTML}/><item id="css" href="styles/book.css" media-type="text/css"/><item id="img" href="images/pic.png" media-type="image/png"/>"#
    );
    epub_raw_binary(
        &manifest,
        r#"<itemref idref="c1"/><itemref idref="c2"/><itemref idref="nt"/>"#,
        &[
            ("OEBPS/ch1.xhtml", ch1.as_bytes()),
            ("OEBPS/text/ch2.xhtml", ch2.as_bytes()),
            ("OEBPS/notes.xhtml", notes.as_bytes()),
            ("OEBPS/styles/book.css", CSS.as_bytes()),
            ("OEBPS/images/pic.png", PNG),
            ("OEBPS/outside.css", b"p { color: red }"),
        ],
    )
}

fn item(bytes: &[u8], id: &str) -> EpubItem {
    render_item(bytes, id).unwrap()
}

fn json(item: &EpubItem) -> String {
    serde_json::to_string(item).unwrap()
}

/// Every element in the tree, with its tag.
fn walk<'a>(
    nodes: &'a [Node],
    out: &mut Vec<&'a abiding_word_lib::library::adapters::epub_view::El>,
) {
    for node in nodes {
        if let Node::El(el) = node {
            out.push(el);
            walk(&el.c, out);
        }
    }
}

fn elements(item: &EpubItem) -> Vec<&abiding_word_lib::library::adapters::epub_view::El> {
    let mut out = Vec::new();
    walk(&item.nodes, &mut out);
    out
}

fn text_of(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|n| match n {
            Node::Text(t) => t.clone(),
            Node::El(el) => text_of(&el.c),
        })
        .collect()
}

#[test]
fn structure_is_kept() {
    let book = book();
    let one = item(&book, "c1");
    let tags: Vec<&str> = elements(&one).iter().map(|e| e.t).collect();
    for wanted in [
        "h1",
        "p",
        "strong",
        "em",
        "sup",
        "sub",
        "blockquote",
        "ol",
        "ul",
        "li",
        "table",
        "caption",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "hr",
        "figure",
        "figcaption",
        "img",
        "a",
    ] {
        assert!(tags.contains(&wanted), "{wanted} missing from {tags:?}");
    }
    let nested = elements(&one).iter().filter(|e| e.t == "ul").count();
    assert_eq!(nested, 2, "nested lists keep their nesting");
    let text = text_of(&one.nodes);
    assert!(
        text.contains("Εἰς τὸ ὄνομα") && text.contains("하나님") && text.contains("שלום"),
        "non-Latin text is kept"
    );
    assert!(text.contains("Footnote text."));
    let ol = elements(&one).into_iter().find(|e| e.t == "ol").unwrap();
    assert_eq!(ol.a.get("start").map(String::as_str), Some("3"));
    let th = elements(&one).into_iter().find(|e| e.t == "th").unwrap();
    assert_eq!(th.a.get("colSpan").map(String::as_str), Some("2"));
}

#[test]
fn nothing_in_a_book_can_run_load_or_navigate() {
    let book = book();
    let one = item(&book, "c1");
    let all = json(&one);
    for bad in [
        "onclick",
        "onmouseover",
        "alert(",
        "pwned",
        "evil.example",
        "javascript",
        "<script",
        "iframe",
        "<object",
        "embed",
        "<form",
        "<input",
        "<button",
        "svg text",
        "steal",
        "/etc/passwd",
        "http://",
        "https://",
        "url(",
    ] {
        assert!(!all.contains(bad), "{bad} must not survive: {all}");
    }
    let tags: Vec<&str> = elements(&one).iter().map(|e| e.t).collect();
    for banned in [
        "script", "style", "iframe", "object", "embed", "form", "input", "button", "svg", "link",
        "head", "title",
    ] {
        assert!(!tags.contains(&banned), "{banned}");
    }
    // Only the picture inside the book is an image with a source, and it is a data URL.
    let sources: Vec<&String> = elements(&one)
        .iter()
        .filter_map(|e| e.a.get("src"))
        .collect();
    assert_eq!(sources.len(), 1);
    assert!(sources[0].starts_with("data:image/png;base64,"));
    // No attribute anywhere is anything but the short, known list.
    for el in elements(&one) {
        for key in el.a.keys() {
            assert!(
                [
                    "id", "class", "lang", "dir", "title", "role", "colSpan", "rowSpan", "scope",
                    "start", "type", "value", "width", "height", "style", "src", "alt"
                ]
                .contains(key),
                "unexpected attribute {key}"
            );
        }
    }
    assert_eq!(
        one.missing_images, 3,
        "remote, outside and absent pictures are all replaced"
    );
    assert!(
        text_of(&one.nodes).contains("remote one")
            && text_of(&one.nodes).contains("outside")
            && text_of(&one.nodes).contains("absent")
    );
}

#[test]
fn styles_are_cut_down_and_cannot_position_anything() {
    let book = book();
    let one = item(&book, "c1");
    for bad in [
        "@import",
        "@font-face",
        "evil",
        "url(",
        "position",
        "z-index",
        "top:",
        "background-image",
        "behavior",
    ] {
        assert!(
            !one.css.contains(bad),
            "{bad} must not survive: {}",
            one.css
        );
    }
    // What is harmless stays; body becomes the stand-in element; font sizes are bounded.
    assert!(one
        .css
        .contains(".aw-doc{background-color:#fffbe6;margin:0;}"));
    assert!(one.css.contains("text-indent:1.5em;"));
    assert!(one.css.contains("clamp(0.7em, 400%, 3em)"));
    assert!(one
        .css
        .contains(".note{font-size:clamp(0.7em, 0.8em, 3em);color:#333;}"));
    // The inline style attribute: colour stays, position and url do not.
    let lead = elements(&one)
        .into_iter()
        .find(|e| e.a.get("class").is_some_and(|c| c == "lead"))
        .unwrap();
    assert_eq!(lead.a.get("style").map(String::as_str), Some("color:red;"));
    // A style sheet outside the book, or on the web, is never read.
    assert!(
        !one.css.contains("p{color:red;}"),
        "outside.css was read: {}",
        one.css
    );
}

#[test]
fn links_lead_only_to_places_in_the_book() {
    let book = book();
    let one = item(&book, "c1");
    let links: Vec<_> = elements(&one)
        .into_iter()
        .filter(|e| e.l.is_some())
        .collect();
    let targets: Vec<(String, Option<String>)> = links
        .iter()
        .map(|e| {
            let l = e.l.as_ref().unwrap();
            (l.item.clone(), l.id.clone())
        })
        .collect();
    assert!(
        targets.contains(&("c1".into(), Some("fn1".into()))),
        "footnote marker: same document"
    );
    assert!(
        targets.contains(&("c2".into(), Some("sec".into()))),
        "another document, by a nested relative path"
    );
    assert!(
        targets.contains(&("c1".into(), Some("r1".into()))),
        "the note's own backlink"
    );
    let all = json(&one);
    for hidden in ["script link", "web link", "outside"] {
        let link_text: Vec<String> = links.iter().map(|e| text_of(&e.c)).collect();
        assert!(
            !link_text.iter().any(|t| t == hidden),
            "{hidden} must not be a link"
        );
        assert!(
            all.contains(hidden) || hidden == "outside",
            "its words stay"
        );
    }
    // The marker keeps its meaning for assistive technology.
    let marker = links
        .iter()
        .find(|e| e.a.get("id").is_some_and(|i| i == "r1"))
        .unwrap();
    assert_eq!(
        marker.a.get("role").map(String::as_str),
        Some("doc-noteref")
    );
    let two = item(&book, "c2");
    let two_targets: Vec<(String, Option<String>)> = elements(&two)
        .into_iter()
        .filter_map(|e| e.l.as_ref().map(|l| (l.item.clone(), l.id.clone())))
        .collect();
    assert_eq!(
        two_targets,
        [
            ("c1".into(), Some("r1".into())),
            ("nt".into(), Some("n2".into())),
            ("nt".into(), None)
        ]
    );
}

#[test]
fn only_documents_of_the_reading_order_can_be_asked_for() {
    let book = book();
    for bad in [
        "css",
        "img",
        "nope",
        "",
        "../../etc/passwd",
        "OEBPS/ch1.xhtml",
    ] {
        assert!(render_item(&book, bad).is_err(), "{bad}");
    }
    assert!(render_item(b"not a zip", "c1").is_err());
}

#[test]
fn the_structure_matches_the_extracted_text() {
    let book = book();
    let segments = EpubImporter
        .extract(&book, "book.epub")
        .unwrap()
        .segments
        .len();
    let structure = epub::structure(&book, segments);
    let ids: Vec<&str> = structure.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["c1", "c2", "nt"]);
    assert_eq!(structure[0].start_segment, 0);
    assert!(
        structure[1].start_segment > 0 && structure[2].start_segment > structure[1].start_segment
    );
    assert_eq!(
        structure.iter().map(|i| i.segment_count).sum::<i64>(),
        segments as i64
    );
    assert!(
        structure[0].anchors.contains_key("fn1")
            && structure[1].anchors.contains_key("sec")
            && structure[2].anchors.contains_key("n2")
    );
    assert!(
        epub::structure(&book, segments + 1).is_empty(),
        "text that no longer matches gives nothing"
    );
}

#[test]
fn sloppy_markup_does_not_break_or_swallow_text() {
    let body = r#"<p>One<br>two<br>three</p><p>Unclosed <b>bold <i>both</b> after</p><div><span>x</div> tail<img src="images/pic.png" alt="a"><p>end</p>"#;
    let sloppy = xhtml(body);
    let manifest = format!(
        r#"<item id="a" href="a.xhtml" {XHTML}/><item id="img" href="images/pic.png" media-type="image/png"/>"#
    );
    let book = epub_raw_binary(
        &manifest,
        r#"<itemref idref="a"/>"#,
        &[
            ("OEBPS/a.xhtml", sloppy.as_bytes()),
            ("OEBPS/images/pic.png", PNG),
        ],
    );
    let one = item(&book, "a");
    let text = text_of(&one.nodes);
    for word in [
        "One", "two", "three", "Unclosed", "bold", "both", "after", "tail", "end",
    ] {
        assert!(text.contains(word), "{word} in {text}");
    }
}

#[test]
fn rows_written_straight_inside_a_table_get_a_body() {
    let body = r#"<table><tr><th>A</th></tr><tr><td>1</td></tr></table>"#;
    let one = xhtml(body);
    let manifest = format!(r#"<item id="a" href="a.xhtml" {XHTML}/>"#);
    let book = epub_raw_binary(
        &manifest,
        r#"<itemref idref="a"/>"#,
        &[("OEBPS/a.xhtml", one.as_bytes())],
    );
    let item = item(&book, "a");
    let table = elements(&item)
        .into_iter()
        .find(|e| e.t == "table")
        .unwrap();
    assert!(
        table
            .c
            .iter()
            .all(|c| matches!(c, Node::El(e) if e.t == "tbody")),
        "{table:?}"
    );
}
