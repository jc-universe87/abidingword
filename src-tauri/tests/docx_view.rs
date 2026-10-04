//! The formatted DOCX view: what is kept, what is dropped, where links lead,
//! how lists, tables, notes and pictures come out, and that nothing in a
//! document can run, load or reach outside it. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use abiding_word_lib::library::adapters::docx::{self, DocxImporter};
use abiding_word_lib::library::adapters::docx_view::render_part;
use abiding_word_lib::library::adapters::epub_view::{El, EpubItem, Node};
use abiding_word_lib::library::adapters::SourceImportAdapter;
use fixtures::{docx as build, docx_raw};

/// A 1 x 1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

fn styles() -> String {
    format!(
        r#"<?xml version="1.0"?><w:styles {NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Listed"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
</w:styles>"#
    )
}

fn numbering() -> String {
    format!(
        r#"<?xml version="1.0"?><w:numbering {NS}>
<w:abstractNum w:abstractNumId="0">
 <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl>
 <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl>
 <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1">
 <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
 <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="2">
 <w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="upperRoman"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>"#
    )
}

fn footnotes() -> String {
    format!(
        r#"<?xml version="1.0"?><w:footnotes {NS}>
<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
<w:footnote w:id="2"><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The first footnote, about abiding.</w:t></w:r></w:p></w:footnote>
<w:footnote w:id="5"><w:p><w:r><w:t>A second footnote.</w:t></w:r></w:p></w:footnote>
</w:footnotes>"#
    )
}

fn endnotes() -> String {
    format!(
        r#"<?xml version="1.0"?><w:endnotes {NS}>
<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>
<w:endnote w:id="3"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t xml:space="preserve"> An endnote.</w:t></w:r></w:p></w:endnote>
</w:endnotes>"#
    )
}

fn run(text: &str, props: &str) -> String {
    format!(r#"<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

fn para(style: &str, ppr: &str, inner: &str) -> String {
    let style = if style.is_empty() {
        String::new()
    } else {
        format!(r#"<w:pStyle w:val="{style}"/>"#)
    };
    format!("<w:p><w:pPr>{style}{ppr}</w:pPr>{inner}</w:p>")
}

fn plain(text: &str) -> String {
    para("", "", &run(text, ""))
}

fn item(num: i64, level: usize, text: &str) -> String {
    para(
        "",
        &format!(r#"<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr>"#),
        &run(text, ""),
    )
}

fn drawing(rid: &str, alt: &str) -> String {
    format!(
        r#"<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="{alt}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="{rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#
    )
}

fn body() -> String {
    let mut b = String::new();
    b.push_str(&para("Title", "", &run("A Synthetic Study", "")));
    b.push_str(&para(
        "Heading1",
        "",
        r#"<w:bookmarkStart w:id="1" w:name="chapter_one"/><w:r><w:t>Chapter One · Εἰς τὸ ὄνομα</w:t></w:r><w:bookmarkEnd w:id="1"/>"#,
    ));
    b.push_str(&para(
        "",
        "",
        &(run("Plain ", "")
            + &run("bold", "<w:b/>")
            + &run(" ", "")
            + &run("italic", "<w:i/>")
            + &run(" ", "")
            + &run("underline", r#"<w:u w:val="single"/>"#)
            + &run(" ", "")
            + &run("struck", "<w:strike/>")
            + &run(" x", "")
            + &run("2", r#"<w:vertAlign w:val="superscript"/>"#)
            + &run(" H", "")
            + &run("2", r#"<w:vertAlign w:val="subscript"/>"#)
            + &run(" ", "")
            + &run("not bold", r#"<w:b w:val="0"/>"#)
            + &run(" hidden", "<w:vanish/>")),
    ));
    b.push_str(&para(
        "",
        r#"<w:jc w:val="center"/>"#,
        &run("Centred text", ""),
    ));
    b.push_str(&para(
        "",
        r#"<w:ind w:left="720" w:hanging="360"/>"#,
        &run("Indented with a hanging first line", ""),
    ));
    b.push_str(&para(
        "",
        "",
        &run(
            "Greek: Ἐγώ εἰμι ἡ ἄμπελος · Hebrew: אֲנִי הַגֶּפֶן · Korean: 나는 참 포도나무요",
            "",
        ),
    ));
    b.push_str(&para("Heading2", "", &run("Lists", "")));
    b.push_str(&item(1, 0, "First"));
    b.push_str(&item(1, 1, "Nested a"));
    b.push_str(&item(1, 2, "Deep i"));
    b.push_str(&item(1, 1, "Nested b"));
    b.push_str(&item(1, 0, "Second"));
    b.push_str(&plain("Between the lists."));
    b.push_str(&item(1, 0, "Third continues"));
    b.push_str(&plain("A new list follows."));
    b.push_str(&item(3, 0, "Restarted one"));
    b.push_str(&item(3, 0, "Restarted two"));
    b.push_str(&item(2, 0, "Bullet one"));
    b.push_str(&item(2, 1, "Bullet nested"));
    b.push_str(&item(2, 0, "Bullet two"));
    b.push_str(&item(4, 0, "Starts at five"));
    b.push_str(&para("Heading2", "", &run("A table", "")));
    b.push_str(
        r#"<w:tbl><w:tblPr/><w:tblGrid/>
<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Term</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Meaning</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>μένω</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>remain</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>abide</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>stay</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>in a cell list</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>dwell</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>"#,
    );
    b.push_str(&para("Heading2", "", &run("Pictures and links", "")));
    b.push_str(&para(
        "",
        r#"<w:jc w:val="center"/>"#,
        &drawing("rIdImg", "A small picture"),
    ));
    b.push_str(&para("Caption", "", &run("Figure 1. A caption.", "")));
    b.push_str(&para(
        "",
        "",
        &(drawing("rIdMissing", "Absent picture")
            + &drawing("rIdLinked", "Linked picture")
            + &drawing("rIdEscape", "Escaping picture")),
    ));
    b.push_str(&para(
        "",
        "",
        &(run("Go ", "")
            + r##"<w:hyperlink w:anchor="chapter_one"><w:r><w:t>to chapter one</w:t></w:r></w:hyperlink>"##
            + &run(", ", "")
            + r#"<w:hyperlink r:id="rIdWeb"><w:r><w:t>to the web</w:t></w:r></w:hyperlink>"#
            + &run(", ", "")
            + r#"<w:hyperlink w:anchor="nowhere"><w:r><w:t>to nowhere</w:t></w:r></w:hyperlink>"#
            + &run(" and ", "")
            + r#"<w:fldSimple w:instr=" HYPERLINK \l &quot;chapter_one&quot; "><w:r><w:t>by a field</w:t></w:r></w:fldSimple>"#
            + &run(".", "")),
    ));
    b.push_str(&para(
        "",
        "",
        &(run("A note", "")
            + r#"<w:r><w:footnoteReference w:id="2"/></w:r>"#
            + &run(" and an endnote", "")
            + r#"<w:r><w:endnoteReference w:id="3"/></w:r>"#
            + &run(", and another note", "")
            + r#"<w:r><w:footnoteReference w:id="5"/></w:r>"#
            + &run(".", "")),
    ));
    b.push_str(&para("Quote", "", &run("A quotation.", "")));
    b.push_str(&para("Code", "", &run("let x = 1;", "")));
    b.push_str(&para(
        "",
        r#"<w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>"#,
        "",
    ));
    b.push_str(&para(
        "",
        "",
        r#"<w:r><w:br w:type="page"/></w:r><w:r><w:t>After a page break.</w:t></w:r>"#,
    ));
    b.push_str(&para(
        "",
        r#"<w:sectPr><w:type w:val="nextPage"/></w:sectPr>"#,
        &run("Last paragraph of a section.", ""),
    ));
    b.push_str(&para("Heading1", "", &run("Chapter Two", "")));
    b.push_str(&plain("The closing text."));
    b
}

fn rels() -> String {
    r#"<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pic.png"/>
<Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/absent.png"/>
<Relationship Id="rIdLinked" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://evil.example/pixel.png" TargetMode="External"/>
<Relationship Id="rIdEscape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../../../../etc/passwd"/>
<Relationship Id="rIdWeb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/" TargetMode="External"/>
<Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdEn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>"#
        .to_string()
}

fn sample() -> Vec<u8> {
    let (s, n, f, e) = (styles(), numbering(), footnotes(), endnotes());
    build(
        &body(),
        &rels(),
        &[
            ("word/styles.xml", s.as_bytes()),
            ("word/numbering.xml", n.as_bytes()),
            ("word/footnotes.xml", f.as_bytes()),
            ("word/endnotes.xml", e.as_bytes()),
            ("word/media/pic.png", PNG),
        ],
    )
}

// --- helpers to look into a tree -------------------------------------------------

fn walk<'a>(nodes: &'a [Node], f: &mut dyn FnMut(&'a El)) {
    for n in nodes {
        if let Node::El(e) = n {
            f(e);
            walk(&e.c, f);
        }
    }
}

fn find<'a>(nodes: &'a [Node], pred: &dyn Fn(&El) -> bool) -> Vec<&'a El> {
    let mut out = Vec::new();
    walk(nodes, &mut |e| {
        if pred(e) {
            out.push(e);
        }
    });
    out
}

fn tag<'a>(nodes: &'a [Node], t: &str) -> Vec<&'a El> {
    find(nodes, &|e| e.t == t)
}

fn text_of(nodes: &[Node]) -> String {
    let mut out = String::new();
    for n in nodes {
        match n {
            Node::Text(t) => out.push_str(t),
            Node::El(e) => out.push_str(&text_of(&e.c)),
        }
    }
    out
}

fn part(bytes: &[u8], id: &str) -> EpubItem {
    render_part(bytes, id).expect("part renders")
}

fn segments(bytes: &[u8]) -> usize {
    DocxImporter
        .extract(bytes, "a.docx")
        .expect("imports")
        .segments
        .len()
}

// --- import -----------------------------------------------------------------------

#[test]
fn import_reads_text_headings_metadata_and_notes() {
    let doc = DocxImporter.extract(&sample(), "study.docx").unwrap();
    assert_eq!(doc.format, "docx");
    assert_eq!(doc.metadata.title.as_deref(), Some("A Synthetic Study"));
    assert_eq!(doc.metadata.author.as_deref(), Some("Pat Example"));
    assert_eq!(doc.metadata.language.as_deref(), Some("English"));
    assert_eq!(doc.chapter_count, Some(2));
    let texts: Vec<&str> = doc.segments.iter().map(|s| s.text.as_str()).collect();
    assert!(texts.contains(&"A Synthetic Study"));
    // Headings give structure, not segments of their own.
    assert!(!texts.contains(&"Chapter Two"));
    let greek = doc
        .segments
        .iter()
        .find(|s| s.text.contains("Ἐγώ"))
        .unwrap();
    assert!(greek.text.contains("אֲנִי") && greek.text.contains("나는 참 포도나무요"));
    assert_eq!(greek.chapter.as_deref(), Some("Chapter One · Εἰς τὸ ὄνομα"));
    assert_eq!(
        greek.section_path.as_deref(),
        Some("Chapter One · Εἰς τὸ ὄνομα")
    );
    let item = doc.segments.iter().find(|s| s.text == "Nested a").unwrap();
    assert_eq!(
        item.section_path.as_deref(),
        Some("Chapter One · Εἰς τὸ ὄνομα › Lists")
    );
    assert_eq!(item.heading.as_deref(), Some("Lists"));
    // Text of a table's cells, and of the notes after the body.
    assert!(texts.contains(&"remain") && texts.contains(&"in a cell list"));
    let last = texts.len();
    assert_eq!(texts[last - 3], "The first footnote, about abiding.");
    assert_eq!(texts[last - 2], "A second footnote.");
    assert_eq!(texts[last - 1], "An endnote.");
    // Hidden text and a note's own marker are not text.
    assert!(!texts.iter().any(|t| t.contains("hidden")));
    assert!(doc
        .segments
        .iter()
        .find(|s| s.text.starts_with("Plain bold italic"))
        .is_some());
}

#[test]
fn a_file_that_is_not_a_document_is_refused_simply() {
    assert!(DocxImporter.extract(b"not a zip", "x.docx").is_err());
    let empty = docx_raw("", "", &[]);
    let no_doc = {
        // A package with no document part.
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            use std::io::Write;
            let mut zip = zip::ZipWriter::new(&mut cursor);
            zip.start_file("hello.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"hi").unwrap();
            zip.finish().unwrap();
        }
        cursor.into_inner()
    };
    assert!(DocxImporter.extract(&no_doc, "x.docx").is_err());
    // A document part with nothing in it reads as an empty document, not a failure.
    assert_eq!(
        DocxImporter
            .extract(&empty, "x.docx")
            .unwrap()
            .segments
            .len(),
        0
    );
}

// --- structure, contents, anchors ----------------------------------------------------

#[test]
fn contents_follow_the_headings_hierarchy() {
    let bytes = sample();
    let total = segments(&bytes);
    let items = docx::contents(&bytes, total);
    let titles: Vec<&str> = items.iter().map(|i| i.title.as_str()).collect();
    assert_eq!(titles, vec!["Chapter One · Εἰς τὸ ὄνομα", "Chapter Two"]);
    let kids: Vec<&str> = items[0].children.iter().map(|i| i.title.as_str()).collect();
    assert_eq!(kids, vec!["Lists", "A table", "Pictures and links"]);
    // A stale count (the text no longer matches the import) gives none rather than wrong places.
    assert!(docx::contents(&bytes, total + 1).is_empty());
}

#[test]
fn structure_places_every_id_in_the_extracted_text() {
    let bytes = sample();
    let total = segments(&bytes);
    let structure = docx::structure(&bytes, total);
    let ids: Vec<&str> = structure.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec!["d0", "notes"]);
    assert_eq!(structure[0].start_segment, 0);
    assert_eq!(
        structure[0].start_segment + structure[0].segment_count,
        structure[1].start_segment
    );
    assert_eq!(
        structure[1].start_segment + structure[1].segment_count,
        total as i64
    );
    let body = &structure[0];
    assert!(body.anchors.contains_key("bm-chapter_one"));
    assert!(body.anchors.keys().any(|k| k.starts_with('p')));
    assert!(body.anchors.keys().any(|k| k == "h0"));
    for (id, at) in body.anchors.iter().chain(structure[1].anchors.iter()) {
        assert!(*at >= 0 && (*at as usize) < total, "{id} at {at}");
    }
    assert!(structure[1].anchors.contains_key("fn2") && structure[1].anchors.contains_key("en3"));
    assert!(body.anchors.contains_key("fr2") && body.anchors.contains_key("er3"));
    // Notes live after the body's text.
    assert!(structure[1].anchors["fn2"] >= structure[1].start_segment);
}

// --- rendering ---------------------------------------------------------------------------

#[test]
fn headings_paragraphs_and_text_styles() {
    let item = part(&sample(), "d0");
    let h1: Vec<String> = tag(&item.nodes, "h1")
        .iter()
        .map(|e| text_of(&e.c))
        .collect();
    assert!(
        h1.contains(&"A Synthetic Study".to_string()),
        "title is a top heading: {h1:?}"
    );
    assert!(h1.contains(&"Chapter One · Εἰς τὸ ὄνομα".to_string()));
    assert!(h1.contains(&"Chapter Two".to_string()));
    assert_eq!(tag(&item.nodes, "h2").len(), 3);
    assert!(!tag(&item.nodes, "strong").is_empty());
    let title = find(&item.nodes, &|e| {
        e.t == "h1" && e.a.get("class").is_some_and(|c| c == "aw-title")
    });
    assert_eq!(title.len(), 1);
    // The title's size is the reader's own: the style's 28 points is not applied on top of it.
    assert!(!serde_json::to_string(title[0])
        .unwrap()
        .contains("font-size"));
    assert_eq!(text_of(&tag(&item.nodes, "strong")[0].c), "bold");
    assert_eq!(text_of(&tag(&item.nodes, "em")[0].c), "italic");
    assert_eq!(text_of(&tag(&item.nodes, "u")[0].c), "underline");
    assert_eq!(text_of(&tag(&item.nodes, "s")[0].c), "struck");
    assert!(tag(&item.nodes, "sup").iter().any(|e| text_of(&e.c) == "2"));
    assert!(tag(&item.nodes, "sub").iter().any(|e| text_of(&e.c) == "2"));
    // "not bold" turned bold off; hidden text is not drawn.
    let all = text_of(&item.nodes);
    assert!(all.contains("not bold") && !all.contains("hidden"));
    assert!(!tag(&item.nodes, "strong")
        .iter()
        .any(|e| text_of(&e.c).contains("not bold")));
    assert!(all.contains("Ἐγώ εἰμι") && all.contains("אֲנִי") && all.contains("나는 참"));
    // Alignment and indentation.
    let centred = find(&item.nodes, &|e| {
        e.a.get("style")
            .is_some_and(|s| s.contains("text-align:center"))
            && e.t == "p"
    });
    assert!(!centred.is_empty());
    let indented = find(&item.nodes, &|e| {
        e.a.get("style").is_some_and(|s| {
            s.contains("margin-inline-start:48px") && s.contains("text-indent:-24px")
        })
    });
    assert_eq!(indented.len(), 1);
    // Block-like styles, a rule and page / section breaks.
    assert_eq!(tag(&item.nodes, "blockquote").len(), 1);
    assert_eq!(
        find(&item.nodes, &|e| e
            .a
            .get("class")
            .is_some_and(|c| c == "aw-code"))
        .len(),
        1
    );
    assert_eq!(tag(&item.nodes, "hr").len(), 3);
    assert_eq!(
        find(&item.nodes, &|e| e
            .a
            .get("role")
            .is_some_and(|r| r == "doc-pagebreak"))
        .len(),
        2
    );
}

#[test]
fn lists_keep_their_structure_numbering_and_restarts() {
    let item = part(&sample(), "d0");
    let ols = tag(&item.nodes, "ol");
    // The first list (with its nested levels), its continuation, the restart, and "starts at five".
    assert!(ols.len() >= 4);
    let first = ols[0];
    assert!(!first.a.contains_key("start"));
    assert_eq!(first.c.len(), 2, "two top-level items: First, Second");
    let nested = tag(&first.c, "ol");
    assert_eq!(nested.len(), 2, "two nested levels below the first");
    assert_eq!(nested[0].a.get("type").map(String::as_str), Some("a"));
    let deep = tag(&nested[0].c, "ol");
    assert_eq!(deep.len(), 1);
    assert_eq!(deep[0].a.get("type").map(String::as_str), Some("i"));
    // The deeper list sits inside an item of the one above, not beside it.
    assert_eq!(
        first
            .c
            .iter()
            .filter(|n| matches!(n, Node::El(e) if e.t == "li"))
            .count(),
        2
    );
    // After a paragraph in between, the same list carries on at 3.
    let continued = ols
        .iter()
        .find(|o| text_of(&o.c) == "Third continues")
        .unwrap();
    assert_eq!(continued.a.get("start").map(String::as_str), Some("3"));
    // A new numbering that restarts begins at 1 again.
    let restarted = ols
        .iter()
        .find(|o| text_of(&o.c).starts_with("Restarted one"))
        .unwrap();
    assert!(!restarted.a.contains_key("start"));
    assert_eq!(restarted.c.len(), 2);
    // A list that starts elsewhere, and its style.
    let five = ols
        .iter()
        .find(|o| text_of(&o.c) == "Starts at five")
        .unwrap();
    assert_eq!(five.a.get("start").map(String::as_str), Some("5"));
    assert_eq!(five.a.get("type").map(String::as_str), Some("I"));
    // Bullets are lists too, nested.
    let uls = tag(&item.nodes, "ul");
    let bullets = uls
        .iter()
        .find(|u| text_of(&u.c).starts_with("Bullet one"))
        .unwrap();
    assert_eq!(tag(&bullets.c, "ul").len(), 1);
    assert_eq!(bullets.c.len(), 2);
    // Items are real list items with an id for the text they are.
    assert!(tag(&first.c, "li").iter().all(|li| li.a.contains_key("id")));
}

#[test]
fn tables_have_headers_spans_and_nested_content() {
    let item = part(&sample(), "d0");
    let tables = tag(&item.nodes, "table");
    assert_eq!(tables.len(), 1);
    let table = tables[0];
    assert_eq!(tag(&table.c, "thead").len(), 1);
    let th = tag(&table.c, "th");
    assert_eq!(th.len(), 2);
    assert!(th
        .iter()
        .all(|c| c.a.get("scope").is_some_and(|s| s == "col")));
    assert!(th
        .iter()
        .any(|c| c.a.get("colSpan").is_some_and(|s| s == "2")));
    let merged = find(&table.c, &|e| {
        e.t == "td" && e.a.get("rowSpan").is_some_and(|s| s == "2")
    });
    assert_eq!(merged.len(), 1);
    assert_eq!(text_of(&merged[0].c), "μένω");
    // The continued cell is not drawn again: the third row has two cells.
    let rows = tag(&table.c, "tr");
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2].c.len(), 2);
    // A paragraph and a list in one cell.
    let cell = rows[2]
        .c
        .iter()
        .find_map(|n| match n {
            Node::El(e) if text_of(&e.c).starts_with("stay") => Some(e),
            _ => None,
        })
        .unwrap();
    assert!(!tag(&cell.c, "p").is_empty() || !cell.c.is_empty());
    assert_eq!(tag(&cell.c, "ul").len(), 1);
}

#[test]
fn pictures_come_from_the_package_and_nothing_else() {
    let item = part(&sample(), "d0");
    let imgs = tag(&item.nodes, "img");
    assert_eq!(imgs.len(), 1);
    let src = imgs[0].a.get("src").unwrap();
    assert!(src.starts_with("data:image/png;base64,"));
    assert_eq!(
        imgs[0].a.get("alt").map(String::as_str),
        Some("A small picture")
    );
    // 1905000 x 952500 EMU is 200 x 100 pixels: the shape is kept.
    assert_eq!(imgs[0].a.get("width").map(String::as_str), Some("200"));
    assert_eq!(imgs[0].a.get("height").map(String::as_str), Some("100"));
    // The caption belongs to the picture.
    let figure = tag(&item.nodes, "figure");
    assert_eq!(figure.len(), 1);
    assert_eq!(
        text_of(&tag(&figure[0].c, "figcaption")[0].c),
        "Figure 1. A caption."
    );
    // Missing, linked from outside and escaping pictures are replaced by their description.
    assert_eq!(item.missing_images, 3);
    let stand_ins = find(&item.nodes, &|e| {
        e.a.get("class").is_some_and(|c| c == "aw-missing-image")
    });
    let alts: Vec<String> = stand_ins.iter().map(|e| text_of(&e.c)).collect();
    assert_eq!(
        alts,
        vec!["Absent picture", "Linked picture", "Escaping picture"]
    );
    let json = serde_json::to_string(&item).unwrap();
    assert!(!json.contains("evil.example") && !json.contains("etc/passwd"));
}

#[test]
fn links_lead_to_bookmarks_and_the_web_is_left_inert() {
    let bytes = sample();
    let item = part(&bytes, "d0");
    let links = tag(&item.nodes, "a");
    let leads: Vec<(String, String)> = links
        .iter()
        .filter(|a| !a.a.contains_key("role"))
        .map(|a| {
            (
                text_of(&a.c),
                format!(
                    "{}#{}",
                    a.l.as_ref().unwrap().item,
                    a.l.as_ref().unwrap().id.clone().unwrap_or_default()
                ),
            )
        })
        .collect();
    assert_eq!(
        leads,
        vec![
            (
                "to chapter one".to_string(),
                "d0#bm-chapter_one".to_string()
            ),
            ("by a field".to_string(), "d0#bm-chapter_one".to_string()),
        ]
    );
    // The web link, and a link to a bookmark that is not there, keep their text and are not links.
    let all = text_of(&item.nodes);
    assert!(all.contains("to the web") && all.contains("to nowhere"));
    assert!(
        find(&item.nodes, &|e| e.t == "span"
            && e.a.get("id").is_some_and(|i| i == "bm-chapter_one"))
        .len()
            == 1
    );
    // Nothing carries an address of its own.
    assert!(links.iter().all(|a| !a.a.contains_key("href")));
    assert!(!serde_json::to_string(&item)
        .unwrap()
        .contains("example.org"));
}

#[test]
fn notes_lead_both_ways() {
    let bytes = sample();
    let body = part(&bytes, "d0");
    let refs = find(&body.nodes, &|e| {
        e.a.get("role").is_some_and(|r| r == "doc-noteref")
    });
    let seen: Vec<(String, String)> = refs
        .iter()
        .map(|a| (text_of(&a.c), a.l.as_ref().unwrap().id.clone().unwrap()))
        .collect();
    // Footnotes number 1, 2 in the order referred to; endnotes are lower-case roman numerals.
    assert_eq!(
        seen,
        vec![
            ("1".to_string(), "fn2".to_string()),
            ("i".to_string(), "en3".to_string()),
            ("2".to_string(), "fn5".to_string())
        ]
    );
    assert!(refs.iter().all(|a| a.l.as_ref().unwrap().item == "notes"));
    assert!(refs.iter().all(|a| a.a.contains_key("id")));
    let notes = part(&bytes, "notes");
    let lis = tag(&notes.nodes, "li");
    let ids: Vec<&str> = lis.iter().map(|l| l.a["id"].as_str()).collect();
    assert_eq!(ids, vec!["fn2", "fn5", "en3"]);
    assert!(
        text_of(&lis[0].c).starts_with(" The first footnote, about abiding.")
            || text_of(&lis[0].c).contains("The first footnote, about abiding.")
    );
    let backs = find(&notes.nodes, &|e| {
        e.a.get("role").is_some_and(|r| r == "doc-backlink")
    });
    assert_eq!(backs.len(), 3);
    assert_eq!(backs[0].l.as_ref().unwrap().item, "d0");
    assert_eq!(backs[0].l.as_ref().unwrap().id.as_deref(), Some("fr2"));
    // Endnotes are in a list numbered in roman numerals.
    assert!(tag(&notes.nodes, "ol")
        .iter()
        .any(|o| o.a.get("type").is_some_and(|t| t == "i")));
}

#[test]
fn unknown_parts_and_unsupported_objects_are_ignored_safely() {
    let hostile = r#"
<w:p><w:r><w:t>Before</w:t></w:r></w:p>
<w:p><w:r><w:object><w:t>OLE TEXT</w:t></w:object></w:r></w:p>
<w:p><w:r><mc:AlternateContent><mc:Choice><w:t>choice</w:t></mc:Choice><mc:Fallback><w:t>FALLBACK DUPLICATE</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>
<w:p><w:r><w:drawing><wp:anchor><a:graphic><a:graphicData><w:txbxContent><w:p><w:r><w:t>TEXT BOX TEXT</w:t></w:r></w:p></w:txbxContent></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
<w:p><m:oMathPara><m:oMath><m:r><m:t>E=mc2</m:t></m:r></m:oMath></m:oMathPara></w:p>
<w:p><w:del><w:r><w:delText>DELETED</w:delText></w:r></w:del><w:ins><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> INCLUDETEXT "file:///etc/passwd" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field result</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt; &amp; text</w:t></w:r></w:p>
<w:sectPr/>"#;
    let bytes = build(hostile, "", &[]);
    let item = part(&bytes, "d0");
    let all = text_of(&item.nodes);
    for gone in [
        "OLE TEXT",
        "FALLBACK DUPLICATE",
        "TEXT BOX TEXT",
        "E=mc2",
        "DELETED",
        "etc/passwd",
        "INCLUDETEXT",
    ] {
        assert!(!all.contains(gone), "{gone} is not drawn");
    }
    for kept in [
        "Before",
        "choice",
        "inserted",
        "field result",
        "<script>alert(1)</script> & text",
    ] {
        assert!(all.contains(kept), "{kept} is kept: {all}");
    }
    // Text stays text: no element named script, no handlers, no addresses.
    assert!(tag(&item.nodes, "script").is_empty());
    let json = serde_json::to_string(&item).unwrap();
    assert!(!json.contains("onclick") && !json.contains("href"));
}

#[test]
fn damaged_parts_and_relationships_cost_only_what_they_carry() {
    // Broken styles, numbering, notes and relationships: the text still reads.
    let body = para("Heading1", "", &run("Heading", ""))
        + &item(1, 0, "Item")
        + &plain("Body.")
        + &para("", "", &drawing("rIdImg", "Pic"));
    let bytes = build(
        &body,
        "<<< not a relationships part >>>",
        &[
            (
                "word/styles.xml",
                b"<w:styles><w:style w:styleId=\"Heading1\"",
            ),
            ("word/numbering.xml", b"not xml at all"),
            ("word/footnotes.xml", &[0xff, 0xfe, 0x00]),
            ("word/media/pic.png", PNG),
        ],
    );
    let doc = DocxImporter.extract(&bytes, "a.docx").unwrap();
    let texts: Vec<&str> = doc.segments.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(texts, vec!["Heading", "Item", "Body."]);
    let item = part(&bytes, "d0");
    // Without its style the heading is a plain paragraph; without numbering the item is a list item.
    assert!(text_of(&item.nodes).contains("Heading") && text_of(&item.nodes).contains("Item"));
    assert!(tag(&item.nodes, "img").is_empty());
    assert_eq!(item.missing_images, 1);

    // A truncated document keeps what was read.
    let full = docx_raw("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Kept text</w:t></w:r></w:p><w:p><w:r><w:t>Cut", "", &[]);
    let kept = DocxImporter.extract(&full, "a.docx").unwrap();
    assert!(kept.segments.iter().any(|s| s.text == "Kept text"));
}

#[test]
fn unknown_part_ids_are_refused() {
    let bytes = sample();
    assert!(render_part(&bytes, "d99").is_err());
    assert!(render_part(&bytes, "../../x").is_err());
    let no_notes = build(&plain("Only text."), "", &[]);
    assert!(render_part(&no_notes, "notes").is_err());
    assert!(render_part(b"not a zip", "d0").is_err());
}

#[test]
fn a_long_document_is_split_into_parts_that_agree_with_the_text() {
    let mut b = String::new();
    for chapter in 0..12 {
        b.push_str(&para(
            "Heading1",
            "",
            &run(&format!("Chapter {chapter}"), ""),
        ));
        for i in 0..150 {
            b.push_str(&plain(&format!(
                "Paragraph {i} of chapter {chapter} — Ἐγώ εἰμι."
            )));
        }
    }
    let bytes = build(&b, "", &[("word/styles.xml", styles().as_bytes())]);
    let total = segments(&bytes);
    assert_eq!(total, 12 * 150);
    let structure = docx::structure(&bytes, total);
    assert!(structure.len() >= 6, "{} parts", structure.len());
    let mut next = 0i64;
    for s in &structure {
        assert_eq!(s.start_segment, next);
        next = s.start_segment + s.segment_count;
        for at in s.anchors.values() {
            assert!(
                *at >= s.start_segment && *at < s.start_segment + s.segment_count.max(1),
                "anchor inside its part"
            );
        }
        // Every part renders, and no part is enormous.
        let item = part(&bytes, &s.id);
        assert!(tag(&item.nodes, "p").len() <= 700);
    }
    assert_eq!(next, total as i64);
    // Every paragraph is drawn exactly once across the parts.
    let drawn: usize = structure
        .iter()
        .map(|s| tag(&part(&bytes, &s.id).nodes, "p").len())
        .sum();
    assert_eq!(drawn, total);
}

#[test]
fn a_table_heavy_document_stays_bounded() {
    let mut b = String::new();
    for t in 0..40 {
        b.push_str("<w:tbl><w:tblPr/><w:tblGrid/>");
        for r in 0..20 {
            b.push_str("<w:tr>");
            for c in 0..5 {
                b.push_str(&format!(
                    r#"<w:tc><w:p><w:r><w:t>t{t} r{r} c{c}</w:t></w:r></w:p></w:tc>"#
                ));
            }
            b.push_str("</w:tr>");
        }
        b.push_str("</w:tbl>");
        b.push_str(&plain("Between."));
    }
    let bytes = build(&b, "", &[]);
    let total = segments(&bytes);
    assert_eq!(total, 40 * 100 + 40);
    let structure = docx::structure(&bytes, total);
    assert!(structure.len() >= 2);
    let cells: usize = structure
        .iter()
        .map(|s| tag(&part(&bytes, &s.id).nodes, "td").len())
        .sum();
    assert_eq!(cells, 40 * 100);
}

#[test]
fn paragraph_styles_stay_inside_the_page() {
    let wild = format!(
        r#"{}{}{}"#,
        para(
            "",
            r#"<w:ind w:left="99999999" w:right="99999999" w:firstLine="99999999"/><w:spacing w:before="99999999" w:after="-500" w:line="9999"/>"#,
            &run("Extreme margins", "")
        ),
        para(
            "",
            "",
            &(run("Huge", r#"<w:sz w:val="9999"/><w:color w:val="FFFFFF"/>"#)
                + &run(" tiny", r#"<w:sz w:val="2"/><w:color w:val="112233"/>"#))
        ),
        para(
            "",
            "",
            &run("Injected", r#"<w:color w:val="red;position:fixed"/>"#)
        ),
    );
    let item = part(&build(&wild, "", &[]), "d0");
    let json = serde_json::to_string(&item).unwrap();
    for bad in ["position", "fixed", "99999999", "red;"] {
        assert!(!json.contains(bad), "{bad} must not appear");
    }
    // White text on the white page is not honoured; size is bounded.
    assert!(!json.contains("#ffffff"));
    assert!(json.contains("font-size:300%") && json.contains("font-size:50%"));
    assert!(json.contains("margin-inline-start:360px"));
}

#[test]
fn every_place_the_structure_names_is_an_element_of_the_drawn_part() {
    // Reading and Original find each other through these ids: one that is not drawn would land at the top of the part.
    let bytes = sample();
    let total = segments(&bytes);
    for s in docx::structure(&bytes, total) {
        let item = part(&bytes, &s.id);
        let ids: std::collections::HashSet<&str> = find(&item.nodes, &|e| e.a.contains_key("id"))
            .iter()
            .map(|e| e.a["id"].as_str())
            .collect();
        for id in s.anchors.keys() {
            assert!(ids.contains(id.as_str()), "{id} is drawn in {}", s.id);
        }
    }
    // Table cells included.
    let mut b = String::new();
    b.push_str(r#"<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>Only cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#);
    let table = build(&b, "", &[]);
    let structure = docx::structure(&table, 1);
    let item = part(&table, "d0");
    let cell_ids = find(&item.nodes, &|e| e.t == "p" && e.a.contains_key("id"));
    assert_eq!(cell_ids.len(), 1);
    assert!(structure[0].anchors.contains_key(&cell_ids[0].a["id"]));
}
