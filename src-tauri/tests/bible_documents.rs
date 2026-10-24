//! Bible documents (v0.23): PDF, EPUB, DOCX, Markdown and plain text read as
//! Bibles, with their verses found (or not) and traced to the original.
//!
//! Every text here is invented for the tests ("Ruth 1:3 — invented words"):
//! no Bible text is used. The books and their verse counts are real, because
//! the recogniser checks chapters against the standard counts.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::path::Path;

use abiding_word_lib::scripture::canon;
use abiding_word_lib::scripture::documents::{self, DocumentFile};
use abiding_word_lib::scripture::import::Severity;
use abiding_word_lib::scripture::structure::{self, Corrections, Recognition};

fn read(name: &str, bytes: &[u8]) -> DocumentFile {
    let extension = name.rsplit('.').next().unwrap();
    documents::read_bytes(
        Path::new(name),
        name,
        extension,
        bytes,
        bytes.len() as u64,
        0,
    )
    .unwrap()
}

fn recognise(file: &DocumentFile) -> Recognition {
    structure::recognise(
        &file.units,
        file.metadata.language.as_deref(),
        &Corrections::default(),
    )
}

/// The invented text of a verse.
fn words(book: &str, chapter: u16, verse: u16) -> String {
    format!("Invented words of {book} {chapter}:{verse} for testing.")
}

fn verse(r: &Recognition, code: &str, chapter: u16, verse: u16) -> Option<String> {
    let book = canon::by_code(code).unwrap();
    r.content
        .books
        .get(&book.ordinal)?
        .chapters
        .get(&chapter)?
        .verses
        .get(&verse)
        .cloned()
}

fn errors(r: &Recognition) -> Vec<String> {
    r.content
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .map(|i| format!("{:?}: {}", i.code, i.message))
        .collect()
}

fn codes(r: &Recognition) -> Vec<String> {
    r.content
        .issues
        .iter()
        .filter_map(|i| i.code.clone())
        .collect()
}

/// Ruth (4 chapters: 22, 23, 18, 22 verses) as text: book heading, chapter
/// headings, one verse per line.
fn ruth_lines(heading: impl Fn(u16) -> String) -> String {
    let mut text = String::from("Ruth\n\n");
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        text.push_str(&heading(chapter));
        text.push_str("\n\n");
        for v in 1..=count {
            text.push_str(&format!("{v} {}\n", words("Ruth", chapter, v)));
        }
        text.push('\n');
    }
    text
}

fn assert_whole_ruth(r: &Recognition) {
    assert!(errors(r).is_empty(), "{:?}", errors(r));
    assert_eq!(r.verse_count(), 85);
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        for v in 1..=count {
            assert_eq!(
                verse(r, "RUT", chapter, v).as_deref(),
                Some(words("Ruth", chapter, v).as_str()),
                "Ruth {chapter}:{v}"
            );
        }
    }
    assert!(r.usable());
}

#[test]
fn plain_text_with_headings_and_verse_lines() {
    let file = read(
        "ruth.txt",
        ruth_lines(|c| format!("Chapter {c}")).as_bytes(),
    );
    let r = recognise(&file);
    assert_whole_ruth(&r);
    assert_eq!(r.books.len(), 1);
    assert_eq!(r.books[0].book, Some("RUT"));
    assert_eq!(r.books[0].chapters, 4);
    // Each verse traces back to its paragraph.
    let origin = r.origins[&(8, 2, 3)];
    assert!(origin.start.segment.is_some());
    assert_eq!(origin.start.page, None);
}

#[test]
fn chapter_headings_in_six_languages() {
    for (heading, book) in [
        (
            Box::new(|c: u16| format!("Kapitel {c}")) as Box<dyn Fn(u16) -> String>,
            "Rut",
        ),
        (Box::new(|c: u16| format!("Chapitre {c}")), "Ruth"),
        (Box::new(|c: u16| format!("Capítulo {c}")), "Rut"),
        (Box::new(|c: u16| format!("제{c}장")), "룻기"),
        (Box::new(|c: u16| format!("CHAPTER {c}")), "RUTH"),
        (Box::new(|c: u16| format!("Ruth {c}")), "Ruth"),
    ] {
        let text = ruth_lines(&heading).replacen("Ruth\n", &format!("{book}\n"), 1);
        let r = recognise(&read("ruth.txt", text.as_bytes()));
        assert_whole_ruth(&r);
        assert_eq!(r.books[0].book, Some("RUT"), "{book}");
    }
}

#[test]
fn printed_bible_layout_chapter_numbers_start_paragraphs() {
    // No chapter headings: each chapter's number starts its first paragraph
    // and stands for verse 1; verses run on in paragraphs.
    let mut text = String::from("Ruth\n\n");
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        let mut paragraph = format!("{chapter} {}", words("Ruth", chapter, 1));
        for v in 2..=count {
            paragraph.push_str(&format!(" {v} {}", words("Ruth", chapter, v)));
            if v % 6 == 0 {
                paragraph.push_str("\n\n");
            }
        }
        text.push_str(&paragraph);
        text.push_str("\n\n");
    }
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert_whole_ruth(&r);
    assert!(r.stats.numbered_chapters >= 3, "{:?}", r.stats);
}

#[test]
fn line_references_name_chapter_and_verse() {
    let mut text = String::new();
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        for v in 1..=count {
            text.push_str(&format!(
                "Ruth {chapter}:{v} {}\n",
                words("Ruth", chapter, v)
            ));
        }
    }
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert_whole_ruth(&r);
}

#[test]
fn markdown_headings() {
    let text = ruth_lines(|c| format!("## Chapter {c}")).replacen("Ruth\n", "# Ruth\n", 1);
    // Markdown joins the lines of a paragraph: verses one per line become one paragraph.
    let r = recognise(&read("ruth.md", text.as_bytes()));
    assert_whole_ruth(&r);
}

/// Psalms 1–3 (6, 12, 8 verses), with a title before Psalm 3's verse 1.
fn psalms_text(title: bool) -> String {
    let mut text = String::from("Psalms\n\n");
    for (psalm, count) in [(1u16, 6u16), (2, 12), (3, 8)] {
        text.push_str(&format!("Psalm {psalm}\n\n"));
        if psalm == 3 && title {
            text.push_str("An invented title for the third psalm.\n\n");
        }
        for v in 1..=count {
            text.push_str(&format!("{v} {}\n", words("Psalm", psalm, v)));
        }
        text.push('\n');
    }
    text
}

#[test]
fn a_psalm_title_before_verse_1_stays_its_title() {
    let r = recognise(&read("psalms.txt", psalms_text(true).as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    let psalms = canon::by_code("PSA").unwrap();
    let three = &r.content.books[&psalms.ordinal].chapters[&3];
    assert_eq!(
        three.superscription.as_deref(),
        Some("An invented title for the third psalm.")
    );
    assert_eq!(three.verses[&1], words("Psalm", 3, 1));
    assert_eq!(r.stats.psalm_titles, 1);
    assert!(codes(&r).contains(&"bibleImport.documentPsalmTitles".to_string()));
}

#[test]
fn a_psalm_whose_verse_1_has_no_number_is_refused_not_guessed() {
    // Title and verse 1 run together with no number between them.
    let text = psalms_text(true).replace(
        "\n1 Invented words of Psalm 3:1",
        "\nInvented words of Psalm 3:1",
    );
    let r = recognise(&read("psalms.txt", text.as_bytes()));
    assert!(
        codes(&r).contains(&"bibleImport.documentPsalmTitle".to_string()),
        "{:?}",
        codes(&r)
    );
    assert!(!r.usable());
}

#[test]
fn verse_1_without_a_number_after_a_heading_is_reported() {
    let text = ruth_lines(|c| format!("Chapter {c}")).replace(
        "\n1 Invented words of Ruth 2:1",
        "\nInvented words of Ruth 2:1",
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert_eq!(
        verse(&r, "RUT", 2, 1).as_deref(),
        Some(words("Ruth", 2, 1).as_str())
    );
    assert_eq!(r.stats.unnumbered_first, 1);
    assert!(codes(&r).contains(&"bibleImport.documentUnnumbered".to_string()));
    assert!(r.usable());
}

#[test]
fn a_missing_verse_is_reported_and_its_neighbours_keep_their_text() {
    // Ruth 2:7's number is missing from the text: its words stay with 2:6 (reported).
    let text = ruth_lines(|c| format!("Chapter {c}")).replace(
        "\n7 Invented words of Ruth 2:7",
        "\nInvented words of Ruth 2:7",
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(verse(&r, "RUT", 2, 7), None);
    assert_eq!(
        verse(&r, "RUT", 2, 6).as_deref(),
        Some(format!("{} {}", words("Ruth", 2, 6), words("Ruth", 2, 7)).as_str())
    );
    assert_eq!(
        verse(&r, "RUT", 2, 8).as_deref(),
        Some(words("Ruth", 2, 8).as_str())
    );
    let missing = r
        .content
        .issues
        .iter()
        .find(|i| i.code.as_deref() == Some("bibleImport.missingVerses"))
        .unwrap();
    assert_eq!(missing.chapter, Some(2));
}

#[test]
fn two_equal_places_for_one_verse_refuse_the_chapter() {
    // "… away. 3 And" twice before verse 4: which is verse 3 cannot be known.
    let text = ruth_lines(|c| format!("Chapter {c}")).replace(
        "\n3 Invented words of Ruth 1:3 for testing.\n",
        "\n3 Invented words of Ruth 1:3. 3 More invented words.\n",
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(
        codes(&r).contains(&"bibleImport.documentAmbiguous".to_string()),
        "{:?}",
        codes(&r)
    );
    assert!(!r.usable());
}

#[test]
fn numbers_inside_the_text_are_not_verse_numbers() {
    // Counts, references and ordinals in verse text stay text.
    let text = ruth_lines(|c| format!("Chapter {c}"))
        .replace(
            "\n4 Invented words of Ruth 1:4 for testing.\n",
            "\n4 Ruth 1:4 lived there 10 years, see chapter 5 and John 5 and the 5th day, 3:5 too.\n",
        )
        .replace(
            "\n9 Invented words of Ruth 1:9 for testing.\n",
            "\n9 Ruth 1:9 invented words; it was 2,000 cubits and 40% of the field.\n",
        );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(
        verse(&r, "RUT", 1, 4).as_deref(),
        Some("Ruth 1:4 lived there 10 years, see chapter 5 and John 5 and the 5th day, 3:5 too.")
    );
    assert_eq!(
        verse(&r, "RUT", 1, 5).as_deref(),
        Some(words("Ruth", 1, 5).as_str())
    );
    assert_eq!(
        verse(&r, "RUT", 1, 9).as_deref(),
        Some("Ruth 1:9 invented words; it was 2,000 cubits and 40% of the field.")
    );
}

#[test]
fn headings_and_notes_inside_chapters_are_left_out() {
    let mut text = String::from("# Ruth\n\n## Chapter 1\n\n");
    for v in 1..=22u16 {
        if v == 6 {
            text.push_str("### An invented section heading\n\n");
        }
        text.push_str(&format!("{v} {}\n\n", words("Ruth", 1, v)));
    }
    text.push_str("## Notes\n\n1 An invented footnote that is not Scripture.\n\n");
    let r = recognise(&read("ruth.md", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(
        verse(&r, "RUT", 1, 5).as_deref(),
        Some(words("Ruth", 1, 5).as_str())
    );
    assert_eq!(
        verse(&r, "RUT", 1, 22).as_deref(),
        Some(words("Ruth", 1, 22).as_str())
    );
    assert_eq!(r.stats.headings, 1);
    assert!(r
        .left_out
        .iter()
        .any(|l| l.reason == "notes" && l.sample.contains("footnote")));
    assert!(r.left_out.iter().any(|l| l.reason == "heading"));
}

#[test]
fn text_before_any_book_is_left_out_and_reported() {
    let text = format!(
        "Preface\n\nAn invented preface with 1 number in it.\n\n{}",
        ruth_lines(|c| format!("Chapter {c}"))
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert_whole_ruth(&r);
    assert!(r
        .left_out
        .iter()
        .any(|l| l.reason == "noBook" && l.sample.contains("preface")));
}

#[test]
fn verse_numbers_without_any_book_give_no_verses() {
    let mut text = String::new();
    for v in 1..=10u16 {
        text.push_str(&format!("{v} An invented line.\n"));
    }
    let r = recognise(&read("plain.txt", text.as_bytes()));
    assert_eq!(r.verse_count(), 0);
    assert!(!r.usable());
    assert!(codes(&r).contains(&"bibleImport.documentNoBook".to_string()));
}

#[test]
fn a_text_that_loses_its_numbers_is_refused_as_too_long() {
    // Ruth 1 with verse numbers to 3, then running text with no numbers at all.
    let mut text =
        String::from("Ruth\n\nChapter 1\n\n1 First invented verse.\n2 Second invented verse.\n3 ");
    for _ in 0..120 {
        text.push_str("An invented sentence with no verse number in it at all. ");
    }
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(
        codes(&r).contains(&"bibleImport.documentLongVerse".to_string()),
        "{:?}",
        codes(&r)
    );
    assert!(!r.usable());
}

#[test]
fn korean_headings_and_verses() {
    let mut text = String::from("룻기\n\n");
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        text.push_str(&format!("제 {chapter} 장\n\n"));
        for v in 1..=count {
            // Korean verses often end without punctuation.
            text.push_str(&format!(
                "{v} 시험을 위해 지어낸 룻기 {chapter}장 {v}절 문장이라 "
            ));
        }
        text.push_str("\n\n");
    }
    let r = recognise(&read("ruth-ko.txt", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(r.verse_count(), 85);
    assert_eq!(
        verse(&r, "RUT", 2, 5).as_deref(),
        Some("시험을 위해 지어낸 룻기 2장 5절 문장이라")
    );
}

#[test]
fn hebrew_right_to_left_text_keeps_its_points() {
    // Obadiah (one chapter, 21 verses), headed in Hebrew, verse text pointed and
    // ended with sof pasuq; bidirectional marks around the numbers.
    let mut text = String::from("עובדיה\n\nפרק א\n\n");
    for v in 1..=21u16 {
        text.push_str(&format!("\u{200F}{v}\u{200F} דְּבַר־בְּדִיקָה מִסְפָּר {v}׃ "));
    }
    let r = recognise(&read("obadiah-he.txt", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(r.books[0].book, Some("OBA"));
    assert_eq!(r.verse_count(), 21);
    // The verse's own number inside its text ("מִסְפָּר 3׃") is not the next verse.
    assert_eq!(verse(&r, "OBA", 1, 3).as_deref(), Some("דְּבַר־בְּדִיקָה מִסְפָּר 3׃"));
}

#[test]
fn greek_book_title() {
    let mut text = String::from("ΙΟΥΔΑ\n\n");
    for v in 1..=25u16 {
        text.push_str(&format!("{v} δοκιμαστικὸς λόγος {v}. "));
    }
    let r = recognise(&read("jude-grc.txt", text.as_bytes()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
    assert_eq!(r.books[0].book, Some("JUD"));
    assert_eq!(r.verse_count(), 25);
}

#[test]
fn corrections_choose_or_leave_out_a_book() {
    // A title the dictionaries do not know, before "Chapter 1".
    let text = ruth_lines(|c| format!("Chapter {c}")).replacen(
        "Ruth\n",
        "The Story of the Moabite Woman\n",
        1,
    );
    let file = read("ruth.txt", text.as_bytes());
    let r = recognise(&file);
    assert_eq!(r.books.len(), 1);
    assert_eq!(r.books[0].detected, None);
    assert_eq!(r.verse_count(), 0);
    // The person says which book it is.
    let mut corrections = Corrections::default();
    corrections.books.insert(0, canon::by_code("RUT"));
    let r = structure::recognise(&file.units, None, &corrections);
    assert_whole_ruth(&r);
    assert_eq!(r.books[0].book, Some("RUT"));
    // … or leaves it out.
    corrections.books.insert(0, None);
    let r = structure::recognise(&file.units, None, &corrections);
    assert_eq!(r.verse_count(), 0);
    assert!(r.books[0].left_out);
}

#[test]
fn a_book_that_begins_twice_is_refused() {
    let text = format!(
        "{}{}",
        ruth_lines(|c| format!("Chapter {c}")),
        ruth_lines(|c| format!("Chapter {c}"))
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(
        codes(&r).contains(&"bibleImport.documentChapterTwice".to_string()),
        "{:?}",
        codes(&r)
    );
    assert!(!codes(&r).contains(&"bibleImport.verseTwice".to_string()));
    assert!(!r.usable());
}

/// Ruth as PDF pages: a running head and a page number on every page, the
/// verses run on, and a verse broken across two pages.
fn ruth_pdf() -> Vec<u8> {
    let mut lines: Vec<String> = vec!["Ruth".into()];
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        lines.push(format!("Chapter {chapter}"));
        for v in 1..=count {
            lines.push(format!("{v} {}", words("Ruth", chapter, v)));
        }
    }
    // Ruth 2:5 is broken over a page end.
    let at = lines
        .iter()
        .position(|l| l.starts_with("5 Invented words of Ruth 2:5"))
        .unwrap();
    lines[at] = "5 Invented words of Ruth 2:5".into();
    lines.insert(at + 1, "for testing.".into());
    let mut pages: Vec<Vec<String>> = Vec::new();
    let mut page: Vec<String> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        page.push(line.clone());
        if page.len() == 9 || i == at {
            pages.push(std::mem::take(&mut page));
        }
    }
    if !page.is_empty() {
        pages.push(page);
    }
    let count = pages.len();
    let pages: Vec<Vec<String>> = pages
        .into_iter()
        .enumerate()
        .map(|(n, mut lines)| {
            lines.insert(0, "THE BOOK OF RUTH".into());
            lines.push(format!("{}", n + 1));
            lines
        })
        .collect();
    assert!(count > 6);
    let refs: Vec<Vec<&str>> = pages
        .iter()
        .map(|p| p.iter().map(String::as_str).collect())
        .collect();
    let refs: Vec<&[&str]> = refs.iter().map(Vec::as_slice).collect();
    fixtures::pdf(&refs, Some("Ruth (invented test text)"), None)
}

#[test]
fn pdf_with_a_text_layer_running_heads_and_a_verse_across_pages() {
    let file = read("ruth.pdf", &ruth_pdf());
    assert_eq!(file.format, "pdf");
    assert!(file.page_count.unwrap() > 6);
    let r = recognise(&file);
    assert_whole_ruth(&r);
    // Running heads and page numbers were taken out, and counted.
    assert!(
        r.stats.page_lines >= 2 * file.page_count.unwrap() as usize - 1,
        "{:?}",
        r.stats
    );
    // The broken verse is whole, and its origin spans two pages.
    let origin = r.origins[&(8, 2, 5)];
    assert_eq!(origin.end.page.unwrap(), origin.start.page.unwrap() + 1);
    // Every verse names its page.
    assert!(r.origins.values().all(|o| o.start.page.is_some()));
}

#[test]
fn a_scanned_pdf_has_pages_but_no_text() {
    let bytes = fixtures::pdf(&[&[], &[], &[]], Some("Scanned"), None);
    let file = read("scanned.pdf", &bytes);
    assert_eq!(file.extraction_status.as_str(), "ocr_required");
    assert_eq!(file.page_count, Some(3));
    assert!(file.segments.is_empty() && file.units.is_empty());
    assert_eq!(recognise(&file).verse_count(), 0);
}

#[test]
fn a_malformed_pdf_is_refused_with_a_message() {
    let error = documents::read_bytes(
        Path::new("x.pdf"),
        "x.pdf",
        "pdf",
        b"%PDF-1.7 not really",
        19,
        0,
    )
    .unwrap_err();
    assert!(format!("{error:?}").contains("library.badPdf"));
    let error = documents::read_bytes(
        Path::new("x.epub"),
        "x.epub",
        "epub",
        b"PK\x03\x04broken",
        10,
        0,
    )
    .unwrap_err();
    assert!(
        format!("{error:?}").contains("library.badEpub"),
        "{error:?}"
    );
    let error = documents::read_bytes(Path::new("x.docx"), "x.docx", "docx", b"not a zip", 9, 0)
        .unwrap_err();
    assert!(
        format!("{error:?}").contains("library.badDocx"),
        "{error:?}"
    );
}

#[test]
fn epub_with_book_and_chapter_headings() {
    let mut chapters = Vec::new();
    let mut bodies = Vec::new();
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        let mut body = String::new();
        if chapter == 1 {
            body.push_str("<h1>Ruth</h1>");
        }
        body.push_str(&format!("<h2>Chapter {chapter}</h2><p>"));
        for v in 1..=count {
            body.push_str(&format!(
                "<sup class=\"v\">{v}</sup>{} ",
                words("Ruth", chapter, v)
            ));
            if v % 5 == 0 {
                body.push_str("</p><p>");
            }
        }
        body.push_str("</p>");
        bodies.push(body);
    }
    let files: Vec<String> = (1..=4).map(|c| format!("c{c}.xhtml")).collect();
    for (i, body) in bodies.iter().enumerate() {
        chapters.push(fixtures::EpubChapter {
            file: &files[i],
            xhtml_body: body,
        });
    }
    let bytes = fixtures::epub(
        "<dc:title>Ruth (invented)</dc:title><dc:language>en</dc:language>",
        &chapters,
        &[0, 1, 2, 3],
    );
    let file = read("ruth.epub", &bytes);
    assert_eq!(file.format, "epub");
    let r = recognise(&file);
    assert_whole_ruth(&r);
    // Origins point at kept segments (paragraphs) of the EPUB.
    let origin = r.origins[&(8, 4, 22)];
    let segment = origin.start.segment.unwrap() as usize;
    assert!(file.segments[segment].text.contains("Ruth 4:22"));
}

#[test]
fn docx_with_headings_numbered_verses_and_footnotes() {
    let heading = |level: u8, text: &str| {
        format!(
            r#"<w:p><w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    let para =
        |text: &str| format!(r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#);
    let mut body = heading(1, "Ruth");
    for (chapter, count) in [(1u16, 22u16), (2, 23), (3, 18), (4, 22)] {
        body.push_str(&heading(2, &format!("Chapter {chapter}")));
        for v in 1..=count {
            let mut text = format!("{v} {}", words("Ruth", chapter, v));
            if chapter == 1 && v == 2 {
                body.push_str(&format!(
                    r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>"#
                ));
                continue;
            }
            text.push(' ');
            body.push_str(&para(&text));
        }
    }
    let styles = br#"<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>"#;
    let notes = br#"<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>3 An invented footnote that must not join a verse.</w:t></w:r></w:p></w:footnote></w:footnotes>"#;
    let rels = r#"<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>"#;
    let bytes = fixtures::docx(
        &body,
        rels,
        &[("word/styles.xml", styles), ("word/footnotes.xml", notes)],
    );
    let file = read("ruth.docx", &bytes);
    assert_eq!(file.format, "docx");
    assert_eq!(file.notes, 1, "the footnote is kept apart");
    let r = recognise(&file);
    assert_whole_ruth(&r);
    assert!(!verse(&r, "RUT", 4, 22).unwrap().contains("footnote"));
}

// --- adding a Bible from documents: the import, the database, removal -----------------

use abiding_word_lib::db::bible_documents::{self as kept_documents, KeptFile};
use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::migrations::{self, MIGRATIONS};
use abiding_word_lib::db::Database;
use abiding_word_lib::scripture::import::{self, ImportOrigin, StagedImport};
use abiding_word_lib::scripture::CommitImport;
use rusqlite::Connection;
use std::path::PathBuf;

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

fn details(staged: &StagedImport, short: &str, as_document: bool) -> CommitImport {
    CommitImport {
        preview_id: staged.id.clone(),
        name: format!("Invented {short}"),
        short_name: short.into(),
        language: "English".into(),
        language_code: Some("en".into()),
        publisher: None,
        copyright_notice: None,
        license_type: None,
        words: Default::default(),
        as_document,
    }
}

fn add(
    conn: &Connection,
    staged: &StagedImport,
    short: &str,
    as_document: bool,
) -> abiding_word_lib::error::AppResult<String> {
    let id = bibles::new_translation_id();
    let stage = staged.documents.as_ref().unwrap();
    let kept: Vec<KeptFile> = stage
        .files
        .iter()
        .enumerate()
        .map(|(i, f)| KeptFile {
            id: format!("{id}-doc-{i}"),
            file_name: format!("{}.{}", i + 1, f.extension),
        })
        .collect();
    kept_documents::commit(
        conn,
        &id,
        &staged.content,
        stage,
        &details(staged, short, as_document),
        &SourceRecord {
            origin: "managed_copy",
            path: Some(format!("sources/bibles/{id}")),
            original_file_name: Some("ruth".into()),
            format: staged.format,
            is_builtin: false,
        },
        &kept,
        !as_document,
    )
    .map(|t| t.id)
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn a_text_bible_is_staged_as_a_document_import_with_its_verses() {
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "ruth.txt",
        ruth_lines(|c| format!("Chapter {c}")).as_bytes(),
    );
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.format, "text");
    let preview = staged.preview(Default::default());
    let document = preview.document.expect("a document preview");
    assert!(document.verses_usable);
    assert_eq!(preview.verse_count, 85);
    assert!(preview.can_import);
    assert_eq!(document.files.len(), 1);
    assert!(!document.files[0].scanned);
    assert!(!document.files[0].keeps_layout);
    // Ordinary text has no word annotations, and none are made up.
    assert_eq!(preview.words.words, 0);
    assert!(!preview.words.indexed);
}

#[test]
fn a_usfm_text_file_is_still_read_as_usfm() {
    let temp = tempfile::tempdir().unwrap();
    let usfm = "\\id RUT\n\\c 1\n\\v 1 Invented words.\n";
    let path = write(temp.path(), "ruth.txt", usfm.as_bytes());
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.format, "usfm");
    assert!(staged.documents.is_none());
}

#[test]
fn documents_and_bible_format_files_together_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let a = write(temp.path(), "ruth.pdf", &ruth_pdf());
    let b = write(temp.path(), "ruth.usfm", b"\\id RUT\n\\c 1\n\\v 1 x\n");
    let error = import::stage(&[a, b], ImportOrigin::UserFiles)
        .err()
        .unwrap();
    assert!(format!("{error:?}").contains("documentMixed"));
}

#[test]
fn added_by_verse_it_reads_as_any_bible_and_remembers_where_each_verse_was() {
    let db = Database::open_in_memory().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = write(temp.path(), "ruth.pdf", &ruth_pdf());
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    db.with_conn(|conn| {
        let id = add(conn, &staged, "RUTHPDF", false).unwrap();
        let translation = bibles::get(conn, &id).unwrap();
        assert_eq!(translation.kind, "structured");
        assert_eq!(translation.import_status, "ready");
        assert_eq!(translation.source_type, "pdf");
        assert_eq!(translation.verse_count, 85);
        let chapter = bibles::chapter(conn, &id, "RUT", 2).unwrap();
        assert_eq!(chapter.verses.len(), 23);
        assert_eq!(chapter.verses[4].text, words("Ruth", 2, 5));
        // The documents and their text are kept, for reading and searching.
        let documents = kept_documents::list(conn, &id).unwrap();
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].view, Some("pdf"));
        assert!(documents[0].segment_count > 80);
        let hits = kept_documents::search(conn, &id, "Ruth 3:7").unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.page_number.is_some()));
        // Ruth 2:5 runs over two pages.
        let origin = kept_documents::origin(conn, &id, abiding_word_lib::scripture::reference::verse_key(8, 2, 5)).unwrap().unwrap();
        assert_eq!(origin.last_page.unwrap(), origin.first_page.unwrap() + 1);
        assert_eq!(origin.document_name, "ruth.pdf");
        // Removing the Bible removes all of it.
        bibles::remove(conn, &id).unwrap();
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_documents"), 0);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_document_segments"), 0);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_verse_origins"), 0);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_document_search WHERE bible_document_search MATCH 'Ruth'"), 0);
        Ok(())
    })
    .unwrap();
}

#[test]
fn added_as_a_document_it_has_no_verses_and_can_be_given_them_later() {
    let db = Database::open_in_memory().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "ruth.md",
        ruth_lines(|c| format!("## Chapter {c}"))
            .replacen("Ruth\n", "# Ruth\n", 1)
            .as_bytes(),
    );
    let staged = import::stage(std::slice::from_ref(&path), ImportOrigin::UserFiles).unwrap();
    db.with_conn(|conn| {
        let id = add(conn, &staged, "RUTHDOC", true).unwrap();
        let translation = bibles::get(conn, &id).unwrap();
        assert_eq!(translation.kind, "document");
        assert_eq!(translation.import_status, "document_only");
        assert_eq!(translation.verse_count, 0);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_verse_texts"), 0);
        assert!(bibles::chapter(conn, &id, "RUT", 1)
            .unwrap()
            .verses
            .is_empty());
        // Its text can be read and searched.
        let documents = kept_documents::list(conn, &id).unwrap();
        assert_eq!(documents[0].view, None);
        let window = kept_documents::segments(conn, &documents[0].id, 0, 10, None).unwrap();
        assert_eq!(
            window.segments.len(),
            4.min(window.total as usize).max(window.segments.len())
        );
        assert!(!kept_documents::search(conn, &id, "invented")
            .unwrap()
            .is_empty());
        // Later: read again for verses, without adding it again.
        let again = import::stage_documents(
            std::slice::from_ref(&path),
            ImportOrigin::Existing {
                translation_id: id.clone(),
            },
        )
        .unwrap();
        let translation = kept_documents::add_verses(
            conn,
            &id,
            &again.content,
            again.documents.as_ref().unwrap(),
        )
        .unwrap();
        assert_eq!(translation.kind, "structured");
        assert_eq!(translation.verse_count, 85);
        assert_eq!(
            bibles::chapter(conn, &id, "RUT", 4).unwrap().verses.len(),
            22
        );
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_verse_origins"), 85);
        Ok(())
    })
    .unwrap();
}

#[test]
fn verses_with_problems_are_never_saved_and_nothing_is_left_behind() {
    let db = Database::open_in_memory().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let text = format!(
        "{}{}",
        ruth_lines(|c| format!("Chapter {c}")),
        ruth_lines(|c| format!("Chapter {c}"))
    );
    let path = write(temp.path(), "ruth.txt", text.as_bytes());
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    assert!(
        !staged
            .preview(Default::default())
            .document
            .unwrap()
            .verses_usable
    );
    db.with_conn(|conn| {
        let error = add(conn, &staged, "BROKEN", false).unwrap_err();
        assert!(format!("{error:?}").contains("hasProblems"));
        assert_eq!(
            count(
                conn,
                "SELECT COUNT(*) FROM bible_translations WHERE short_name = 'BROKEN'"
            ),
            0
        );
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_documents"), 0);
        // As a document it can be added.
        add(conn, &staged, "BROKEN", true).unwrap();
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_cancelled_import_writes_nothing() {
    let db = Database::open_in_memory().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = write(temp.path(), "ruth.pdf", &ruth_pdf());
    let before = db
        .with_conn(|conn| Ok(count(conn, "SELECT COUNT(*) FROM bible_translations")))
        .unwrap();
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    drop(staged);
    db.with_conn(|conn| {
        assert_eq!(
            count(conn, "SELECT COUNT(*) FROM bible_translations"),
            before
        );
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_documents"), 0);
        assert_eq!(
            count(conn, "SELECT COUNT(*) FROM bible_document_segments"),
            0
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_scanned_pdf_can_be_added_to_read_page_by_page() {
    let db = Database::open_in_memory().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = write(
        temp.path(),
        "scan.pdf",
        &fixtures::pdf(&[&[], &[], &[], &[]], Some("Scan"), None),
    );
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    let preview = staged.preview(Default::default());
    let document = preview.document.unwrap();
    assert!(document.files[0].scanned);
    assert_eq!(document.files[0].pages, Some(4));
    assert!(!document.verses_usable);
    assert!(preview.can_import);
    db.with_conn(|conn| {
        let id = add(conn, &staged, "SCAN", true).unwrap();
        let documents = kept_documents::list(conn, &id).unwrap();
        assert_eq!(documents[0].extraction_status, "ocr_required");
        assert_eq!(documents[0].page_count, Some(4));
        assert_eq!(documents[0].segment_count, 0);
        Ok(())
    })
    .unwrap();
}

#[test]
fn corrections_in_the_review_read_the_documents_again() {
    let temp = tempfile::tempdir().unwrap();
    let text = ruth_lines(|c| format!("Chapter {c}")).replacen(
        "Ruth\n",
        "The Story of the Moabite Woman\n",
        1,
    );
    let path = write(temp.path(), "ruth.txt", text.as_bytes());
    let mut staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.content.verse_count(), 0);
    staged.correct(&[(0, Some("RUT".into()))]).unwrap();
    assert_eq!(staged.content.verse_count(), 85);
    let preview = staged.preview(Default::default());
    assert_eq!(preview.document.unwrap().books[0].book, Some("RUT"));
}

/// A dev.42 database (schema 18) with an imported Bible, a note on a verse and
/// a library source, upgraded to schema 19: backed up first, every row kept,
/// the new tables empty.
#[test]
fn a_dev42_database_upgrades_and_keeps_everything() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("abiding-word.db");
    let backups = temp.path().join("pre-migration");
    {
        let mut conn = Connection::open(&path).unwrap();
        migrations::run_with(&mut conn, &MIGRATIONS[..18]).unwrap();
        let t = "2026-10-22T10:00:00.000Z";
        conn.execute_batch(&format!(
            "INSERT INTO bible_translations (id, name, short_name, language, kind, source_type, source_origin,
                 import_status, book_count, verse_count, created_at, updated_at)
             VALUES ('tr-1', 'Invented', 'INV', 'English', 'structured', 'usfm', 'managed_copy', 'ready', 1, 1, '{t}', '{t}');
             INSERT OR IGNORE INTO bible_verses (id, book_id, chapter, verse) VALUES (8001001, 8, 1, 1);
             INSERT INTO bible_verse_texts (translation_id, verse_id, text) VALUES ('tr-1', 8001001, 'Invented words.');"
        ))
        .unwrap();
    }
    let db = Database::open(&path, &backups).unwrap();
    let backup = std::fs::read_dir(&backups)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert!(backup
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("abiding-word-v18-"));
    db.with_conn(|conn| {
        assert_eq!(migrations::current_version(conn).unwrap(), 19);
        let bible = bibles::get(conn, "tr-1").unwrap();
        assert_eq!((bible.kind.as_str(), bible.verse_count), ("structured", 1));
        assert_eq!(
            bibles::chapter(conn, "tr-1", "RUT", 1).unwrap().verses[0].text,
            "Invented words."
        );
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_documents"), 0);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM bible_verse_origins"), 0);
        assert!(kept_documents::list(conn, "tr-1").unwrap().is_empty());
        Ok(())
    })
    .unwrap();
}

// --- Independent review (v0.23): words wrapped onto their own line, weak
// numbers, numbers that look like references, and chapters cut short.

/// Ruth as lines, with verse 1:3 wrapped so its last word stands alone.
fn ruth_with_wrapped_word(word: &str) -> String {
    ruth_lines(|c| format!("Chapter {c}")).replacen(
        &format!("3 {}\n", words("Ruth", 1, 3)),
        &format!("3 {}\n{word}\n", words("Ruth", 1, 3)),
        1,
    )
}

#[test]
fn a_book_name_wrapped_onto_its_own_line_stays_in_the_verse() {
    for word in ["Ruth.", "Ruth", "song.", "Acts"] {
        let r = recognise(&read("ruth.txt", ruth_with_wrapped_word(word).as_bytes()));
        assert_eq!(
            verse(&r, "RUT", 1, 3),
            Some(format!("{} {word}", words("Ruth", 1, 3))),
            "{word}"
        );
        assert_eq!(
            verse(&r, "RUT", 1, 22),
            Some(words("Ruth", 1, 22)),
            "{word}"
        );
        assert_eq!(r.verse_count(), 85, "{word}");
        assert!(errors(&r).is_empty(), "{word}: {:?}", errors(&r));
    }
}

#[test]
fn two_equally_weak_places_for_one_verse_refuse_the_chapter() {
    let text = ruth_lines(|c| format!("Chapter {c}")).replacen(
        &format!("4 {}\n5 {}\n", words("Ruth", 1, 4), words("Ruth", 1, 5)),
        "4 and he gave them 5 loaves 5 and so on\n",
        1,
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(
        codes(&r).contains(&"bibleImport.documentAmbiguous".to_string()),
        "{:?}",
        codes(&r)
    );
    assert!(!r.usable());
}

#[test]
fn a_large_number_starting_a_line_is_not_a_chapter_and_verse() {
    let text = ruth_lines(|c| format!("Chapter {c}")).replacen(
        &format!("3 {}\n", words("Ruth", 1, 3)),
        "3 And they counted\n2,300 days and nights.\n",
        1,
    );
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert_eq!(
        verse(&r, "RUT", 1, 3).as_deref(),
        Some("And they counted 2,300 days and nights.")
    );
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
}

#[test]
fn the_gospel_according_to_saint_mark_names_mark() {
    let mut text = String::from("The Gospel According to Saint Mark\n\nChapter 1\n\n");
    for v in 1..=45u16 {
        text.push_str(&format!("{v} {}\n", words("Mark", 1, v)));
    }
    let r = recognise(&read("mark.txt", text.as_bytes()));
    assert_eq!(r.books[0].book, Some("MRK"));
    assert_eq!(verse(&r, "MRK", 1, 45), Some(words("Mark", 1, 45)));
}

#[test]
fn a_chapter_cut_short_is_refused_and_a_few_verses_short_is_a_warning() {
    // Ruth 1 stops after verse 3 (22 expected): refused.
    let mut text = String::from("Ruth\n\nChapter 1\n\n");
    for v in 1..=3u16 {
        text.push_str(&format!("{v} {}\n", words("Ruth", 1, v)));
    }
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(codes(&r).contains(&"bibleImport.documentChapterShort".to_string()));
    assert!(!r.usable());
    // Ruth 1 with 19 of its 22 verses: another numbering, perhaps: a warning.
    let mut text = String::from("Ruth\n\nChapter 1\n\n");
    for v in 1..=19u16 {
        text.push_str(&format!("{v} {}\n", words("Ruth", 1, v)));
    }
    let r = recognise(&read("ruth.txt", text.as_bytes()));
    assert!(codes(&r).contains(&"bibleImport.documentChapterShort".to_string()));
    assert!(errors(&r).is_empty(), "{:?}", errors(&r));
}
