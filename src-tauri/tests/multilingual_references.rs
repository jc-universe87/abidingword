//! Explicit references in every supported language, in one document, whatever
//! the source's language; the collision and false-positive policy; and local
//! and document context through the real PDF, DOCX and EPUB importers
//! (v0.13.2). All text is invented.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::passage_index::{self, SourceFacts};
use abiding_word_lib::library::{import, CommitSourceImport, SourceType};
use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::recognise::Recogniser;
use rusqlite::Connection;

const ALL: [ReferenceLanguage; 6] = [En, De, Ko, Fr, Es, Pt];

/// The acceptance fixture's explicit references, as written, with what each means.
const FORMS: &[(&str, &str)] = &[
    ("John 15:4", "JHN.15.4"),
    ("Jn 15:5", "JHN.15.5"),
    ("John 15:7-8", "JHN.15.7-JHN.15.8"),
    ("Joh 15,4", "JHN.15.4"),
    ("Johannes 15,5", "JHN.15.5"),
    ("Joh 15,7-8", "JHN.15.7-JHN.15.8"),
    ("Mal 4,3", "MAL.4.3"),
    ("요한복음 15장 4절", "JHN.15.4"),
    ("요 15:5", "JHN.15.5"),
    ("요한복음 15장 7-8절", "JHN.15.7-JHN.15.8"),
    ("요한복음 15장", "JHN.15"),
    ("Jean 15,4", "JHN.15.4"),
    ("Jn 15,5", "JHN.15.5"),
    ("Jean 15,7-8", "JHN.15.7-JHN.15.8"),
    ("Juan 15:4", "JHN.15.4"),
    ("Juan 15:7-8", "JHN.15.7-JHN.15.8"),
    ("João 15:4", "JHN.15.4"),
    ("Jo 15:5", "JHN.15.5"),
    ("João 15:7-8", "JHN.15.7-JHN.15.8"),
];

fn found(language: ReferenceLanguage, text: &str) -> Vec<(String, String)> {
    Recogniser::for_source(language)
        .detect(text)
        .into_iter()
        .map(|r| (r.text, r.reference.canonical))
        .collect()
}

// --- explicit references: one document, every source language ------------------------------

#[test]
fn every_form_is_found_alone_whatever_the_sources_language() {
    for language in ALL {
        for (written, canonical) in FORMS {
            let text = format!("Siehe {written} hier.");
            assert_eq!(
                found(language, &text),
                [(written.to_string(), canonical.to_string())],
                "{written:?} in a {language:?} source"
            );
        }
    }
}

#[test]
fn the_whole_fixture_in_one_document_gives_the_same_index_in_every_language() {
    let paragraphs: Vec<String> = FORMS.iter().map(|(w, _)| format!("Vgl. {w}.")).collect();
    let expected: Vec<(usize, String, String)> = FORMS
        .iter()
        .enumerate()
        .map(|(i, (w, c))| (i, w.to_string(), c.to_string()))
        .collect();
    for language in ALL {
        let index = passage_index::build(
            "text",
            paragraphs.iter().map(|p| (p.as_str(), None, None)),
            language,
            SourceFacts::default(),
        );
        let got: Vec<(usize, String, String)> = index
            .references
            .into_iter()
            .map(|(i, r)| (i, r.text, r.reference.canonical))
            .collect();
        assert_eq!(got, expected, "{language:?}");
    }
    // and all in one paragraph
    let line = FORMS.iter().map(|(w, _)| *w).collect::<Vec<_>>().join("; ");
    for language in ALL {
        let canon: Vec<String> = found(language, &line).into_iter().map(|(_, c)| c).collect();
        let want: Vec<String> = FORMS.iter().map(|(_, c)| c.to_string()).collect();
        assert_eq!(canon, want, "{language:?}");
    }
}

// --- collisions between languages --------------------------------------------------------------

#[test]
fn a_shared_abbreviation_is_settled_by_the_reference_or_the_sources_language_never_by_order() {
    // "Jn" is John in English, French and Spanish, Jonah in Portuguese.
    // Jn 15:5 can only be John (Jonah has four chapters), in any source.
    for language in ALL {
        assert_eq!(
            found(language, "Jn 15:5."),
            [("Jn 15:5".into(), "JHN.15.5".into())],
            "{language:?}"
        );
    }
    // Jn 3:5 could be either: the source language decides, and where it has no say, nothing is linked.
    assert_eq!(found(En, "Jn 3:5."), [("Jn 3:5".into(), "JHN.3.5".into())]);
    assert_eq!(found(Fr, "Jn 3,5."), [("Jn 3,5".into(), "JHN.3.5".into())]);
    assert_eq!(found(Es, "Jn 3:5."), [("Jn 3:5".into(), "JHN.3.5".into())]);
    assert_eq!(found(Pt, "Jn 3:5."), [("Jn 3:5".into(), "JON.3.5".into())]);
    assert!(found(De, "Jn 3:5.").is_empty());
    assert!(found(Ko, "Jn 3:5.").is_empty());
    // repeated reading gives the same answer
    for _ in 0..3 {
        assert!(found(De, "Jn 3:5.").is_empty());
    }
}

#[test]
fn every_contested_abbreviation_follows_the_same_rule() {
    // "Mc": Micah in English, Mark in French, Spanish and Portuguese.
    // Mc 10:2 can only be Mark (Micah has seven chapters).
    for language in ALL {
        assert_eq!(
            found(language, "Mc 10:2."),
            [("Mc 10:2".into(), "MRK.10.2".into())],
            "{language:?}"
        );
    }
    assert_eq!(found(En, "Mc 4:2."), [("Mc 4:2".into(), "MIC.4.2".into())]);
    assert_eq!(found(Es, "Mc 4:2."), [("Mc 4:2".into(), "MRK.4.2".into())]);
    assert!(
        found(De, "Mc 4:2.").is_empty(),
        "German has no say: ambiguous"
    );
    // "Hb": Habakkuk in English, Hebrews in Portuguese. Hb 10:2 can only be Hebrews.
    for language in ALL {
        assert_eq!(
            found(language, "Hb 10:2."),
            [("Hb 10:2".into(), "HEB.10.2".into())],
            "{language:?}"
        );
    }
    assert_eq!(found(En, "Hb 3:2."), [("Hb 3:2".into(), "HAB.3.2".into())]);
    assert_eq!(found(Pt, "Hb 3:2."), [("Hb 3:2".into(), "HEB.3.2".into())]);
    assert!(found(Fr, "Hb 3,2.").is_empty());
    // the full list is exactly these three; a new pack that adds one must add its test here
    let names: Vec<String> = abiding_word_lib::scripture::recognise::contested_names()
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    assert_eq!(names, ["hb", "jn", "mc"]);
}

#[test]
fn ordinary_words_never_become_references_in_any_source() {
    // German prose in a German source: "Rom" is the city, "Am", "Na", "mal" ordinary words
    let german = [
        "Wir werden mal sehen.",
        "Das sind noch mal 4 Dinge.",
        "Mal 5 Minuten warten.",
        "Er reiste nach Rom 4,3 Tage lang.",
        "Am 3,5 Uhr war es dunkel.",
        "Na 2,3 Prozent mehr.",
    ];
    for text in german {
        assert!(
            found(De, text).is_empty(),
            "{text:?} gave {:?}",
            found(De, text)
        );
    }
    // English prose in an English source: "is" and "am" are never Isaiah or Amos
    for text in [
        "It Is 5:3 now.",
        "I Am 3:4 sure.",
        "It is 5:3 now, and I am 3:4 sure.",
    ] {
        assert!(
            found(En, text).is_empty(),
            "{text:?} gave {:?}",
            found(En, text)
        );
    }
    for language in [En, De] {
        for text in ["mal sehen", "noch mal 4 Dinge", "Mal 5 Minuten"] {
            assert!(
                found(language, text).is_empty(),
                "{language:?}: {text:?} gave {:?}",
                found(language, text)
            );
        }
    }
    for language in ALL {
        for text in ["mal sehen", "noch mal 4 Dinge", "Mal 5 Minuten"] {
            assert!(found(language, text).is_empty(), "{language:?}: {text:?}");
        }
    }
}

#[test]
fn another_languages_book_name_needs_a_verse() {
    // a German source: "Johannes 15" (chapter only) is too weak in English, French … and
    // in German itself it is a chapter reference, as before
    assert_eq!(
        found(De, "Johannes 15 hier."),
        [("Johannes 15".into(), "JHN.15".into())]
    );
    assert!(found(En, "Johannes 15 years old.").is_empty());
    assert!(found(Fr, "Juan 15 ans.").is_empty());
    // a Korean full name with its chapter unit is unmistakable
    assert_eq!(
        found(En, "See 요한복음 15장."),
        [("요한복음 15장".into(), "JHN.15".into())]
    );
}

// --- context through the real importers ---------------------------------------------------------

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

fn import(
    conn: &Connection,
    dir: &Path,
    file: &str,
    bytes: &[u8],
    kind: Option<SourceType>,
) -> Vec<(String, String)> {
    let path = dir.join(file);
    fs::write(&path, bytes).unwrap();
    let staged = import::stage(&path).unwrap();
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, &staged);
    library::commit_import(
        conn,
        &id,
        &staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: "Abiding in Christ".into(),
            language: Some("English".into()),
            source_type: kind,
            ..Default::default()
        },
        &relative,
    )
    .unwrap();
    let mut out: Vec<(String, String)> = library::passages(conn, &id)
        .unwrap()
        .into_iter()
        .map(|m| (m.matched_text, m.reference.canonical))
        .collect();
    out.sort();
    out
}

/// What every format of the sermon fixture must resolve.
fn sermon_expected() -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = [
        ("John 15:1-11", "JHN.15.1-JHN.15.11"),
        ("15:4", "JHN.15.4"),
        ("v. 5", "JHN.15.5"),
        ("15:7-8", "JHN.15.7-JHN.15.8"),
        ("Romans 8:1-4", "ROM.8.1-ROM.8.4"),
        ("8:2", "ROM.8.2"),
        ("v. 3", "ROM.8.3"),
    ]
    .iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();
    v.sort();
    v
}

fn docx_paragraph(text: &str, outline: Option<u8>) -> String {
    let p_pr = outline
        .map(|l| format!(r#"<w:pPr><w:outlineLvl w:val="{l}"/></w:pPr>"#))
        .unwrap_or_default();
    format!(r#"<w:p>{p_pr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

#[test]
fn the_sermon_resolves_the_same_in_pdf_docx_and_epub() {
    with_db(|conn, dir| {
        // PDF: no heading metadata at all; the heading lines are visible lines of their own.
        let pdf = fixtures::pdf(
            &[
                &["John 15:1-11", "Abiding in Christ"],
                &["Later 15:4 and v. 5 and 15:7-8."],
                &[
                    "A different section: Romans 8:1-4",
                    "In 8:2 the law of the Spirit of life sets free.",
                    "Then v. 3 speaks of what the law could not do.",
                ],
            ],
            None,
            None,
        );
        assert_eq!(
            import(conn, dir, "sermon.pdf", &pdf, Some(SourceType::Sermon)),
            sermon_expected(),
            "PDF"
        );

        // DOCX with real headings
        let body = [
            docx_paragraph("John 15:1-11", Some(0)),
            docx_paragraph("Later 15:4 and v. 5 and 15:7-8.", None),
            docx_paragraph("A different section: Romans 8:1-4", Some(1)),
            docx_paragraph("In 8:2 the law of the Spirit of life sets free.", None),
            docx_paragraph("Then v. 3 speaks of what the law could not do.", None),
        ]
        .concat();
        let docx = fixtures::docx(&body, "", &[]);
        let mut got = import(conn, dir, "sermon.docx", &docx, Some(SourceType::Sermon));
        // a heading is structure, not a mention: its passage is a section link
        got.retain(|(t, _)| !t.contains("-11") && !t.contains("8:1-4"));
        let mut want = sermon_expected();
        want.retain(|(t, _)| !t.contains("-11") && !t.contains("8:1-4"));
        assert_eq!(got, want, "DOCX with headings");

        // DOCX whose headings are plain paragraphs (no Heading style): like the PDF
        let plain = [
            docx_paragraph("John 15:1-11", None),
            docx_paragraph("Later 15:4 and v. 5 and 15:7-8.", None),
            docx_paragraph("A different section: Romans 8:1-4", None),
            docx_paragraph("In 8:2 the law of the Spirit of life sets free.", None),
            docx_paragraph("Then v. 3 speaks of what the law could not do.", None),
        ]
        .concat();
        let docx = fixtures::docx(&plain, "", &[]);
        assert_eq!(
            import(conn, dir, "plain.docx", &docx, Some(SourceType::Sermon)),
            sermon_expected(),
            "DOCX, plain paragraphs"
        );

        // EPUB with headings
        let epub = fixtures::epub(
            "<dc:title>Sermon</dc:title><dc:language>en</dc:language>",
            &[fixtures::EpubChapter {
                file: "one.xhtml",
                xhtml_body: "<h1>John 15:1-11</h1><p>Later 15:4 and v. 5 and 15:7-8.</p><h2>A different section: Romans 8:1-4</h2><p>In 8:2 the law of the Spirit of life sets free.</p><p>Then v. 3 speaks of what the law could not do.</p>",
            }],
            &[0],
        );
        let mut got = import(conn, dir, "sermon.epub", &epub, Some(SourceType::Sermon));
        got.retain(|(t, _)| !t.contains("-11") && !t.contains("8:1-4"));
        let mut want = sermon_expected();
        want.retain(|(t, _)| !t.contains("-11") && !t.contains("8:1-4"));
        assert_eq!(got, want, "EPUB");
        Ok(())
    })
}

#[test]
fn a_heading_lines_context_does_not_leak() {
    with_db(|conn, dir| {
        // Notes (no document passage): the Romans heading line governs what follows it,
        // until the next heading line, and never further than eight paragraphs.
        let pdf = fixtures::pdf(
            &[
                &[
                    "A different section: Romans 8:1-4",
                    "In 8:2 the law sets free.",
                ],
                &["Application", "Here 8:5 has no book."],
                &[
                    "Romans 8:1-4",
                    "One.",
                    "Two.",
                    "Three.",
                    "Four.",
                    "Five.",
                    "Six.",
                    "Seven.",
                    "Eight.",
                    "Far later 8:6 has none.",
                ],
            ],
            None,
            None,
        );
        let got = import(conn, dir, "notes.pdf", &pdf, None);
        let texts: Vec<&str> = got.iter().map(|(t, _)| t.as_str()).collect();
        assert!(texts.contains(&"8:2"), "{got:?}");
        assert!(
            !texts.contains(&"8:5"),
            "a new heading line ends it: {got:?}"
        );
        assert!(!texts.contains(&"8:6"), "eight paragraphs at most: {got:?}");
        Ok(())
    })
}

#[test]
fn a_multi_chapter_main_passage_resolves_chapter_and_verse_but_not_verse_alone() {
    with_db(|conn, dir| {
        let pdf = fixtures::pdf(
            &[
                &["John 15-16", "The Farewell"],
                &["Plain words of an ordinary paragraph that carries no reference at all."],
                &["Later 15:4 and v. 5 here, in a paragraph long enough to be text."],
            ],
            None,
            None,
        );
        let got = import(conn, dir, "farewell.pdf", &pdf, Some(SourceType::Sermon));
        let texts: Vec<&str> = got.iter().map(|(t, _)| t.as_str()).collect();
        assert!(texts.contains(&"15:4"), "{got:?}");
        assert!(!texts.contains(&"v. 5"), "{got:?}");
        Ok(())
    })
}
