//! Source suggestion quality (v0.9, sub-phase 3): what the Sources pane puts
//! first for a passage, checked against a small realistic corpus imported
//! through the real path (stage, commit, index). All text is invented.

use std::fs;
use std::path::Path;

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import;
use abiding_word_lib::library::relevance::MatchKind;
use abiding_word_lib::library::sections::LinkOrigin;
use abiding_word_lib::library::{CommitSourceImport, PassageSourceGroup};
use abiding_word_lib::scripture::reference::ScriptureRef;
use rusqlite::Connection;

fn reference(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

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

/// The imported corpus; only the control source's id is needed by the tests.
struct Corpus {
    control: String,
}

const COMMENTARY: &str = "# Vine Commentary

## John 15:1–11 — The True Vine

The vine is the picture the whole passage rests on.

### John 15:5 — Abiding

A branch cannot bear fruit by itself.

Remaining is not effort but dependence.

## Closing thoughts

Compare John 15:16 on being chosen to bear fruit.
";

const THEOLOGY: &str = "# Notes in Systematic Theology

## Union with Christ

Believers are joined to Christ. As John 15:4–5 shows, the image is organic.

The doctrine has many sides.

## Adoption

Nothing about the vine here.
";

const SERMON: &str = "# Sermon Manuscript

## John 15:1–8 — Remain in Me

Open with a story about a garden.

Name the fruit that grows from remaining.

## Application

Romans 8:1 reminds us there is no condemnation.
";

const NOTES: &str = "Quick thought on dependence: John 15:5 says apart from me nothing.

Another thought about love for one another, John 15:12.

A closing remark with no reference at all.
";

const GENERAL: &str = "# A Guide to John

## John 15

An overview of the chapter and its place in the farewell discourse.

More general remarks, no particular verse.
";

const SAME_CHAPTER: &str = "# Notes on Love

## John 15:12–17 — Love One Another

Friends are those who keep the command.
";

const CONTROL: &str = "# Management Handbook

## Mark 4 Principles of Leadership

Lead by listening first. Nothing scriptural is intended here.
";

const GERMAN: &str = "# Johanneskommentar

## Joh 15,1–11 — Der wahre Weinstock

Der Weinstock ist das Bild des ganzen Abschnitts.

Ein Absatz über Joh 15,5 und das Bleiben.
";

const KOREAN: &str = "# 요한복음 묵상

## 요한복음 15:1–11 — 참 포도나무

포도나무는 이 본문 전체의 그림입니다.

요한복음 15장 5절을 따라 머무름을 묵상합니다.
";

fn corpus(conn: &Connection, dir: &Path) -> Corpus {
    let english =
        |file: &str, text: &str, title: &str| add(conn, dir, file, text, title, "English");
    english("commentary.md", COMMENTARY, "Vine Commentary");
    english("theology.md", THEOLOGY, "Systematic Notes");
    english("sermon.md", SERMON, "Sermon Manuscript");
    english("notes.txt", NOTES, "Personal Notes");
    english("general.md", GENERAL, "A Guide to John");
    english("love.md", SAME_CHAPTER, "Notes on Love");
    let control = english("control.md", CONTROL, "Management Handbook");
    add(
        conn,
        dir,
        "german.md",
        GERMAN,
        "Johanneskommentar",
        "Deutsch",
    );
    add(conn, dir, "korean.md", KOREAN, "요한복음 묵상", "한국어");
    Corpus { control }
}

fn with_corpus<T>(f: impl FnOnce(&Connection, &Corpus) -> AppResult<T>) -> T {
    let temp = tempfile::tempdir().unwrap();
    Database::open_in_memory()
        .unwrap()
        .with_conn(|conn| {
            let c = corpus(conn, temp.path());
            f(conn, &c)
        })
        .unwrap()
}

fn show(conn: &Connection, canonical: &str) -> Vec<PassageSourceGroup> {
    library::passage_sources(conn, &reference(canonical)).unwrap()
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

fn titles(groups: &[PassageSourceGroup]) -> Vec<&str> {
    groups.iter().map(|g| g.source_title.as_str()).collect()
}

fn id_of(groups: &[PassageSourceGroup], title: &str) -> PassageSourceGroup {
    groups
        .iter()
        .find(|g| g.source_title == title)
        .unwrap_or_else(|| panic!("{title} is not listed: {}", dump(groups)))
        .clone()
}

fn md(heading: &str, paragraphs: &[String]) -> String {
    let mut out = format!("# Source\n\n## {heading}\n\n");
    for p in paragraphs {
        out.push_str(p);
        out.push_str("\n\n");
    }
    out
}

// --- the realistic corpus, passage by passage ---------------------------------

#[test]
fn for_one_verse_the_best_sources_come_first_in_a_justified_order() {
    with_corpus(|conn, _| {
        let found = show(conn, "JHN.15.5");
        assert_eq!(
            titles(&found),
            [
                // a section on exactly this verse
                "Vine Commentary",
                // sections on a short range that contains it, nearest first
                "Sermon Manuscript",
                "Johanneskommentar",
                "요한복음 묵상",
                // a neutral citation of exactly the verse, then of a range around it
                "Personal Notes",
                "Systematic Notes",
                // a section on the whole chapter
                "A Guide to John",
            ]
        );
        // the unrelated sources never appear, and neither does a source that
        // only has John 15:12–17
        assert!(!titles(&found).contains(&"Management Handbook"));
        assert!(!titles(&found).contains(&"Notes on Love"));
        Ok(())
    });
}

#[test]
fn for_a_passage_a_section_on_it_leads_and_narrower_beats_broader() {
    with_corpus(|conn, _| {
        let found = show(conn, "JHN.15.1-JHN.15.11");
        assert_eq!(
            titles(&found),
            [
                "Johanneskommentar",
                "Vine Commentary",
                "요한복음 묵상",
                "Sermon Manuscript",
                "Systematic Notes",
                "Personal Notes",
                "A Guide to John",
            ]
        );
        assert!(found[..3]
            .iter()
            .all(|g| g.locations[0].match_kind == MatchKind::Exact));
        Ok(())
    });
}

#[test]
fn for_a_whole_chapter_the_chapter_source_leads_and_each_source_appears_once() {
    with_corpus(|conn, _| {
        let found = show(conn, "JHN.15");
        assert_eq!(found[0].source_title, "A Guide to John");
        assert_eq!(found[0].locations[0].match_kind, MatchKind::Exact);
        let mut seen = titles(&found);
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), found.len(), "one entry per source");
        // the commentary offers its section, its subsection and the passing mention
        let vine = id_of(&found, "Vine Commentary");
        assert_eq!(vine.locations.len(), 3);
        assert_eq!(vine.locations[2].origin, LinkOrigin::Explicit);
        Ok(())
    });
}

#[test]
fn a_later_part_of_the_chapter_offers_only_what_reaches_those_verses() {
    with_corpus(|conn, _| {
        let found = show(conn, "JHN.15.12-JHN.15.17");
        assert_eq!(
            titles(&found),
            [
                // the section on exactly these verses
                "Notes on Love",
                // neutral citations of verses inside them
                "Personal Notes",
                "Vine Commentary",
                // a section on the whole chapter
                "A Guide to John",
            ]
        );
        // the vine commentary's section on John 15:1–11 shares only the chapter: not offered
        assert!(!titles(&found).contains(&"Johanneskommentar"));
        assert!(!titles(&found).contains(&"Sermon Manuscript"));
        // its passing mention of John 15:16 is a direct place here
        let vine = id_of(&found, "Vine Commentary");
        assert_eq!(vine.locations[0].match_kind, MatchKind::Contained);
        assert_eq!(vine.locations[0].origin, LinkOrigin::Explicit);
        Ok(())
    });
}

#[test]
fn a_passage_with_no_direct_source_lists_nothing_and_an_unrelated_book_does_not_leak() {
    with_corpus(|conn, _| {
        assert!(show(conn, "PSA.23").is_empty());
        let romans = show(conn, "ROM.8.1");
        assert_eq!(titles(&romans), ["Sermon Manuscript"]);
        // the same reference rendered twice for John never mentions Romans or Mark
        for g in show(conn, "JHN.15.5") {
            assert!(g
                .locations
                .iter()
                .all(|l| l.reference.canonical.starts_with("JHN")));
        }
        Ok(())
    });
}

#[test]
fn a_heading_that_starts_with_a_book_and_number_follows_the_parser_rules() {
    // "Mark 4 Principles of Leadership" reads as Mark chapter 4 by the parser's
    // (documented) rules: the capital-letter rule cannot tell it from a heading
    // on Mark 4. It never touches John.
    with_corpus(|conn, c| {
        let mark = show(conn, "MRK.4");
        assert_eq!(titles(&mark), ["Management Handbook"]);
        assert_eq!(mark[0].source_id, c.control);
        assert!(!titles(&show(conn, "JHN.15.5")).contains(&"Management Handbook"));
        Ok(())
    });
}

// --- section versus passing mention --------------------------------------------

#[test]
fn a_section_about_a_passage_outranks_a_neutral_mention_even_of_the_exact_verse() {
    let temp = tempfile::tempdir().unwrap();
    with_corpus(|conn, _| {
        add(
            conn,
            temp.path(),
            "aside.md",
            "# Aside\n\n## Leadership\n\nAn aside, see John 15:5–6 for a thought.\n",
            "Aside",
            "English",
        );
        let found = show(conn, "JHN.15.5");
        let at = |t: &str| titles(&found).iter().position(|x| *x == t).unwrap();
        // a section on a short range that contains the verse comes before every neutral citation …
        assert!(at("Sermon Manuscript") < at("Personal Notes"));
        assert!(at("Sermon Manuscript") < at("Aside"));
        // … a neutral citation of the exact verse before one of a range around it …
        assert!(at("Personal Notes") < at("Aside"));
        // … and all of them before a section on the whole chapter
        assert!(at("Aside") < at("A Guide to John"));
        Ok(())
    });
}

// --- duplicates and consolidation ------------------------------------------------

#[test]
fn a_section_its_opening_mention_and_repeated_mentions_are_one_place() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let text = md(
            "John 15:1–11 — The True Vine",
            &[
                "The vine of John 15:1–11 opens here.".into(),
                "Again John 15:1–11 is the frame.".into(),
                "Once more, John 15:1–11.".into(),
                "A paragraph with no reference.".into(),
            ],
        );
        let id = add(conn, temp.path(), "a.md", &text, "Source A", "English");
        let found = show(conn, "JHN.15.5");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].source_id, id);
        assert_eq!(found[0].locations.len(), 1, "{}", dump(&found));
        assert_eq!(found[0].more_locations, 0);
        assert_eq!(found[0].locations[0].origin, LinkOrigin::Section);
        // nothing was deleted: every mention and the section are still stored
        let stored: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages WHERE source_id = ?1 AND origin IN ('explicit','section')",
            [&id],
            |r| r.get(0),
        )?;
        assert_eq!(stored, 4);
        Ok(())
    });
}

#[test]
fn the_same_passage_mentioned_twice_in_a_section_is_one_place_and_the_section_leads() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let text = md(
            "John 15:1–11 — The True Vine",
            &[
                "Opening with no reference.".into(),
                "See John 15:3 on being clean.".into(),
                "Also John 15:3 again.".into(),
                "And John 15:3 a third time.".into(),
            ],
        );
        add(conn, temp.path(), "a.md", &text, "Source A", "English");
        let found = show(conn, "JHN.15.3");
        assert_eq!(found.len(), 1);
        // the section the verse lies in, then the first mention of exactly this verse
        assert_eq!(found[0].locations.len(), 2, "{}", dump(&found));
        assert_eq!(found[0].locations[0].origin, LinkOrigin::Section);
        assert_eq!(found[0].locations[1].match_kind, MatchKind::Exact);
        assert_eq!(found[0].more_locations, 0);
        Ok(())
    });
}

#[test]
fn distinct_places_are_preserved() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        // two sections of one source, each naming a passage that contains the verse
        let text = "# Source\n\n## John 15:1–11 — The Vine\n\nFirst.\n\n## John 15\n\nSecond.\n\n## Elsewhere\n\nA note that cites John 15:5 directly.\n";
        add(conn, temp.path(), "a.md", text, "Source A", "English");
        let found = show(conn, "JHN.15.5");
        assert_eq!(found.len(), 1);
        let kinds: Vec<_> = found[0]
            .locations
            .iter()
            .map(|l| (l.match_kind, l.origin))
            .collect();
        assert_eq!(
            kinds,
            [
                // the section on a short range, then a neutral exact mention, then the whole chapter
                (MatchKind::Contained, LinkOrigin::Section),
                (MatchKind::Exact, LinkOrigin::Explicit),
                (MatchKind::Contained, LinkOrigin::Section),
            ]
        );
        assert_eq!(found[0].more_locations, 0);
        Ok(())
    });
}

// --- grouping --------------------------------------------------------------------

#[test]
fn a_source_with_fifty_mentions_shows_three_places_and_the_true_remainder() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let paragraphs: Vec<String> = (1..=50)
            .map(|n| format!("Point {n}: John 15:{} applies.", (n % 10) + 1))
            .collect();
        let text = md("Notes", &paragraphs);
        add(
            conn,
            temp.path(),
            "noisy.md",
            &text,
            "Noisy Notes",
            "English",
        );
        add(
            conn,
            temp.path(),
            "focused.md",
            &md(
                "John 15:1–11 — The Vine",
                &["One focused paragraph.".into()],
            ),
            "Focused Commentary",
            "English",
        );
        let found = show(conn, "JHN.15.5");
        // a section on the passage comes first however many mentions the other source has
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].source_title, "Focused Commentary");
        let noisy = id_of(&found, "Noisy Notes");
        assert_eq!(noisy.locations.len(), 3);
        // ten distinct verses cycle, so five paragraphs mention verse 5 exactly:
        // only places that add something are counted (the same passage, no section: each is its own segment)
        assert_eq!(noisy.more_locations, 2, "{}", dump(&found));
        assert_eq!(found[1].source_title, "Noisy Notes");
        Ok(())
    });
}

#[test]
fn at_most_thirty_sources_are_listed_and_the_choice_is_stable() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        for n in 0..40 {
            add(
                conn,
                temp.path(),
                &format!("s{n}.md"),
                &md(
                    "Notes",
                    &[format!("Source number {n} cites John 15:5 once.")],
                ),
                &format!("Source {n:02}"),
                "English",
            );
        }
        let first = show(conn, "JHN.15.5");
        assert_eq!(first.len(), library_limit());
        // equal evidence is ordered by title, so the thirty are the first thirty
        let expected: Vec<String> = (0..30).map(|n| format!("Source {n:02}")).collect();
        let listed: Vec<String> = first.iter().map(|g| g.source_title.clone()).collect();
        assert_eq!(listed, expected);
        for _ in 0..3 {
            assert_eq!(show(conn, "JHN.15.5"), first);
        }
        Ok(())
    });
}

fn library_limit() -> usize {
    library::SOURCE_GROUP_LIMIT
}

fn with_db_only<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

#[test]
fn the_place_cap_is_three_and_the_remainder_counts_real_places() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let paragraphs: Vec<String> = (1..=6)
            .map(|n| format!("Paragraph {n}: remember John 15:{n}."))
            .collect();
        add(
            conn,
            temp.path(),
            "a.md",
            &md("Notes", &paragraphs),
            "Source A",
            "English",
        );
        // a chapter reading sees all six verses' mentions
        let found = show(conn, "JHN.15");
        assert_eq!(found[0].locations.len(), library::LOCATIONS_PER_SOURCE);
        assert_eq!(found[0].more_locations, 3);
        Ok(())
    });
}

#[test]
fn same_chapter_places_are_never_offered() {
    with_corpus(|conn, _| {
        let found = show(conn, "JHN.15.5");
        // the section on John 15:12–17 shares the chapter and nothing else
        assert!(!titles(&found).contains(&"Notes on Love"));
        for g in &found {
            for l in &g.locations {
                // every offered place shares a verse with the passage
                assert_ne!(
                    l.reference.canonical,
                    "JHN.15.12-JHN.15.17",
                    "{}",
                    dump(&found)
                );
                assert_ne!(l.reference.canonical, "JHN.15.16", "{}", dump(&found));
            }
        }
        // the commentary's own places are the two sections that contain the verse
        let vine = id_of(&found, "Vine Commentary");
        assert_eq!(vine.locations.len(), 2);
        // the indexed references are still all there
        let stored: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages p JOIN sources s ON s.id = p.source_id
             WHERE s.title = 'Notes on Love' AND p.origin = 'section'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(stored, 1);
        Ok(())
    });
}

// --- range edge cases --------------------------------------------------------------

#[test]
fn range_relations_are_classified_for_the_pane() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let text = "# Source\n\n## Parts\n\nOne: John 15:3–5. Two: John 15:8–9. Three: John 15:6. Four: John 15:1–20. Five: John 14:30–15:2.\n";
        add(conn, temp.path(), "a.md", text, "Source A", "English");
        let kind_of = |passage: &str| -> Option<MatchKind> {
            show(conn, passage)
                .first()
                .and_then(|g| g.locations.first())
                .map(|l| l.match_kind)
        };
        // one verse inside a range / inside a bigger one
        assert_eq!(kind_of("JHN.15.4"), Some(MatchKind::Contained));
        // several verses: partial overlap with 15:3–5
        assert_eq!(kind_of("JHN.15.4-JHN.15.7"), Some(MatchKind::Contained));
        // adjacent but not overlapping: the single verse 15:6 is not part of 15:3–5
        let adjacent = show(conn, "JHN.15.7");
        assert_eq!(
            adjacent[0].locations[0].reference.canonical,
            "JHN.15.1-JHN.15.20"
        );
        // a range that exactly equals a mention
        assert_eq!(kind_of("JHN.15.8-JHN.15.9"), Some(MatchKind::Exact));
        // a reference crossing the chapter boundary matches both chapters
        assert!(kind_of("JHN.14.30").is_some());
        assert_eq!(kind_of("JHN.15.1"), Some(MatchKind::Contained));
        // another chapter or book: nothing
        assert_eq!(kind_of("JHN.16.1"), None);
        assert_eq!(kind_of("MAT.15.5"), None);
        Ok(())
    });
}

#[test]
fn partial_overlap_ranks_below_containment_and_a_chapter_only_range_is_not_offered() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        add(
            conn,
            temp.path(),
            "o.md",
            &md("John 15:8–17 — Overlap", &["Text.".into()]),
            "Overlap",
            "English",
        );
        add(
            conn,
            temp.path(),
            "c.md",
            &md("John 15:1–20 — Contains", &["Text.".into()]),
            "Contains",
            "English",
        );
        add(
            conn,
            temp.path(),
            "w.md",
            &md("John 15:14–17", &["Text.".into()]),
            "Elsewhere",
            "English",
        );
        let found = show(conn, "JHN.15.1-JHN.15.11");
        assert_eq!(titles(&found), ["Contains", "Overlap"]);
        let kinds: Vec<_> = found.iter().map(|g| g.locations[0].match_kind).collect();
        assert_eq!(kinds, [MatchKind::Contained, MatchKind::Overlap]);
        Ok(())
    });
}

#[test]
fn one_chapter_books_and_psalms_use_their_canonical_chapters() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        add(
            conn,
            temp.path(),
            "j.md",
            &md("Jude 3", &["On contending for the faith.".into()]),
            "Jude Notes",
            "English",
        );
        add(
            conn,
            temp.path(),
            "p.md",
            &md("Psalm 23", &["On the shepherd.".into()]),
            "Psalm Notes",
            "English",
        );
        let jude = show(conn, "JUD.1.3");
        assert_eq!(jude[0].locations[0].match_kind, MatchKind::Exact);
        let psalm = show(conn, "PSA.23.1");
        assert_eq!(psalm[0].source_title, "Psalm Notes");
        assert_eq!(psalm[0].locations[0].match_kind, MatchKind::Contained);
        assert!(show(conn, "PSA.24.1").is_empty());
        Ok(())
    });
}

// --- manual provenance ---------------------------------------------------------------

#[test]
fn a_manual_link_ranks_as_documented_ahead_of_a_section_and_a_mention() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        let manual = add(
            conn,
            temp.path(),
            "m.md",
            &md("Misc", &["Remarks.".into()]),
            "Manual",
            "English",
        );
        let section = add(
            conn,
            temp.path(),
            "s.md",
            &md("John 15:5", &["Text.".into()]),
            "Section",
            "English",
        );
        add(
            conn,
            temp.path(),
            "e.md",
            &md("Misc", &["See John 15:5.".into()]),
            "Mention",
            "English",
        );
        let segment: String = conn.query_row(
            "SELECT id FROM source_segments WHERE source_id = ?1 LIMIT 1",
            [&manual],
            |r| r.get(0),
        )?;
        conn.execute(
            "INSERT INTO source_passages (id, source_id, segment_id, passage, start_key, end_key,
                 matched_text, start_offset, end_offset, created_at, origin)
             VALUES ('manual-1', ?1, ?2, 'JHN.15.5', 43015005, 43015005, 'my link', NULL, NULL,
                     '2026-01-01T00:00:00.000Z', 'manual')",
            [&manual, &segment],
        )?;
        let found = show(conn, "JHN.15.5");
        assert_eq!(titles(&found), ["Manual", "Section", "Mention"]);
        assert_eq!(found[0].locations[0].origin, LinkOrigin::Manual);
        let _ = section;
        Ok(())
    });
}

// --- language neutrality ----------------------------------------------------------------

#[test]
fn the_source_language_changes_detection_never_the_ranking() {
    let temp = tempfile::tempdir().unwrap();
    with_db_only(|conn| {
        // the same structure in English, German and Korean
        add(
            conn,
            temp.path(),
            "en.md",
            "# Commentary\n\n## John 15:1–11 — The Vine\n\nText.\n\nSee John 15:5.\n",
            "En Source",
            "English",
        );
        add(
            conn,
            temp.path(),
            "de.md",
            "# Kommentar\n\n## Joh 15,1–11 — Der Weinstock\n\nText.\n\nSiehe Joh 15,5.\n",
            "De Source",
            "Deutsch",
        );
        add(
            conn,
            temp.path(),
            "ko.md",
            "# 주석\n\n## 요한복음 15:1–11 — 포도나무\n\n본문.\n\n요한복음 15장 5절 참고.\n",
            "Ko Source",
            "한국어",
        );
        let found = show(conn, "JHN.15.5");
        assert_eq!(titles(&found), ["De Source", "En Source", "Ko Source"]);
        let shape = |g: &PassageSourceGroup| -> Vec<(MatchKind, LinkOrigin, String)> {
            g.locations
                .iter()
                .map(|l| (l.match_kind, l.origin, l.reference.canonical.clone()))
                .collect()
        };
        assert_eq!(shape(&found[0]), shape(&found[1]));
        assert_eq!(shape(&found[1]), shape(&found[2]));
        Ok(())
    });
}

#[test]
fn equal_input_always_gives_equal_output() {
    with_corpus(|conn, _| {
        for passage in ["JHN.15.5", "JHN.15", "JHN.15.12-JHN.15.17"] {
            let first = show(conn, passage);
            for _ in 0..5 {
                assert_eq!(show(conn, passage), first);
            }
        }
        Ok(())
    });
}
