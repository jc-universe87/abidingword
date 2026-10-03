//! Overlapping phrase highlights follow the physical-highlighter rule
//! (docs/scripture-annotations-v0.5.md, "Overlapping highlights"): a new
//! highlight owns exactly the words it covers; highlights on the same
//! wording are merged, trimmed or split around it, atomically.
//!
//! The wide fixture (usfm-wide, John 15) has long, predictable verses so
//! offsets like [0, 30) mean something:
//!   4  "aaaa bbbb cccc … tttt"   99 units, a 4-letter word every 5 units
//!   5  "AAAA BBBB … TTTT"        99 units
//!   6  "uuuu vvvv wwww xxxx yyyy zzzz"
//!   7  "ab 🍇🍇 cd efgh ijkl"      (each 🍇 is 2 UTF-16 units)
//!   8  "“Abide in me,” he said; “and I in you!”"

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::SourceRecord;
use abiding_word_lib::db::{annotations, bibles, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::scripture::annotation_data::{verse_hash, AnnotationData};
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::reference::ScriptureRef;
use abiding_word_lib::scripture::{
    AnchorEnd, AnchorInput, Annotation, BibleTranslation, CommitImport, CreateAnnotation,
    UpdateAnnotation,
};
use rusqlite::Connection;

fn install(conn: &Connection, set: &str, short_name: &str) -> AppResult<BibleTranslation> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(set);
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    let staged = import::stage(&files, ImportOrigin::UserFiles)?;
    bibles::commit_import(
        conn,
        &bibles::new_translation_id(),
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: format!("Fixture {short_name}"),
            short_name: short_name.into(),
            language: "English".into(),
            language_code: Some("en".into()),
            publisher: None,
            copyright_notice: None,
            license_type: None,
        },
        &SourceRecord {
            origin: "managed_copy",
            path: Some("sources/bibles/test".into()),
            original_file_name: Some("fixture".into()),
            format: "usfm",
            is_builtin: false,
        },
    )
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

// ---- the fixture's text -------------------------------------------------

fn lower() -> String {
    (0..20)
        .map(|i| ((b'a' + i) as char).to_string().repeat(4))
        .collect::<Vec<_>>()
        .join(" ")
}

fn verse_text(verse: u32) -> String {
    match verse {
        4 => lower(),
        5 => lower().to_uppercase(),
        6 => "uuuu vvvv wwww xxxx yyyy zzzz".into(),
        7 => "ab 🍇🍇 cd efgh ijkl".into(),
        8 => "“Abide in me,” he said; “and I in you!”".into(),
        other => panic!("no fixture text for verse {other}"),
    }
}

fn units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// The words between two positions, as the core rebuilds them: each verse's
/// part, joined with one space.
fn quote((v1, o1): (u32, u32), (v2, o2): (u32, u32)) -> String {
    (v1..=v2)
        .map(|v| {
            let text = units(&verse_text(v));
            let a = if v == v1 { o1 } else { 0 } as usize;
            let b = if v == v2 { o2 } else { text.len() as u32 } as usize;
            String::from_utf16(&text[a..b]).unwrap()
        })
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

type Pos = (u32, u32);

fn anchor_input(translation: &str, from: Pos, to: Pos) -> AnchorInput {
    let end = |(verse, offset): Pos| AnchorEnd {
        verse: format!("JHN.15.{verse}"),
        offset,
    };
    AnchorInput {
        translation_id: translation.into(),
        start: end(from),
        end: end(to),
        quote: quote(from, to),
    }
}

fn passage(from: Pos, to: Pos) -> String {
    if from.0 == to.0 {
        format!("JHN.15.{}", from.0)
    } else {
        format!("JHN.15.{}-JHN.15.{}", from.0, to.0)
    }
}

fn highlight(
    conn: &Connection,
    translation: &str,
    from: Pos,
    to: Pos,
    color: &str,
) -> AppResult<Annotation> {
    annotations::create(
        conn,
        &CreateAnnotation {
            reference: passage(from, to),
            kind: "highlight".into(),
            color: Some(color.into()),
            anchor: Some(anchor_input(translation, from, to)),
            ..Default::default()
        },
    )
}

/// What is left on screen: (colour, start, end, quote) of every active phrase
/// highlight shown in this wording, in reading order.
fn shown(conn: &Connection, translation: &str) -> Vec<(String, Pos, Pos, String)> {
    let verse = |canonical: &str| {
        canonical
            .rsplit('.')
            .next()
            .unwrap()
            .parse::<u32>()
            .unwrap()
    };
    let mut marks: Vec<_> = annotations::list_for(
        conn,
        &ScriptureRef::from_canonical("JHN.15").unwrap(),
        Some(translation),
    )
    .unwrap()
    .into_iter()
    .filter(|a| a.kind == "highlight")
    .filter_map(|a| {
        let anchor = a.anchor?;
        anchor.shown.then(|| {
            (
                a.color.unwrap(),
                (verse(&anchor.start.verse), anchor.start.offset),
                (verse(&anchor.end.verse), anchor.end.offset),
                anchor.quote,
            )
        })
    })
    .collect();
    marks.sort_by_key(|m| (m.1, m.2));
    marks
}

fn mark(color: &str, from: Pos, to: Pos) -> (String, Pos, Pos, String) {
    (color.into(), from, to, quote(from, to))
}

fn count(conn: &Connection, filter: &str) -> i64 {
    conn.query_row(
        &format!("SELECT count(*) FROM annotations WHERE {filter}"),
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn deleted(conn: &Connection) -> i64 {
    count(conn, "deleted_at IS NOT NULL")
}

fn setup(conn: &Connection) -> String {
    install(conn, "usfm-wide", "WIDE").unwrap().id
}

const A: u32 = 4;

// ---- 1-10: the arithmetic of one verse -----------------------------------

#[test]
fn highlights_that_do_not_meet_both_stay() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 10), (A, 20), "blue")?;
        highlight(conn, &t, (A, 30), (A, 40), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 10), (A, 20)),
                mark("rose", (A, 30), (A, 40))
            ]
        );
        assert_eq!(deleted(conn), 0);
        Ok(())
    });
}

#[test]
fn the_same_words_in_another_colour_recolour_the_one_highlight() {
    with_db(|conn| {
        let t = setup(conn);
        let blue = highlight(conn, &t, (A, 10), (A, 20), "blue")?;
        let rose = highlight(conn, &t, (A, 10), (A, 20), "rose")?;
        assert_eq!(rose.id, blue.id, "identity kept");
        assert_eq!(rose.revision, blue.revision + 1);
        assert_eq!(shown(conn, &t), vec![mark("rose", (A, 10), (A, 20))]);
        assert_eq!(count(conn, "deleted_at IS NULL"), 1);
        Ok(())
    });
}

#[test]
fn the_same_words_in_the_same_colour_change_nothing() {
    with_db(|conn| {
        let t = setup(conn);
        let first = highlight(conn, &t, (A, 10), (A, 20), "blue")?;
        let again = highlight(conn, &t, (A, 10), (A, 20), "blue")?;
        assert_eq!((again.id.as_str(), again.revision), (first.id.as_str(), 1));
        assert_eq!(shown(conn, &t), vec![mark("blue", (A, 10), (A, 20))]);
        Ok(())
    });
}

#[test]
fn a_new_range_inside_an_old_one_splits_it_in_two() {
    with_db(|conn| {
        let t = setup(conn);
        let old = highlight(conn, &t, (A, 0), (A, 99), "blue")?;
        let new = highlight(conn, &t, (A, 30), (A, 60), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 30)),
                mark("rose", (A, 30), (A, 60)),
                mark("blue", (A, 60), (A, 99)),
            ]
        );
        // The original keeps the part before; the part after is a new highlight.
        let before = annotations::get(conn, &old.id)?;
        assert_eq!(before.anchor.unwrap().end.offset, 30);
        assert_eq!(before.revision, 2);
        assert_ne!(new.id, old.id);
        assert_eq!(count(conn, "deleted_at IS NULL"), 3);
        assert_eq!(deleted(conn), 0);
        // Every piece has a complete, rebuilt anchor: hashes of the verse.
        let rows: Vec<String> = conn
            .prepare("SELECT data FROM annotations WHERE deleted_at IS NULL")?
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        for data in rows {
            let data = AnnotationData::read(Some(&data));
            let anchor = data.anchor.unwrap();
            assert_eq!(anchor.verses.len(), 1);
            assert_eq!(anchor.verses[0].sha256, verse_hash(&verse_text(A)));
            assert_eq!(anchor.translation_short_name, "WIDE");
        }
        Ok(())
    });
}

#[test]
fn a_new_range_over_the_tail_trims_the_old_one() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 0), (A, 50), "blue")?;
        highlight(conn, &t, (A, 30), (A, 70), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 30)),
                mark("rose", (A, 30), (A, 70))
            ]
        );
        Ok(())
    });
}

#[test]
fn a_new_range_over_the_head_trims_the_old_one() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 30), (A, 80), "blue")?;
        highlight(conn, &t, (A, 0), (A, 50), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("rose", (A, 0), (A, 50)),
                mark("blue", (A, 50), (A, 80))
            ]
        );
        Ok(())
    });
}

#[test]
fn a_new_range_covering_an_old_one_replaces_it() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 30), (A, 50), "blue")?;
        highlight(conn, &t, (A, 0), (A, 80), "rose")?;
        assert_eq!(shown(conn, &t), vec![mark("rose", (A, 0), (A, 80))]);
        assert_eq!(deleted(conn), 1, "soft-deleted, not removed");
        assert_eq!(count(conn, "1 = 1"), 2);
        Ok(())
    });
}

#[test]
fn same_colour_highlights_that_overlap_become_one() {
    with_db(|conn| {
        let t = setup(conn);
        let first = highlight(conn, &t, (A, 0), (A, 50), "blue")?;
        let merged = highlight(conn, &t, (A, 30), (A, 80), "blue")?;
        assert_eq!(merged.id, first.id, "the earlier highlight is extended");
        assert_eq!(shown(conn, &t), vec![mark("blue", (A, 0), (A, 80))]);
        assert_eq!(count(conn, "deleted_at IS NULL"), 1);
        Ok(())
    });
}

#[test]
fn same_colour_highlights_that_touch_become_one() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 0), (A, 50), "blue")?;
        highlight(conn, &t, (A, 50), (A, 80), "blue")?;
        assert_eq!(shown(conn, &t), vec![mark("blue", (A, 0), (A, 80))]);
        // One character between them is not touching.
        highlight(conn, &t, (A, 85), (A, 95), "blue")?;
        highlight(conn, &t, (A, 81), (A, 84), "blue")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 80)),
                mark("blue", (A, 81), (A, 84)),
                mark("blue", (A, 85), (A, 95)),
            ],
            "81..84 does not touch 80, and 84..85 leaves one unit"
        );
        Ok(())
    });
}

#[test]
fn a_new_range_over_several_colours_cuts_each() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (A, 0), (A, 20), "blue")?;
        highlight(conn, &t, (A, 30), (A, 50), "green")?;
        highlight(conn, &t, (A, 10), (A, 40), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 10)),
                mark("rose", (A, 10), (A, 40)),
                mark("green", (A, 40), (A, 50)),
            ]
        );
        Ok(())
    });
}

// ---- 11-12: across verses -------------------------------------------------

#[test]
fn a_multi_verse_highlight_is_split_around_a_range_in_its_middle_verse() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (4, 50), (6, 10), "blue")?;
        highlight(conn, &t, (5, 20), (5, 40), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (4, 50), (5, 20)),
                mark("rose", (5, 20), (5, 40)),
                mark("blue", (5, 40), (6, 10)),
            ]
        );
        // Each surviving piece is stored on the verses it now covers.
        let list = annotations::list_for(conn, &ScriptureRef::from_canonical("JHN.15")?, Some(&t))?;
        let mut passages: Vec<_> = list.iter().map(|a| a.reference.canonical.clone()).collect();
        passages.sort();
        assert_eq!(
            passages,
            ["JHN.15.4-JHN.15.5", "JHN.15.5", "JHN.15.5-JHN.15.6"]
        );
        // Quotes joined across verses, rebuilt from the text.
        let first = &shown(conn, &t)[0];
        assert_eq!(
            first.3,
            format!("{} {}", &lower()[50..], &lower().to_uppercase()[..20])
        );
        Ok(())
    });
}

#[test]
fn a_new_multi_verse_range_cuts_several_highlights() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (4, 0), (4, 30), "blue")?;
        highlight(conn, &t, (5, 10), (5, 40), "green")?;
        highlight(conn, &t, (4, 60), (4, 70), "amber")?;
        highlight(conn, &t, (4, 20), (5, 20), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (4, 0), (4, 20)),
                mark("rose", (4, 20), (5, 20)),
                mark("green", (5, 20), (5, 40)),
            ]
        );
        assert_eq!(deleted(conn), 1, "the amber one lay wholly inside");
        Ok(())
    });
}

#[test]
fn highlights_that_meet_across_a_verse_boundary_merge_when_the_same_colour() {
    with_db(|conn| {
        let t = setup(conn);
        highlight(conn, &t, (4, 90), (4, 99), "blue")?;
        highlight(conn, &t, (5, 0), (5, 10), "blue")?;
        assert_eq!(shown(conn, &t), vec![mark("blue", (4, 90), (5, 10))]);
        // A different colour that meets it stays apart.
        highlight(conn, &t, (5, 10), (5, 20), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (4, 90), (5, 10)),
                mark("rose", (5, 10), (5, 20))
            ]
        );
        Ok(())
    });
}

// ---- 13: wording identity -------------------------------------------------

#[test]
fn only_highlights_on_the_same_wording_are_normalised() {
    with_db(|conn| {
        let a = setup(conn);
        let b = install(conn, "usfm-wide-b", "WIDEB")?.id;
        // Verse 4 differs between the two wordings (so its hash differs): B's
        // first word is 8 units longer, so the same words sit at 38..68.
        highlight(conn, &a, (A, 30), (A, 60), "blue")?;
        let b_text = lower().replacen("aaaa", "AAAA-changed", 1);
        let b_words = AnchorInput {
            translation_id: b.clone(),
            start: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: 38,
            },
            end: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: 68,
            },
            quote: b_text[38..68].to_string(),
        };
        assert_eq!(
            b_words.quote,
            quote((A, 30), (A, 60)),
            "the very same words"
        );
        annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                color: Some("rose".into()),
                anchor: Some(b_words),
                ..Default::default()
            },
        )?;
        assert_eq!(count(conn, "deleted_at IS NULL"), 2, "independent");
        assert_eq!(shown(conn, &a), vec![mark("blue", (A, 30), (A, 60))]);
        assert_eq!(
            count(conn, "revision > 1"),
            0,
            "nothing was trimmed or recoloured"
        );

        // Highlighting over the first in its own wording leaves the other alone.
        highlight(conn, &a, (A, 40), (A, 50), "amber")?;
        assert_eq!(
            shown(conn, &a),
            vec![
                mark("blue", (A, 30), (A, 40)),
                mark("amber", (A, 40), (A, 50)),
                mark("blue", (A, 50), (A, 60)),
            ]
        );
        let on_b = shown(conn, &b);
        assert_eq!(on_b.len(), 1);
        assert_eq!(on_b[0].0, "rose");
        Ok(())
    });
}

#[test]
fn two_installs_of_the_same_wording_are_one_wording() {
    with_db(|conn| {
        let first = setup(conn);
        let second = install(conn, "usfm-wide", "WIDE2")?.id;
        highlight(conn, &first, (A, 0), (A, 50), "blue")?;
        // Another id and short name, identical text: the hashes agree.
        highlight(conn, &second, (A, 30), (A, 70), "rose")?;
        assert_eq!(
            shown(conn, &second),
            vec![
                mark("blue", (A, 0), (A, 30)),
                mark("rose", (A, 30), (A, 70))
            ]
        );
        Ok(())
    });
}

// ---- 14-16: other kinds are never touched -----------------------------------

#[test]
fn notes_whole_verse_highlights_and_bookmarks_are_never_changed() {
    with_db(|conn| {
        let t = setup(conn);
        let note = annotations::create(
            conn,
            &CreateAnnotation {
                reference: passage((A, 20), (A, 60)),
                kind: "note".into(),
                content: Some("Keep".into()),
                anchor: Some(anchor_input(&t, (A, 20), (A, 60))),
                ..Default::default()
            },
        )?;
        let verse = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                color: Some("green".into()),
                ..Default::default()
            },
        )?;
        let bookmark = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "bookmark".into(),
                ..Default::default()
            },
        )?;
        highlight(conn, &t, (A, 0), (A, 99), "blue")?;
        highlight(conn, &t, (A, 30), (A, 50), "rose")?;
        highlight(conn, &t, (A, 30), (A, 50), "blue")?;

        for before in [&note, &verse, &bookmark] {
            let after = annotations::get(conn, &before.id)?;
            assert_eq!(after.revision, before.revision, "{} untouched", before.kind);
            assert_eq!(after.updated_at, before.updated_at);
            assert_eq!(
                after
                    .anchor
                    .as_ref()
                    .map(|a| (a.start.offset, a.end.offset)),
                before
                    .anchor
                    .as_ref()
                    .map(|a| (a.start.offset, a.end.offset))
            );
            assert_eq!(after.color, before.color);
        }
        assert_eq!(
            annotations::get(conn, &verse.id)?.color.as_deref(),
            Some("green")
        );
        assert_eq!(count(conn, "kind = 'note' AND deleted_at IS NULL"), 1);
        assert_eq!(count(conn, "kind = 'bookmark' AND deleted_at IS NULL"), 1);
        Ok(())
    });
}

// ---- 17-18: UTF-16 and quotes -------------------------------------------------

#[test]
fn cuts_never_fall_inside_a_surrogate_pair() {
    with_db(|conn| {
        let t = setup(conn);
        // "ab 🍇🍇 cd": the grapes are units 3..7.
        highlight(conn, &t, (7, 3), (7, 7), "blue")?;
        highlight(conn, &t, (7, 5), (7, 10), "rose")?;
        assert_eq!(
            shown(conn, &t),
            vec![mark("blue", (7, 3), (7, 5)), mark("rose", (7, 5), (7, 10))]
        );
        let blue = &shown(conn, &t)[0];
        assert_eq!(blue.3, "🍇");
        // An offset between the two halves of a grape is refused, and changes nothing.
        let before = shown(conn, &t);
        let inside = AnchorInput {
            quote: "?".into(),
            ..anchor_input(&t, (7, 3), (7, 9))
        };
        let inside = AnchorInput {
            start: AnchorEnd {
                verse: "JHN.15.7".into(),
                offset: 4,
            },
            ..inside
        };
        let refused = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.7".into(),
                kind: "highlight".into(),
                color: Some("green".into()),
                anchor: Some(inside),
                ..Default::default()
            },
        );
        assert!(refused.is_err());
        assert_eq!(shown(conn, &t), before);
        Ok(())
    });
}

#[test]
fn remainders_keep_punctuation_and_whitespace_from_the_stored_text() {
    with_db(|conn| {
        let t = setup(conn);
        let len = units(&verse_text(8)).len() as u32;
        highlight(conn, &t, (8, 0), (8, len), "blue")?;
        // "he said;" — the offsets of the words inside the verse.
        let at = |s: &str| {
            let byte = verse_text(8).find(s).unwrap();
            verse_text(8)[..byte].encode_utf16().count() as u32
        };
        let (from, to) = (at("he said;"), at("he said;") + 8);
        highlight(conn, &t, (8, from), (8, to), "rose")?;
        let marks = shown(conn, &t);
        assert_eq!(marks.len(), 3);
        assert_eq!(marks[0].3, "“Abide in me,” ");
        assert_eq!(marks[1].3, "he said;");
        assert_eq!(marks[2].3, " “and I in you!”");
        Ok(())
    });
}

#[test]
fn a_remainder_of_only_whitespace_is_dropped() {
    with_db(|conn| {
        let t = setup(conn);
        // "uuuu " then a rose over "uuuu": all that is left of blue is a space.
        highlight(conn, &t, (6, 0), (6, 5), "blue")?;
        highlight(conn, &t, (6, 0), (6, 4), "rose")?;
        assert_eq!(shown(conn, &t), vec![mark("rose", (6, 0), (6, 4))]);
        assert_eq!(deleted(conn), 1);
        Ok(())
    });
}

// ---- 19-20: atomicity and deleted rows ------------------------------------------

#[test]
fn a_failure_part_way_leaves_nothing_half_done() {
    with_db(|conn| {
        let t = setup(conn);
        let old = highlight(conn, &t, (A, 0), (A, 99), "blue")?;
        let before = shown(conn, &t);
        // Make the last step — inserting the new rose highlight — fail,
        // after the old one has already been trimmed and split.
        conn.execute_batch(
            "CREATE TEMP TRIGGER fail_rose BEFORE INSERT ON main.annotations
             WHEN NEW.data LIKE '%\"color\":\"rose\"%'
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
        )?;
        assert!(highlight(conn, &t, (A, 30), (A, 60), "rose").is_err());
        assert_eq!(shown(conn, &t), before, "rolled back completely");
        let untouched = annotations::get(conn, &old.id)?;
        assert_eq!(untouched.revision, 1);
        assert_eq!(count(conn, "1 = 1"), 1, "no half-made rows");
        assert_eq!(deleted(conn), 0);

        // Once the cause is gone the same action works.
        conn.execute_batch("DROP TRIGGER fail_rose")?;
        highlight(conn, &t, (A, 30), (A, 60), "rose")?;
        assert_eq!(shown(conn, &t).len(), 3);
        Ok(())
    });
}

#[test]
fn deleted_highlights_are_ignored() {
    with_db(|conn| {
        let t = setup(conn);
        let gone = highlight(conn, &t, (A, 0), (A, 50), "blue")?;
        annotations::delete(conn, &gone.id)?;
        let kept = count(conn, "revision = 2");
        highlight(conn, &t, (A, 30), (A, 70), "rose")?;
        assert_eq!(shown(conn, &t), vec![mark("rose", (A, 30), (A, 70))]);
        // The deleted row was not trimmed, merged or revived.
        assert_eq!(count(conn, "revision = 2"), kept);
        // Nor does a deleted highlight of the same colour merge into a new one.
        highlight(conn, &t, (A, 80), (A, 90), "blue")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("rose", (A, 30), (A, 70)),
                mark("blue", (A, 80), (A, 90))
            ]
        );
        assert_eq!(deleted(conn), 1);
        Ok(())
    });
}

// ---- recolouring and legacy data -------------------------------------------------

#[test]
fn recolouring_a_phrase_highlight_follows_the_same_rules() {
    with_db(|conn| {
        let t = setup(conn);
        let blue = highlight(conn, &t, (A, 0), (A, 30), "blue")?;
        highlight(conn, &t, (A, 30), (A, 60), "rose")?;
        // Blue becomes rose and touches the other rose: one highlight.
        let result = annotations::update(
            conn,
            &UpdateAnnotation {
                id: blue.id.clone(),
                color: Some("rose".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(result.color.as_deref(), Some("rose"));
        assert_eq!(shown(conn, &t), vec![mark("rose", (A, 0), (A, 60))]);
        // Recolouring to the colour it already has changes nothing.
        let same = annotations::update(
            conn,
            &UpdateAnnotation {
                id: result.id.clone(),
                color: Some("rose".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(same.revision, result.revision);
        Ok(())
    });
}

/// A highlight written the way Phase 3 could (no normalisation).
fn legacy(conn: &Connection, translation: &str, from: Pos, to: Pos, color: &str) -> AppResult<()> {
    let (reference, anchor) =
        annotations::resolve_anchor(conn, &anchor_input(translation, from, to))?;
    let data = AnnotationData {
        v: 0,
        color: Some(color.into()),
        anchor: Some(anchor),
    };
    conn.execute(
        "INSERT INTO annotations (id, workspace_id, passage, start_key, end_key, translation_id, kind, content, data, created_at, updated_at)
         VALUES (?1, (SELECT id FROM workspaces LIMIT 1), ?2, ?3, ?4, ?5, 'highlight', '', ?6, ?7, ?7)",
        rusqlite::params![
            abiding_word_lib::db::new_id(),
            reference.canonical(),
            reference.start_key(),
            reference.end_key(),
            translation,
            data.to_stored(),
            abiding_word_lib::db::now()
        ],
    )?;
    Ok(())
}

#[test]
fn old_conflicting_highlights_stay_readable_and_are_fixed_where_touched() {
    with_db(|conn| {
        let t = setup(conn);
        legacy(conn, &t, (A, 0), (A, 50), "blue")?;
        legacy(conn, &t, (A, 30), (A, 70), "rose")?;
        // Listed as they were, overlap and all.
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 50)),
                mark("rose", (A, 30), (A, 70))
            ]
        );
        // A new highlight cuts both where it lies; the rest of the old overlap stays.
        highlight(conn, &t, (A, 40), (A, 45), "amber")?;
        assert_eq!(
            shown(conn, &t),
            vec![
                mark("blue", (A, 0), (A, 40)),
                mark("rose", (A, 30), (A, 40)),
                mark("amber", (A, 40), (A, 45)),
                mark("blue", (A, 45), (A, 50)),
                mark("rose", (A, 45), (A, 70)),
            ]
        );
        Ok(())
    });
}
