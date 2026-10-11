//! Generated contents (v0.13): for a source without contents of its own, the
//! headings found in its structure. PDFs are made here with lines at known
//! sizes; Markdown is imported through the real path. All synthetic.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::library::contents::{ContentsItem, ContentsTarget};
use abiding_word_lib::library::generated_contents::from_pdf;
use abiding_word_lib::library::import;
use abiding_word_lib::library::CommitSourceImport;

const PROSE: &str = "Every branch that bears fruit he prunes, that it may bear more fruit.";

/// A page: an optional heading near the top, prose, a running header and a page number.
fn page(number: i64, heading: Option<(i64, &str)>) -> Vec<(i64, i64, String)> {
    let mut lines = vec![(9, 815, "ABIDING IN THE VINE".to_string())];
    let mut y = 760;
    if let Some((size, text)) = heading {
        lines.push((size, y, text.to_string()));
        y -= 50;
    }
    for _ in 0..25 {
        lines.push((11, y, PROSE.to_string()));
        y -= 15;
    }
    lines.push((9, 30, number.to_string()));
    lines
}

fn flat(
    items: &[ContentsItem],
    depth: usize,
    out: &mut Vec<(usize, String, Option<ContentsTarget>)>,
) {
    for item in items {
        out.push((depth, item.title.clone(), item.target));
        flat(&item.children, depth + 1, out);
    }
}

#[test]
fn a_pdf_without_an_outline_gets_its_probable_headings_by_page() {
    let bytes = fixtures::pdf_styled(&[
        page(1, Some((22, "Chapter 1 The True Vine"))),
        page(2, Some((15, "Pruning"))),
        page(3, None),
        page(4, Some((15, "Remaining"))),
        page(5, Some((22, "Chapter 2 Love"))),
    ]);
    let mut found = Vec::new();
    flat(&from_pdf(&bytes), 0, &mut found);
    let page = |p| Some(ContentsTarget::Page { page: p });
    assert_eq!(
        found,
        [
            (0, "Chapter 1 The True Vine".to_string(), page(1)),
            (1, "Pruning".to_string(), page(2)),
            (1, "Remaining".to_string(), page(4)),
            (0, "Chapter 2 Love".to_string(), page(5)),
        ]
    );
}

#[test]
fn a_pdf_of_uniform_text_gets_no_generated_contents() {
    let bytes = fixtures::pdf_styled(&[page(1, None), page(2, None), page(3, None)]);
    assert!(from_pdf(&bytes).is_empty());
    assert!(from_pdf(b"not a pdf").is_empty());
}

#[test]
fn markdown_headings_become_generated_contents() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("notes.md");
    fs::write(
        &path,
        "# Abiding\n\nIntro.\n\n## In the vine\n\nText.\n\n## In his love\n\nText.\n\n# Fruit\n\nText.\n",
    )
    .unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| {
            let staged = import::stage(&path).unwrap();
            let id = abiding_word_lib::db::new_id();
            let relative = library::managed_relative_path(&id, &staged);
            library::commit_import(
                conn,
                &id,
                &staged,
                &CommitSourceImport {
                    preview_id: staged.id.clone(),
                    title: "Notes".into(),
                    ..Default::default()
                },
                &relative,
            )
            .unwrap();
            let mut found = Vec::new();
            flat(&library::generated_contents(conn, &id)?, 0, &mut found);
            let titles: Vec<(usize, &str)> =
                found.iter().map(|(d, t, _)| (*d, t.as_str())).collect();
            assert_eq!(
                titles,
                [
                    (0, "Abiding"),
                    (1, "In the vine"),
                    (1, "In his love"),
                    (0, "Fruit")
                ]
            );
            assert!(library::generated_contents(conn, "missing").is_err());
            Ok(())
        })
        .unwrap();
}
