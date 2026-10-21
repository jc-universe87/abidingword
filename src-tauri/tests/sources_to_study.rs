//! From Sources to Study (v0.15): a finding made from a source keeps what the
//! source said (the quote) apart from what the person wrote, where it was,
//! and a snapshot of title, author, location and section that outlives the
//! source and any mark it came from. Sources are invented and imported
//! through the real path.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{
    findings, library, projects, sections, source_annotations as marks, studies, workspaces,
    Database,
};
use abiding_word_lib::domain::{
    CreateProject, CreateStudy, CreateStudySection, DuplicateStudy, Finding, FindingType,
    UpdateFinding,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::library::annotations::{CreateSourceAnnotation, PlaceInput, TextPoint};
use abiding_word_lib::library::import;
use abiding_word_lib::library::{
    AddFindingSource, CitedPassage, CommitSourceImport, CreateFindingFromSource, GetSegments,
    SourceSegment,
};
use rusqlite::{params, Connection};

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

fn commit(conn: &Connection, path: &Path, title: &str, author: Option<&str>) -> String {
    let staged = import::stage(path).unwrap();
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, &staged);
    library::commit_import(
        conn,
        &id,
        &staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: title.into(),
            author: author.map(String::from),
            language: Some("en".into()),
            ..Default::default()
        },
        &relative,
    )
    .unwrap();
    id
}

fn add_text(conn: &Connection, dir: &Path, file: &str, text: &str, author: Option<&str>) -> String {
    let path = dir.join(file);
    fs::write(&path, text).unwrap();
    commit(conn, &path, file, author)
}

fn segments(conn: &Connection, source: &str) -> Vec<SourceSegment> {
    library::segments(
        conn,
        &GetSegments {
            source_id: source.into(),
            around_segment_id: None,
            around_page: None,
            offset: Some(0),
            limit: Some(500),
        },
    )
    .unwrap()
    .segments
}

fn u16_at(text: &str, byte: usize) -> u32 {
    text[..byte].encode_utf16().count() as u32
}

/// The `nth` occurrence (0-based) of `words` in one segment, as a selection.
fn nth_words(segment: &SourceSegment, words: &str, nth: usize) -> CitedPassage {
    let byte = segment
        .text
        .match_indices(words)
        .nth(nth)
        .unwrap_or_else(|| panic!("{words} #{nth} in {}", segment.text))
        .0;
    let start = u16_at(&segment.text, byte);
    CitedPassage {
        source_id: Some(segment_source(segment)),
        start: Some(TextPoint {
            segment_id: segment.id.clone(),
            offset: start,
        }),
        end: Some(TextPoint {
            segment_id: segment.id.clone(),
            offset: start + words.encode_utf16().count() as u32,
        }),
        quote: Some(words.into()),
        ..Default::default()
    }
}

thread_local! {
    static SOURCE_OF: std::cell::RefCell<std::collections::HashMap<String, String>> = Default::default();
}

fn segment_source(segment: &SourceSegment) -> String {
    SOURCE_OF.with(|m| m.borrow().get(&segment.id).cloned().expect("known segment"))
}

fn segs(conn: &Connection, source: &str) -> Vec<SourceSegment> {
    let all = segments(conn, source);
    SOURCE_OF.with(|m| {
        for s in &all {
            m.borrow_mut().insert(s.id.clone(), source.to_string());
        }
    });
    all
}

fn seg<'a>(all: &'a [SourceSegment], start: &str) -> &'a SourceSegment {
    all.iter()
        .find(|x| x.text.starts_with(start))
        .unwrap_or_else(|| panic!("a paragraph starting {start}"))
}

fn words(segment: &SourceSegment, words: &str) -> CitedPassage {
    nth_words(segment, words, 0)
}

fn new_study(conn: &Connection, title: &str) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = match projects::list(conn, &workspace.id)?.into_iter().next() {
        Some(p) => p.id,
        None => {
            projects::create(
                conn,
                &CreateProject {
                    workspace_id: workspace.id,
                    title: "Collection".into(),
                    description: None,
                },
            )?
            .id
        }
    };
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project,
            title: title.into(),
            ..Default::default()
        },
    )?
    .study
    .id)
}

fn to_study(
    study: &str,
    kind: &str,
    content: &str,
    cited: CitedPassage,
) -> CreateFindingFromSource {
    CreateFindingFromSource {
        study_id: study.into(),
        finding_type: kind.into(),
        content: Some(content.into()),
        section_id: None,
        cited,
    }
}

fn error_key<T: std::fmt::Debug>(result: AppResult<T>) -> String {
    match result {
        Err(AppError::InvalidInput(message)) => message.code.unwrap_or_default().to_string(),
        other => panic!("expected invalid input, got {other:?}"),
    }
}

fn citation_count(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM finding_sources WHERE deleted_at IS NULL",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

const BOOK: &str = "# The True Vine\n\nAbide in me, and I in you.\n\nAs the branch cannot bear fruit by itself, neither can you.\n\n# Grace\n\nGrace upon grace: grace upon grace is the gift.\n";

#[test]
fn selected_words_become_a_finding_with_the_quote_kept_apart() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, Some("J. Example"));
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "observation",
                "Abiding is receptive.",
                words(seg(&s, "As the"), "bear fruit"),
            ),
        )?;
        assert_eq!(finding.finding_type, FindingType::Observation);
        assert_eq!(finding.content, "Abiding is receptive.");
        assert!(finding.passages.is_empty(), "no passages are added");
        let c = &finding.sources[0];
        assert_eq!(c.quote.as_deref(), Some("bear fruit"));
        assert_eq!(c.title, "vine.md");
        assert_eq!(c.author.as_deref(), Some("J. Example"));
        assert_eq!(c.section.as_deref(), Some("The True Vine"));
        assert_eq!(c.segment_id.as_deref(), Some(seg(&s, "As the").id.as_str()));
        assert!(!c.removed);

        // Nothing written: a quotation whose text is the quote.
        let quoted = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "quotation",
                "  ",
                words(seg(&s, "Abide"), "Abide in me"),
            ),
        )?;
        assert_eq!(quoted.content, "Abide in me");
        assert_eq!(quoted.sources[0].quote.as_deref(), Some("Abide in me"));

        // Editing the finding never rewrites what the source said.
        findings::update(
            conn,
            &UpdateFinding {
                id: quoted.id.clone(),
                content: Some("Remain in Christ.".into()),
                ..Default::default()
            },
        )?;
        let edited = findings::get(conn, &quoted.id)?;
        assert_eq!(edited.content, "Remain in Christ.");
        assert_eq!(edited.sources[0].quote.as_deref(), Some("Abide in me"));
        Ok(())
    });
}

#[test]
fn a_finding_goes_into_the_chosen_part_and_bad_input_creates_nothing() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, None);
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let part = sections::create(
            conn,
            &CreateStudySection {
                study_id: study.clone(),
                title: "Observations".into(),
                guidance: None,
                key: None,
                phase: None,
            },
        )?;
        let mut input = to_study(&study, "quotation", "", words(seg(&s, "Abide"), "Abide"));
        input.section_id = Some(part.id.clone());
        assert_eq!(
            findings::create_from_source(conn, &input)?
                .section_id
                .as_deref(),
            Some(part.id.as_str())
        );

        // Words that are not the source's own, an unknown type, a part of another study: nothing is created.
        let other = new_study(conn, "Other")?;
        let mut wrong = words(seg(&s, "Abide"), "Abide");
        wrong.quote = Some("Abide!".into());
        assert_eq!(
            error_key(findings::create_from_source(
                conn,
                &to_study(&study, "quotation", "", wrong)
            )),
            "sourceAnnotations.textChanged"
        );
        let mut elsewhere = to_study(&other, "quotation", "", words(seg(&s, "Abide"), "Abide"));
        elsewhere.section_id = Some(part.id.clone());
        assert!(findings::create_from_source(conn, &elsewhere).is_err());
        assert!(findings::create_from_source(
            conn,
            &to_study(&study, "sermon", "x", words(seg(&s, "Abide"), "Abide"))
        )
        .is_err());
        // A place with nothing written has nothing to add.
        let place = CitedPassage {
            source_id: Some(source.clone()),
            place: Some(PlaceInput {
                segment_id: Some(seg(&s, "As the").id.clone()),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(
            error_key(findings::create_from_source(
                conn,
                &to_study(&study, "observation", "", place)
            )),
            "findings.writeFirst"
        );
        assert_eq!(findings::list(conn, &study)?.len(), 1);
        assert_eq!(citation_count(conn), 1);
        Ok(())
    });
}

#[test]
fn a_quote_across_paragraphs_and_in_korean_is_kept_exactly() {
    with_db(|conn, dir| {
        let text = "# 요한복음\n\n𝔊 내 안에 거하라 나도 너희 안에 거하리라.\n\n가지가 포도나무에 붙어 있지 아니하면.\n";
        let source = add_text(conn, dir, "korean.md", text, Some("홍길동"));
        let s = segs(conn, &source);
        let study = new_study(conn, "성경공부")?;
        let first = seg(&s, "𝔊");
        let last = seg(&s, "가지가");
        let start = u16_at(&first.text, first.text.find("거하리라").unwrap());
        let end = u16_at(&last.text, last.text.find(" 붙어").unwrap());
        let quote = format!(
            "거하리라.\n{}",
            &last.text[..last.text.find(" 붙어").unwrap()]
        );
        let cited = CitedPassage {
            source_id: Some(source.clone()),
            start: Some(TextPoint {
                segment_id: first.id.clone(),
                offset: start,
            }),
            end: Some(TextPoint {
                segment_id: last.id.clone(),
                offset: end,
            }),
            quote: Some(quote.clone()),
            ..Default::default()
        };
        let finding =
            findings::create_from_source(conn, &to_study(&study, "quotation", "", cited))?;
        assert_eq!(finding.sources[0].quote.as_deref(), Some(quote.as_str()));
        assert_eq!(finding.sources[0].author.as_deref(), Some("홍길동"));
        // The place is found again exactly.
        let place = findings::locate_source(conn, &finding.sources[0].id)?.unwrap();
        let w = place.words.unwrap();
        assert_eq!(
            (w.start_segment_id.as_str(), w.start_offset),
            (first.id.as_str(), start)
        );
        assert_eq!(
            (w.end_segment_id.as_str(), w.end_offset),
            (last.id.as_str(), end)
        );
        // A selection that would split a character outside the BMP is refused.
        let split = CitedPassage {
            source_id: Some(source.clone()),
            start: Some(TextPoint {
                segment_id: first.id.clone(),
                offset: 1,
            }),
            end: Some(TextPoint {
                segment_id: first.id.clone(),
                offset: 4,
            }),
            quote: Some("x".into()),
            ..Default::default()
        };
        assert!(
            findings::create_from_source(conn, &to_study(&study, "quotation", "", split)).is_err()
        );
        Ok(())
    });
}

#[test]
fn the_same_words_at_two_places_are_two_citations_but_the_same_place_is_one() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "grace.md", BOOK, None);
        let s = segs(conn, &source);
        let grace = s.iter().find(|x| x.text.starts_with("Grace upon")).unwrap();
        let study = new_study(conn, "Grace")?;
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "observation",
                "Grace given again and again.",
                nth_words(grace, "upon grace", 0),
            ),
        )?;
        // The same words, a second time in the same paragraph: another citation.
        let twice = findings::add_source(
            conn,
            &AddFindingSource {
                finding_id: finding.id.clone(),
                segment_id: None,
                cited: nth_words(grace, "upon grace", 1),
            },
        )?;
        assert_eq!(twice.sources.len(), 2);
        assert_ne!(twice.sources[0].id, twice.sources[1].id);
        assert_eq!(twice.sources[0].quote, twice.sources[1].quote);
        // Exactly the same words at the same place again: nothing new.
        let again = findings::add_source(
            conn,
            &AddFindingSource {
                finding_id: finding.id.clone(),
                segment_id: None,
                cited: nth_words(grace, "upon grace", 1),
            },
        )?;
        assert_eq!(again.sources.len(), 2);
        // A whole paragraph cited the v0.4 way is still one per paragraph.
        let whole = |conn: &Connection| {
            findings::add_source(
                conn,
                &AddFindingSource {
                    finding_id: finding.id.clone(),
                    segment_id: Some(grace.id.clone()),
                    cited: CitedPassage::default(),
                },
            )
        };
        assert_eq!(whole(conn)?.sources.len(), 3);
        assert_eq!(whole(conn)?.sources.len(), 3);
        // Two findings from the same words are the person's choice, and both are kept.
        findings::create_from_source(
            conn,
            &to_study(&study, "quotation", "", nth_words(grace, "upon grace", 0)),
        )?;
        findings::create_from_source(
            conn,
            &to_study(&study, "quotation", "", nth_words(grace, "upon grace", 0)),
        )?;
        assert_eq!(findings::list(conn, &study)?.len(), 3);
        Ok(())
    });
}

#[test]
fn a_mark_becomes_a_finding_and_the_finding_never_depends_on_it() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, Some("J. Example"));
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let w = words(seg(&s, "As the"), "cannot bear fruit");
        let highlight = marks::create(
            conn,
            &CreateSourceAnnotation {
                source_id: source.clone(),
                kind: "highlight".into(),
                color: Some("green".into()),
                start: w.start.clone(),
                end: w.end.clone(),
                quote: w.quote.clone(),
                ..Default::default()
            },
        )?;
        let from_mark = |id: &str| CitedPassage {
            annotation_id: Some(id.into()),
            ..Default::default()
        };
        let finding = findings::create_from_source(
            conn,
            &to_study(&study, "quotation", "", from_mark(&highlight.id)),
        )?;
        let c = &finding.sources[0];
        assert_eq!(c.quote.as_deref(), Some("cannot bear fruit"));
        assert_eq!(c.annotation_id.as_deref(), Some(highlight.id.as_str()));
        assert_eq!(finding.content, "cannot bear fruit");

        // A note on words: the note is the person's text, the words the quote.
        let nw = words(seg(&s, "Abide"), "Abide in me");
        let note = marks::create(
            conn,
            &CreateSourceAnnotation {
                source_id: source.clone(),
                kind: "note".into(),
                content: Some("Remain.".into()),
                start: nw.start.clone(),
                end: nw.end.clone(),
                quote: nw.quote.clone(),
                ..Default::default()
            },
        )?;
        let from_note = findings::create_from_source(
            conn,
            &to_study(&study, "observation", "Remain.", from_mark(&note.id)),
        )?;
        assert_eq!(from_note.content, "Remain.");
        assert_eq!(from_note.sources[0].quote.as_deref(), Some("Abide in me"));

        // A note on a place: its place, no quote.
        let place_note = marks::create(
            conn,
            &CreateSourceAnnotation {
                source_id: source.clone(),
                kind: "note".into(),
                content: Some("Read again.".into()),
                place: Some(PlaceInput {
                    segment_id: Some(seg(&s, "As the").id.clone()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let from_place = findings::create_from_source(
            conn,
            &to_study(&study, "question", "Read again.", from_mark(&place_note.id)),
        )?;
        assert_eq!(from_place.sources[0].quote, None);
        assert_eq!(
            from_place.sources[0].segment_id.as_deref(),
            Some(seg(&s, "As the").id.as_str())
        );
        let opened = findings::locate_source(conn, &from_place.sources[0].id)?.unwrap();
        assert_eq!(
            opened.segment_id.as_deref(),
            Some(seg(&s, "As the").id.as_str())
        );
        assert!(opened.words.is_none());

        // A bookmark has nothing to add.
        let bookmark = marks::create(
            conn,
            &CreateSourceAnnotation {
                source_id: source.clone(),
                kind: "bookmark".into(),
                place: Some(PlaceInput {
                    segment_id: Some(seg(&s, "Abide").id.clone()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(
            error_key(findings::create_from_source(
                conn,
                &to_study(&study, "observation", "x", from_mark(&bookmark.id))
            )),
            "sourceAnnotations.bookmarkNotStudy"
        );

        // The marks are unchanged by adding them to a study.
        assert_eq!(marks::get(conn, &highlight.id)?, highlight);

        // Deleting a mark leaves the finding and its citation exactly as they were.
        let before = findings::get(conn, &finding.id)?;
        marks::delete(conn, &highlight.id)?;
        marks::delete(conn, &note.id)?;
        assert_eq!(findings::get(conn, &finding.id)?, before);
        assert_eq!(
            findings::get(conn, &from_note.id)?.sources[0]
                .quote
                .as_deref(),
            Some("Abide in me")
        );
        assert!(findings::locate_source(conn, &before.sources[0].id)?
            .unwrap()
            .words
            .is_some());
        // A deleted mark can no longer be added.
        assert!(findings::create_from_source(
            conn,
            &to_study(&study, "quotation", "", from_mark(&highlight.id))
        )
        .is_err());
        Ok(())
    });
}

#[test]
fn removing_the_source_keeps_the_finding_quote_and_snapshot() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, Some("J. Example"));
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "interpretation",
                "Fruit comes from union.",
                words(seg(&s, "As the"), "bear fruit"),
            ),
        )?;
        library::remove(conn, &source)?;
        let after = findings::get(conn, &finding.id)?;
        assert_eq!(after.content, "Fruit comes from union.");
        let c = &after.sources[0];
        assert!(c.removed);
        assert_eq!(c.quote.as_deref(), Some("bear fruit"));
        assert_eq!(c.title, "vine.md");
        assert_eq!(c.author.as_deref(), Some("J. Example"));
        assert_eq!(c.section.as_deref(), Some("The True Vine"));
        assert!(c.locator.is_some());
        assert_eq!(c.segment_id, None);
        // It cannot be opened, and nothing fails.
        assert_eq!(findings::locate_source(conn, &c.id)?, None);
        // And it cannot be cited again.
        assert!(findings::create_from_source(
            conn,
            &to_study(
                &study,
                "quotation",
                "",
                words(seg(&s, "As the"), "bear fruit")
            )
        )
        .is_err());
        Ok(())
    });
}

#[test]
fn a_citation_is_found_again_when_the_text_changes_and_never_guessed() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, None);
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let branch = seg(&s, "As the");
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "quotation",
                "",
                words(branch, "bear fruit by itself"),
            ),
        )?;
        let id = finding.sources[0].id.clone();
        let set = |text: &str| {
            conn.execute(
                "UPDATE source_segments SET content = ?2 WHERE id = ?1",
                params![branch.id, text],
            )
            .unwrap();
        };
        // Words moved within the paragraph: followed exactly.
        set("Truly, as the branch cannot bear fruit by itself, neither can you.");
        let moved = findings::locate_source(conn, &id)?.unwrap().words.unwrap();
        assert_eq!(
            moved.start_offset,
            u16_at(
                "Truly, as the branch cannot bear fruit by itself, neither can you.",
                "Truly, as the branch cannot ".len()
            )
        );
        // The words now twice, with no context to tell them apart: no words are guessed; the paragraph opens.
        set("bear fruit by itself or bear fruit by itself");
        let ambiguous = findings::locate_source(conn, &id)?.unwrap();
        assert!(ambiguous.words.is_none());
        assert_eq!(ambiguous.segment_id.as_deref(), Some(branch.id.as_str()));
        // The snapshot never changes.
        assert_eq!(
            findings::get(conn, &finding.id)?.sources[0]
                .quote
                .as_deref(),
            Some("bear fruit by itself")
        );
        Ok(())
    });
}

#[test]
fn a_place_on_a_pdf_page_and_pdf_words_are_kept_with_their_page() {
    with_db(|conn, dir| {
        let path = dir.join("pages.pdf");
        fs::write(
            &path,
            fixtures::pdf(
                &[
                    &["The first page has enough text to be read as a real page of a book."],
                    &["The second page also has text for the reader to see here."],
                    &["Page three continues with more words about abiding in the vine."],
                ],
                Some("Pages"),
                None,
            ),
        )
        .unwrap();
        let source = commit(conn, &path, "Pages", Some("A. Writer"));
        let s = segs(conn, &source);
        let second = s.iter().find(|x| x.page_number == Some(2)).unwrap();
        let study = new_study(conn, "Pages")?;
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "quotation",
                "",
                words(second, "text for the reader"),
            ),
        )?;
        assert_eq!(finding.sources[0].locator.as_deref(), Some("p. 2"));
        let place = findings::locate_source(conn, &finding.sources[0].id)?.unwrap();
        assert_eq!(place.segment_id.as_deref(), Some(second.id.as_str()));
        assert!(place.words.is_some());

        // A place on a page (an Original PDF), with how far down.
        let on_page = CitedPassage {
            source_id: Some(source.clone()),
            place: Some(PlaceInput {
                segment_id: None,
                page: Some(3),
                fraction: Some(0.25),
            }),
            ..Default::default()
        };
        let noted = findings::create_from_source(
            conn,
            &to_study(&study, "question", "Why here?", on_page),
        )?;
        assert_eq!(noted.sources[0].locator.as_deref(), Some("p. 3"));
        let opened = findings::locate_source(conn, &noted.sources[0].id)?.unwrap();
        assert_eq!((opened.page, opened.fraction), (Some(3), Some(0.25)));

        // A place on a page that also names its paragraph still reopens on the
        // page, how far down, not only at the paragraph in Reading.
        let at_paragraph = CitedPassage {
            source_id: Some(source.clone()),
            place: Some(PlaceInput {
                segment_id: Some(second.id.clone()),
                page: Some(2),
                fraction: Some(0.6),
            }),
            ..Default::default()
        };
        let there = findings::create_from_source(
            conn,
            &to_study(&study, "question", "And here?", at_paragraph),
        )?;
        let opened = findings::locate_source(conn, &there.sources[0].id)?.unwrap();
        assert_eq!(opened.segment_id.as_deref(), Some(second.id.as_str()));
        assert_eq!((opened.page, opened.fraction), (Some(2), Some(0.6)));
        Ok(())
    });
}

#[test]
fn duplicating_a_study_copies_quotes_places_and_snapshots() {
    with_db(|conn, dir| {
        let source = add_text(conn, dir, "vine.md", BOOK, Some("J. Example"));
        let s = segs(conn, &source);
        let study = new_study(conn, "Abiding")?;
        let finding = findings::create_from_source(
            conn,
            &to_study(
                &study,
                "observation",
                "Mine.",
                words(seg(&s, "As the"), "bear fruit"),
            ),
        )?;
        let copy = studies::duplicate(
            conn,
            &DuplicateStudy {
                study_id: study.clone(),
                include_content: true,
            },
        )?;
        let copied: Vec<Finding> = findings::list(conn, &copy.study.id)?;
        let (a, b) = (&finding.sources[0], &copied[0].sources[0]);
        assert_ne!(a.id, b.id);
        assert_eq!(
            (
                &a.quote,
                &a.section,
                &a.locator,
                &a.title,
                &a.author,
                &a.segment_id
            ),
            (
                &b.quote,
                &b.section,
                &b.locator,
                &b.title,
                &b.author,
                &b.segment_id
            )
        );
        assert!(findings::locate_source(conn, &b.id)?
            .unwrap()
            .words
            .is_some());
        Ok(())
    });
}
