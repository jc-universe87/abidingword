//! Source relevance after the first Windows acceptance of v0.9: material *about*
//! a passage must outrank material that only *cites* it; cross-references from
//! other passages' sections are incidental; book-scale ranges are far too broad;
//! a shared chapter number alone suggests nothing. Every source here is invented,
//! imported through the real path (stage, commit, index).

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import;
use abiding_word_lib::library::relevance::MatchKind;
use abiding_word_lib::library::sections::LinkOrigin;
use abiding_word_lib::library::{CommitSourceImport, PassageSourceGroup};
use abiding_word_lib::scripture::parser::ReferenceParser;
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

fn show(conn: &Connection, canonical: &str) -> Vec<PassageSourceGroup> {
    library::passage_sources(conn, &ScriptureRef::from_canonical(canonical).unwrap()).unwrap()
}

fn titles(groups: &[PassageSourceGroup]) -> Vec<&str> {
    groups.iter().map(|g| g.source_title.as_str()).collect()
}

fn dump(groups: &[PassageSourceGroup]) -> String {
    groups
        .iter()
        .map(|g| {
            let places: Vec<String> = g
                .locations
                .iter()
                .map(|l| {
                    format!(
                        "{:?}/{}/{}",
                        l.match_kind,
                        l.origin.as_str(),
                        l.reference.canonical
                    )
                })
                .collect();
            format!(
                "{} [{}] +{}",
                g.source_title,
                places.join(", "),
                g.more_locations
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The six sources of the Windows acceptance, invented.
fn windows_corpus(conn: &Connection, dir: &Path) {
    let en = |file: &str, text: &str, title: &str| add(conn, dir, file, text, title, "English");
    en("a.md", "# A\n\n## John 15:1–11 — The Vine\n\nThe vine is the picture of the passage.\n\nBranches bear fruit by remaining.\n", "A Vine Study");
    en(
        "b.md",
        "# B\n\n## Cross-references for Matthew 13:23\n\nCompare John 15:5.\n",
        "B Matthew Cross-references",
    );
    en(
        "c.md",
        "# C\n\n## Cross-references for Mark 4:20\n\nSee also John 15:5.\n",
        "C Mark Cross-references",
    );
    en(
        "d.md",
        "# D\n\n## John 11–21\n\nThe second half of the Gospel, from the raising of Lazarus.\n",
        "D Second Half of John",
    );
    en(
        "e.md",
        "# E\n\n## John 15:12–17\n\nFriends are those who keep the command.\n",
        "E Love One Another",
    );
    en(
        "f.md",
        "# F\n\n## Notes\n\nJohn 15:5 describes abiding as the source of fruit.\n",
        "F Neutral Notes",
    );
}

fn with_windows_corpus<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| {
            windows_corpus(conn, temp.path());
            f(conn)
        })
        .unwrap()
}

fn with_db<T>(f: impl FnOnce(&Connection, &Path) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| f(conn, temp.path()))
        .unwrap()
}

// --- the observed Windows results -----------------------------------------------

#[test]
fn for_john_15_5_the_section_about_it_leads_and_cross_references_and_the_broad_range_follow() {
    with_windows_corpus(|conn| {
        let found = show(conn, "JHN.15.5");
        assert_eq!(
            titles(&found),
            [
                "A Vine Study",
                "F Neutral Notes",
                "B Matthew Cross-references",
                "C Mark Cross-references",
                "D Second Half of John",
            ],
            "{}",
            dump(&found)
        );
        // John 15:12–17 only shares the chapter: it is not offered at all
        assert!(!titles(&found).contains(&"E Love One Another"));
        Ok(())
    });
}

#[test]
fn a_section_about_the_passage_beats_an_exact_cross_reference_from_another_passages_section() {
    with_windows_corpus(|conn| {
        let found = show(conn, "JHN.15.5");
        let at = |t: &str| titles(&found).iter().position(|x| *x == t).unwrap();
        assert!(at("A Vine Study") < at("B Matthew Cross-references"));
        assert!(at("A Vine Study") < at("C Mark Cross-references"));
        // although the cross-references cite exactly the verse and the section only contains it
        let b = found
            .iter()
            .find(|g| g.source_title.starts_with("B "))
            .unwrap();
        assert_eq!(b.locations[0].match_kind, MatchKind::Exact);
        assert_eq!(b.locations[0].origin, LinkOrigin::Explicit);
        let a = &found[at("A Vine Study")];
        assert_eq!(a.locations[0].match_kind, MatchKind::Contained);
        assert_eq!(a.locations[0].origin, LinkOrigin::Section);
        Ok(())
    });
}

#[test]
fn a_neutral_exact_mention_stays_discoverable_above_the_cross_references() {
    with_windows_corpus(|conn| {
        let found = show(conn, "JHN.15.5");
        let at = |t: &str| titles(&found).iter().position(|x| *x == t).unwrap();
        assert!(at("F Neutral Notes") < at("B Matthew Cross-references"));
        // but not above a section about the passage
        assert!(at("A Vine Study") < at("F Neutral Notes"));
        Ok(())
    });
}

#[test]
fn a_book_scale_range_is_last_and_never_above_a_narrow_section() {
    with_windows_corpus(|conn| {
        let found = show(conn, "JHN.15.5");
        assert_eq!(found.last().unwrap().source_title, "D Second Half of John");
        let at = |t: &str| titles(&found).iter().position(|x| *x == t).unwrap();
        assert!(at("A Vine Study") < at("D Second Half of John"));
        Ok(())
    });
}

#[test]
fn the_other_queries_make_sense_too() {
    with_windows_corpus(|conn| {
        // a passage the vine section is exactly about
        assert_eq!(
            titles(&show(conn, "JHN.15.1-JHN.15.11")),
            [
                "A Vine Study",
                "F Neutral Notes",
                "B Matthew Cross-references",
                "C Mark Cross-references",
                "D Second Half of John"
            ]
        );
        // the whole chapter: both sections inside it first, then the neutral citation
        let chapter = show(conn, "JHN.15");
        assert_eq!(
            titles(&chapter),
            [
                "A Vine Study",
                "E Love One Another",
                "F Neutral Notes",
                "B Matthew Cross-references",
                "C Mark Cross-references",
                "D Second Half of John"
            ],
            "{}",
            dump(&chapter)
        );
        // a verse only the love section reaches: nothing else of chapter 15 follows
        assert_eq!(
            titles(&show(conn, "JHN.15.13")),
            ["E Love One Another", "D Second Half of John"]
        );
        Ok(())
    });
}

// --- parser or ranking? ------------------------------------------------------------

#[test]
fn the_windows_examples_are_correct_references_with_the_wrong_relevance_not_parser_errors() {
    let parser = ReferenceParser::english();
    let canon = |text: &str| -> Vec<String> {
        parser
            .detect(text)
            .into_iter()
            .map(|d| d.reference.canonical)
            .collect()
    };
    assert_eq!(canon("Cross-references for Matthew 13:23"), ["MAT.13.23"]);
    assert_eq!(canon("Cross-references for Mark 4:20"), ["MRK.4.20"]);
    assert_eq!(canon("Compare John 15:5."), ["JHN.15.5"]);
    assert_eq!(canon("See also John 15:5."), ["JHN.15.5"]);
    assert_eq!(canon("John 11–21"), ["JHN.11-JHN.21"]);
    // and prose that merely has a name and a number apart is not joined into a reference
    assert!(canon("Saint John arrived, and 15 people came.").is_empty());
    assert!(canon("John, 15 miles on").is_empty());
}

#[test]
fn a_demoted_citation_is_still_stored_with_its_provenance() {
    with_windows_corpus(|conn| {
        for (title, section) in [
            ("B Matthew Cross-references", "MAT.13.23"),
            ("C Mark Cross-references", "MRK.4.20"),
        ] {
            let rows: Vec<(String, String)> = conn
                .prepare(
                    "SELECT p.origin, p.passage FROM source_passages p JOIN sources s ON s.id = p.source_id
                     WHERE s.title = ?1 ORDER BY p.origin",
                )?
                .query_map([title], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            // the written reference is an explicit link …
            assert!(
                rows.contains(&("explicit".into(), "JHN.15.5".into())),
                "{title}: {rows:?}"
            );
            // … and the section keeps its own passage
            assert!(
                rows.contains(&("section".into(), section.into())),
                "{title}: {rows:?}"
            );
        }
        Ok(())
    });
}

#[test]
fn a_citation_inside_a_section_about_the_passage_is_about_it_not_a_cross_reference() {
    with_db(|conn, dir| {
        add(conn, dir, "g.md", "# G\n\n## John 15:1–11 — The Vine\n\nA first paragraph.\n\nVerse 5 says John 15:5 plainly.\n", "G Vine Section", "English");
        add(
            conn,
            dir,
            "h.md",
            "# H\n\n## Cross-references for Matthew 13:23\n\nCompare John 15:5.\n",
            "H Cross-references",
            "English",
        );
        let found = show(conn, "JHN.15.5");
        // the section (and the citation inside it) before the cross-reference
        assert_eq!(titles(&found), ["G Vine Section", "H Cross-references"]);
        assert!(found[0]
            .locations
            .iter()
            .any(|l| l.origin == LinkOrigin::Explicit && l.match_kind == MatchKind::Exact));
        Ok(())
    });
}

#[test]
fn a_book_scale_heading_does_not_make_a_citation_inside_it_about_the_passage_or_a_cross_reference()
{
    with_db(|conn, dir| {
        add(
            conn,
            dir,
            "i.md",
            "# I\n\n## John 11–21\n\nThe second half. Abide: John 15:5.\n",
            "I Broad Section",
            "English",
        );
        add(
            conn,
            dir,
            "j.md",
            "# J\n\n## Cross-references for Matthew 13:23\n\nCompare John 15:5.\n",
            "J Cross-references",
            "English",
        );
        let found = show(conn, "JHN.15.5");
        // the citation inside the book-scale section is neutral: above a true cross-reference
        assert_eq!(titles(&found), ["I Broad Section", "J Cross-references"]);
        Ok(())
    });
}

// --- the rest of the behaviour is unchanged ------------------------------------------

#[test]
fn an_unrelated_book_is_excluded_and_the_order_is_stable() {
    with_windows_corpus(|conn| {
        assert!(show(conn, "ROM.8.1").is_empty());
        for passage in ["JHN.15.5", "JHN.15", "JHN.15.13"] {
            let first = show(conn, passage);
            for _ in 0..4 {
                assert_eq!(show(conn, passage), first);
            }
        }
        Ok(())
    });
}

#[test]
fn a_cross_reference_source_with_many_citations_is_one_entry_and_does_not_flood() {
    with_db(|conn, dir| {
        let mut text = String::from("# Study Bible\n\n");
        for n in 1..=20 {
            text.push_str(&format!(
                "## Cross-references for Matthew {n}:1\n\nCompare John 15:5 here ({n}).\n\n"
            ));
        }
        add(
            conn,
            dir,
            "k.md",
            &text,
            "K Cross-reference Study Bible",
            "English",
        );
        add(
            conn,
            dir,
            "l.md",
            "# L\n\n## John 15:1–11\n\nThe vine.\n",
            "L Vine Section",
            "English",
        );
        let found = show(conn, "JHN.15.5");
        assert_eq!(
            titles(&found),
            ["L Vine Section", "K Cross-reference Study Bible"]
        );
        let k = &found[1];
        assert_eq!(k.locations.len(), library::LOCATIONS_PER_SOURCE);
        assert_eq!(k.more_locations, 17);
        Ok(())
    });
}

#[test]
fn the_source_language_changes_detection_never_the_relevance() {
    with_db(|conn, dir| {
        add(
            conn,
            dir,
            "en1.md",
            "# En\n\n## John 15:1–11 — The Vine\n\nText.\n",
            "En Section",
            "English",
        );
        add(
            conn,
            dir,
            "de1.md",
            "# De\n\n## Joh 15,1–11 — Der Weinstock\n\nText.\n",
            "De Section",
            "Deutsch",
        );
        add(
            conn,
            dir,
            "ko1.md",
            "# Ko\n\n## 요한복음 15:1–11 — 포도나무\n\n본문.\n",
            "Ko Section",
            "한국어",
        );
        add(
            conn,
            dir,
            "de2.md",
            "# De2\n\n## Matthäus 13,23 — Verweise\n\nVergleiche Joh 15,5.\n",
            "De Cross-references",
            "Deutsch",
        );
        add(
            conn,
            dir,
            "ko2.md",
            "# Ko2\n\n## 마태복음 13:23 — 참조\n\n요한복음 15장 5절을 보라.\n",
            "Ko Cross-references",
            "한국어",
        );
        let found = show(conn, "JHN.15.5");
        let at = |t: &str| titles(&found).iter().position(|x| *x == t).unwrap();
        for section in ["En Section", "De Section", "Ko Section"] {
            for cross in ["De Cross-references", "Ko Cross-references"] {
                assert!(at(section) < at(cross), "{}", dump(&found));
            }
        }
        // the three sections rank alike (ties are broken by title, not by language)
        let shape = |g: &PassageSourceGroup| -> Vec<(MatchKind, LinkOrigin, String)> {
            g.locations
                .iter()
                .map(|l| (l.match_kind, l.origin, l.reference.canonical.clone()))
                .collect()
        };
        assert_eq!(
            shape(&found[at("En Section")]),
            shape(&found[at("De Section")])
        );
        assert_eq!(
            shape(&found[at("De Section")]),
            shape(&found[at("Ko Section")])
        );
        Ok(())
    });
}
