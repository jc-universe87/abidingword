//! Reference parsing and detection (English).

use abiding_word_lib::error::AppError;
use abiding_word_lib::scripture::parser::ReferenceParser;

fn parse(text: &str) -> String {
    ReferenceParser::english()
        .parse(text)
        .unwrap_or_else(|e| panic!("{text:?}: {e}"))
        .canonical()
}

#[test]
fn common_english_forms_parse_to_canonical_references() {
    let cases = [
        ("John 15", "JHN.15"),
        ("John 15:7", "JHN.15.7"),
        ("John 15:1-11", "JHN.15.1-JHN.15.11"),
        ("Jn 15:7", "JHN.15.7"),
        ("Romans 8:1", "ROM.8.1"),
        ("Rom 8:1-17", "ROM.8.1-ROM.8.17"),
        ("1 Corinthians 13", "1CO.13"),
        ("1 Cor 13:4-7", "1CO.13.4-1CO.13.7"),
        ("Psalm 23", "PSA.23"),
        ("Ps 23", "PSA.23"),
        ("Psalms 119:105", "PSA.119.105"),
        ("Genesis 1:1", "GEN.1.1"),
    ];
    for (input, expected) in cases {
        assert_eq!(parse(input), expected, "{input}");
    }
}

#[test]
fn spelling_spacing_and_punctuation_variants() {
    let cases = [
        ("john 15:7", "JHN.15.7"),
        ("JOHN 15 : 7", "JHN.15.7"),
        ("Rom. 8:1–17", "ROM.8.1-ROM.8.17"),
        ("Rom 8.28", "ROM.8.28"),
        ("1Cor 13", "1CO.13"),
        ("I John 3:16", "1JN.3.16"),
        ("First John 3:16", "1JN.3.16"),
        ("2 Tim 3:16-17", "2TI.3.16-2TI.3.17"),
        ("Song of Solomon 2:1", "SNG.2.1"),
        ("Rev 22:21.", "REV.22.21"),
    ];
    for (input, expected) in cases {
        assert_eq!(parse(input), expected, "{input}");
    }
}

#[test]
fn ranges_across_chapters_and_whole_chapters() {
    assert_eq!(parse("John 14-16"), "JHN.14-JHN.16");
    assert_eq!(parse("John 15:1-16:4"), "JHN.15.1-JHN.16.4");
    assert_eq!(parse("John 15-16:4"), "JHN.15-JHN.16.4");
}

#[test]
fn one_chapter_books_read_a_single_number_as_a_verse() {
    assert_eq!(parse("Jude 3"), "JUD.1.3");
    assert_eq!(parse("Jude 1:3"), "JUD.1.3");
    assert_eq!(parse("Philemon 4-7"), "PHM.1.4-PHM.1.7");
}

#[test]
fn a_bare_book_name_opens_its_first_chapter() {
    assert_eq!(parse("Romans"), "ROM.1");
    assert_eq!(parse("1 John"), "1JN.1");
}

#[test]
fn invalid_references_are_rejected_with_a_plain_message() {
    for input in [
        "",
        "Jonn 3",
        "Hezekiah 1:1",
        "3:16",
        "John",
        "John 22",
        "John 3:0",
        "John 3:16-3:1",
        "John 0",
        "Psalm 151",
        "Rom 8:1-17 and more",
    ] {
        match ReferenceParser::english().parse(input) {
            Err(AppError::InvalidReference(message)) => {
                assert!(!message.is_empty());
                assert!(!message.contains("regex"), "{message}");
            }
            // "John" alone is a valid bare book name.
            Ok(r) if input == "John" => assert_eq!(r.canonical(), "JHN.1"),
            other => panic!("{input:?} gave {other:?}"),
        }
    }
    let message = ReferenceParser::english()
        .parse("John 22")
        .unwrap_err()
        .to_string();
    assert!(message.contains("21 chapters"), "{message}");
}

#[test]
fn detects_one_reference() {
    let found = ReferenceParser::english().detect("Read John 15:7 today.");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].text, "John 15:7");
    assert_eq!((found[0].start, found[0].end), (5, 14));
    assert_eq!(found[0].reference.canonical, "JHN.15.7");
}

#[test]
fn detects_several_references_with_offsets() {
    let text = "Compare Romans 8:15 with Galatians 4:4-7 and John 1:12.";
    let found = ReferenceParser::english().detect(text);
    let summary: Vec<_> = found
        .iter()
        .map(|d| {
            (
                d.text.as_str(),
                d.start,
                d.end,
                d.reference.canonical.as_str(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            ("Romans 8:15", 8, 19, "ROM.8.15"),
            ("Galatians 4:4-7", 25, 40, "GAL.4.4-GAL.4.7"),
            ("John 1:12", 45, 54, "JHN.1.12"),
        ]
    );
    for d in &found {
        assert_eq!(
            &text[d.start..d.end],
            d.text,
            "ASCII text: offsets are bytes too"
        );
    }
}

#[test]
fn numbered_books_are_not_split_into_two_references() {
    let found = ReferenceParser::english().detect("See 1 John 3:16 and John 3:16.");
    let canon: Vec<_> = found
        .iter()
        .map(|d| d.reference.canonical.as_str())
        .collect();
    assert_eq!(canon, ["1JN.3.16", "JHN.3.16"]);
    assert_eq!(found[0].text, "1 John 3:16");
}

#[test]
fn punctuation_around_references() {
    let found = ReferenceParser::english().detect("(Rom 8:28), Ps. 23; and [Heb 11:1-3]!");
    let canon: Vec<_> = found
        .iter()
        .map(|d| d.reference.canonical.as_str())
        .collect();
    assert_eq!(canon, ["ROM.8.28", "PSA.23", "HEB.11.1-HEB.11.3"]);
}

#[test]
fn ordinary_words_and_impossible_passages_are_not_references() {
    let parser = ReferenceParser::english();
    for text in [
        "We will mark 4 places on the map.",
        "Mr 5 arrived.",
        "It is 5 o'clock and I am 3 minutes late.",
        "John 99:1 does not exist.",
        "Chapter 3 of the report.",
        "Compare John 3. 16 people came.",
    ] {
        let found: Vec<_> = parser
            .detect(text)
            .into_iter()
            .map(|d| d.reference.canonical)
            .collect();
        let allowed: &[&str] = if text.starts_with("Compare John 3.") {
            &["JHN.3"]
        } else {
            &[]
        };
        assert_eq!(found, allowed, "{text}");
    }
}

#[test]
fn offsets_are_utf16_code_units() {
    // “ and — are one UTF-16 unit but three UTF-8 bytes each.
    let text = "“Abide” — John 15:4";
    let found = ReferenceParser::english().detect(text);
    assert_eq!(found.len(), 1);
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let slice = String::from_utf16(&utf16[found[0].start..found[0].end]).unwrap();
    assert_eq!(slice, "John 15:4");
}
