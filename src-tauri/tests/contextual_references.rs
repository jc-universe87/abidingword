//! Contextual references (v0.13.1): bookless references resolved from the
//! source's own explicit references nearby, in the source language's notation,
//! and never without clear context. All text is invented.

use abiding_word_lib::library::passage_index;
use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::parser::{ContextTracker, ReferenceParser};

/// (visible text, canonical) for each reference found, in order.
type Found = Vec<(String, String)>;

fn paragraphs(
    language: ReferenceLanguage,
    sectioned: bool,
    items: &[(&str, Option<&str>, Option<i64>)],
) -> Vec<Found> {
    let parser = ReferenceParser::for_language(language);
    let mut tracker = ContextTracker::new(parser, sectioned);
    items
        .iter()
        .map(|(text, path, page)| {
            tracker
                .next(text, *path, *page)
                .all()
                .into_iter()
                .map(|r| (r.text, r.reference.canonical))
                .collect()
        })
        .collect()
}

fn one(language: ReferenceLanguage, text: &str) -> Found {
    paragraphs(language, true, &[(text, None, None)]).remove(0)
}

fn pairs(list: &[(&str, &str)]) -> Found {
    list.iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect()
}

// --- the context model -----------------------------------------------------------

#[test]
fn an_explicit_reference_establishes_context_for_a_reference_list() {
    assert_eq!(
        one(En, "Read John 15:4; 15:7; 16:1 together."),
        pairs(&[
            ("John 15:4", "JHN.15.4"),
            ("15:7", "JHN.15.7"),
            ("16:1", "JHN.16.1")
        ])
    );
    // a range inherits too, and so does a range across chapters
    assert_eq!(
        one(En, "See John 15:1; 15:5–6; 15:26–16:4."),
        pairs(&[
            ("John 15:1", "JHN.15.1"),
            ("15:5–6", "JHN.15.5-JHN.15.6"),
            ("15:26–16:4", "JHN.15.26-JHN.16.4"),
        ])
    );
}

#[test]
fn the_heading_of_a_section_establishes_its_book() {
    let found = paragraphs(
        En,
        true,
        &[
            (
                "Jesus speaks of the vine.",
                Some("John 15:1–11 — The True Vine"),
                None,
            ),
            (
                "Look at 15:4 and then at 15:5–6.",
                Some("John 15:1–11 — The True Vine"),
                None,
            ),
        ],
    );
    assert_eq!(found[0], pairs(&[]));
    assert_eq!(
        found[1],
        pairs(&[("15:4", "JHN.15.4"), ("15:5–6", "JHN.15.5-JHN.15.6")])
    );
}

#[test]
fn a_new_explicit_book_replaces_the_context() {
    assert_eq!(
        one(
            En,
            "John 3:16 is famous. Paul writes in Romans 8:1; 8:28 too."
        ),
        pairs(&[
            ("John 3:16", "JHN.3.16"),
            ("Romans 8:1", "ROM.8.1"),
            ("8:28", "ROM.8.28")
        ])
    );
    // outside a list, two books in view are ambiguous: nothing is linked
    assert_eq!(
        one(En, "John 3:16 and Romans 8:1 agree; compare 5:8 here."),
        pairs(&[("John 3:16", "JHN.3.16"), ("Romans 8:1", "ROM.8.1")])
    );
}

#[test]
fn a_new_section_without_context_resets_it() {
    let found = paragraphs(
        En,
        true,
        &[
            ("Begin with John 15:1.", Some("Chapter One"), None),
            ("Then 15:4 follows.", Some("Chapter One"), None),
            ("Here 15:4 has no book.", Some("Chapter Two"), None),
        ],
    );
    assert_eq!(found[1], pairs(&[("15:4", "JHN.15.4")]));
    assert_eq!(found[2], pairs(&[]));
}

#[test]
fn context_from_an_earlier_paragraph_expires() {
    let mut items = vec![("Begin with John 15:1.", Some("One"), None)];
    for _ in 0..12 {
        items.push((
            "A paragraph without any reference at all.",
            Some("One"),
            None,
        ));
    }
    items.push(("Much later 15:4 appears.", Some("One"), None));
    let found = paragraphs(En, true, &items);
    assert_eq!(
        found.last().unwrap(),
        &pairs(&[]),
        "eight paragraphs at most"
    );
    // but within reach it still counts
    let near = paragraphs(
        En,
        true,
        &[
            ("Begin with John 15:1.", Some("One"), None),
            ("Nothing here.", Some("One"), None),
            ("Soon 15:4 appears.", Some("One"), None),
        ],
    );
    assert_eq!(near[2], pairs(&[("15:4", "JHN.15.4")]));
}

#[test]
fn a_source_without_sections_carries_context_only_briefly_and_never_across_pages() {
    let found = paragraphs(
        En,
        false,
        &[
            ("Begin with John 15:1.", None, Some(1)),
            ("Then 15:4 follows.", None, Some(1)),
            ("And 15:5 after it.", None, Some(1)),
            ("A new page: 15:6 has no book.", None, Some(2)),
        ],
    );
    assert_eq!(found[1], pairs(&[("15:4", "JHN.15.4")]));
    assert_eq!(found[2], pairs(&[("15:5", "JHN.15.5")]));
    assert_eq!(found[3], pairs(&[]));
}

#[test]
fn without_context_a_bookless_reference_is_never_linked() {
    assert_eq!(one(En, "The meeting chose 3:16 as its motto."), pairs(&[]));
    assert_eq!(one(De, "Das Ergebnis war 3,16 Punkte."), pairs(&[]));
}

// --- false positives ---------------------------------------------------------------

#[test]
fn times_decimals_years_and_numbers_never_become_verses() {
    let heading = Some("John 15:1–11");
    let cases: &[(ReferenceLanguage, &str)] = &[
        (En, "We meet at 10:30 every week."),
        (En, "Doors open from 9:45 until 11:15."),
        (En, "A 3:1 ratio, a score of 2:1, a 5:4 majority."),
        (De, "Das Spiel wurde 3:1 gewonnen."),
        (En, "The service is at 1:30 pm, not 1:30pm."),
        (En, "It starts 10:30 a.m. sharp."),
        (En, "Pi is 3.14 and the year 2026.10 was a date."),
        (En, "Scores of 3:16:2 and 15:4:9 are not verses."),
        (En, "A time of 1:05 is never a verse."),
        (De, "Wir treffen uns um 10:30 Uhr."),
        (De, "Es sind 2,5 km und 3,5 % mehr."),
        (De, "Es kostet € 2,50 oder 2,5,7 Stück."),
        (Fr, "Rendez-vous à 10:30 précises."),
        (Es, "Nos vemos a las 10:30 en punto."),
        (Pt, "Encontro às 10:30 horas."),
        (Ko, "오후 1:30에 모입니다."),
        (Ko, "10:30분에 시작합니다."),
    ];
    for (language, text) in cases {
        let found = paragraphs(*language, true, &[(text, heading, None)]).remove(0);
        assert!(found.is_empty(), "{language:?} {text:?} gave {found:?}");
    }
}

#[test]
fn a_number_after_an_unknown_capitalised_name_is_left_alone() {
    // German "Rom" is the city, not Romans: the number after it is not a verse of the section's book
    let found = paragraphs(
        De,
        true,
        &[(
            "Er reiste nach Rom 4,3 Tage lang.",
            Some("Joh 15,1–11"),
            None,
        )],
    )
    .remove(0);
    assert!(found.is_empty(), "{found:?}");
    // a lead word at the start of a sentence is fine
    let found = paragraphs(De, true, &[("Vgl. 15,4 dazu.", Some("Joh 15,1–11"), None)]).remove(0);
    assert_eq!(found, pairs(&[("15,4", "JHN.15.4")]));
}

// --- each language's own notation -------------------------------------------------------

#[test]
fn english_uses_the_colon_only() {
    assert_eq!(
        one(En, "John 3:16; 3:18 and so 3:16-18."),
        pairs(&[
            ("John 3:16", "JHN.3.16"),
            ("3:18", "JHN.3.18"),
            ("3:16-18", "JHN.3.16-JHN.3.18")
        ])
    );
    // "3.16" is a decimal without a book, even beside one
    assert_eq!(
        one(En, "John 3:16; 3.18."),
        pairs(&[("John 3:16", "JHN.3.16")])
    );
    // a comma joins references in an English list
    assert_eq!(
        one(En, "John 3:16, 4:5"),
        pairs(&[("John 3:16", "JHN.3.16"), ("4:5", "JHN.4.5")])
    );
}

#[test]
fn german_uses_the_comma_and_lists_with_semicolons() {
    assert_eq!(
        one(De, "Joh 3,16; 3,18 und dann 3,16-18."),
        pairs(&[
            ("Joh 3,16", "JHN.3.16"),
            ("3,18", "JHN.3.18"),
            ("3,16-18", "JHN.3.16-JHN.3.18")
        ])
    );
    let found = paragraphs(
        De,
        true,
        &[(
            "Der Weinstock: 15,4 und 15,5–6.",
            Some("Joh 15,1–11 — Der wahre Weinstock"),
            None,
        )],
    )
    .remove(0);
    assert_eq!(
        found,
        pairs(&[("15,4", "JHN.15.4"), ("15,5–6", "JHN.15.5-JHN.15.6")])
    );
    // a comma does not make a German list (it is the verse separator's character), but
    // the paragraph names only John, so the second reference is John's all the same
    assert_eq!(
        one(De, "Joh 3,16, 4,5"),
        pairs(&[("Joh 3,16", "JHN.3.16"), ("4,5", "JHN.4.5")])
    );
    // and with a second book in the paragraph it stays unlinked
    assert_eq!(
        one(De, "Joh 3,16 und Röm 8,1, dazu 4,5"),
        pairs(&[("Joh 3,16", "JHN.3.16"), ("Röm 8,1", "ROM.8.1")])
    );
}

#[test]
fn french_spanish_and_portuguese_use_their_comma_notation() {
    assert_eq!(
        one(Fr, "Jean 3,16 ; 3,18."),
        pairs(&[("Jean 3,16", "JHN.3.16"), ("3,18", "JHN.3.18")])
    );
    assert_eq!(
        one(Es, "Juan 3,16; 3,18."),
        pairs(&[("Juan 3,16", "JHN.3.16"), ("3,18", "JHN.3.18")])
    );
    assert_eq!(
        one(Pt, "João 3:16; 3:18."),
        pairs(&[("João 3:16", "JHN.3.16"), ("3:18", "JHN.3.18")])
    );
}

#[test]
fn korean_uses_its_colon_and_unit_forms() {
    assert_eq!(
        one(Ko, "요한복음 3:16; 3:18 참조"),
        pairs(&[("요한복음 3:16", "JHN.3.16"), ("3:18", "JHN.3.18")])
    );
    let found = paragraphs(
        Ko,
        true,
        &[(
            "여기서 15장 4절과 15장 5-6절을 보라.",
            Some("요한복음 15:1-11 참 포도나무"),
            None,
        )],
    )
    .remove(0);
    assert_eq!(
        found,
        pairs(&[
            ("15장 4절", "JHN.15.4"),
            ("15장 5-6절", "JHN.15.5-JHN.15.6")
        ])
    );
}

// --- the sermon pattern -------------------------------------------------------------

#[test]
fn a_sermon_titled_with_its_passage_resolves_verse_shorthand() {
    let title = Some("John 15:1–11 › Abiding in Christ");
    let found = paragraphs(
        En,
        true,
        &[
            ("In v. 4 Jesus says remain in me.", title, None),
            ("Verse 5 explains why, and 15:6 warns.", title, None),
            ("Then vv. 7–8 promise fruit.", title, None),
        ],
    );
    assert_eq!(found[0], pairs(&[("v. 4", "JHN.15.4")]));
    assert_eq!(
        found[1],
        pairs(&[("Verse 5", "JHN.15.5"), ("15:6", "JHN.15.6")])
    );
    assert_eq!(found[2], pairs(&[("vv. 7–8", "JHN.15.7-JHN.15.8")]));
}

#[test]
fn verse_shorthand_needs_one_chapter_in_view() {
    // the heading spans two chapters: which chapter "v. 4" is in is unclear
    let found = paragraphs(
        En,
        true,
        &[("Here v. 4 matters.", Some("John 15–16"), None)],
    )
    .remove(0);
    assert!(found.is_empty(), "{found:?}");
    // two passages in view
    let found = paragraphs(
        En,
        true,
        &[(
            "Romans 8:28 is often quoted; v. 29 follows.",
            Some("John 15:1–11"),
            None,
        )],
    )
    .remove(0);
    assert_eq!(found, pairs(&[("Romans 8:28", "ROM.8.28")]));
    // no passage at all: "v. 4" is just text (a version number, say)
    assert!(one(En, "Install v. 4 of the program.").is_empty());
}

#[test]
fn verse_shorthand_in_each_language() {
    let cases: &[(ReferenceLanguage, &str, &str, &str)] = &[
        (De, "Joh 15,1–11", "In V. 4 heißt es: Bleibt.", "V. 4"),
        (
            De,
            "Joh 15,1–11",
            "Die Verse 7–8 versprechen Frucht.",
            "Verse 7–8",
        ),
        (Fr, "Jean 15,1-11", "Au v. 4, Jésus dit : demeurez.", "v. 4"),
        (
            Es,
            "Juan 15,1-11",
            "En el versículo 5 lo explica.",
            "versículo 5",
        ),
        (
            Pt,
            "João 15:1-11",
            "No versículo 5 ele explica.",
            "versículo 5",
        ),
        (
            Ko,
            "요한복음 15:1-11",
            "4절에서 예수님은 말씀하신다.",
            "4절",
        ),
    ];
    for (language, heading, text, written) in cases {
        let found = paragraphs(*language, true, &[(text, Some(heading), None)]).remove(0);
        assert_eq!(found.len(), 1, "{language:?} {text:?}: {found:?}");
        assert_eq!(found[0].0, *written, "{language:?}");
        assert!(found[0].1.starts_with("JHN.15."), "{language:?}: {found:?}");
    }
}

// --- the passage index ------------------------------------------------------------

#[test]
fn the_passage_index_stores_contextual_references_with_their_visible_text() {
    let segments = vec![
        (
            "Jesus speaks of the vine.",
            Some("John 15:1–11 — The True Vine"),
            None,
        ),
        (
            "Look at 15:4 and v. 5.",
            Some("John 15:1–11 — The True Vine"),
            None,
        ),
    ];
    let index = passage_index::build(
        "markdown",
        segments,
        En,
        passage_index::SourceFacts::default(),
    );
    let found: Vec<(usize, &str, &str)> = index
        .references
        .iter()
        .map(|(i, r)| (*i, r.text.as_str(), r.reference.canonical.as_str()))
        .collect();
    assert_eq!(found, [(1, "15:4", "JHN.15.4"), (1, "v. 5", "JHN.15.5")]);
}

// --- a sermon's or lecture's main passage ---------------------------------------------

/// The references the passage index finds in each paragraph, for a source of this kind and title.
fn indexed(
    format: &str,
    kind: &str,
    title: &str,
    items: &[(&str, Option<&str>, Option<i64>)],
) -> Vec<Found> {
    let index = passage_index::build(
        format,
        items.iter().copied(),
        En,
        passage_index::SourceFacts {
            kind: Some(kind),
            title,
        },
    );
    let mut out = vec![Found::new(); items.len()];
    for (i, r) in index.references {
        out[i].push((r.text, r.reference.canonical));
    }
    out
}

const SERMON: &[(&str, Option<&str>, Option<i64>)] = &[
    ("John 15:1–11", None, Some(1)),
    ("Abiding in Christ", None, Some(1)),
    ("An introduction that names no passage at all, as sermons often begin, before turning to the text itself.", None, Some(1)),
    ("Much later, 15:4 and v. 5 and then 15:7–8.", None, Some(3)),
];

#[test]
fn a_sermon_whose_title_area_names_one_passage_resolves_later_pages() {
    let found = indexed("pdf", "sermon", "Abiding in Christ", SERMON);
    assert_eq!(
        found[3],
        pairs(&[
            ("15:4", "JHN.15.4"),
            ("v. 5", "JHN.15.5"),
            ("15:7–8", "JHN.15.7-JHN.15.8")
        ])
    );
    // a lecture too, and the title alone is enough
    let found = indexed("pdf", "lecture", "John 15:1–11: Abiding", &SERMON[2..]);
    assert_eq!(found[1].len(), 3, "{found:?}");
}

#[test]
fn only_sermons_and_lectures_have_a_main_passage() {
    for kind in ["book", "article", "notes", "document"] {
        let found = indexed("pdf", kind, "Abiding in Christ", SERMON);
        assert!(found[3].is_empty(), "{kind}: {found:?}");
    }
}

#[test]
fn a_competing_passage_in_the_title_area_gives_no_main_passage() {
    let found = indexed(
        "pdf",
        "sermon",
        "Abiding",
        &[
            ("John 15:1–11 and Romans 8:1–4", None, Some(1)),
            ("Later 15:4 here.", None, Some(2)),
        ],
    );
    assert!(found[1].is_empty(), "{found:?}");
    let found = indexed(
        "pdf",
        "sermon",
        "Romans 8",
        &[
            ("John 15:1–11", None, Some(1)),
            ("Later 15:4 here.", None, Some(2)),
        ],
    );
    assert!(found[1].is_empty(), "{found:?}");
}

#[test]
fn a_long_opening_paragraph_is_not_a_title_line() {
    let found = indexed(
        "pdf",
        "sermon",
        "Sunday Sermon",
        &[
            ("A long opening paragraph mentions John 3:16 in passing and goes on and on without end", None, Some(1)),
            ("Later 15:4 here.", None, Some(2)),
        ],
    );
    assert!(found[1].is_empty(), "{found:?}");
}

#[test]
fn a_reference_in_the_body_never_establishes_a_main_passage() {
    // the opening paragraph is a sentence, not a title line: its reference is incidental
    let found = indexed(
        "pdf",
        "sermon",
        "Sunday Sermon",
        &[
            ("We begin with John 3:16.", None, Some(1)),
            ("Nothing here.", None, Some(1)),
            ("Nothing here either.", None, Some(1)),
            ("Later 15:4 here.", None, Some(2)),
        ],
    );
    assert!(found[3].is_empty(), "{found:?}");
}

#[test]
fn the_main_passage_is_still_weighed_against_other_books_and_section_headings() {
    // another book in the paragraph: ambiguous
    let found = indexed(
        "pdf",
        "sermon",
        "Abiding",
        &[
            ("John 15:1–11", None, Some(1)),
            ("Romans 8:1 says it; compare 5:8 here.", None, Some(2)),
        ],
    );
    assert_eq!(found[1], pairs(&[("Romans 8:1", "ROM.8.1")]));
    // a section heading naming another passage governs its own section
    let found = indexed(
        "markdown",
        "sermon",
        "Abiding",
        &[
            ("John 15:1–11", Some("John 15:1–11"), None),
            ("Here 15:4 is John's.", Some("Abiding"), None),
            ("Here 8:28 is Paul's.", Some("Abiding › Romans 8"), None),
        ],
    );
    assert_eq!(found[1], pairs(&[("15:4", "JHN.15.4")]));
    assert_eq!(found[2], pairs(&[("8:28", "ROM.8.28")]));
}

#[test]
fn verse_shorthand_needs_the_main_passage_to_lie_in_one_chapter() {
    let found = indexed(
        "pdf",
        "sermon",
        "Farewell",
        &[
            ("John 15–16", None, Some(1)),
            ("Later 15:4 and v. 5 here.", None, Some(2)),
        ],
    );
    assert_eq!(
        found[1],
        pairs(&[("15:4", "JHN.15.4")]),
        "the book is clear, the chapter of v. 5 is not"
    );
}
