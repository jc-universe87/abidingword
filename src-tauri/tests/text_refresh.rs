//! Refreshing the stored text of EPUBs imported by an earlier version
//! (v0.13.1): literal references and paragraphs lost after a stray `&` are
//! repaired from the managed copy, segment ids are kept, the passage index is
//! rebuilt, and it happens once. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;

use abiding_word_lib::db::text_refresh::ensure_extracted_text;
use abiding_word_lib::db::{library, source_annotations, Database};
use abiding_word_lib::library::annotations::{AnchorState, CreateSourceAnnotation, TextPoint};
use abiding_word_lib::library::import;
use abiding_word_lib::library::CommitSourceImport;
use rusqlite::Connection;

const XHTML: &str = r#"media-type="application/xhtml+xml""#;

fn rows(conn: &Connection, id: &str) -> Vec<(String, String)> {
    conn.prepare("SELECT id, content FROM source_segments WHERE source_id = ?1 ORDER BY position")
        .unwrap()
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn an_epub_imported_by_an_earlier_version_is_repaired_in_place_once() {
    let chapter = fixtures::xhtml(
        "<h1>John 15</h1><p>Abide &dagger; in me (John 15:4).</p><p>Q&A follows.</p><p>The last paragraph.</p>",
    );
    let bytes = fixtures::epub_raw_binary(
        &format!(r#"<item id="c1" href="ch1.xhtml" {XHTML}/>"#),
        r#"<itemref idref="c1"/>"#,
        &[("OEBPS/ch1.xhtml", chapter.as_bytes())],
    );
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("sources");
    let file = temp.path().join("book.epub");
    fs::write(&file, &bytes).unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| {
            let staged = import::stage(&file).unwrap();
            let id = abiding_word_lib::db::new_id();
            let relative = library::managed_relative_path(&id, &staged);
            library::commit_import(
                conn,
                &id,
                &staged,
                &CommitSourceImport {
                    preview_id: staged.id.clone(),
                    title: "Book".into(),
                    language: Some("en".into()),
                    ..Default::default()
                },
                &relative,
            )?;
            let target = root.join(&relative);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, &bytes).unwrap();
            let good = rows(conn, &id);
            assert_eq!(good.len(), 3);

            // What an earlier version stored: the reference literal, the chapter cut at "Q&A".
            conn.execute(
                "UPDATE source_segments SET content = 'Abide &dagger; in me (John 15:4).' WHERE id = ?1",
                [&good[0].0],
            )?;
            conn.execute("UPDATE source_segments SET content = 'Q' WHERE id = ?1", [&good[1].0])?;
            conn.execute("DELETE FROM source_segments WHERE id = ?1", [&good[2].0])?;
            library::reindex_passages(conn, &id)?;

            // Marks made on the old text (v0.14): a highlight after the broken
            // entity, which moves in the repaired text.
            let point = |offset| TextPoint {
                segment_id: good[0].0.clone(),
                offset,
            };
            let start = "Abide &dagger; ".encode_utf16().count() as u32;
            let mark = source_annotations::create(
                conn,
                &CreateSourceAnnotation {
                    source_id: id.clone(),
                    kind: "highlight".into(),
                    start: Some(point(start)),
                    end: Some(point(start + 5)),
                    quote: Some("in me".into()),
                    ..Default::default()
                },
            )?;

            let report = ensure_extracted_text(conn, &root)?;
            assert_eq!((report.checked, report.updated, report.failed), (1, 1, 0));
            let repaired = rows(conn, &id);
            let texts: Vec<&str> = repaired.iter().map(|(_, t)| t.as_str()).collect();
            assert_eq!(texts, ["Abide † in me (John 15:4).", "Q&A follows.", "The last paragraph."]);
            // the paragraph that was still there keeps its id (citations keep working)
            assert_eq!(repaired[0].0, good[0].0);
            // the reference is found at its new place in the repaired text
            let refs = library::source_references(conn, &id)?;
            assert_eq!(refs.len(), 1);
            let units: Vec<u16> = texts[0].encode_utf16().collect();
            assert_eq!(
                String::from_utf16(&units[refs[0].start as usize..refs[0].end as usize]).unwrap(),
                "John 15:4"
            );
            // the highlight is on the same words in the repaired text
            let moved = source_annotations::get(conn, &mark.id)?;
            assert_eq!(moved.state, AnchorState::Moved);
            assert_eq!(moved.start.as_ref().unwrap().segment_id, good[0].0);
            assert_eq!(
                moved.start.as_ref().unwrap().offset,
                Some("Abide † ".encode_utf16().count() as u32)
            );
            assert_eq!(moved.quote.as_deref(), Some("in me"));
            // done once: a second start changes nothing
            assert_eq!(ensure_extracted_text(conn, &root)?.checked, 0);
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_missing_file_is_left_as_it_was_and_tried_again() {
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| {
            let temp = tempfile::tempdir().unwrap();
            let bytes = fixtures::epub_raw_binary(
                &format!(r#"<item id="c1" href="ch1.xhtml" {XHTML}/>"#),
                r#"<itemref idref="c1"/>"#,
                &[(
                    "OEBPS/ch1.xhtml",
                    fixtures::xhtml("<p>Text.</p>").as_bytes(),
                )],
            );
            let file = temp.path().join("book.epub");
            fs::write(&file, &bytes).unwrap();
            let staged = import::stage(&file).unwrap();
            let id = abiding_word_lib::db::new_id();
            let relative = library::managed_relative_path(&id, &staged);
            library::commit_import(
                conn,
                &id,
                &staged,
                &CommitSourceImport {
                    preview_id: staged.id.clone(),
                    title: "Book".into(),
                    ..Default::default()
                },
                &relative,
            )?;
            // the managed copy was never written
            let report = ensure_extracted_text(conn, &temp.path().join("sources"))?;
            assert_eq!((report.checked, report.failed), (1, 1));
            assert_eq!(rows(conn, &id).len(), 1);
            assert_eq!(
                ensure_extracted_text(conn, &temp.path().join("sources"))?.checked,
                1
            );
            Ok(())
        })
        .unwrap();
}
