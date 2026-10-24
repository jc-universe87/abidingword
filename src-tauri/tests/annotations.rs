//! Scripture annotations v0.5: highlight colours and phrase anchors tied to
//! exact wording (docs/scripture-annotations-v0.5.md).

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::SourceRecord;
use abiding_word_lib::db::{annotations, bibles, Database};
use abiding_word_lib::error::AppResult;
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
            words: Default::default(),
            as_document: false,
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

fn r(value: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(value).unwrap()
}

// Stored fixture text (usfm-a).
const A4: &str = "Fixture alpha fifteen four about remaining.";
const A5: &str = "Fixture alpha fifteen five.";

/// A selection of `words` in `text` of one verse (ASCII fixtures, so byte
/// and UTF-16 offsets agree).
fn words(translation: &str, verse: &str, text: &str, words: &str) -> AnchorInput {
    let at = text.find(words).unwrap() as u32;
    AnchorInput {
        translation_id: translation.into(),
        start: AnchorEnd {
            verse: verse.into(),
            offset: at,
        },
        end: AnchorEnd {
            verse: verse.into(),
            offset: at + words.len() as u32,
        },
        quote: words.into(),
    }
}

fn phrase(
    conn: &Connection,
    kind: &str,
    reference: &str,
    anchor: AnchorInput,
    color: Option<&str>,
) -> AppResult<Annotation> {
    annotations::create(
        conn,
        &CreateAnnotation {
            reference: reference.into(),
            kind: kind.into(),
            content: (kind == "note").then(|| "Keep going".into()),
            color: color.map(Into::into),
            anchor: Some(anchor),
            ..Default::default()
        },
    )
}

#[test]
fn phrase_highlights_are_drawn_only_in_identical_wording() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let b = install(conn, "usfm-b", "FXB")?;
        let mark = phrase(
            conn,
            "highlight",
            "JHN.15.4",
            words(&a.id, "JHN.15.4", A4, "about remaining"),
            None,
        )?;
        assert_eq!(mark.color.as_deref(), Some("amber"), "default colour");
        assert_eq!(mark.translation_id.as_deref(), Some(a.id.as_str()));
        assert_eq!(mark.reference.canonical, "JHN.15.4");
        let anchor = mark.anchor.clone().unwrap();
        assert_eq!(anchor.quote, "about remaining");
        assert_eq!(anchor.translation_short_name, "FXA");
        assert!(anchor.shown, "drawn in the translation it was made in");

        let in_a = annotations::list_for(conn, &r("JHN.15"), Some(&a.id))?;
        assert!(in_a[0].anchor.as_ref().unwrap().shown);
        let in_b = annotations::list_for(conn, &r("JHN.15"), Some(&b.id))?;
        assert_eq!(in_b.len(), 1, "kept in every translation");
        assert!(
            !in_b[0].anchor.as_ref().unwrap().shown,
            "never drawn on other wording"
        );
        let unknown = annotations::list(conn, &r("JHN.15"))?;
        assert!(!unknown[0].anchor.as_ref().unwrap().shown);
        Ok(())
    });
}

#[test]
fn phrase_marks_span_verses_within_one_chapter() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let start = A4.find("remaining").unwrap() as u32;
        let across = AnchorInput {
            translation_id: a.id.clone(),
            start: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: start,
            },
            end: AnchorEnd {
                verse: "JHN.15.5".into(),
                offset: "Fixture alpha".len() as u32,
            },
            quote: "remaining. Fixture alpha".into(),
        };
        let view = annotations::check_anchor(conn, &across)?;
        assert_eq!(view.quote, "remaining. Fixture alpha");
        assert_eq!(
            (view.start.verse.as_str(), view.end.verse.as_str()),
            ("JHN.15.4", "JHN.15.5")
        );
        assert!(view.shown);
        assert!(
            annotations::list(conn, &r("JHN.15"))?.is_empty(),
            "checking saves nothing"
        );

        let mark = phrase(
            conn,
            "highlight",
            "JHN.15.4-JHN.15.5",
            across.clone(),
            Some("blue"),
        )?;
        assert_eq!(mark.reference.canonical, "JHN.15.4-JHN.15.5");
        assert_eq!(mark.color.as_deref(), Some("blue"));

        // The passage must be the verses the words are in.
        assert!(phrase(conn, "highlight", "JHN.15.4", across.clone(), None).is_err());
        // Not across chapters.
        let chapters = AnchorInput {
            end: AnchorEnd {
                verse: "JHN.16.1".into(),
                offset: 3,
            },
            ..across
        };
        assert!(annotations::check_anchor(conn, &chapters).is_err());
        Ok(())
    });
}

#[test]
fn phrase_anchors_refuse_anything_that_does_not_match_the_text() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let good = words(&a.id, "JHN.15.4", A4, "about remaining");
        let wrong_quote = AnchorInput {
            quote: "about remainder".into(),
            ..good.clone()
        };
        assert!(annotations::check_anchor(conn, &wrong_quote).is_err());
        let beyond = AnchorInput {
            end: AnchorEnd {
                verse: "JHN.15.4".into(),
                offset: 500,
            },
            ..good.clone()
        };
        assert!(annotations::check_anchor(conn, &beyond).is_err());
        let not_a_verse = AnchorInput {
            start: AnchorEnd {
                verse: "JHN.15".into(),
                offset: 0,
            },
            ..good.clone()
        };
        assert!(annotations::check_anchor(conn, &not_a_verse).is_err());
        let missing_bible = AnchorInput {
            translation_id: "nope".into(),
            ..good.clone()
        };
        assert!(annotations::check_anchor(conn, &missing_bible).is_err());

        // Bookmarks are whole verses; colours are for highlights.
        assert!(phrase(conn, "bookmark", "JHN.15.4", good.clone(), None).is_err());
        assert!(phrase(conn, "note", "JHN.15.4", good.clone(), Some("rose")).is_err());
        assert!(phrase(conn, "highlight", "JHN.15.4", good.clone(), Some("yellow")).is_err());
        // A translation given beside the anchor must be the same one.
        let b = install(conn, "usfm-b", "FXB")?;
        assert!(annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                translation_id: Some(b.id.clone()),
                anchor: Some(good),
                ..Default::default()
            }
        )
        .is_err());
        assert!(annotations::list(conn, &r("JHN.15"))?.is_empty());
        Ok(())
    });
}

#[test]
fn the_same_words_again_recolour_instead_of_duplicating() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let first = phrase(
            conn,
            "highlight",
            "JHN.15.4",
            words(&a.id, "JHN.15.4", A4, "about remaining"),
            Some("green"),
        )?;
        let again = phrase(
            conn,
            "highlight",
            "JHN.15.4",
            words(&a.id, "JHN.15.4", A4, "about remaining"),
            Some("rose"),
        )?;
        assert_eq!(first.id, again.id);
        assert_eq!(again.color.as_deref(), Some("rose"));
        let other = phrase(
            conn,
            "highlight",
            "JHN.15.4",
            words(&a.id, "JHN.15.4", A4, "fifteen"),
            None,
        )?;
        assert_ne!(other.id, first.id, "other words in the same verse");
        // A verse highlight is separate from phrase highlights in it.
        let verse = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                ..Default::default()
            },
        )?;
        assert!(verse.anchor.is_none());
        assert_eq!(annotations::list(conn, &r("JHN.15.4"))?.len(), 3);
        Ok(())
    });
}

#[test]
fn phrase_notes_keep_their_quote_in_every_translation() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let b = install(conn, "usfm-b", "FXB")?;
        let note = phrase(
            conn,
            "note",
            "JHN.15.5",
            words(&a.id, "JHN.15.5", A5, "fifteen five"),
            None,
        )?;
        assert_eq!(note.color, None);
        let twin = phrase(
            conn,
            "note",
            "JHN.15.5",
            words(&a.id, "JHN.15.5", A5, "fifteen five"),
            None,
        )?;
        assert_ne!(note.id, twin.id, "notes are never merged");
        let in_b = annotations::list_for(conn, &r("JHN.15.5"), Some(&b.id))?;
        assert_eq!(in_b.len(), 2);
        let anchor = in_b[0].anchor.as_ref().unwrap();
        assert_eq!(
            (anchor.quote.as_str(), anchor.shown),
            ("fifteen five", false)
        );
        assert_eq!(in_b[0].content, "Keep going");
        Ok(())
    });
}

#[test]
fn removing_and_adding_the_same_bible_again_restores_the_phrase() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let mark = phrase(
            conn,
            "highlight",
            "JHN.15.4",
            words(&a.id, "JHN.15.4", A4, "about remaining"),
            Some("blue"),
        )?;
        bibles::remove(conn, &a.id)?;

        let kept = annotations::get(conn, &mark.id)?;
        assert_eq!(kept.translation_id, None, "translation link dropped");
        let anchor = kept.anchor.unwrap();
        assert_eq!(anchor.quote, "about remaining");
        assert_eq!(anchor.translation_short_name, "FXA", "provenance kept");
        assert_eq!(kept.color.as_deref(), Some("blue"));

        // Same text, new id.
        let again = install(conn, "usfm-a", "FXA2")?;
        assert_ne!(again.id, a.id);
        let listed = annotations::list_for(conn, &r("JHN.15"), Some(&again.id))?;
        assert!(
            listed[0].anchor.as_ref().unwrap().shown,
            "identical wording is drawn again"
        );
        // A different edition is not.
        let other = install(conn, "usfm-b", "FXB")?;
        let listed = annotations::list_for(conn, &r("JHN.15"), Some(&other.id))?;
        assert!(!listed[0].anchor.as_ref().unwrap().shown);
        Ok(())
    });
}

#[test]
fn verse_highlights_have_colours_and_old_ones_are_amber() {
    with_db(|conn| {
        install(conn, "usfm-a", "FXA")?;
        let highlight = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.1".into(),
                kind: "highlight".into(),
                ..Default::default()
            },
        )?;
        assert_eq!(highlight.color.as_deref(), Some("amber"));
        let again = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.1".into(),
                kind: "highlight".into(),
                color: Some("green".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(
            (again.id.as_str(), again.color.as_deref()),
            (highlight.id.as_str(), Some("green"))
        );

        let recoloured = annotations::update(
            conn,
            &UpdateAnnotation {
                id: highlight.id.clone(),
                color: Some("grey".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(recoloured.color.as_deref(), Some("grey"));
        assert!(annotations::update(
            conn,
            &UpdateAnnotation {
                id: highlight.id.clone(),
                color: Some("purple".into()),
                ..Default::default()
            },
        )
        .is_err());

        // A v0.2 highlight: no data at all, or an empty value.
        for legacy in [None, Some("")] {
            conn.execute(
                "UPDATE annotations SET data = ?2 WHERE id = ?1",
                rusqlite::params![highlight.id, legacy],
            )?;
            let old = annotations::get(conn, &highlight.id)?;
            assert_eq!(old.color.as_deref(), Some("amber"));
            assert!(old.anchor.is_none());
        }

        let note = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.1".into(),
                kind: "note".into(),
                content: Some("Vine".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(note.color, None);
        assert!(annotations::update(
            conn,
            &UpdateAnnotation {
                id: note.id.clone(),
                color: Some("rose".into()),
                ..Default::default()
            },
        )
        .is_err());
        let bookmark = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.1".into(),
                kind: "bookmark".into(),
                ..Default::default()
            },
        )?;
        assert_eq!(bookmark.color, None);
        let stored: Option<String> = conn.query_row(
            "SELECT data FROM annotations WHERE id = ?1",
            [&note.id],
            |r| r.get(0),
        )?;
        assert_eq!(stored, None, "plain notes store no data");
        Ok(())
    });
}

/// The stable code and values of a refused request.
fn refused_with<T: std::fmt::Debug>(result: AppResult<T>) -> (String, Vec<(String, String)>) {
    let error = result.unwrap_err();
    let (code, params) = error.user_code();
    (
        code.expect("a user-facing annotation error carries a code")
            .to_string(),
        params
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}

#[test]
fn refused_annotation_requests_carry_stable_codes() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let good = words(&a.id, "JHN.15.4", A4, "about remaining");
        let code = |result| refused_with::<Annotation>(result).0;

        // Bookmarks are whole verses.
        assert_eq!(
            code(phrase(conn, "bookmark", "JHN.15.4", good.clone(), None)),
            "annotations.bookmarkWholeVerse"
        );
        // Colours are for highlights only.
        assert_eq!(
            code(phrase(conn, "note", "JHN.15.4", good.clone(), Some("rose"))),
            "annotations.colorOnlyHighlight"
        );
        // An unknown colour and an unknown kind.
        let (c, p) = refused_with(phrase(
            conn,
            "highlight",
            "JHN.15.4",
            good.clone(),
            Some("yellow"),
        ));
        assert_eq!(c, "invalidChoice");
        assert_eq!(p, vec![("value".to_string(), "yellow".to_string())]);
        assert_eq!(
            code(phrase(conn, "underline", "JHN.15.4", good.clone(), None)),
            "invalidChoice"
        );
        // Words that are not the stored wording.
        let wrong = AnchorInput {
            quote: "about remainder".into(),
            ..good.clone()
        };
        assert_eq!(
            refused_with(annotations::check_anchor(conn, &wrong)).0,
            "annotations.wordingMismatch"
        );
        // Words from another passage than the one named.
        assert_eq!(
            code(phrase(conn, "highlight", "JHN.15.5", good.clone(), None)),
            "annotations.notInPassage"
        );
        // A selection across chapters.
        let across = AnchorInput {
            end: AnchorEnd {
                verse: "JHN.16.1".into(),
                offset: 5,
            },
            ..good.clone()
        };
        assert_eq!(
            refused_with(annotations::check_anchor(conn, &across)).0,
            "annotations.oneChapter"
        );
        // A selection that selects nothing.
        let empty = AnchorInput {
            end: good.start.clone(),
            quote: String::new(),
            ..good.clone()
        };
        assert_eq!(
            refused_with(annotations::check_anchor(conn, &empty)).0,
            "annotations.nothingSelected"
        );
        // A note that is too long.
        let long = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "note".into(),
                content: Some("x".repeat(20_001)),
                ..Default::default()
            },
        );
        assert_eq!(code(long), "annotations.tooLong");
        // A phrase's end must name a single verse.
        let chapter = AnchorInput {
            start: AnchorEnd {
                verse: "JHN.15".into(),
                offset: 0,
            },
            ..good
        };
        let (c, p) = refused_with(annotations::check_anchor(conn, &chapter));
        assert_eq!(c, "annotations.notSingleVerse");
        assert_eq!(p, vec![("passage".to_string(), "JHN.15".to_string())]);
        Ok(())
    });
}

#[test]
fn a_verse_highlight_is_translation_independent() {
    with_db(|conn| {
        let a = install(conn, "usfm-a", "FXA")?;
        let b = install(conn, "usfm-b", "FXB")?;
        let verse = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "highlight".into(),
                color: Some("blue".into()),
                ..Default::default()
            },
        )?;
        assert!(verse.anchor.is_none() && verse.translation_id.is_none());
        for translation in [&a.id, &b.id] {
            let listed = annotations::list_for(conn, &r("JHN.15"), Some(translation))?;
            assert_eq!(listed.len(), 1);
            assert_eq!(listed[0].color.as_deref(), Some("blue"));
            assert!(listed[0].anchor.is_none());
        }
        // A whole-verse bookmark is likewise independent.
        let bookmark = annotations::create(
            conn,
            &CreateAnnotation {
                reference: "JHN.15.4".into(),
                kind: "bookmark".into(),
                ..Default::default()
            },
        )?;
        assert!(bookmark.color.is_none() && bookmark.anchor.is_none());
        Ok(())
    });
}
