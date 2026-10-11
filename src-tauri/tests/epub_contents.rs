//! An EPUB's own table of contents: EPUB 3 navigation document, EPUB 2 NCX,
//! hierarchy, mapping to segment positions, and safety. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use abiding_word_lib::library::adapters::epub;
use abiding_word_lib::library::adapters::SourceImportAdapter;
use abiding_word_lib::library::contents::{ContentsItem, ContentsTarget};
use fixtures::{epub_raw, xhtml};

const XHTML: &str = r#"media-type="application/xhtml+xml""#;

fn position(item: &ContentsItem) -> Option<i64> {
    match item.target {
        Some(ContentsTarget::Segment { position }) => Some(position),
        _ => None,
    }
}

fn segments(bytes: &[u8]) -> usize {
    epub::EpubImporter
        .extract(bytes, "book.epub")
        .unwrap()
        .segments
        .len()
}

fn contents(bytes: &[u8]) -> Vec<ContentsItem> {
    epub::contents(bytes, segments(bytes))
}

fn titles(items: &[ContentsItem]) -> Vec<(&str, Option<i64>)> {
    items
        .iter()
        .map(|i| (i.title.as_str(), position(i)))
        .collect()
}

/// Three chapters of text (2, 3 and 1 segments), a nav document and an
/// optional extra part of the package.
fn book(
    nav: &str,
    extra_manifest: &str,
    extra_files: &[(&str, &str)],
    spine_attrs: &str,
) -> Vec<u8> {
    let ch1 = xhtml("<h1 id=\"c1\">One</h1><p>a1</p><p>a2</p>");
    let ch2 = xhtml(
        "<h1 id=\"c2\">Two</h1><p>b1</p><h2 id=\"c2s\">Two A</h2><p id=\"mid\">b2</p><p>b3</p>",
    );
    let ch3 = xhtml("<h1>Three</h1><p>c1</p>");
    let mut files: Vec<(&str, &str)> = vec![
        ("OEBPS/ch1.xhtml", &ch1),
        ("OEBPS/text/ch2.xhtml", &ch2),
        ("OEBPS/ch3.xhtml", &ch3),
        ("OEBPS/nav.xhtml", nav),
    ];
    files.extend_from_slice(extra_files);
    let manifest = format!(
        r#"<item id="n" href="nav.xhtml" {XHTML} properties="nav"/><item id="c1" href="ch1.xhtml" {XHTML}/><item id="c2" href="text/ch2.xhtml" {XHTML}/><item id="c3" href="ch3.xhtml" {XHTML}/>{extra_manifest}"#
    );
    epub_raw(
        &manifest,
        spine_attrs,
        r#"<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>"#,
        &files,
    )
}

fn nav(list: &str) -> String {
    xhtml(&format!(
        r#"<nav epub:type="toc"><h1>Contents</h1>{list}</nav><nav epub:type="landmarks"><ol><li><a href="ch3.xhtml">Landmark only</a></li></ol></nav>"#
    ))
}

#[test]
fn an_epub3_navigation_document_gives_the_contents() {
    let nav = nav(
        r#"<ol><li><a href="ch1.xhtml">One</a></li><li><a href="text/ch2.xhtml">Two &amp; more</a></li><li><a href="ch3.xhtml">Three</a></li></ol>"#,
    );
    let items = contents(&book(&nav, "", &[], ""));
    // Chapters start at segments 0, 2 and 5; the landmarks list is not used.
    assert_eq!(
        titles(&items),
        [
            ("One", Some(0)),
            ("Two & more", Some(2)),
            ("Three", Some(5))
        ]
    );
    assert!(items.iter().all(|i| i.children.is_empty()));
    let ids: Vec<_> = items.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, ["n0", "n1", "n2"]);
}

#[test]
fn nesting_is_kept_not_flattened() {
    let nav = nav(r#"<ol><li><a href="ch1.xhtml">One</a></li>
        <li><a href="text/ch2.xhtml">Two</a><ol><li><a href="text/ch2.xhtml#c2s">Two A</a><ol><li><a href="text/ch2.xhtml#mid">Deep</a></li></ol></li></ol></li></ol>"#);
    let items = contents(&book(&nav, "", &[], ""));
    assert_eq!(titles(&items), [("One", Some(0)), ("Two", Some(2))]);
    let two_a = &items[1].children;
    assert_eq!(titles(two_a), [("Two A", Some(3))]);
    assert_eq!(titles(&two_a[0].children), [("Deep", Some(3))]);
}

#[test]
fn a_fragment_maps_to_the_nearest_segment_and_an_unknown_one_to_the_chapter() {
    let nav = nav(
        r#"<ol><li><a href="text/ch2.xhtml#c2">Heading</a></li><li><a href="text/ch2.xhtml#c2s">Sub heading</a></li><li><a href="text/ch2.xhtml#mid">Paragraph</a></li><li><a href="text/ch2.xhtml#nope">Unknown</a></li><li><a href="ch3.xhtml#also-nope">Unknown too</a></li></ol>"#,
    );
    // ch2 = b1(2) b2(3) b3(4) with the two headings before b1 and b2.
    let items = contents(&book(&nav, "", &[], ""));
    assert_eq!(
        titles(&items),
        [
            ("Heading", Some(2)),
            ("Sub heading", Some(3)),
            ("Paragraph", Some(3)),
            ("Unknown", Some(2)),
            ("Unknown too", Some(5)),
        ]
    );
}

#[test]
fn an_epub2_ncx_is_used_when_there_is_no_navigation_document() {
    let ch1 = xhtml("<h1>One</h1><p>a1</p>");
    let ch2 = xhtml("<h1>Two</h1><p>b1</p><p>b2</p>");
    let ncx = r#"<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><docTitle><text>Ignored</text></docTitle><navMap>
      <navPoint id="a" playOrder="1"><navLabel><text>One</text></navLabel><content src="ch1.xhtml"/></navPoint>
      <navPoint id="b" playOrder="2"><navLabel><text>Two</text></navLabel><content src="ch2.xhtml"/>
        <navPoint id="b1" playOrder="3"><navLabel><text>Two &amp; a half</text></navLabel><content src="ch2.xhtml#x"/></navPoint></navPoint></navMap></ncx>"#;
    let ch2 = ch2.replace("<p>b2</p>", "<p id=\"x\">b2</p>");
    let bytes = epub_raw(
        &format!(
            r#"<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="ch1.xhtml" {XHTML}/><item id="c2" href="ch2.xhtml" {XHTML}/>"#
        ),
        r#"toc="ncx""#,
        r#"<itemref idref="c1"/><itemref idref="c2"/>"#,
        &[
            ("OEBPS/ch1.xhtml", &ch1),
            ("OEBPS/ch2.xhtml", &ch2),
            ("OEBPS/toc.ncx", ncx),
        ],
    );
    let items = contents(&bytes);
    assert_eq!(titles(&items), [("One", Some(0)), ("Two", Some(1))]);
    assert_eq!(titles(&items[1].children), [("Two & a half", Some(2))]);
}

#[test]
fn the_navigation_document_wins_over_the_ncx() {
    let nav = nav(r#"<ol><li><a href="ch3.xhtml">From nav</a></li></ol>"#);
    let ncx = r#"<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="a"><navLabel><text>From ncx</text></navLabel><content src="ch1.xhtml"/></navPoint></navMap></ncx>"#;
    let bytes = book(
        &nav,
        r#"<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>"#,
        &[("OEBPS/toc.ncx", ncx)],
        r#"toc="ncx""#,
    );
    assert_eq!(titles(&contents(&bytes)), [("From nav", Some(5))]);
}

#[test]
fn external_scripted_and_escaping_targets_are_ignored() {
    let nav = nav(r#"<ol>
        <li><a href="https://example.org/book">Web</a></li>
        <li><a href="javascript:alert(1)">Script</a></li>
        <li><a href="data:text/html,x">Data</a></li>
        <li><a href="../../../../etc/passwd">Traversal</a></li>
        <li><a href="/etc/passwd">Absolute</a></li>
        <li><a href="not-in-the-book.xhtml">Missing</a></li>
        <li><span>Part</span><ol><li><a href="ch3.xhtml">Kept child</a></li><li><a href="http://x.y/z">External child</a></li></ol></li>
        <li><a href="ch1.xhtml">Fine</a></li></ol>"#);
    let items = contents(&book(&nav, "", &[], ""));
    assert_eq!(titles(&items), [("Part", None), ("Fine", Some(0))]);
    assert_eq!(titles(&items[0].children), [("Kept child", Some(5))]);
}

#[test]
fn a_broken_navigation_document_gives_no_contents_and_the_book_still_imports() {
    for broken in [
        "<html><nav epub:type=\"toc\"><ol><li><a href=\"ch1.xhtml\">One",
        "not xml at all <<<",
        "",
    ] {
        let bytes = book(broken, "", &[], "");
        assert_eq!(segments(&bytes), 6, "the text imports regardless");
        let items = contents(&bytes);
        assert!(items.len() <= 1, "{broken}");
    }
}

#[test]
fn a_book_without_contents_imports_and_reads_normally() {
    let ch1 = xhtml("<h1>One</h1><p>a1</p>");
    let bytes = epub_raw(
        &format!(r#"<item id="c1" href="ch1.xhtml" {XHTML}/>"#),
        "",
        r#"<itemref idref="c1"/>"#,
        &[("OEBPS/ch1.xhtml", &ch1)],
    );
    assert_eq!(segments(&bytes), 1);
    assert!(contents(&bytes).is_empty());
}

#[test]
fn contents_are_dropped_if_the_text_no_longer_matches_what_was_imported() {
    let nav = nav(r#"<ol><li><a href="ch1.xhtml">One</a></li></ol>"#);
    let bytes = book(&nav, "", &[], "");
    assert_eq!(epub::contents(&bytes, segments(&bytes)).len(), 1);
    assert!(epub::contents(&bytes, segments(&bytes) + 1).is_empty());
}

#[test]
fn a_huge_or_deep_contents_is_bounded() {
    let mut list = String::from("<ol>");
    for i in 0..6_000 {
        list.push_str(&format!(r#"<li><a href="ch1.xhtml">Item {i}</a></li>"#));
    }
    list.push_str("</ol>");
    let items = contents(&book(&nav(&list), "", &[], ""));
    assert_eq!(items.len(), 5_000);

    let mut deep = String::new();
    for _ in 0..200 {
        deep.push_str(r#"<ol><li><a href="ch1.xhtml">Level</a>"#);
    }
    for _ in 0..200 {
        deep.push_str("</li></ol>");
    }
    let items = contents(&book(&nav(&deep), "", &[], ""));
    fn depth(items: &[ContentsItem]) -> usize {
        items
            .iter()
            .map(|i| 1 + depth(&i.children))
            .max()
            .unwrap_or(0)
    }
    assert!(depth(&items) <= 12);
}

#[test]
fn the_managed_file_is_read_only_from_its_own_folder_and_within_a_limit() {
    use abiding_word_lib::library::original::read_managed;
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path().join("books").join("src1");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.epub"), b"12345").unwrap();
    let root = temp.path();
    assert_eq!(
        read_managed(root, "src1", "books/src1/a.epub", 100).unwrap(),
        b"12345"
    );
    assert!(
        read_managed(root, "src1", "books/src1/a.epub", 4).is_err(),
        "over the limit"
    );
    assert!(
        read_managed(root, "other", "books/src1/a.epub", 100).is_err(),
        "another source's folder"
    );
    assert!(read_managed(root, "src1", "../books/src1/a.epub", 100).is_err());
    assert!(read_managed(root, "src1", "books/src1/missing.epub", 100).is_err());
}
