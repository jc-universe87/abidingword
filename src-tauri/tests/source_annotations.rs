//! Source annotations (v0.14): highlights, notes and bookmarks in library
//! sources, anchored in the stored text and found again — never guessed —
//! when that text changes. Sources are invented and imported through the
//! real path (stage, commit).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, source_annotations as marks, Database};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::library::annotations::{
    AnchorState, CreateSourceAnnotation, PlaceInput, SourceAnnotation, TextPoint,
    UpdateSourceAnnotation,
};
use abiding_word_lib::library::import;
use abiding_word_lib::library::{CommitSourceImport, GetSegments, SourceSegment};
use rusqlite::{params, Connection};

fn add(conn: &Connection, dir: &Path, file: &str, text: &str) -> String {
    let path = dir.join(file);
    fs::write(&path, text).unwrap();
    let staged = import::stage(&path).unwrap();
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, &staged);
    library::commit_import(
        conn,
        &id,
        &staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: file.into(),
            language: Some("en".into()),
            ..Default::default()
        },
        &relative,
    )
    .unwrap();
    id
}

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
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

fn u16_index(text: &str, needle: &str) -> u32 {
    let byte = text
        .find(needle)
        .unwrap_or_else(|| panic!("{needle} in {text}"));
    text[..byte].encode_utf16().count() as u32
}

fn u16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

/// A selection of `words` inside one segment.
fn words_in(segment: &SourceSegment, words: &str) -> (TextPoint, TextPoint, String) {
    let start = u16_index(&segment.text, words);
    (
        TextPoint {
            segment_id: segment.id.clone(),
            offset: start,
        },
        TextPoint {
            segment_id: segment.id.clone(),
            offset: start + u16_len(words),
        },
        words.to_string(),
    )
}

fn on_words(
    source: &str,
    kind: &str,
    color: Option<&str>,
    (start, end, quote): (TextPoint, TextPoint, String),
) -> CreateSourceAnnotation {
    CreateSourceAnnotation {
        source_id: source.into(),
        kind: kind.into(),
        color: color.map(String::from),
        start: Some(start),
        end: Some(end),
        quote: Some(quote),
        ..Default::default()
    }
}

fn place(source: &str, kind: &str, segment: &str) -> CreateSourceAnnotation {
    CreateSourceAnnotation {
        source_id: source.into(),
        kind: kind.into(),
        place: Some(PlaceInput {
            segment_id: Some(segment.into()),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn error_key(result: AppResult<SourceAnnotation>) -> String {
    match result {
        Err(AppError::InvalidInput(message)) => message.code.unwrap_or_default().to_string(),
        other => panic!("expected invalid input, got {other:?}"),
    }
}

/// Highlights as (colour, quote), in reading order.
fn highlights(conn: &Connection, source: &str) -> Vec<(String, String)> {
    marks::list_for_source(conn, source)
        .unwrap()
        .into_iter()
        .filter(|m| m.kind == "highlight")
        .map(|m| (m.color.unwrap(), m.quote.unwrap()))
        .collect()
}

const SERMON: &str = "# The True Vine\n\nAbide in me, and I in you.\n\nAs the branch cannot bear fruit by itself, neither can you.\n\n# Fruit\n\nBy this my Father is glorified, that you bear much fruit.\n";

#[test]
fn a_highlight_is_anchored_in_the_stored_text_with_its_context() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("green"),
                words_in(&segs[1], "bear fruit"),
            ),
        )?;
        assert_eq!(made.kind, "highlight");
        assert_eq!(made.color.as_deref(), Some("green"));
        assert_eq!(made.quote.as_deref(), Some("bear fruit"));
        assert_eq!(made.state, AnchorState::Exact);
        let start = made.start.clone().unwrap();
        assert_eq!(start.segment_id, segs[1].id);
        assert_eq!(start.position, segs[1].position);
        assert_eq!(start.offset, Some(u16_index(&segs[1].text, "bear fruit")));
        assert!(made
            .section_path
            .as_deref()
            .unwrap()
            .contains("The True Vine"));
        // Context is kept in the file for finding it again.
        let (prefix, suffix): (String, String) = conn.query_row(
            "SELECT prefix, suffix FROM source_annotations WHERE id = ?1",
            [&made.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert!(prefix.ends_with("branch cannot "), "{prefix}");
        assert!(suffix.starts_with(" by itself"), "{suffix}");
        // A highlight without a colour gets the default.
        let plain = marks::create(
            conn,
            &on_words(&source, "highlight", None, words_in(&segs[2], "glorified")),
        )?;
        assert_eq!(plain.color.as_deref(), Some("amber"));
        Ok(())
    });
}

#[test]
fn a_selection_across_paragraphs_has_one_quote_joined_with_a_newline() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let start = u16_index(&segs[0].text, "I in you.");
        let input = CreateSourceAnnotation {
            source_id: source.clone(),
            kind: "note".into(),
            content: Some("Mutual indwelling.".into()),
            start: Some(TextPoint {
                segment_id: segs[0].id.clone(),
                offset: start,
            }),
            end: Some(TextPoint {
                segment_id: segs[1].id.clone(),
                offset: u16_index(&segs[1].text, " cannot"),
            }),
            quote: Some("I in you.\nAs the branch".into()),
            ..Default::default()
        };
        let note = marks::create(conn, &input)?;
        assert_eq!(note.quote.as_deref(), Some("I in you.\nAs the branch"));
        assert_eq!(note.start.as_ref().unwrap().segment_id, segs[0].id);
        assert_eq!(note.end.as_ref().unwrap().segment_id, segs[1].id);
        assert_eq!(note.content, "Mutual indwelling.");
        // Any other joining (a space) is not the stored text.
        let mut spaced = input.clone();
        spaced.quote = Some("I in you. As the branch".into());
        assert_eq!(
            error_key(marks::create(conn, &spaced)),
            "sourceAnnotations.textChanged"
        );
        Ok(())
    });
}

#[test]
fn offsets_are_utf16_for_korean_and_characters_outside_the_bmp() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "korean.txt",
            "𝔊𝔬𝔡 요한복음 15장 4절: 내 안에 거하라.\n\n둘째 문단.\n",
        );
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("rose"),
                words_in(&segs[0], "내 안에 거하라"),
            ),
        )?;
        assert_eq!(made.quote.as_deref(), Some("내 안에 거하라"));
        assert_eq!(
            made.start.unwrap().offset,
            Some(u16_index(&segs[0].text, "내 안에")),
            "the three Fraktur letters count two units each"
        );
        // An offset inside a surrogate pair is refused, never rounded.
        let bad = CreateSourceAnnotation {
            source_id: source.clone(),
            kind: "highlight".into(),
            start: Some(TextPoint {
                segment_id: segs[0].id.clone(),
                offset: 1,
            }),
            end: Some(TextPoint {
                segment_id: segs[0].id.clone(),
                offset: 4,
            }),
            quote: Some("𝔬".into()),
            ..Default::default()
        };
        assert_eq!(
            error_key(marks::create(conn, &bad)),
            "sourceAnnotations.textChanged"
        );
        Ok(())
    });
}

#[test]
fn what_each_kind_may_hold_is_checked() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let words = || words_in(&segs[0], "Abide");
        assert_eq!(
            error_key(marks::create(
                conn,
                &place(&source, "highlight", &segs[0].id)
            )),
            "sourceAnnotations.noWords"
        );
        assert_eq!(
            error_key(marks::create(
                conn,
                &on_words(&source, "bookmark", None, words())
            )),
            "sourceAnnotations.bookmarkPlace"
        );
        assert_eq!(
            error_key(marks::create(
                conn,
                &on_words(&source, "note", Some("blue"), words())
            )),
            "annotations.colorOnlyHighlight"
        );
        let mut with_words = on_words(&source, "highlight", None, words());
        with_words.content = Some("text".into());
        assert_eq!(
            error_key(marks::create(conn, &with_words)),
            "sourceAnnotations.wordsOnlyNotes"
        );
        assert_eq!(
            error_key(marks::create(
                conn,
                &on_words(&source, "highlight", Some("purple"), words())
            )),
            "invalidChoice"
        );
        let mut leading_space = on_words(&source, "highlight", None, words());
        leading_space.quote = Some("abide".into());
        assert_eq!(
            error_key(marks::create(conn, &leading_space)),
            "sourceAnnotations.textChanged"
        );
        let mut other_kind = place(&source, "underline", &segs[0].id);
        other_kind.kind = "underline".into();
        assert_eq!(error_key(marks::create(conn, &other_kind)), "invalidChoice");
        Ok(())
    });
}

#[test]
fn a_selection_is_trimmed_of_space_at_its_ends() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let text = &segs[0].text;
        // " in me, " with its spaces.
        let start = u16_index(text, " in me, ");
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                None,
                (
                    TextPoint {
                        segment_id: segs[0].id.clone(),
                        offset: start,
                    },
                    TextPoint {
                        segment_id: segs[0].id.clone(),
                        offset: start + 8,
                    },
                    " in me, ".into(),
                ),
            ),
        )?;
        assert_eq!(made.quote.as_deref(), Some("in me,"));
        assert_eq!(made.start.unwrap().offset, Some(start + 1));
        Ok(())
    });
}

#[test]
fn notes_and_bookmarks_on_a_place_need_no_selected_words() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let mut note = place(&source, "note", &segs[2].id);
        note.content = Some("Preach this on Sunday.".into());
        let note = marks::create(conn, &note)?;
        assert_eq!(note.quote, None);
        assert_eq!(note.end, None);
        assert_eq!(note.start.as_ref().unwrap().segment_id, segs[2].id);
        assert_eq!(note.start.as_ref().unwrap().offset, None);

        let first = marks::create(conn, &place(&source, "bookmark", &segs[1].id))?;
        let again = marks::create(conn, &place(&source, "bookmark", &segs[1].id))?;
        assert_eq!(first.id, again.id, "one bookmark per place");
        assert_eq!(first.locator, Some(segs[1].locator.clone()));

        let all = marks::list_for_source(conn, &source)?;
        assert_eq!(
            all.iter().map(|m| m.kind.as_str()).collect::<Vec<_>>(),
            vec!["bookmark", "note"],
            "reading order"
        );
        marks::delete(conn, &first.id)?;
        assert_eq!(marks::list_for_source(conn, &source)?.len(), 1);
        // Gone from the list, still in the file.
        let deleted: Option<String> = conn.query_row(
            "SELECT deleted_at FROM source_annotations WHERE id = ?1",
            [&first.id],
            |r| r.get(0),
        )?;
        assert!(deleted.is_some());
        Ok(())
    });
}

#[test]
fn a_note_is_edited_and_a_highlight_recoloured_in_place() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let mut note = on_words(&source, "note", None, words_in(&segs[2], "much fruit"));
        note.content = Some("first".into());
        let note = marks::create(conn, &note)?;
        let edited = marks::update(
            conn,
            &UpdateSourceAnnotation {
                id: note.id.clone(),
                content: Some("second".into()),
                color: None,
            },
        )?;
        assert_eq!(edited.content, "second");
        assert!(edited.revision > note.revision);

        let mark = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("amber"),
                words_in(&segs[0], "Abide in me"),
            ),
        )?;
        let recoloured = marks::update(
            conn,
            &UpdateSourceAnnotation {
                id: mark.id.clone(),
                content: None,
                color: Some("blue".into()),
            },
        )?;
        assert_eq!(recoloured.id, mark.id, "the same highlight");
        assert_eq!(recoloured.color.as_deref(), Some("blue"));
        assert_eq!(recoloured.quote.as_deref(), Some("Abide in me"));
        assert!(marks::update(
            conn,
            &UpdateSourceAnnotation {
                id: note.id.clone(),
                content: None,
                color: Some("blue".into()),
            },
        )
        .is_err());
        Ok(())
    });
}

#[test]
fn highlights_behave_like_a_highlighter_on_paper() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "plain.txt",
            "one two three four five six seven eight nine ten\n\nsecond paragraph here\n",
        );
        let segs = segments(conn, &source);
        let first = &segs[0];
        let mark = |color: &str, words: &str| {
            marks::create(
                conn,
                &on_words(&source, "highlight", Some(color), words_in(first, words)),
            )
            .unwrap()
        };
        // Separated by a space only, highlights stay two (as with Bible text).
        mark("rose", "nine");
        mark("rose", "ten");
        assert_eq!(
            highlights(conn, &source),
            vec![
                ("rose".into(), "nine".into()),
                ("rose".into(), "ten".into())
            ]
        );
        mark("rose", "nine ten");
        assert_eq!(
            highlights(conn, &source),
            vec![("rose".into(), "nine ten".into())]
        );
        conn.execute(
            "UPDATE source_annotations SET deleted_at = 'x' WHERE kind = 'highlight'",
            [],
        )?;
        // Same colour, overlapping: one highlight.
        let a = mark("amber", "two three four");
        let b = mark("amber", "four five");
        assert_eq!(a.id, b.id, "merged into the earlier highlight");
        assert_eq!(
            highlights(conn, &source),
            vec![("amber".into(), "two three four five".into())]
        );
        // Another colour inside it: split around it.
        mark("blue", "three");
        assert_eq!(
            highlights(conn, &source),
            vec![
                ("amber".into(), "two".into()),
                ("blue".into(), "three".into()),
                ("amber".into(), "four five".into()),
            ]
        );
        // Covering everything in one colour: one highlight left.
        mark("green", "one two three four five six");
        assert_eq!(
            highlights(conn, &source),
            vec![("green".into(), "one two three four five six".into())]
        );
        // Overlapping, in the same colour, joins.
        mark("green", "six seven");
        assert_eq!(
            highlights(conn, &source),
            vec![("green".into(), "one two three four five six seven".into())]
        );
        // Exactly the same words in another colour: recoloured.
        let same = mark("rose", "one two three four five six seven");
        assert_eq!(
            highlights(conn, &source),
            vec![("rose".into(), "one two three four five six seven".into())]
        );
        assert_eq!(same.color.as_deref(), Some("rose"));
        // Highlights in other paragraphs are not touched; notes never are.
        let mut note = on_words(&source, "note", None, words_in(first, "eight"));
        note.content = Some("n".into());
        marks::create(conn, &note)?;
        marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("blue"),
                words_in(&segs[1], "second"),
            ),
        )?;
        mark("blue", "six seven eight nine");
        assert_eq!(
            highlights(conn, &source),
            vec![
                ("rose".into(), "one two three four five".into()),
                ("blue".into(), "six seven eight nine".into()),
                ("blue".into(), "second".into()),
            ]
        );
        assert_eq!(
            marks::list_for_source(conn, &source)?
                .iter()
                .filter(|m| m.kind == "note")
                .count(),
            1
        );
        Ok(())
    });
}

fn set_text(conn: &Connection, segment: &str, text: &str) {
    conn.execute(
        "UPDATE source_segments SET content = ?2 WHERE id = ?1",
        params![segment, text],
    )
    .unwrap();
}

fn state_of(conn: &Connection, source: &str, id: &str) -> SourceAnnotation {
    marks::list_for_source(conn, source)
        .unwrap()
        .into_iter()
        .find(|m| m.id == id)
        .unwrap()
}

#[test]
fn an_annotation_follows_its_words_when_the_stored_text_changes() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("green"),
                words_in(&segs[1], "bear fruit"),
            ),
        )?;
        // Words before it change (as in an EPUB text repair): same paragraph.
        set_text(
            conn,
            &segs[1].id,
            "As the branch, truly, cannot bear fruit by itself, neither can you.",
        );
        let moved = state_of(conn, &source, &made.id);
        assert_eq!(moved.state, AnchorState::Moved);
        let text = "As the branch, truly, cannot bear fruit by itself, neither can you.";
        assert_eq!(
            moved.start.as_ref().unwrap().offset,
            Some(u16_index(text, "bear fruit"))
        );
        assert_eq!(moved.quote.as_deref(), Some("bear fruit"));
        // Found once, it is exact again where it now is.
        let again = state_of(conn, &source, &made.id);
        assert_eq!(again.start, moved.start);
        Ok(())
    });
}

#[test]
fn a_lost_paragraph_is_found_again_only_with_its_context() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "lost.txt",
            "Intro paragraph.\n\nGrace and peace to you from God our Father.\n\nAnother part.\n\nClosing.\n",
        );
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("blue"),
                words_in(&segs[1], "Grace and peace"),
            ),
        )?;
        // The paragraph is replaced by a new row with the same words (a
        // repair that could not keep its id).
        conn.execute(
            "UPDATE source_segments SET content = ?2 WHERE id = ?1",
            params![
                segs[2].id,
                "Grace and peace to you from God our Father. Another part."
            ],
        )?;
        conn.execute("DELETE FROM source_segments WHERE id = ?1", [&segs[1].id])?;
        let found = state_of(conn, &source, &made.id);
        assert_eq!(found.state, AnchorState::Moved);
        assert_eq!(found.start.as_ref().unwrap().segment_id, segs[2].id);
        Ok(())
    });
}

#[test]
fn an_ambiguous_or_missing_quote_is_unresolved_never_guessed() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "ambiguous.txt",
            "First: the Lord is my shepherd.\n\nMiddle paragraph.\n\nLast part here.\n",
        );
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(
                &source,
                "highlight",
                Some("amber"),
                words_in(&segs[0], "my shepherd"),
            ),
        )?;
        // The words now occur twice in their paragraph, and neither has the
        // stored text on either side: unresolved.
        set_text(
            conn,
            &segs[0].id,
            "my shepherd, and again my shepherd, again",
        );
        let lost = state_of(conn, &source, &made.id);
        assert_eq!(lost.state, AnchorState::Unresolved);
        assert_eq!(lost.start, None, "never drawn");
        assert_eq!(lost.quote.as_deref(), Some("my shepherd"), "words kept");

        // The words disappear entirely: still unresolved.
        set_text(conn, &segs[0].id, "First: something else entirely.");
        assert_eq!(
            state_of(conn, &source, &made.id).state,
            AnchorState::Unresolved
        );
        // They come back exactly where they were: found again.
        set_text(conn, &segs[0].id, "First: the Lord is my shepherd.");
        let back = state_of(conn, &source, &made.id);
        assert_ne!(back.state, AnchorState::Unresolved);
        assert!(back.start.is_some());
        Ok(())
    });
}

#[test]
fn context_decides_between_repeats_elsewhere_in_the_source() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "repeats.txt",
            "Alpha says: abide in him always.\n\nBeta says: abide in him forever.\n\nGamma.\n",
        );
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(&source, "note", None, words_in(&segs[1], "abide in him")),
        )?;
        // Its paragraph is gone; the words occur twice elsewhere, and only one
        // occurrence has the stored context.
        conn.execute(
            "UPDATE source_segments SET content = ?2 WHERE id = ?1",
            params![segs[2].id, "Beta says: abide in him forever."],
        )?;
        conn.execute("DELETE FROM source_segments WHERE id = ?1", [&segs[1].id])?;
        let found = state_of(conn, &source, &made.id);
        assert_eq!(found.state, AnchorState::Moved);
        assert_eq!(found.start.as_ref().unwrap().segment_id, segs[2].id);
        Ok(())
    });
}

#[test]
fn a_place_whose_paragraph_went_falls_back_to_its_section() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let segs = segments(conn, &source);
        let bookmark = marks::create(conn, &place(&source, "bookmark", &segs[1].id))?;
        conn.execute("DELETE FROM source_segments WHERE id = ?1", [&segs[1].id])?;
        let found = state_of(conn, &source, &bookmark.id);
        assert_eq!(found.state, AnchorState::Moved);
        assert_eq!(
            found.start.as_ref().unwrap().segment_id,
            segs[0].id,
            "first paragraph of the same section"
        );
        // With no section or page to go by, it is unresolved.
        let lone = add(conn, dir, "lone.txt", "Only paragraph.\n\nSecond.\n");
        let lone_segs = segments(conn, &lone);
        let mark = marks::create(conn, &place(&lone, "bookmark", &lone_segs[0].id))?;
        conn.execute(
            "DELETE FROM source_segments WHERE id = ?1",
            [&lone_segs[0].id],
        )?;
        assert_eq!(
            state_of(conn, &lone, &mark.id).state,
            AnchorState::Unresolved
        );
        Ok(())
    });
}

#[test]
fn rebuilding_the_passage_index_leaves_annotations_untouched() {
    with_db(|conn, dir| {
        let source = add(
            conn,
            dir,
            "refs.md",
            "# John 15:1–11\n\nAbide in me (John 15:4), as Romans 8:1 says.\n",
        );
        let segs = segments(conn, &source);
        let made = marks::create(
            conn,
            &on_words(&source, "highlight", None, words_in(&segs[0], "Romans 8:1")),
        )?;
        let before: (String, i64) = conn.query_row(
            "SELECT anchor_state, revision FROM source_annotations WHERE id = ?1",
            [&made.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        library::reindex_passages(conn, &source)?;
        let after = state_of(conn, &source, &made.id);
        assert_eq!(after.state, AnchorState::Exact);
        assert_eq!(after.start, made.start);
        let now: (String, i64) = conn.query_row(
            "SELECT anchor_state, revision FROM source_annotations WHERE id = ?1",
            [&made.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        assert_eq!(before, now, "nothing rewritten");
        Ok(())
    });
}

#[test]
fn removing_a_source_removes_its_marks_but_keeps_them_in_the_file() {
    with_db(|conn, dir| {
        let source = add(conn, dir, "vine.md", SERMON);
        let other = add(conn, dir, "other.md", "# Other\n\nOther words.\n");
        let segs = segments(conn, &source);
        let other_segs = segments(conn, &other);
        marks::create(conn, &place(&source, "bookmark", &segs[0].id))?;
        marks::create(
            conn,
            &on_words(&source, "highlight", None, words_in(&segs[1], "branch")),
        )?;
        let kept = marks::create(conn, &place(&other, "bookmark", &other_segs[0].id))?;
        assert_eq!(marks::count_for_source(conn, &source)?, 2);
        library::remove(conn, &source)?;
        assert_eq!(marks::count_for_source(conn, &source)?, 0);
        let rows: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_annotations WHERE source_id = ?1 AND deleted_at IS NOT NULL AND quote IS NOT NULL",
            [&source],
            |r| r.get(0),
        )?;
        assert_eq!(rows, 1, "the highlight's words are still in the file");
        assert_eq!(marks::get(conn, &kept.id)?.id, kept.id);
        Ok(())
    });
}

#[test]
fn a_page_of_a_pdf_without_text_can_be_bookmarked() {
    with_db(|conn, dir| {
        #[path = "support/library_fixtures.rs"]
        mod fixtures;
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
        let staged = import::stage(&path)?;
        let id = abiding_word_lib::db::new_id();
        let relative = library::managed_relative_path(&id, &staged);
        library::commit_import(
            conn,
            &id,
            &staged,
            &CommitSourceImport {
                preview_id: staged.id.clone(),
                title: "Pages".into(),
                ..Default::default()
            },
            &relative,
        )?;
        let page = |page: i64, fraction: f64| CreateSourceAnnotation {
            source_id: id.clone(),
            kind: "bookmark".into(),
            place: Some(PlaceInput {
                segment_id: None,
                page: Some(page),
                fraction: Some(fraction),
            }),
            ..Default::default()
        };
        let made = marks::create(conn, &page(2, 0.4))?;
        assert_eq!(made.page_number, Some(2));
        assert_eq!(made.fraction, Some(0.4));
        assert_eq!(made.start, None);
        assert_eq!(made.locator.as_deref(), Some("p. 2"));
        assert_eq!(marks::create(conn, &page(2, 0.9))?.id, made.id);
        assert_eq!(
            error_key(marks::create(conn, &page(9, 0.0))),
            "sourceAnnotations.noPlace"
        );
        assert_eq!(
            marks::list_for_source(conn, &id)?[0].state,
            AnchorState::Exact
        );
        Ok(())
    });
}
