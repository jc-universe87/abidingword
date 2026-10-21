//! The Bible passage in a material (v0.18.8): the text of each passage from
//! the one Bible chosen, in verse order with verse numbers; a verse that
//! Bible lacks is named, never taken from another Bible. Uses the bundled
//! Korean and German Bibles and a small fixture.

use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::error::AppResult;
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::reference::ScriptureRef;
use abiding_word_lib::scripture::CommitImport;
use rusqlite::Connection;

fn install(
    conn: &Connection,
    files: &[PathBuf],
    origin: ImportOrigin,
    short: &str,
    copyright: Option<&str>,
) -> AppResult<String> {
    let staged = import::stage(files, origin)?;
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: format!("Bible {short}"),
            short_name: short.into(),
            language: "Test".into(),
            language_code: None,
            publisher: None,
            copyright_notice: copyright.map(Into::into),
            license_type: None,
        },
        &SourceRecord {
            origin: "managed_copy",
            path: Some("sources/bibles/test".into()),
            original_file_name: Some("fixture".into()),
            format: "usfm",
            is_builtin: false,
        },
    )?;
    Ok(id)
}

fn bundled(id: &'static str, file: &str) -> (Vec<PathBuf>, ImportOrigin) {
    (
        vec![Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../resources/scripture/{id}/{file}"))],
        ImportOrigin::Bundled { id },
    )
}

fn fixture() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/usfm-a");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    files
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn r(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

#[test]
fn the_passage_comes_whole_and_in_order_from_the_chosen_bible() {
    with_db(|conn| {
        let (files, origin) = bundled("kor1961", "kor1961_usfm.zip");
        let korean = install(conn, &files, origin, "개역한글", Some("Public domain"))?;
        let (files, origin) = bundled("deu1912", "deu1912_usfm.zip");
        let german = install(conn, &files, origin, "LUT1912", None)?;
        let text = bibles::material_passages(conn, &korean, &[r("JHN.3.16-JHN.3.18")])?;
        assert_eq!(text.short_name, "개역한글");
        assert_eq!(text.copyright_notice.as_deref(), Some("Public domain"));
        let passage = &text.passages[0];
        assert_eq!(passage.canonical, "JHN.3.16-JHN.3.18");
        assert_eq!(
            passage.verses.iter().map(|v| v.verse).collect::<Vec<_>>(),
            [16, 17, 18]
        );
        assert!(passage.verses[0]
            .text
            .starts_with("하나님이 세상을 이처럼 사랑하사"));
        assert!(passage.missing.is_empty());

        // The other Bible gives its own words for the same passage, never mixed with the first.
        let de = bibles::material_passages(conn, &german, &[r("JHN.3.16-JHN.3.18")])?;
        assert!(
            de.passages[0].verses[0].text.contains("Gott"),
            "{}",
            de.passages[0].verses[0].text
        );
        assert!(!de.passages[0]
            .verses
            .iter()
            .any(|v| v.text.contains("하나님")));

        // Across a chapter break, and a long passage, still whole and in order.
        let long = bibles::material_passages(conn, &korean, &[r("ROM.7.1-ROM.8.39")])?;
        let verses = &long.passages[0].verses;
        assert_eq!(verses.len(), 25 + 39);
        assert_eq!((verses[0].chapter, verses[0].verse), (7, 1));
        assert_eq!((verses[25].chapter, verses[25].verse), (8, 1));
        assert!(verses
            .windows(2)
            .all(|w| (w[0].chapter, w[0].verse) < (w[1].chapter, w[1].verse)));
        Ok(())
    });
}

#[test]
fn a_verse_the_bible_lacks_is_named_and_not_taken_from_another_bible() {
    with_db(|conn| {
        let fixture = install(conn, &fixture(), ImportOrigin::UserFiles, "FXA", None)?;
        let (files, origin) = bundled("kor1961", "kor1961_usfm.zip");
        install(conn, &files, origin, "개역한글", None)?;
        // The fixture has only the first verses of John 15.
        let text = bibles::material_passages(conn, &fixture, &[r("JHN.15.1-JHN.15.27")])?;
        let passage = &text.passages[0];
        assert!(!passage.verses.is_empty());
        let have = passage.verses.len();
        assert_eq!(passage.missing.len(), 27 - have);
        assert_eq!(
            passage.missing.first().map(String::as_str),
            Some(format!("15:{}", have + 1).as_str())
        );
        assert!(passage
            .verses
            .iter()
            .all(|v| v.text.starts_with("Fixture alpha")));
        // A book the fixture does not have at all: nothing, everything named.
        let none = bibles::material_passages(conn, &fixture, &[r("GEN.1.1-GEN.1.3")])?;
        assert!(none.passages[0].verses.is_empty());
        assert_eq!(none.passages[0].missing, ["1:1", "1:2", "1:3"]);
        Ok(())
    });
}

#[test]
fn several_passages_keep_their_order_and_an_unknown_bible_is_refused() {
    with_db(|conn| {
        let fixture = install(conn, &fixture(), ImportOrigin::UserFiles, "FXA", None)?;
        let text =
            bibles::material_passages(conn, &fixture, &[r("JHN.15.4"), r("JHN.14.1-JHN.14.2")])?;
        assert_eq!(
            text.passages
                .iter()
                .map(|p| p.canonical.as_str())
                .collect::<Vec<_>>(),
            ["JHN.15.4", "JHN.14.1-JHN.14.2"]
        );
        assert_eq!(text.passages[1].verses.len(), 2);
        assert!(bibles::material_passages(conn, "no-such-bible", &[r("JHN.15.4")]).is_err());
        Ok(())
    });
}
