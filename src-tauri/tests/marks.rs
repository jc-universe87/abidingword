//! The Marks view's query: a page of the user's notes, highlights and
//! bookmarks in Scripture order (docs/scripture-annotations-v0.5.md).

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::SourceRecord;
use abiding_word_lib::db::{annotations, bibles, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::{
    AnchorEnd, AnchorInput, Annotation, BibleTranslation, CommitImport, CreateAnnotation,
    MarksQuery,
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

fn mark(
    conn: &Connection,
    kind: &str,
    reference: &str,
    content: Option<&str>,
    color: Option<&str>,
) -> Annotation {
    annotations::create(
        conn,
        &CreateAnnotation {
            reference: reference.into(),
            kind: kind.into(),
            content: content.map(Into::into),
            color: color.map(Into::into),
            ..Default::default()
        },
    )
    .unwrap()
}

fn refs(page: &abiding_word_lib::scripture::MarksPage) -> Vec<(&str, &str)> {
    page.marks
        .iter()
        .map(|m| (m.reference.canonical.as_str(), m.kind.as_str()))
        .collect()
}

/// Created out of Scripture order on purpose.
fn sample(conn: &Connection) {
    mark(
        conn,
        "note",
        "ROM.8.28",
        Some("Everything works together"),
        None,
    );
    mark(conn, "highlight", "JHN.15.5", None, Some("green"));
    mark(conn, "bookmark", "GEN.1.1", None, None);
    mark(conn, "highlight", "JHN.3.16", None, None); // default colour
    mark(
        conn,
        "note",
        "JHN.15.4",
        Some("Abide in him — Über alles"),
        None,
    );
    mark(conn, "highlight", "ROM.8.1", None, Some("blue"));
}

#[test]
fn marks_come_in_scripture_order_whatever_the_order_they_were_made_in() {
    with_db(|conn| {
        sample(conn);
        let page = annotations::marks(conn, &MarksQuery::default())?;
        assert_eq!(
            refs(&page),
            [
                ("GEN.1.1", "bookmark"),
                ("JHN.3.16", "highlight"),
                ("JHN.15.4", "note"),
                ("JHN.15.5", "highlight"),
                ("ROM.8.1", "highlight"),
                ("ROM.8.28", "note"),
            ]
        );
        assert!(!page.has_more);
        Ok(())
    });
}

#[test]
fn a_kind_a_book_and_a_colour_each_narrow_the_list() {
    with_db(|conn| {
        sample(conn);
        let by = |q: MarksQuery| annotations::marks(conn, &q).unwrap();
        let kind = |k: &str| MarksQuery {
            kind: Some(k.into()),
            ..Default::default()
        };
        assert_eq!(
            refs(&by(kind("note"))),
            [("JHN.15.4", "note"), ("ROM.8.28", "note")]
        );
        assert_eq!(refs(&by(kind("bookmark"))), [("GEN.1.1", "bookmark")]);
        assert_eq!(by(kind("highlight")).marks.len(), 3);

        let book = by(MarksQuery {
            book: Some("JHN".into()),
            ..Default::default()
        });
        assert_eq!(
            refs(&book),
            [
                ("JHN.3.16", "highlight"),
                ("JHN.15.4", "note"),
                ("JHN.15.5", "highlight")
            ]
        );
        let both = by(MarksQuery {
            book: Some("ROM".into()),
            kind: Some("highlight".into()),
            ..Default::default()
        });
        assert_eq!(refs(&both), [("ROM.8.1", "highlight")]);

        let green = by(MarksQuery {
            color: Some("green".into()),
            ..Default::default()
        });
        assert_eq!(refs(&green), [("JHN.15.5", "highlight")]);
        // A highlight with no stored colour is the default (amber).
        let amber = by(MarksQuery {
            color: Some("amber".into()),
            ..Default::default()
        });
        assert_eq!(refs(&amber), [("JHN.3.16", "highlight")]);
        assert!(by(MarksQuery {
            color: Some("rose".into()),
            ..Default::default()
        })
        .marks
        .is_empty());
        Ok(())
    });
}

#[test]
fn searching_looks_in_note_text_only_and_ignores_case_in_any_script() {
    with_db(|conn| {
        sample(conn);
        let find = |q: &str| {
            annotations::marks(
                conn,
                &MarksQuery {
                    query: Some(q.into()),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        assert_eq!(refs(&find("WORKS")), [("ROM.8.28", "note")]);
        assert_eq!(refs(&find("  together  ")), [("ROM.8.28", "note")]);
        // Non-ASCII letters fold too (ASCII-only LIKE would miss this).
        assert_eq!(refs(&find("über")), [("JHN.15.4", "note")]);
        assert_eq!(refs(&find("ÜBER ALLES")), [("JHN.15.4", "note")]);
        assert!(find("nothing like this").marks.is_empty());
        // Whitespace only is no search at all.
        assert_eq!(find("   ").marks.len(), 6);
        // Highlights and bookmarks have no words: a search never returns them.
        let with_kind = annotations::marks(
            conn,
            &MarksQuery {
                query: Some("a".into()),
                kind: Some("highlight".into()),
                ..Default::default()
            },
        )?;
        assert!(with_kind.marks.iter().all(|m| m.kind == "note"));
        // A search narrows within a book.
        let in_book = annotations::marks(
            conn,
            &MarksQuery {
                query: Some("abide".into()),
                book: Some("ROM".into()),
                ..Default::default()
            },
        )?;
        assert!(in_book.marks.is_empty());
        Ok(())
    });
}

#[test]
fn pages_are_bounded_and_say_whether_more_follow() {
    with_db(|conn| {
        for verse in 1..=7 {
            mark(
                conn,
                "note",
                &format!("PSA.23.{verse}"),
                Some(&format!("note {verse}")),
                None,
            );
        }
        let page = |offset, limit| {
            annotations::marks(
                conn,
                &MarksQuery {
                    limit: Some(limit),
                    offset: Some(offset),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let first = page(0, 3);
        assert_eq!(first.marks.len(), 3);
        assert!(first.has_more);
        assert_eq!(first.marks[0].reference.canonical, "PSA.23.1");
        let second = page(3, 3);
        assert_eq!(second.marks[0].reference.canonical, "PSA.23.4");
        assert!(second.has_more);
        let last = page(6, 3);
        assert_eq!(refs(&last), [("PSA.23.7", "note")]);
        assert!(!last.has_more);
        assert!(page(50, 3).marks.is_empty());
        // Pages continue exactly where the last stopped, under a search too.
        let searched = |offset| {
            annotations::marks(
                conn,
                &MarksQuery {
                    query: Some("note".into()),
                    limit: Some(4),
                    offset: Some(offset),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        assert_eq!(searched(0).marks.len(), 4);
        assert!(searched(0).has_more);
        assert_eq!(searched(4).marks.len(), 3);
        assert!(!searched(4).has_more);
        // The default page is moderate, and the largest one is capped.
        for verse in 1..=120 {
            mark(conn, "bookmark", &format!("ISA.40.{verse}"), None, None);
        }
        let all = annotations::marks(conn, &MarksQuery::default())?;
        assert_eq!(all.marks.len(), 30);
        assert!(all.has_more);
        let huge = annotations::marks(
            conn,
            &MarksQuery {
                limit: Some(10_000),
                ..Default::default()
            },
        )?;
        assert_eq!(huge.marks.len(), 100);
        Ok(())
    });
}

#[test]
fn deleted_marks_are_never_listed() {
    with_db(|conn| {
        sample(conn);
        let gone = mark(conn, "note", "MAT.5.3", Some("temporary"), None);
        assert_eq!(
            annotations::marks(conn, &MarksQuery::default())?
                .marks
                .len(),
            7
        );
        annotations::delete(conn, &gone.id)?;
        let page = annotations::marks(conn, &MarksQuery::default())?;
        assert_eq!(page.marks.len(), 6);
        assert!(page.marks.iter().all(|m| m.id != gone.id));
        let found = annotations::marks(
            conn,
            &MarksQuery {
                query: Some("temporary".into()),
                ..Default::default()
            },
        )?;
        assert!(found.marks.is_empty());
        Ok(())
    });
}

#[test]
fn phrase_marks_keep_their_quote_and_say_whether_the_wording_fits() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let b = install(conn, "usfm-b", "FXB")?;
        let text = "Fixture alpha fifteen four about remaining.";
        let at = text.find("about remaining").unwrap() as u32;
        let anchor = AnchorInput {
            translation_id: a.id.clone(),
            start: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: at,
            },
            end: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: at + 15,
            },
            quote: "about remaining".into(),
        };
        annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                color: Some("rose".into()),
                anchor: Some(anchor),
                ..Default::default()
            },
        )?;
        mark(conn, "bookmark", "JHN.15.1", None, None);
        let show = |translation: &str| {
            annotations::marks(
                conn,
                &MarksQuery {
                    translation_id: Some(translation.into()),
                    color: Some("rose".into()),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let in_a = show(&a.id);
        let anchor = in_a.marks[0].anchor.clone().unwrap();
        assert_eq!(anchor.quote, "about remaining");
        assert!(
            anchor.shown,
            "same wording in the translation it was made in"
        );
        assert!(
            !show(&b.id).marks[0].anchor.clone().unwrap().shown,
            "different wording"
        );
        // Without a translation nothing is drawn, but the mark is still listed.
        let none = annotations::marks(conn, &MarksQuery::default())?;
        assert_eq!(none.marks.len(), 2);
        assert!(!none.marks[1].anchor.clone().unwrap().shown);
        assert!(
            none.marks[0].anchor.is_none(),
            "a whole-verse bookmark has no anchor"
        );
        Ok(())
    });
}

#[test]
fn unknown_choices_are_refused_and_a_damaged_colour_record_does_not_break_the_list() {
    with_db(|conn| {
        sample(conn);
        for bad in [
            MarksQuery {
                kind: Some("tag".into()),
                ..Default::default()
            },
            MarksQuery {
                book: Some("ZZZ".into()),
                ..Default::default()
            },
            MarksQuery {
                color: Some("purple".into()),
                ..Default::default()
            },
        ] {
            assert!(annotations::marks(conn, &bad).is_err());
        }
        // A highlight whose stored data is not valid JSON counts as the default colour.
        conn.execute(
            "UPDATE annotations SET data = 'not json' WHERE passage = 'JHN.15.5'",
            [],
        )?;
        let amber = annotations::marks(
            conn,
            &MarksQuery {
                color: Some("amber".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(amber.marks.len(), 2);
        Ok(())
    });
}

#[test]
fn overlapping_highlights_are_listed_as_the_normalised_pieces() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let text = "Fixture alpha fifteen four about remaining.";
        let range = |words: &str| {
            let at = text.find(words).unwrap() as u32;
            AnchorInput {
                translation_id: a.id.clone(),
                start: AnchorEnd {
                    verse: "JHN.15.4".into(),
                    offset: at,
                },
                end: AnchorEnd {
                    verse: "JHN.15.4".into(),
                    offset: at + words.len() as u32,
                },
                quote: words.into(),
            }
        };
        let make = |words: &str, color: &str| {
            annotations::create(
                conn,
                &CreateAnnotation {
                    reference: "JHN.15.4".into(),
                    kind: "highlight".into(),
                    color: Some(color.into()),
                    anchor: Some(range(words)),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        make("about remaining", "green");
        make("remaining", "rose"); // the physical highlighter: the new colour owns its words
        let listed = annotations::marks(
            conn,
            &MarksQuery {
                kind: Some("highlight".into()),
                translation_id: Some(a.id.clone()),
                ..Default::default()
            },
        )?;
        let pieces: Vec<(String, String)> = listed
            .marks
            .iter()
            .map(|m| (m.color.clone().unwrap(), m.anchor.clone().unwrap().quote))
            .collect();
        assert_eq!(
            pieces,
            [
                ("green".to_string(), "about ".to_string()),
                ("rose".to_string(), "remaining".to_string())
            ]
        );
        assert!(listed.marks.iter().all(|m| m.anchor.clone().unwrap().shown));
        // The colour filter sees the same pieces.
        let rose = annotations::marks(
            conn,
            &MarksQuery {
                color: Some("rose".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(rose.marks.len(), 1);
        Ok(())
    });
}

#[test]
fn marks_survive_closing_and_reopening_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("abiding-word.sqlite");
    let backups = dir.path().join("backups");
    {
        let db = Database::open(&path, &backups).unwrap();
        db.with_conn(|conn| {
            mark(
                conn,
                "note",
                "ROM.8.28",
                Some("Kept across a restart"),
                None,
            );
            mark(conn, "highlight", "JHN.15.5", None, Some("blue"));
            let gone = mark(conn, "bookmark", "GEN.1.1", None, None);
            annotations::delete(conn, &gone.id)?;
            Ok(())
        })
        .unwrap();
    }
    let db = Database::open(&path, &backups).unwrap();
    db.with_conn(|conn| {
        let page = annotations::marks(conn, &MarksQuery::default())?;
        assert_eq!(
            refs(&page),
            [("JHN.15.5", "highlight"), ("ROM.8.28", "note")]
        );
        assert_eq!(page.marks[0].color.as_deref(), Some("blue"));
        assert_eq!(page.marks[1].content, "Kept across a restart");
        Ok(())
    })
    .unwrap();
}
