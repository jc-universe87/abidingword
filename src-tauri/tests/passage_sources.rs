//! Passage-aware sources (v0.9): section and inherited links derived from
//! headings, ranking and grouping in the Sources pane query, rebuilding, and
//! the formats that have no structure. All material is invented.

#[path = "support/library_fixtures.rs"]
mod fixtures;

use std::fs;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::{findings, library, projects, studies, workspaces, Database};
use abiding_word_lib::domain::{CreateFinding, CreateProject, CreateStudy, FindingType};
use abiding_word_lib::error::AppResult;
use abiding_word_lib::library::import::{self, StagedSource};
use abiding_word_lib::library::relevance::MatchKind;
use abiding_word_lib::library::sections::{self, LinkOrigin};
use abiding_word_lib::library::{AddFindingSource, CommitSourceImport, GetSegments};
use abiding_word_lib::scripture::reference::ScriptureRef;
use fixtures::EpubChapter;
use rusqlite::Connection;

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

fn commit(conn: &Connection, staged: &StagedSource, title: &str) -> AppResult<String> {
    let id = abiding_word_lib::db::new_id();
    let relative = library::managed_relative_path(&id, staged);
    library::commit_import(
        conn,
        &id,
        staged,
        &CommitSourceImport {
            preview_id: staged.id.clone(),
            title: title.into(),
            author: Some("Synthetic Author".into()),
            ..Default::default()
        },
        &relative,
    )?;
    Ok(id)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn add(conn: &Connection, dir: &Path, file: &str, bytes: &[u8], title: &str) -> String {
    let staged = import::stage(&write(dir, file, bytes)).unwrap();
    commit(conn, &staged, title).unwrap()
}

fn reference(canonical: &str) -> ScriptureRef {
    ScriptureRef::from_canonical(canonical).unwrap()
}

/// The id of the segment whose text starts with `text`.
fn segment(conn: &Connection, source: &str, text: &str) -> String {
    conn.query_row(
        "SELECT id FROM source_segments WHERE source_id = ?1 AND content LIKE ?2 || '%'",
        [source, text],
        |r| r.get(0),
    )
    .unwrap_or_else(|_| panic!("no segment starting {text:?}"))
}

/// (origin, passage) of every link of a segment, in the order the reader shows.
fn links(conn: &Connection, segment_id: &str) -> Vec<(&'static str, String)> {
    library::segment_passage_links(conn, segment_id)
        .unwrap()
        .into_iter()
        .map(|l| (l.origin.as_str(), l.reference.canonical))
        .collect()
}

fn derived_rows(conn: &Connection, source: &str) -> Vec<(String, String, String, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT g.position || '', p.origin, p.passage, COALESCE(p.section_heading, '')
             FROM source_passages p JOIN source_segments g ON g.id = p.segment_id
             WHERE p.source_id = ?1 AND p.origin IN ('section', 'inherited')
             ORDER BY g.position, p.origin, p.passage",
        )
        .unwrap();
    stmt.query_map([source], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

const COMMENTARY: &str = "# A Synthetic Commentary

Prefatory note that names no passage.

## John 15:1–11 — The True Vine

Opening paragraph about the vine.

A second paragraph about branches. See also Romans 8:1 for a related thought.

A third paragraph with nothing explicit.

## John 15:12–17 — Love One Another

A paragraph about love.

## Closing remarks

Final words with nothing at all.
";

// --- derivation by format --------------------------------------------------

#[test]
fn an_explicit_reference_stays_linked_as_explicit() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let second = segment(conn, &id, "A second paragraph");
        let mine = links(conn, &second);
        assert!(mine.contains(&("explicit", "ROM.8.1".to_string())));
        // v0.4 views still see exactly the literal mentions
        let mentions = library::mentions(conn, &reference("ROM.8.1"))?;
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].segment_id, second);
        assert!(library::mentions(conn, &reference("JHN.15.5"))?.is_empty());
        let listed = library::passages(conn, &id)?;
        assert_eq!(
            listed.len(),
            1,
            "the source's passage list is literal mentions only"
        );
        assert_eq!(library::get(conn, &id)?.passage_count, 1);
        Ok(())
    });
}

#[test]
fn a_heading_passage_applies_to_the_section_that_follows_it() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let opening = segment(conn, &id, "Opening paragraph");
        let second = segment(conn, &id, "A second paragraph");
        let third = segment(conn, &id, "A third paragraph");
        assert_eq!(
            links(conn, &opening),
            [("section", "JHN.15.1-JHN.15.11".into())]
        );
        assert!(links(conn, &second).contains(&("inherited", "JHN.15.1-JHN.15.11".into())));
        assert_eq!(
            links(conn, &third),
            [("inherited", "JHN.15.1-JHN.15.11".into())]
        );
        // the provenance says which heading and where that section opens
        let inherited = library::segment_passage_links(conn, &third)?;
        assert_eq!(
            inherited[0].section_heading.as_deref(),
            Some("John 15:1–11 — The True Vine")
        );
        assert_eq!(
            inherited[0].section_segment_id.as_deref(),
            Some(opening.as_str())
        );
        assert_eq!(inherited[0].matched_text, "John 15:1–11");
        Ok(())
    });
}

#[test]
fn inheritance_stops_at_a_sibling_section_and_unrelated_sections_get_none() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let love = segment(conn, &id, "A paragraph about love");
        assert_eq!(
            links(conn, &love),
            [("section", "JHN.15.12-JHN.15.17".into())]
        );
        let preface = segment(conn, &id, "Prefatory note");
        let closing = segment(conn, &id, "Final words");
        assert!(
            links(conn, &preface).is_empty(),
            "before any passage heading"
        );
        assert!(
            links(conn, &closing).is_empty(),
            "a later unrelated section"
        );
        Ok(())
    });
}

#[test]
fn nested_headings_inherit_from_the_nearest_passage_heading_only() {
    let md = "# Synthetic Notes on Ruth

## Ruth 1

Intro paragraph of chapter one.

### Application

An application paragraph.

### Ruth 1:16–17 — Where you go

A paragraph on the pledge.

More on the pledge.

### Closing

Last paragraph.

## Ruth 2

Another chapter intro.
";
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(conn, temp.path(), "r.md", md.as_bytes(), "Ruth notes");
        let at = |text: &str| links(conn, &segment(conn, &id, text));
        assert_eq!(at("Intro paragraph"), [("section", "RUT.1".into())]);
        // no passage of its own: belongs to the chapter above
        assert_eq!(at("An application"), [("inherited", "RUT.1".into())]);
        // a narrower heading overrides, not widens
        assert_eq!(
            at("A paragraph on the pledge"),
            [("section", "RUT.1.16-RUT.1.17".into())]
        );
        assert_eq!(
            at("More on the pledge"),
            [("inherited", "RUT.1.16-RUT.1.17".into())]
        );
        // the sibling's passage does not leak into the next sibling
        assert_eq!(at("Last paragraph"), [("inherited", "RUT.1".into())]);
        // a new chapter heading is its own section
        assert_eq!(at("Another chapter intro"), [("section", "RUT.2".into())]);
        Ok(())
    });
}

#[test]
fn several_references_in_one_heading_are_kept_separately() {
    let md = "# Synthetic Study

## John 15:1–11 and Isaiah 5:1–7

The vine in two witnesses.

And a second line.
";
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(conn, temp.path(), "v.md", md.as_bytes(), "Vines");
        let first = links(conn, &segment(conn, &id, "The vine"));
        assert_eq!(
            first,
            [
                ("section", "ISA.5.1-ISA.5.7".into()),
                ("section", "JHN.15.1-JHN.15.11".into())
            ]
        );
        let second = links(conn, &segment(conn, &id, "And a second"));
        assert_eq!(
            second,
            [
                ("inherited", "ISA.5.1-ISA.5.7".into()),
                ("inherited", "JHN.15.1-JHN.15.11".into())
            ]
        );
        // each passage finds the source; no artificial combined range exists
        assert_eq!(
            library::passage_sources(conn, &reference("ISA.5.3"))?.len(),
            1
        );
        assert_eq!(
            library::passage_sources(conn, &reference("JHN.15.5"))?.len(),
            1
        );
        assert!(library::passage_sources(conn, &reference("JHN.15.20"))?
            .iter()
            .all(|g| g
                .locations
                .iter()
                .all(|l| l.match_kind == MatchKind::Chapter)));
        Ok(())
    });
}

#[test]
fn a_reference_in_the_body_never_changes_what_a_section_is_about() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        // the second paragraph mentions Romans 8:1; the paragraph after it is still John
        let third = links(conn, &segment(conn, &id, "A third paragraph"));
        assert_eq!(third, [("inherited", "JHN.15.1-JHN.15.11".into())]);
        // and the mentioning paragraph keeps both facts, literal first
        let second = links(conn, &segment(conn, &id, "A second paragraph"));
        assert_eq!(
            second,
            [
                ("explicit", "ROM.8.1".into()),
                ("inherited", "JHN.15.1-JHN.15.11".into())
            ]
        );
        Ok(())
    });
}

#[test]
fn an_epub_gets_section_links_from_its_headings() {
    let temp = tempfile::tempdir().unwrap();
    let epub = fixtures::epub(
        "<dc:title>An Invented Acts Study</dc:title><dc:language>en</dc:language>",
        &[
            EpubChapter {
                file: "one.xhtml",
                xhtml_body: "<h1>Chapter on Acts</h1><h2>Acts 2:1–4 — The Gift</h2>\
                    <p>First paragraph on the gift.</p><p>Second paragraph on the gift.</p>\
                    <h2>Reflection</h2><p>A reflection with no passage.</p>",
            },
            EpubChapter {
                file: "two.xhtml",
                xhtml_body: "<h1>An Unrelated Chapter</h1><p>Nothing scriptural here.</p>",
            },
        ],
        &[0, 1],
    );
    with_db(|conn| {
        let id = add(conn, temp.path(), "acts.epub", &epub, "Acts study");
        let at = |text: &str| links(conn, &segment(conn, &id, text));
        assert_eq!(
            at("First paragraph"),
            [("section", "ACT.2.1-ACT.2.4".into())]
        );
        assert_eq!(
            at("Second paragraph"),
            [("inherited", "ACT.2.1-ACT.2.4".into())]
        );
        assert!(
            at("A reflection").is_empty(),
            "the sibling does not inherit"
        );
        assert!(
            at("Nothing scriptural").is_empty(),
            "another chapter gets none"
        );
        Ok(())
    });
}

fn docx_heading(level: u8, text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:outlineLvl w:val="{}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#,
        level - 1
    )
}

fn docx_para(text: &str) -> String {
    format!(r#"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>"#)
}

#[test]
fn a_word_document_gets_section_links_from_its_headings() {
    let temp = tempfile::tempdir().unwrap();
    let body = [
        docx_heading(1, "Invented Sermon Notes"),
        docx_heading(2, "Psalm 23 — The Shepherd"),
        docx_para("The Lord leads beside still waters."),
        docx_para("He restores the soul."),
        docx_heading(2, "Other thoughts"),
        docx_para("A passing remark with no passage."),
    ]
    .concat();
    let docx = fixtures::docx(&body, "", &[]);
    with_db(|conn| {
        let id = add(conn, temp.path(), "notes.docx", &docx, "Sermon notes");
        let at = |text: &str| links(conn, &segment(conn, &id, text));
        assert_eq!(at("The Lord leads"), [("section", "PSA.23".into())]);
        assert_eq!(at("He restores"), [("inherited", "PSA.23".into())]);
        assert!(at("A passing remark").is_empty());
        Ok(())
    });
}

#[test]
fn plain_text_has_explicit_references_only() {
    let txt = "Psalm 23 — The Shepherd\n\nThe Lord leads beside still waters.\n\n\
               He restores the soul, as Psalm 23:3 says.\n";
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "notes.txt",
            txt.as_bytes(),
            "Plain notes",
        );
        assert!(
            derived_rows(conn, &id).is_empty(),
            "text has no structure to derive from"
        );
        let lead = segment(conn, &id, "The Lord leads");
        assert!(links(conn, &lead).is_empty());
        // the literal mentions are all there is
        assert!(library::passage_sources(conn, &reference("PSA.23.3"))?
            .iter()
            .flat_map(|g| &g.locations)
            .all(|l| l.origin == LinkOrigin::Explicit));
        assert_eq!(library::mentions(conn, &reference("PSA.23"))?.len(), 2);
        Ok(())
    });
}

#[test]
fn a_pdf_never_gets_invented_structure() {
    let temp = tempfile::tempdir().unwrap();
    let pdf = fixtures::pdf(
        &[
            &[
                "John 15:1–11 — The True Vine",
                "Opening words about the vine.",
            ],
            &["More words about branches.", "And an ending."],
        ],
        Some("An Invented PDF"),
        None,
    );
    with_db(|conn| {
        let id = add(conn, temp.path(), "vine.pdf", &pdf, "Vine PDF");
        assert!(derived_rows(conn, &id).is_empty());
        let more = segment(conn, &id, "More words");
        assert!(links(conn, &more).is_empty());
        // the one literal mention (in the first-page heading line) is still explicit
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert!(found
            .iter()
            .flat_map(|g| &g.locations)
            .all(|l| l.origin == LinkOrigin::Explicit));
        Ok(())
    });
}

// --- ranking and grouping ---------------------------------------------------

fn md(heading: &str, paragraphs: &[&str]) -> String {
    let mut out = format!("# A Synthetic Source\n\n## {heading}\n\n");
    for p in paragraphs {
        out.push_str(p);
        out.push_str("\n\n");
    }
    out
}

#[test]
fn an_exact_match_outranks_a_containing_section_which_outranks_a_broad_one() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let broad = add(
            conn,
            temp.path(),
            "a.md",
            md("John 15", &["Whole chapter remarks."]).as_bytes(),
            "A — the whole chapter",
        );
        let section = add(
            conn,
            temp.path(),
            "b.md",
            md("John 15:1–11 — The Vine", &["Remarks on the vine."]).as_bytes(),
            "B — the section",
        );
        let exact = add(
            conn,
            temp.path(),
            "c.md",
            md("Notes", &["Abide: see John 15:5."]).as_bytes(),
            "C — the exact verse",
        );
        let order: Vec<_> = library::passage_sources(conn, &reference("JHN.15.5"))?
            .into_iter()
            .map(|g| (g.source_id, g.locations[0].match_kind))
            .collect();
        assert_eq!(
            order,
            [
                (exact, MatchKind::Exact),
                (section, MatchKind::Contained),
                (broad, MatchKind::Contained)
            ]
        );
        Ok(())
    });
}

#[test]
fn an_overlapping_range_ranks_between_containment_and_the_same_chapter() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let same_chapter = add(
            conn,
            temp.path(),
            "a.md",
            md("John 15:16–17", &["Fruit that lasts."]).as_bytes(),
            "Chapter only",
        );
        let overlap = add(
            conn,
            temp.path(),
            "b.md",
            md("John 15:8–14", &["Friends and fruit."]).as_bytes(),
            "Overlap",
        );
        let contained = add(
            conn,
            temp.path(),
            "c.md",
            md("John 15:1–11", &["The vine."]).as_bytes(),
            "Contained",
        );
        let other_book = add(
            conn,
            temp.path(),
            "d.md",
            md("Romans 8", &["Nothing to do with it."]).as_bytes(),
            "Other book",
        );
        let found = library::passage_sources(conn, &reference("JHN.15.5-JHN.15.12"))?;
        let order: Vec<_> = found
            .iter()
            .map(|g| (g.source_id.clone(), g.locations[0].match_kind))
            .collect();
        // active 15:5–12: 15:1–11 overlaps (neither contains the other); 15:8–14 overlaps too;
        // 15:16–17 shares only the chapter; Romans is not shown.
        assert!(order.iter().all(|(id, _)| *id != other_book));
        let kinds: Vec<_> = order.iter().map(|(_, k)| *k).collect();
        assert_eq!(
            kinds,
            [MatchKind::Overlap, MatchKind::Overlap, MatchKind::Chapter]
        );
        assert_eq!(order[2].0, same_chapter);
        assert!([&contained, &overlap].contains(&&order[0].0));
        Ok(())
    });
}

#[test]
fn a_source_with_many_places_is_one_group_with_a_few_places_and_a_count() {
    let temp = tempfile::tempdir().unwrap();
    let text: String = (1..=40)
        .map(|i| format!("Remark number {i}. It touches John 15:5 again.\n\n"))
        .collect();
    with_db(|conn| {
        add(
            conn,
            temp.path(),
            "many.txt",
            text.as_bytes(),
            "Forty mentions",
        );
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert_eq!(found.len(), 1, "one source, one entry");
        assert_eq!(found[0].locations.len(), library::LOCATIONS_PER_SOURCE);
        assert_eq!(
            found[0].more_locations,
            40 - library::LOCATIONS_PER_SOURCE as i64
        );
        // reading order breaks the tie among equal places
        assert_eq!(found[0].locations[0].locator, "¶ 1");
        Ok(())
    });
}

#[test]
fn a_commentary_section_is_one_place_not_one_card_per_paragraph() {
    let temp = tempfile::tempdir().unwrap();
    let paragraphs: Vec<String> = (1..=12)
        .map(|i| format!("Paragraph {i} about the vine."))
        .collect();
    let refs: Vec<&str> = paragraphs.iter().map(String::as_str).collect();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "calvin.md",
            md("John 15:1–11 — The True Vine", &refs).as_bytes(),
            "Synthetic commentary",
        );
        let found = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].locations.len(),
            1,
            "the section opens in one place"
        );
        assert_eq!(found[0].more_locations, 0);
        let place = &found[0].locations[0];
        assert_eq!(place.origin, LinkOrigin::Section);
        assert_eq!(place.matched_text, "John 15:1–11");
        assert_eq!(place.reference.canonical, "JHN.15.1-JHN.15.11");
        assert_eq!(
            place.section_heading.as_deref(),
            Some("John 15:1–11 — The True Vine")
        );
        // opening it lands on the section's first paragraph, through the normal reader window
        let window = library::segments(
            conn,
            &GetSegments {
                source_id: id,
                around_segment_id: Some(place.segment_id.clone()),
                around_page: None,
                offset: None,
                limit: None,
            },
        )?;
        assert_eq!(
            window.target_segment_id.as_deref(),
            Some(place.segment_id.as_str())
        );
        let target = window
            .segments
            .iter()
            .find(|s| s.id == place.segment_id)
            .unwrap();
        assert!(target.text.starts_with("Paragraph 1 about"));
        Ok(())
    });
}

#[test]
fn a_source_with_a_direct_place_does_not_also_list_its_same_chapter_places() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        // verse 5: the 15:1–11 section contains it; the 15:12–17 section only shares the chapter
        let direct = library::passage_sources(conn, &reference("JHN.15.5"))?;
        assert_eq!(direct.len(), 1);
        assert_eq!(direct[0].locations.len(), 1);
        assert_eq!(direct[0].locations[0].match_kind, MatchKind::Contained);
        assert_eq!(direct[0].more_locations, 0);
        // verse 14: now the other section contains it, and the first is the one left out
        let other = library::passage_sources(conn, &reference("JHN.15.14"))?;
        assert_eq!(other[0].locations.len(), 1);
        assert_eq!(
            other[0].locations[0].reference.canonical,
            "JHN.15.12-JHN.15.17"
        );
        // a source that has nothing closer still appears, for its same-chapter places only
        let none = add(
            conn,
            temp.path(),
            "n.md",
            md("John 15:1–3", &["Early verses."]).as_bytes(),
            "Early verses",
        );
        let found = library::passage_sources(conn, &reference("JHN.15.9"))?;
        let early = found.iter().find(|g| g.source_id == none).unwrap();
        assert_eq!(early.locations[0].match_kind, MatchKind::Chapter);
        assert!(found.iter().any(|g| g.source_id == id));
        Ok(())
    });
}

#[test]
fn removed_sources_never_appear() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        assert_eq!(
            library::passage_sources(conn, &reference("JHN.15.5"))?.len(),
            1
        );
        library::remove(conn, &id)?;
        assert!(library::passage_sources(conn, &reference("JHN.15.5"))?.is_empty());
        assert!(library::mentions(conn, &reference("ROM.8.1"))?.is_empty());
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))?;
        assert_eq!(rows, 0, "removal takes every kind of link with the text");
        Ok(())
    });
}

#[test]
fn a_chapter_view_lists_the_sources_that_speak_to_any_part_of_it() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let found = library::passage_sources(conn, &reference("JHN.15"))?;
        assert_eq!(found.len(), 1);
        // both sections of the chapter, nothing for Romans
        let passages: Vec<_> = found[0]
            .locations
            .iter()
            .map(|l| l.reference.canonical.as_str())
            .collect();
        assert_eq!(passages, ["JHN.15.1-JHN.15.11", "JHN.15.12-JHN.15.17"]);
        assert_eq!(found[0].source_id, id);
        Ok(())
    });
}

// --- citations, duplicates, rebuilding --------------------------------------

fn study_with_finding(conn: &Connection) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: "John".into(),
            description: None,
        },
    )?;
    let study = studies::create(
        conn,
        &CreateStudy {
            project_id: project.id,
            title: "John 15".into(),
            ..Default::default()
        },
    )?;
    Ok(findings::create(
        conn,
        &CreateFinding {
            study_id: study.study.id,
            finding_type: FindingType::Quotation,
            content: Some("Remain in me.".into()),
            section_id: None,
            passage: None,
        },
    )?
    .id)
}

#[test]
fn finding_citations_are_unaffected_by_rebuilding_the_links() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let finding = study_with_finding(conn)?;
        let cited_segment = segment(conn, &id, "A third paragraph");
        findings::add_source(
            conn,
            &AddFindingSource {
                finding_id: finding.clone(),
                segment_id: cited_segment.clone(),
            },
        )?;
        library::reindex_passages(conn, &id)?;
        library::reindex_passages(conn, &id)?;
        let after = findings::get(conn, &finding)?;
        assert_eq!(after.sources.len(), 1);
        assert_eq!(
            after.sources[0].segment_id.as_deref(),
            Some(cited_segment.as_str())
        );
        assert!(!after.sources[0].removed);
        Ok(())
    });
}

#[test]
fn a_duplicate_is_still_refused_and_a_deliberate_copy_has_its_own_links() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let first = import::stage(&write(temp.path(), "a.md", COMMENTARY.as_bytes())).unwrap();
        let second = import::stage(&write(temp.path(), "copy.md", COMMENTARY.as_bytes())).unwrap();
        let id = commit(conn, &first, "Commentary")?;
        assert!(library::find_duplicate(conn, &second.hash)?.is_some());
        assert!(
            commit(conn, &second, "Again").is_err(),
            "refused unless allowed"
        );
        let copy = abiding_word_lib::db::new_id();
        library::commit_import(
            conn,
            &copy,
            &second,
            &CommitSourceImport {
                preview_id: second.id.clone(),
                title: "Deliberate copy".into(),
                allow_duplicate: true,
                ..Default::default()
            },
            "notes/x/copy.md",
        )?;
        assert_eq!(
            derived_rows(conn, &id).len(),
            derived_rows(conn, &copy).len()
        );
        // both appear, each with its own places
        assert_eq!(
            library::passage_sources(conn, &reference("JHN.15.5"))?.len(),
            2
        );
        Ok(())
    });
}

#[test]
fn rebuilding_gives_the_same_links_as_importing() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let id = add(
            conn,
            temp.path(),
            "c.md",
            COMMENTARY.as_bytes(),
            "Commentary",
        );
        let at_import = derived_rows(conn, &id);
        assert!(!at_import.is_empty());
        let explicit_before: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages WHERE origin = 'explicit'",
            [],
            |r| r.get(0),
        )?;

        // a library from before v0.9: no derived links, never indexed
        conn.execute("DELETE FROM source_passages WHERE origin <> 'explicit'", [])?;
        conn.execute("UPDATE sources SET passage_index_version = 0", [])?;
        assert!(derived_rows(conn, &id).is_empty());

        let report = library::ensure_passage_index(conn)?;
        assert_eq!((report.rebuilt, report.failed), (1, 0));
        assert_eq!(
            derived_rows(conn, &id),
            at_import,
            "the same links, deterministically"
        );
        let version: i64 = conn.query_row(
            "SELECT passage_index_version FROM sources WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )?;
        assert_eq!(version, sections::INDEX_VERSION);

        // nothing left to do, and doing it again changes nothing
        assert_eq!(library::ensure_passage_index(conn)?.rebuilt, 0);
        library::reindex_passages(conn, &id)?;
        assert_eq!(derived_rows(conn, &id), at_import);
        let explicit_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM source_passages WHERE origin = 'explicit'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(
            explicit_before, explicit_after,
            "literal links are never touched"
        );
        Ok(())
    });
}

#[test]
fn a_stored_path_naming_no_valid_passage_links_nothing_and_the_others_still_rebuild() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let good = add(conn, temp.path(), "g.md", COMMENTARY.as_bytes(), "Good");
        let bad = add(
            conn,
            temp.path(),
            "b.md",
            md("John 3:16", &["Plain."]).as_bytes(),
            "Bad",
        );
        conn.execute("DELETE FROM source_passages WHERE origin <> 'explicit'", [])?;
        conn.execute("UPDATE sources SET passage_index_version = 0", [])?;
        // a stored structure naming a passage that does not exist (Psalms has 150 chapters)
        conn.execute(
            "UPDATE source_segments SET section_path = 'X › Psalm 999:1' WHERE source_id = ?1",
            [&bad],
        )?;
        let report = library::ensure_passage_index(conn)?;
        assert_eq!(
            report.rebuilt, 2,
            "a path naming no valid passage is simply not linked"
        );
        assert!(!derived_rows(conn, &good).is_empty());
        assert!(derived_rows(conn, &bad).is_empty());
        Ok(())
    });
}

#[test]
fn heading_text_with_the_importers_separator_still_derives_deterministically() {
    // A heading that itself contains " › " is read as nested headings: documented, deterministic.
    let parts: Vec<_> = sections::components("Book › Psalm 23 › 3").collect();
    assert_eq!(parts, ["Book", "Psalm 23", "3"]);
}

// --- size ---------------------------------------------------------------------

#[test]
fn turning_pages_stays_fast_on_a_large_library() {
    // Eight sources of 1,600 paragraphs each, every section naming a passage
    // (some across many chapters), plus scattered literal mentions.
    let temp = tempfile::tempdir().unwrap();
    let books = ["John", "Romans", "Psalm", "Isaiah"];
    with_db(|conn| {
        for s in 0..8 {
            let mut text = format!("# Synthetic Library Book {s}\n\n");
            for section in 0..80 {
                let book = books[(s + section) % books.len()];
                let chapter = 1 + (section * 7 + s) % 14;
                let (a, b) = (1 + section % 5, 6 + section % 7);
                let heading = if section % 9 == 0 {
                    format!("{book} {chapter}–{}", chapter + 2)
                } else {
                    format!("{book} {chapter}:{a}–{b} — Section {section}")
                };
                text.push_str(&format!("## {heading}\n\n"));
                for p in 0..20 {
                    if p % 7 == 0 {
                        text.push_str(&format!("Remark {p} recalls {book} {chapter}:{a}.\n\n"));
                    } else {
                        text.push_str(&format!("Invented paragraph {p} of section {section}.\n\n"));
                    }
                }
            }
            add(
                conn,
                temp.path(),
                &format!("book{s}.md"),
                text.as_bytes(),
                &format!("Book {s}"),
            );
        }
        let segments: i64 =
            conn.query_row("SELECT COUNT(*) FROM source_segments", [], |r| r.get(0))?;
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))?;
        assert!(segments >= 12_800, "{segments} segments");
        assert!(rows > 12_000, "{rows} links");

        let queries: Vec<String> = (1..=14)
            .flat_map(|c| ["JHN", "ROM", "PSA", "ISA"].map(|b| (b, c)))
            .flat_map(|(b, c)| {
                [
                    format!("{b}.{c}"),
                    format!("{b}.{c}.5"),
                    format!("{b}.{c}.3-{b}.{c}.9"),
                ]
            })
            .collect();
        let started = std::time::Instant::now();
        let mut shown = 0;
        for q in &queries {
            shown += library::passage_sources(conn, &reference(q))?.len();
        }
        let per_query = started.elapsed() / queries.len() as u32;
        eprintln!(
            "{segments} segments, {rows} links, {} queries: {per_query:?} each, {shown} groups",
            queries.len()
        );
        assert!(shown > 0);

        // the one-time rebuild an existing library gets at startup
        conn.execute("DELETE FROM source_passages WHERE origin <> 'explicit'", [])?;
        conn.execute("UPDATE sources SET passage_index_version = 0", [])?;
        let started = std::time::Instant::now();
        let report = library::ensure_passage_index(conn)?;
        let rebuild = started.elapsed();
        eprintln!(
            "rebuilt {} sources ({segments} segments) in {rebuild:?}",
            report.rebuilt
        );
        assert_eq!((report.rebuilt, report.failed), (8, 0));
        assert!(rebuild < std::time::Duration::from_secs(10), "{rebuild:?}");
        let after: i64 =
            conn.query_row("SELECT COUNT(*) FROM source_passages", [], |r| r.get(0))?;
        assert_eq!(after, rows, "the rebuild restores exactly the same links");
        assert!(
            per_query < std::time::Duration::from_millis(100),
            "{per_query:?} per query"
        );
        Ok(())
    });
}
