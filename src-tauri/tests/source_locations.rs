//! Expanding "more places in this source" (second v0.9 Windows acceptance): the
//! pane shows a source's best few places and a count; the rest must be
//! reachable, by the same relevance rules and in the same order. Every source
//! here is invented, imported through the real path (stage, commit, index).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import;
use abiding_word_lib::library::{CommitSourceImport, PassageLocation, PassageSourceGroup};
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::Connection;

fn add(
    conn: &Connection,
    dir: &Path,
    file: &str,
    text: &str,
    title: &str,
    language: &str,
) -> String {
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
            title: title.into(),
            language: Some(language.into()),
            ..Default::default()
        },
        &relative,
    )
    .unwrap();
    id
}

fn reference(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

fn groups(conn: &Connection, canonical: &str) -> Vec<PassageSourceGroup> {
    library::passage_sources(conn, &reference(canonical)).unwrap()
}

fn expanded(conn: &Connection, source_id: &str, canonical: &str) -> Vec<PassageLocation> {
    library::passage_source_locations(conn, &reference(canonical), source_id).unwrap()
}

fn ids(places: &[PassageLocation]) -> Vec<&str> {
    places.iter().map(|p| p.segment_id.as_str()).collect()
}

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

/// A source whose twenty sections each cross-reference John 15:5: the initial
/// group shows three, 17 more qualify.
fn cross_reference_source(conn: &Connection, dir: &Path) -> String {
    let mut text = String::from("# Study Bible\n\n");
    for n in 1..=20 {
        text.push_str(&format!(
            "## Cross-references for Matthew {n}:1\n\nCompare John 15:5 here ({n}).\n\n"
        ));
    }
    add(conn, dir, "k.md", &text, "K Study Bible", "English")
}

#[test]
fn the_initial_group_still_shows_three_places_with_the_right_remainder() {
    with_db(|conn, dir| {
        let id = cross_reference_source(conn, dir);
        let found = groups(conn, "JHN.15.5");
        let k = found.iter().find(|g| g.source_id == id).unwrap();
        assert_eq!(k.locations.len(), library::LOCATIONS_PER_SOURCE);
        assert_eq!(k.more_locations, 17);
        Ok(())
    });
}

#[test]
fn expanding_returns_every_qualifying_place_and_starts_with_the_initial_three() {
    with_db(|conn, dir| {
        let id = cross_reference_source(conn, dir);
        let found = groups(conn, "JHN.15.5");
        let k = found.iter().find(|g| g.source_id == id).unwrap();
        let all = expanded(conn, &id, "JHN.15.5");
        assert_eq!(all.len(), 20);
        assert_eq!(
            all.len() as i64,
            k.locations.len() as i64 + k.more_locations
        );
        // The same order as the pane: its three are the first three.
        assert_eq!(ids(&all[..3]), ids(&k.locations));
        assert_eq!(all[..3], k.locations[..]);
        // Each place is one segment.
        let mut unique = ids(&all);
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), all.len());
        // Equal input, equal output.
        assert_eq!(expanded(conn, &id, "JHN.15.5"), all);
        Ok(())
    });
}

#[test]
fn places_the_relevance_model_excludes_are_not_brought_back() {
    with_db(|conn, dir| {
        // Two places for John 15:5 (the section, a neutral mention below a
        // heading without a passage) and others that never qualified: a verse of
        // the same chapter that does not overlap, another chapter, another book.
        let id = add(
            conn,
            dir,
            "m.md",
            "# M\n\n## John 15:1–11\n\nThe vine.\n\n## Elsewhere\n\nSee John 15:5.\n\nAlso John 15:20 and John 6:1 and Romans 8:1.\n",
            "M Mixed",
            "English",
        );
        let all = expanded(conn, &id, "JHN.15.5");
        assert!(!all.is_empty());
        for place in &all {
            // Every place shares a verse with the passage.
            assert_ne!(
                place.reference.canonical, "JHN.15.20",
                "a same-chapter place that shares no verse was offered"
            );
            assert_ne!(place.reference.canonical, "JHN.6.1");
            assert_ne!(place.reference.canonical, "ROM.8.1");
        }
        let found = groups(conn, "JHN.15.5");
        let m = found.iter().find(|g| g.source_id == id).unwrap();
        assert_eq!(
            all.len() as i64,
            m.locations.len() as i64 + m.more_locations
        );
        Ok(())
    });
}

#[test]
fn a_source_with_only_same_chapter_mentions_has_no_places() {
    with_db(|conn, dir| {
        let id = add(
            conn,
            dir,
            "n.md",
            "# N\n\n## Notes\n\nSee John 15:20 only.\n",
            "N Same Chapter",
            "English",
        );
        assert!(expanded(conn, &id, "JHN.15.5").is_empty());
        assert!(groups(conn, "JHN.15.5").iter().all(|g| g.source_id != id));
        Ok(())
    });
}

#[test]
fn a_section_and_the_paragraphs_inside_it_are_still_one_place() {
    with_db(|conn, dir| {
        let id = add(
            conn,
            dir,
            "o.md",
            "# O\n\n## John 15:1–11\n\nThe vine, see John 15:5.\n\nAgain John 15:5 and John 15:5.\n",
            "O One Section",
            "English",
        );
        let all = expanded(conn, &id, "JHN.15.5");
        let found = groups(conn, "JHN.15.5");
        let o = found.iter().find(|g| g.source_id == id).unwrap();
        assert_eq!(
            all.len() as i64,
            o.locations.len() as i64 + o.more_locations
        );
        assert_eq!(ids(&all[..o.locations.len()]), ids(&o.locations));
        // The section and the exact mention are two places; repeats of that mention add none.
        assert!(
            all.len() <= 2,
            "repeated mentions in one section were not consolidated"
        );
        Ok(())
    });
}

#[test]
fn a_wrong_source_or_passage_gives_nothing_and_no_error() {
    with_db(|conn, dir| {
        let id = cross_reference_source(conn, dir);
        assert!(expanded(conn, "no-such-source", "JHN.15.5").is_empty());
        assert!(expanded(conn, "", "JHN.15.5").is_empty());
        // The source has nothing for an unrelated passage.
        assert!(expanded(conn, &id, "GEN.1.1").is_empty());
        // A removed source offers nothing.
        conn.execute(
            "UPDATE sources SET deleted_at = '2026-01-01' WHERE id = ?1",
            [&id],
        )
        .unwrap();
        assert!(expanded(conn, &id, "JHN.15.5").is_empty());
        Ok(())
    });
}

#[test]
fn the_expanded_list_is_capped() {
    with_db(|conn, dir| {
        let mut text = String::from("# Big\n\n");
        let mut n = 0;
        let mut push = |book: &str, chapters: u32| {
            for c in 1..=chapters {
                n += 1;
                text.push_str(&format!(
                    "## Cross-references for {book} {c}:1\n\nCompare John 15:5 ({n}).\n\n"
                ));
            }
        };
        push("Psalm", 150);
        push("Matthew", 28);
        push("Luke", 24);
        push("Acts", 28);
        let id = add(conn, dir, "p.md", &text, "P Big", "English");
        let found = groups(conn, "JHN.15.5");
        let p = found.iter().find(|g| g.source_id == id).unwrap();
        assert_eq!(p.more_locations, 227);
        let all = expanded(conn, &id, "JHN.15.5");
        assert_eq!(all.len(), library::EXPANDED_LOCATIONS_LIMIT);
        assert_eq!(ids(&all[..3]), ids(&p.locations));
        Ok(())
    });
}
