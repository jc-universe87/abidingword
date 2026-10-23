//! Presentation & Delivery (v0.18): a presentation is made from a Bible
//! Teaching by fixed rules, follows the teaching live, keeps what the
//! audience sees apart from what only the speaker sees, and gives the same
//! slides to the Presenter View, PowerPoint, PDF, Markdown and the delivery
//! package. All text is invented.

use std::io::Read as _;
use std::path::{Path, PathBuf};

use abiding_word_lib::commands::presentations::render;
use abiding_word_lib::db::bibles::SourceRecord;
use abiding_word_lib::db::{
    bibles, presentations, projects, studies, teaching, workspaces, Database,
};
use abiding_word_lib::domain::{
    AddTeachingPassage, CreatePresentation, CreatePresentationItem, CreateProject, CreateStudy,
    CreateTeaching, ImageInfo, ItemSource, KeepTeachingMaterial, ProposalLabels, Reorder,
    StartingPoint, UpdatePresentation, UpdatePresentationItem, UpdateTeaching, UpdateTeachingPoint,
};
use abiding_word_lib::error::{AppError, AppResult};
use abiding_word_lib::presentation::fonts::FontSet;
use abiding_word_lib::presentation::{self, document, package, ExportOptions, ImageStore};
use abiding_word_lib::scripture::import::{self, ImportOrigin};
use abiding_word_lib::scripture::CommitImport;
use rusqlite::Connection;

fn with_db<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> T {
    Database::open_in_memory().unwrap().with_conn(f).unwrap()
}

fn install_bible(conn: &Connection) -> AppResult<String> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/usfm-a");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    let staged = import::stage(&files, ImportOrigin::UserFiles)?;
    let id = bibles::new_translation_id();
    bibles::commit_import(
        conn,
        &id,
        &staged.content,
        &CommitImport {
            preview_id: staged.id.clone(),
            name: "Fixture Alpha".into(),
            short_name: "FXA".into(),
            language: "English".into(),
            language_code: Some("en".into()),
            publisher: None,
            copyright_notice: Some("Fixture text, free to use.".into()),
            license_type: None,
            words: Default::default(),
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

fn new_study(conn: &Connection) -> AppResult<String> {
    let workspace = workspaces::get_default(conn)?;
    let project = projects::create(
        conn,
        &CreateProject {
            workspace_id: workspace.id,
            title: "Collection".into(),
            description: None,
        },
    )?;
    Ok(studies::create(
        conn,
        &CreateStudy {
            project_id: project.id,
            title: "John 15".into(),
            ..Default::default()
        },
    )?
    .study
    .id)
}

const GENERATED: &str = "0a1b2c3d-4e5f.png";

/// A small real PNG (with transparency).
fn png_bytes() -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, 4, 3);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[200u8; 4 * 3 * 4]).unwrap();
    }
    out
}

struct Sermon {
    teaching: String,
    points: Vec<String>,
}

/// A sermon: introduction, message, John 15:1–5 for the whole, two points
/// (the first with John 15:7 and a generated image), a conclusion, notes.
fn sermon(conn: &Connection) -> AppResult<Sermon> {
    let study = new_study(conn)?;
    let prep = teaching::create(
        conn,
        &CreateTeaching {
            study_id: study,
            title: "Remain in the vine".into(),
            kind: Some("sermon".into()),
            points: vec![
                StartingPoint {
                    title: "Stay connected".into(),
                    kind: None,
                },
                StartingPoint {
                    title: "Bear fruit".into(),
                    kind: None,
                },
            ],
        },
    )?;
    teaching::update(
        conn,
        &UpdateTeaching {
            id: prep.id.clone(),
            introduction: Some("Have you ever pruned a rose?".into()),
            central_message: Some("Fruit comes from abiding.".into()),
            conclusion: Some("Stay close to him this week.".into()),
            notes: Some("PRIVATE TEACHING NOTE".into()),
            ..Default::default()
        },
    )?;
    let points: Vec<String> = prep.points.iter().map(|p| p.id.clone()).collect();
    teaching::update_point(
        conn,
        &UpdateTeachingPoint {
            id: points[0].clone(),
            explanation: Some("SPEAKER EXPLANATION: branches live from the vine.".into()),
            application: Some("Pray before you plan.".into()),
            ..Default::default()
        },
    )?;
    teaching::add_passage(
        conn,
        &AddTeachingPassage {
            preparation_id: prep.id.clone(),
            point_id: None,
            reference: "JHN.15.1-JHN.15.5".into(),
        },
    )?;
    teaching::add_passage(
        conn,
        &AddTeachingPassage {
            preparation_id: prep.id.clone(),
            point_id: Some(points[0].clone()),
            reference: "JHN.15.7".into(),
        },
    )?;
    teaching::keep_material(
        conn,
        &KeepTeachingMaterial {
            preparation_id: prep.id.clone(),
            point_id: Some(points[0].clone()),
            kind: "image".into(),
            standing: "generated".into(),
            title: "A vine with grapes".into(),
            content: String::new(),
            sources: Vec::new(),
            image: Some(ImageInfo {
                file: Some(GENERATED.into()),
                ..Default::default()
            }),
            assistant: Some("Example · image".into()),
        },
    )?;
    Ok(Sermon {
        teaching: prep.id,
        points,
    })
}

fn labels() -> ProposalLabels {
    ProposalLabels {
        introduction: "Introduction".into(),
        conclusion: "Conclusion".into(),
    }
}

fn propose(conn: &Connection, teaching: &str) -> AppResult<abiding_word_lib::domain::Presentation> {
    presentations::create(
        conn,
        &CreatePresentation {
            preparation_id: teaching.into(),
            title: None,
            propose: true,
            labels: labels(),
        },
    )
}

fn store(dir: &Path) -> ImageStore {
    let generated = dir.join("teaching-images");
    std::fs::create_dir_all(&generated).unwrap();
    std::fs::write(generated.join(GENERATED), png_bytes()).unwrap();
    ImageStore {
        generated_dir: generated,
        offline_dir: dir.join("presentation-images"),
        template_dir: dir.join("presentation-templates"),
    }
}

fn code<T: std::fmt::Debug>(result: AppResult<T>) -> String {
    match result {
        Err(AppError::InvalidInput(m)) | Err(AppError::InvalidReference(m)) => {
            m.code.unwrap_or_default().to_string()
        }
        Err(AppError::NotFound { entity, .. }) => format!("notFound:{entity}"),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_proposal_follows_the_teaching_in_order_without_ai() {
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        let kinds: Vec<(&str, &str)> = p
            .items
            .iter()
            .map(|i| {
                (
                    i.kind.as_str(),
                    i.source.as_ref().map_or("", |s| s.kind.as_str()),
                )
            })
            .collect();
        assert_eq!(
            kinds,
            [
                ("title", "preparation"),
                ("heading", "preparation"), // introduction (spoken)
                ("scripture", "passage"),   // John 15:1–5
                ("text", "preparation"),    // central message
                ("heading", "point"),
                ("scripture", "passage"), // John 15:7
                ("image", "material"),
                ("heading", "point"),
                ("heading", "preparation"), // conclusion
            ]
        );
        assert_eq!(p.title, "Remain in the vine");
        assert_eq!(p.theme, "light");
        // The proposal's own headings are in the person's language.
        assert_eq!(p.items[1].heading.as_deref(), Some("Introduction"));
        assert_eq!(p.items[8].heading.as_deref(), Some("Conclusion"));
        // The same teaching always gives the same proposal.
        let again = propose(conn, &s.teaching)?;
        assert_eq!(
            again
                .items
                .iter()
                .map(|i| (&i.kind, &i.source))
                .collect::<Vec<_>>(),
            p.items
                .iter()
                .map(|i| (&i.kind, &i.source))
                .collect::<Vec<_>>()
        );
        assert_eq!(presentations::list(conn, &s.teaching)?.len(), 2);
        Ok(())
    });
}

#[test]
fn bible_study_questions_and_lesson_steps_get_their_own_slides() {
    with_db(|conn| {
        let study = new_study(conn)?;
        let group = teaching::create(
            conn,
            &CreateTeaching {
                study_id: study.clone(),
                title: "Group".into(),
                kind: Some("bible_study".into()),
                points: vec![StartingPoint {
                    title: "What does the vine give the branch?".into(),
                    kind: None,
                }],
            },
        )?;
        let p = propose(conn, &group.id)?;
        assert_eq!(p.items[1].kind, "question");

        let lesson = teaching::create(
            conn,
            &CreateTeaching {
                study_id: study,
                title: "Lesson".into(),
                kind: Some("children".into()),
                points: ["scripture", "activity", "question", "image"]
                    .iter()
                    .map(|k| StartingPoint {
                        title: format!("A {k} step"),
                        kind: Some((*k).into()),
                    })
                    .collect(),
            },
        )?;
        teaching::add_passage(
            conn,
            &AddTeachingPassage {
                preparation_id: lesson.id.clone(),
                point_id: Some(lesson.points[0].id.clone()),
                reference: "JHN.15.1".into(),
            },
        )?;
        let p = propose(conn, &lesson.id)?;
        let kinds: Vec<&str> = p.items.iter().map(|i| i.kind.as_str()).collect();
        // The Scripture step is shown by its passage; an image step without
        // an image keeps its heading.
        assert_eq!(
            kinds,
            ["title", "scripture", "activity", "question", "heading"]
        );
        Ok(())
    });
}

#[test]
fn slides_follow_the_teaching_live_until_the_person_writes_their_own() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        let point_item = p.items[4].clone();
        let heading = |conn: &Connection| -> AppResult<Option<String>> {
            let doc = document::build(conn, &p.id, &store)?;
            Ok(doc
                .slides
                .iter()
                .find(|sl| sl.item_id == point_item.id)
                .and_then(|sl| sl.audience.heading.clone()))
        };
        assert_eq!(heading(conn)?.as_deref(), Some("Stay connected"));
        // Editing the teaching shows in the presentation.
        teaching::update_point(
            conn,
            &UpdateTeachingPoint {
                id: s.points[0].clone(),
                title: Some("Stay joined to him".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(heading(conn)?.as_deref(), Some("Stay joined to him"));
        // The person's own heading wins, and the teaching is not changed.
        let before = teaching::get(conn, &s.teaching)?;
        presentations::update_item(
            conn,
            &UpdatePresentationItem {
                id: point_item.id.clone(),
                heading: Some("Joined".into()),
                body: Some("Audience line".into()),
                notes: Some("Look at the back row.".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(heading(conn)?.as_deref(), Some("Joined"));
        let after = teaching::get(conn, &s.teaching)?;
        assert_eq!(before.revision, after.revision);
        assert_eq!(after.points[0].title, "Stay joined to him");
        // Following the teaching again.
        presentations::update_item(
            conn,
            &UpdatePresentationItem {
                id: point_item.id.clone(),
                follow_heading: true,
                ..Default::default()
            },
        )?;
        assert_eq!(heading(conn)?.as_deref(), Some("Stay joined to him"));
        Ok(())
    });
}

#[test]
fn items_are_added_reordered_left_out_and_checked() {
    with_db(|conn| {
        let s = sermon(conn)?;
        let other = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        let first = p.items[0].id.clone();
        let p = presentations::create_item(
            conn,
            &CreatePresentationItem {
                presentation_id: p.id.clone(),
                kind: "pause".into(),
                after_item_id: Some(first.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(p.items[1].kind, "pause");
        let p = presentations::create_item(
            conn,
            &CreatePresentationItem {
                presentation_id: p.id.clone(),
                kind: "scripture".into(),
                reference: Some("ROM.8.1".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(
            p.items.last().unwrap().reference.as_deref(),
            Some("ROM.8.1")
        );

        // Refusals: another teaching's part, an unknown kind or theme, a bad reference.
        assert_eq!(
            code(presentations::create_item(
                conn,
                &CreatePresentationItem {
                    presentation_id: p.id.clone(),
                    kind: "heading".into(),
                    source: Some(ItemSource {
                        kind: "point".into(),
                        id: other.points[0].clone(),
                        field: None,
                    }),
                    ..Default::default()
                },
            )),
            "presentation.otherTeaching"
        );
        assert_eq!(
            code(presentations::create_item(
                conn,
                &CreatePresentationItem {
                    presentation_id: p.id.clone(),
                    kind: "video".into(),
                    ..Default::default()
                },
            )),
            "invalidChoice"
        );
        assert_eq!(
            code(presentations::update(
                conn,
                &UpdatePresentation {
                    id: p.id.clone(),
                    theme: Some("neon".into()),
                    ..Default::default()
                },
            )),
            "invalidChoice"
        );
        assert_eq!(
            code(presentations::update_item(
                conn,
                &UpdatePresentationItem {
                    id: first.clone(),
                    reference: Some("NOT.A.REF".into()),
                    ..Default::default()
                },
            )),
            "reference.invalid"
        );

        let mut ids: Vec<String> = p.items.iter().map(|i| i.id.clone()).collect();
        ids.reverse();
        let p = presentations::reorder_items(
            conn,
            &Reorder {
                parent_id: p.id.clone(),
                ids: ids.clone(),
            },
        )?;
        assert_eq!(
            p.items.iter().map(|i| &i.id).collect::<Vec<_>>(),
            ids.iter().collect::<Vec<_>>()
        );
        assert_eq!(
            code(presentations::reorder_items(
                conn,
                &Reorder {
                    parent_id: p.id.clone(),
                    ids: ids[1..].to_vec(),
                },
            )),
            "changedMeanwhile"
        );

        let p = presentations::update(
            conn,
            &UpdatePresentation {
                id: p.id.clone(),
                theme: Some("warm".into()),
                title: Some("Sunday".into()),
                ..Default::default()
            },
        )?;
        assert_eq!((p.theme.as_str(), p.title.as_str()), ("warm", "Sunday"));
        let left_out = p.items[0].id.clone();
        let p = presentations::update_item(
            conn,
            &UpdatePresentationItem {
                id: left_out.clone(),
                skipped: Some(true),
                ..Default::default()
            },
        )?;
        let temp = tempfile::tempdir().unwrap();
        let doc = document::build(conn, &p.id, &store(temp.path()))?;
        assert!(doc.slides.iter().all(|sl| sl.item_id != left_out));
        let count = p.items.len();
        let p = presentations::delete_item(conn, &left_out)?;
        assert_eq!(p.items.len(), count - 1);
        assert_eq!(
            p.items.iter().map(|i| i.position).collect::<Vec<_>>(),
            (0..count as i64 - 1).collect::<Vec<_>>()
        );

        presentations::delete(conn, &p.id)?;
        assert_eq!(
            code(presentations::get(conn, &p.id)),
            "notFound:presentation"
        );
        // The teaching is still there.
        teaching::get(conn, &s.teaching)?;
        Ok(())
    });
}

#[test]
fn a_removed_part_of_the_teaching_is_reported_and_a_removed_teaching_takes_its_presentations() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        teaching::delete_point(conn, &s.points[1])?;
        let doc = document::build(conn, &p.id, &store)?;
        let missing: Vec<_> = doc.slides.iter().filter(|sl| sl.source_missing).collect();
        assert_eq!(missing.len(), 1);
        assert!(doc.warnings.iter().any(|w| w.code == "sourceMissing"));
        teaching::delete(conn, &s.teaching)?;
        assert!(presentations::get(conn, &p.id).is_err());
        Ok(())
    });
}

#[test]
fn scripture_is_quoted_from_an_installed_bible_and_missing_text_is_said() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        let doc = document::build(conn, &p.id, &store)?;
        assert!(doc.bible.is_none());
        assert!(doc.warnings.iter().any(|w| w.code == "noBible"));
        assert!(doc
            .warnings
            .iter()
            .any(|w| w.code == "scriptureUnavailable"));

        let bible = install_bible(conn)?;
        let doc = document::build(conn, &p.id, &store)?;
        assert_eq!(
            doc.bible.as_ref().map(|b| b.id.as_str()),
            Some(bible.as_str())
        );
        let scripture: Vec<_> = doc
            .slides
            .iter()
            .filter(|sl| sl.kind == "scripture")
            .collect();
        assert_eq!(scripture.len(), 2);
        assert_eq!(scripture[0].audience.verses.len(), 5);
        assert!(scripture[0].audience.verses[0].text.contains("vine"));
        assert_eq!(scripture[0].audience.bible.as_deref(), Some("FXA"));
        assert_eq!(
            scripture[1].audience.reference.as_ref().unwrap().canonical,
            "JHN.15.7"
        );
        // The title slide names the main passage.
        assert_eq!(
            doc.slides[0].audience.reference.as_ref().unwrap().canonical,
            "JHN.15.1-JHN.15.5"
        );
        assert_eq!(
            doc.primary_passage.as_ref().unwrap().canonical,
            "JHN.15.1-JHN.15.5"
        );
        Ok(())
    });
}

#[test]
fn speaker_text_never_reaches_the_audience() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        install_bible(conn)?;
        let p = propose(conn, &s.teaching)?;
        for item in &p.items {
            presentations::update_item(
                conn,
                &UpdatePresentationItem {
                    id: item.id.clone(),
                    notes: Some(format!("SECRET NOTE {}", item.position)),
                    ..Default::default()
                },
            )?;
        }
        let p = presentations::create_item(
            conn,
            &CreatePresentationItem {
                presentation_id: p.id.clone(),
                kind: "pause".into(),
                heading: Some("SECRET PAUSE LABEL".into()),
                ..Default::default()
            },
        )?;
        let doc = document::build(conn, &p.id, &store)?;
        // The speaker has their text…
        let speaker = serde_json::to_string(&doc).unwrap();
        assert!(speaker.contains("SECRET NOTE 0"));
        assert!(speaker.contains("SPEAKER EXPLANATION"));
        assert!(speaker.contains("Have you ever pruned a rose?"));
        // …the audience screen is given none of it.
        let audience = serde_json::to_string(&doc.audience()).unwrap();
        for private in [
            "SECRET",
            "SPEAKER EXPLANATION",
            "Pray before you plan",
            "Have you ever pruned a rose?",
            "Stay close to him this week",
            "PRIVATE TEACHING NOTE",
            "manuscript",
            "notes",
            "citations",
            "Fixture text, free to use.",
            "Example · image",
        ] {
            assert!(
                !audience.contains(private),
                "audience was given {private:?}"
            );
        }
        // A pause is an empty screen.
        let pause = doc.audience().slides.into_iter().last().unwrap();
        assert!(pause.audience.blank);
        assert!(pause.audience.heading.is_none());
        // The generated image is marked as generated for the audience too.
        let image = doc.slides.iter().find(|sl| sl.kind == "image").unwrap();
        assert!(image.audience.image.as_ref().unwrap().generated);
        Ok(())
    });
}

#[test]
fn the_delivery_package_is_a_deterministic_self_contained_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        install_bible(conn)?;
        let p = propose(conn, &s.teaching)?;
        let first = package::to_json(&package::build(conn, &p.id, &store)?)?;
        let second = package::to_json(&package::build(conn, &p.id, &store)?)?;
        assert_eq!(first, second, "the same content gives the same file");
        let read = package::from_json(&first)?;
        assert_eq!(read.format, document::FORMAT);
        assert_eq!(read.schema_version, document::SCHEMA_VERSION);
        assert_eq!(
            read.slides.len(),
            document::build(conn, &p.id, &store)?.slides.len()
        );
        let image = &read.images[0];
        assert!(image.available);
        assert_eq!(image.media_type.as_deref(), Some("image/png"));
        assert_eq!((image.width, image.height), (Some(4), Some(3)));
        assert!(image.data.as_deref().is_some_and(|d| !d.is_empty()));
        // No addresses of this computer's files are in it.
        assert!(!first.contains(temp.path().to_str().unwrap()));
        // The live document carries no image data.
        assert!(document::build(conn, &p.id, &store)?.images[0]
            .data
            .is_none());
        // A newer package is refused rather than misread.
        let newer = first.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99");
        assert!(package::from_json(&newer).is_err());
        Ok(())
    });
}

fn options(notes: bool) -> ExportOptions {
    ExportOptions {
        speaker_notes: notes,
        citations: true,
        ..Default::default()
    }
}

fn exported(format: &str, notes: bool) -> (Vec<u8>, presentation::PresentationDocument) {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        install_bible(conn)?;
        let p = propose(conn, &s.teaching)?;
        presentations::update_item(
            conn,
            &UpdatePresentationItem {
                id: p.items[4].id.clone(),
                notes: Some("Look at the back row.".into()),
                body: Some("나는 포도나무요 — Ich bin der Weinstock".into()),
                ..Default::default()
            },
        )?;
        let doc = package::build(conn, &p.id, &store)?;
        let bytes = render(&doc, format, &options(notes), FontSet::system).unwrap();
        Ok((bytes, doc))
    })
}

#[test]
fn markdown_has_the_slides_and_speaker_text_only_when_asked() {
    let (bytes, _) = exported("markdown", false);
    let md = String::from_utf8(bytes).unwrap();
    assert!(md.starts_with("# Remain in the vine\n"));
    assert!(md.contains("*John 15:1–5*"));
    assert!(md.contains("### Stay connected"));
    assert!(md.contains("> **John 15:1–5** (FXA)"));
    assert!(md.contains("<sup>1</sup> Fixture alpha fifteen one"));
    assert!(md.contains("Generated image"));
    assert!(!md.contains("Look at the back row."));
    assert!(!md.contains("SPEAKER EXPLANATION"));
    let (bytes, _) = exported("markdown", true);
    let md = String::from_utf8(bytes).unwrap();
    assert!(md.contains("Look at the back row."));
    assert!(md.contains("SPEAKER EXPLANATION"));
    assert!(md.contains("## Sources"));
}

fn unzip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    (0..archive.len())
        .map(|i| {
            let mut file = archive.by_index(i).unwrap();
            let mut data = Vec::new();
            file.read_to_end(&mut data).unwrap();
            (file.name().to_string(), data)
        })
        .collect()
}

#[test]
fn powerpoint_has_one_well_formed_slide_per_audience_slide() {
    let (bytes, doc) = exported("pptx", false);
    let files = unzip(&bytes);
    let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names[0], "[Content_Types].xml");
    for part in [
        "_rels/.rels",
        "ppt/presentation.xml",
        "ppt/slideMasters/slideMaster1.xml",
        "ppt/slideLayouts/slideLayout1.xml",
        "ppt/theme/theme1.xml",
        "docProps/core.xml",
    ] {
        assert!(names.contains(&part), "missing {part}");
    }
    let slides = names
        .iter()
        .filter(|n| n.starts_with("ppt/slides/slide"))
        .count();
    assert_eq!(slides, doc.slides.len());
    assert!(names.contains(&"ppt/media/image1.png"));
    assert!(
        !names.iter().any(|n| n.contains("notesSlide")),
        "no notes unless asked"
    );
    // Every XML part is well formed.
    for (name, data) in &files {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            let mut reader = quick_xml::Reader::from_reader(data.as_slice());
            let mut buf = Vec::new();
            loop {
                match reader.read_event_into(&mut buf) {
                    Ok(quick_xml::events::Event::Eof) => break,
                    Ok(_) => {}
                    Err(e) => panic!("{name} is not well formed: {e}"),
                }
                buf.clear();
            }
        }
    }
    let all: String = files
        .iter()
        .filter(|(n, _)| n.starts_with("ppt/slides/slide"))
        .map(|(_, d)| String::from_utf8_lossy(d).into_owned())
        .collect();
    assert!(all.contains("Remain in the vine"));
    assert!(all.contains("Fixture alpha fifteen one"));
    assert!(all.contains("나는 포도나무요"));
    assert!(!all.contains("Look at the back row."));
    assert!(!all.contains("SPEAKER EXPLANATION"));
    // The same presentation gives the same file.
    assert_eq!(bytes, exported("pptx", false).0);

    let (bytes, _) = exported("pptx", true);
    let files = unzip(&bytes);
    let notes: String = files
        .iter()
        .filter(|(n, _)| n.starts_with("ppt/notesSlides/notesSlide"))
        .map(|(_, d)| String::from_utf8_lossy(d).into_owned())
        .collect();
    assert!(notes.contains("Look at the back row."));
    assert!(notes.contains("SPEAKER EXPLANATION"));
    assert!(files
        .iter()
        .any(|(n, _)| n == "ppt/notesMasters/notesMaster1.xml"));
}

#[test]
fn the_pdfs_have_a_page_per_slide_and_readable_text() {
    let (bytes, doc) = exported("pdf", false);
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    assert_eq!(pdf.get_pages().len(), doc.slides.len());
    let text = pdf_extract::extract_text_from_mem(&bytes).unwrap_or_default();
    assert!(text.contains("Remain"), "text: {text}");
    assert!(!text.contains("Look at the back row."));
    // Hangul is drawn when this computer has a font for it.
    let fonts = FontSet::system();
    if fonts.regular.iter().any(|f| f.glyph('나').is_some()) {
        assert!(text.contains("포도나무"), "text: {text}");
    }

    let (bytes, doc) = exported("speaker_pdf", false);
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    assert!(pdf.get_pages().len() >= doc.slides.len());
    let text = pdf_extract::extract_text_from_mem(&bytes).unwrap_or_default();
    // The speaker sheet has the speaker's text.
    assert!(text.contains("Look at the back row."), "text: {text}");
    assert!(text.contains("SPEAKER EXPLANATION"));
}

#[test]
fn exports_work_without_any_system_font() {
    let (_, doc) = exported("markdown", false);
    let bytes = render(&doc, "pdf", &options(false), FontSet::empty).unwrap();
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    assert_eq!(pdf.get_pages().len(), doc.slides.len());
    let bytes = render(&doc, "pptx", &options(true), FontSet::empty).unwrap();
    assert!(!unzip(&bytes).is_empty());
}

/// Writes example exports for looking at them (not run by default):
/// `ABIDING_EXPORT_DIR=/some/dir cargo test --test presentations write_examples -- --ignored`
#[test]
#[ignore]
fn write_examples() {
    let dir = PathBuf::from(std::env::var("ABIDING_EXPORT_DIR").unwrap());
    std::fs::create_dir_all(&dir).unwrap();
    for (format, name, notes) in [
        ("pptx", "example.pptx", true),
        ("pdf", "example.pdf", false),
        ("speaker_pdf", "example-speaker.pdf", true),
        ("markdown", "example.md", true),
        ("package", "example.json", false),
    ] {
        std::fs::write(dir.join(name), exported(format, notes).0).unwrap();
    }
}

#[test]
fn a_target_time_is_kept_with_the_presentation_and_can_be_removed() {
    let temp = tempfile::tempdir().unwrap();
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        assert_eq!(p.target_minutes, None);
        let set = |minutes| UpdatePresentation {
            id: p.id.clone(),
            target_minutes: Some(minutes),
            ..Default::default()
        };
        let p2 = presentations::update(conn, &set(30))?;
        assert_eq!(p2.target_minutes, Some(30));
        // Another change leaves it as it was.
        let renamed = presentations::update(
            conn,
            &UpdatePresentation {
                id: p.id.clone(),
                title: Some("Sunday".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(renamed.target_minutes, Some(30));
        let doc = document::build(conn, &p.id, &store(temp.path()))?;
        assert_eq!(doc.target_minutes, Some(30));
        assert_eq!(
            code(presentations::update(conn, &set(601))),
            "presentation.targetTooLong"
        );
        assert_eq!(presentations::update(conn, &set(0))?.target_minutes, None);
        Ok(())
    });
}

#[test]
fn live_marks_on_the_audience_screen_stay_small_and_on_the_slide() {
    use abiding_word_lib::presentation::LiveMarks;
    let marks = LiveMarks {
        pointer: Some([1.5, -0.2]),
        strokes: vec![vec![[0.5, 0.5], [f32::NAN, 0.1], [2.0, 0.3]]; LiveMarks::STROKES_MAX + 5],
    }
    .bounded();
    assert_eq!(marks.pointer, Some([1.0, 0.0]));
    assert_eq!(marks.strokes.len(), LiveMarks::STROKES_MAX);
    assert_eq!(marks.strokes[0], vec![[0.5, 0.5], [1.0, 0.3]]);
    let long = LiveMarks {
        pointer: Some([f32::INFINITY, 0.5]),
        strokes: vec![vec![[0.1, 0.1]; LiveMarks::POINTS_MAX + 1]],
    }
    .bounded();
    assert_eq!(long.pointer, None);
    assert_eq!(long.strokes[0].len(), LiveMarks::POINTS_MAX);
}

#[test]
fn a_late_audience_change_never_replaces_a_newer_one() {
    use abiding_word_lib::presentation::AudienceState;
    let at = |id: &str, seq: u64, index: usize| AudienceState {
        presentation_id: id.into(),
        index,
        seq,
        ..Default::default()
    };
    let kept = at("p-1", 7, 4);
    assert!(!at("p-1", 6, 3).replaces(Some(&kept)));
    assert!(at("p-1", 7, 4).replaces(Some(&kept)));
    assert!(at("p-1", 8, 5).replaces(Some(&kept)));
    // Another presentation, or nothing shown yet: always.
    assert!(at("p-2", 1, 0).replaces(Some(&kept)));
    assert!(at("p-1", 0, 0).replaces(None));
}

// ---------------------------------------------------------------------------
// Church templates (v0.18.1)
// ---------------------------------------------------------------------------

use abiding_word_lib::db::presentation_templates;
use abiding_word_lib::domain::{CreatePresentationTemplate, UpdatePresentationTemplate};
use abiding_word_lib::presentation::layout::{self as slide_layout, Block};
use abiding_word_lib::presentation::template::{
    self, Crop, FilledRect, Footer, ImageFill, Placed, RoleLayout, TemplateDefinition, TextFrame,
};

fn frame(x: f32, y: f32, w: f32, h: f32, size: f32) -> TextFrame {
    TextFrame {
        x,
        y,
        w,
        h,
        size,
        min_size: 18.0,
        ..Default::default()
    }
}

/// A 4:3 church design: a cropped background, a logo, a band, a footer, its
/// own heading and Scripture layouts (bottom-aligned heading, no shrinking).
fn church_design(store: &ImageStore) -> TemplateDefinition {
    let asset = store
        .templates()
        .add(&png_bytes(), "background.png")
        .unwrap();
    let mut def = template::builtin("light");
    def.width = template::STANDARD.0;
    def.height = template::STANDARD.1;
    def.colors.background = "#102030".into();
    def.colors.text = "#FAFAFA".into();
    def.background.image = Some(ImageFill {
        asset_id: asset.id.clone(),
        crop: Crop {
            left: 0.1,
            top: 0.0,
            right: 0.1,
            bottom: 0.05,
        },
    });
    def.logo = Some(Placed {
        asset_id: asset.id.clone(),
        x: 620.0,
        y: 20.0,
        w: 80.0,
        h: 40.0,
        opacity: Some(0.5),
        ..Default::default()
    });
    def.footer = Some(Footer {
        text: "Grace Church · Sunday".into(),
        frame: TextFrame {
            fit: "none".into(),
            ..frame(40.0, 500.0, 640.0, 30.0, 14.0)
        },
    });
    let heading = RoleLayout {
        source: Some("Main Content".into()),
        rects: vec![FilledRect {
            x: 0.0,
            y: 0.0,
            w: 720.0,
            h: 12.0,
            fill: Some("#C8A040".into()),
            fill_opacity: Some(0.8),
            ..Default::default()
        }],
        title: Some(TextFrame {
            valign: "bottom".into(),
            fit: "none".into(),
            bold: true,
            font: "heading".into(),
            align: "center".into(),
            ..frame(60.0, 40.0, 600.0, 140.0, 40.0)
        }),
        body: Some(TextFrame {
            fit: "none".into(),
            ..frame(60.0, 200.0, 600.0, 120.0, 28.0)
        }),
        ..Default::default()
    };
    def.roles.insert("heading".into(), heading);
    def.roles.insert(
        "scripture".into(),
        RoleLayout {
            title: Some(frame(60.0, 40.0, 600.0, 60.0, 30.0)),
            reference: Some(frame(60.0, 100.0, 600.0, 40.0, 24.0)),
            body: Some(TextFrame {
                fit: "shrink".into(),
                ..frame(60.0, 150.0, 600.0, 330.0, 36.0)
            }),
            hide_logo: true,
            ..Default::default()
        },
    );
    def.assets.push(asset);
    def
}

fn with_template(
    conn: &Connection,
    store: &ImageStore,
) -> AppResult<(Sermon, abiding_word_lib::domain::Presentation, String)> {
    let s = sermon(conn)?;
    install_bible(conn)?;
    let p = propose(conn, &s.teaching)?;
    let t = presentation_templates::create(
        conn,
        &CreatePresentationTemplate {
            name: "Grace Church".into(),
            description: "Our Sunday design".into(),
            definition: church_design(store),
            source_format: "designer".into(),
            ..Default::default()
        },
    )?;
    let p = presentations::update(
        conn,
        &UpdatePresentation {
            id: p.id.clone(),
            template_id: Some(t.id.clone()),
            ..Default::default()
        },
    )?;
    Ok((s, p, t.id))
}

#[test]
fn a_template_is_chosen_changed_and_dropped_without_touching_slides_or_teaching() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let s = sermon(conn)?;
        let p = propose(conn, &s.teaching)?;
        let teaching_before = teaching::get(conn, &s.teaching)?;
        let t = presentation_templates::create(
            conn,
            &CreatePresentationTemplate {
                name: "  Grace Church  ".into(),
                definition: church_design(&store),
                ..Default::default()
            },
        )?;
        assert_eq!(t.name, "Grace Church");
        assert_eq!(t.source_format, "designer");
        assert_eq!(presentation_templates::list(conn)?.len(), 1);
        assert_eq!(presentation_templates::list(conn)?[0].width, 720.0);

        let chosen = presentations::update(
            conn,
            &UpdatePresentation {
                id: p.id.clone(),
                template_id: Some(t.id.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(chosen.template_id.as_deref(), Some(t.id.as_str()));
        assert_eq!(
            chosen.items, p.items,
            "the slides stay exactly as they were"
        );
        let doc = document::build(conn, &p.id, &store)?;
        let used = doc.template.as_ref().unwrap();
        assert_eq!(used.name, "Grace Church");
        assert!(doc
            .images
            .iter()
            .any(|i| i.id == used.definition.assets[0].id && i.available));
        assert_eq!(doc.audience().template.as_ref().unwrap().id, t.id);

        // Back to the built-in background, and to the template again.
        let back = presentations::update(
            conn,
            &UpdatePresentation {
                id: p.id.clone(),
                template_id: Some(String::new()),
                ..Default::default()
            },
        )?;
        assert_eq!(back.template_id, None);
        assert_eq!(back.theme, p.theme);
        assert!(document::build(conn, &p.id, &store)?.template.is_none());

        presentations::update(
            conn,
            &UpdatePresentation {
                id: p.id.clone(),
                template_id: Some(t.id.clone()),
                ..Default::default()
            },
        )?;
        let renamed = presentation_templates::update(
            conn,
            &UpdatePresentationTemplate {
                id: t.id.clone(),
                name: Some("Grace Church 2".into()),
                ..Default::default()
            },
        )?;
        assert_eq!(renamed.revision, 2);
        // Deleting the template returns the presentation to its background.
        presentation_templates::delete(conn, &t.id)?;
        assert_eq!(presentations::get(conn, &p.id)?.template_id, None);
        assert!(presentation_templates::list(conn)?.is_empty());
        assert_eq!(
            code(presentations::update(
                conn,
                &UpdatePresentation {
                    id: p.id.clone(),
                    template_id: Some(t.id.clone()),
                    ..Default::default()
                },
            )),
            "notFound:presentation template"
        );
        let teaching_after = teaching::get(conn, &s.teaching)?;
        assert_eq!(teaching_after.revision, teaching_before.revision);
        assert_eq!(presentations::get(conn, &p.id)?.items, p.items);
        Ok(())
    });
}

#[test]
fn a_broken_template_is_refused() {
    with_db(|conn| {
        let mut def = template::builtin("light");
        def.roles.insert("banner".into(), RoleLayout::default());
        assert_eq!(
            code(presentation_templates::create(
                conn,
                &CreatePresentationTemplate {
                    name: "X".into(),
                    definition: def,
                    ..Default::default()
                },
            )),
            "presentation.templateInvalid"
        );
        assert_eq!(
            code(presentation_templates::create(
                conn,
                &CreatePresentationTemplate {
                    name: " ".into(),
                    definition: template::builtin("dark"),
                    ..Default::default()
                },
            )),
            "validation.titleRequired"
        );
        Ok(())
    });
}

#[test]
fn a_template_places_text_in_its_boxes_and_says_what_does_not_fit() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let (_, p, _) = with_template(conn, &store)?;
        let doc = document::build(conn, &p.id, &store)?;
        let design = doc.design();
        let fonts = FontSet::empty();
        let shaper = abiding_word_lib::presentation::text::Shaper { fonts: &fonts };
        let locale = ExportOptions::default().locale;

        let heading = doc.slides.iter().find(|s| s.kind == "heading").unwrap();
        let page = slide_layout::page(heading, &doc, &design, &shaper, &locale);
        assert_eq!((page.width, page.height), (720.0, 540.0));
        assert_eq!(page.background, "#102030");
        // Background first (cropped), then the band, the texts, the logo and the footer.
        match &page.blocks[0] {
            Block::Picture(b) => {
                assert_eq!((b.x, b.y, b.w, b.h), (0.0, 0.0, 720.0, 540.0));
                assert_eq!(b.crop.left, 0.1);
                assert_eq!(b.crop.bottom, 0.05);
            }
            other => panic!("background first, got {other:?}"),
        }
        assert!(matches!(&page.blocks[1], Block::Rect(r) if r.fill_opacity == 0.8));
        let texts: Vec<&slide_layout::TextBox> = page
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Text(t) => Some(t),
                _ => None,
            })
            .collect();
        let title = texts[0];
        assert_eq!(title.lines, vec![heading.audience.heading.clone().unwrap()]);
        let f = title.frame.as_ref().unwrap();
        assert_eq!((f.x, f.y, f.w, f.h), (60.0, 40.0, 600.0, 140.0));
        assert_eq!(title.size, 40.0);
        // Bottom-aligned: the line sits at the bottom of the box (inside its margins).
        let bottom = 40.0 + 140.0 - 3.6;
        assert!(
            (title.y + title.size * title.line - bottom).abs() < 0.01,
            "{}",
            title.y
        );
        assert_eq!(title.align, slide_layout::Align::Center);
        assert_eq!(title.color, "#FAFAFA");
        assert!(page
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Picture(p) if p.opacity == 0.5)));
        assert_eq!(
            texts.last().unwrap().lines,
            vec!["Grace Church · Sunday".to_string()]
        );

        // Scripture: its own layout, text shrinks only because the template says so; no logo there.
        let scripture = doc.slides.iter().find(|s| s.kind == "scripture").unwrap();
        let page = slide_layout::page(scripture, &doc, &design, &shaper, &locale);
        assert_eq!(
            page.blocks
                .iter()
                .filter(|b| matches!(b, Block::Picture(_)))
                .count(),
            1,
            "only the background, the logo is hidden here"
        );
        assert_eq!(page.overflowing(), 0);

        // A long text in a box that may not shrink is reported, never shrunk quietly.
        let mut long = heading.clone();
        long.audience.body = Some("Ich bin der Weinstock, ihr seid die Reben. ".repeat(30));
        let page = slide_layout::page(&long, &doc, &design, &shaper, &locale);
        let body = page
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Text(t) if t.frame.as_ref().is_some_and(|f| f.y == 200.0) => Some(t),
                _ => None,
            })
            .next()
            .unwrap();
        assert_eq!(body.size, 28.0);
        assert!(body.overflow);
        assert_eq!(page.overflowing(), 1);

        // A kind of slide the template does not lay out uses the built-in arrangement in its colours.
        let title_slide = doc.slides.iter().find(|s| s.kind == "title").unwrap();
        let page = slide_layout::page(title_slide, &doc, &design, &shaper, &locale);
        let first_text = page.blocks.iter().find_map(|b| match b {
            Block::Text(t) => Some(t),
            _ => None,
        });
        assert!(first_text.unwrap().frame.is_none());
        assert_eq!(first_text.unwrap().color, "#FAFAFA");
        // On the 4:3 page the built-in arrangement is centred on 720 points.
        let t = first_text.unwrap();
        assert!((t.x + t.w / 2.0 - 360.0).abs() < 0.01);

        // Without a passage box, the passage line takes the free title box (this slide has
        // no heading of its own); with no box free for it, the built-in arrangement is used.
        let mut lonely = design.clone();
        lonely.roles.get_mut("scripture").unwrap().reference = None;
        assert!(scripture.audience.heading.is_none());
        let page = slide_layout::page(scripture, &doc, &lonely, &shaper, &locale);
        assert!(page
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Text(t) if t.frame.as_ref().is_some_and(|f| f.y == 40.0))));
        lonely.roles.get_mut("scripture").unwrap().title = None;
        let page = slide_layout::page(scripture, &doc, &lonely, &shaper, &locale);
        assert!(page.blocks.iter().all(
            |b| !matches!(b, Block::Text(t) if t.frame.as_ref().is_some_and(|f| f.y == 150.0))
        ));
        Ok(())
    });
}

fn template_export(format: &str) -> (Vec<u8>, presentation::PresentationDocument, usize) {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let (_, p, _) = with_template(conn, &store)?;
        let doc = package::build(conn, &p.id, &store)?;
        let (bytes, overflow) = abiding_word_lib::commands::presentations::render_counted(
            &doc,
            format,
            &options(false),
            FontSet::empty,
        )
        .unwrap();
        Ok((bytes, doc, overflow))
    })
}

#[test]
fn powerpoint_with_a_template_keeps_its_size_crop_transparency_fonts_and_boxes() {
    let (bytes, doc, overflow) = template_export("pptx");
    assert_eq!(overflow, 0);
    let files = unzip(&bytes);
    let text = |name: &str| -> String {
        String::from_utf8(files.iter().find(|(n, _)| n == name).unwrap().1.clone()).unwrap()
    };
    assert!(text("ppt/presentation.xml").contains(r#"<p:sldSz cx="9144000" cy="6858000"/>"#));
    let heading_index = doc.slides.iter().position(|s| s.kind == "heading").unwrap() + 1;
    let slide = text(&format!("ppt/slides/slide{heading_index}.xml"));
    assert!(
        slide.contains(r#"<a:srgbClr val="102030"/>"#),
        "background colour"
    );
    assert!(
        slide.contains(r#"<a:srcRect l="10000" t="0" r="10000" b="5000"/>"#),
        "crop as in the source"
    );
    assert!(
        slide.contains(r#"<a:alphaModFix amt="50000"/>"#),
        "the logo's transparency"
    );
    assert!(
        slide.contains(r#"<a:alpha val="80000"/>"#),
        "the band's transparency"
    );
    assert!(
        slide.contains(r#"anchor="b""#),
        "bottom-aligned heading box"
    );
    assert!(slide.contains(r#"lIns="91440""#), "the box's inner margin");
    assert!(slide.contains(r#"<a:noAutofit/>"#));
    assert!(slide.contains("Grace Church · Sunday"));
    // The picture file is packed once although background and logo use it.
    assert_eq!(
        files
            .iter()
            .filter(|(n, _)| n.starts_with("ppt/media/"))
            .count(),
        2
    );
    for (name, data) in &files {
        if name.ends_with(".xml") || name.ends_with(".rels") {
            let mut reader = quick_xml::Reader::from_reader(data.as_slice());
            let mut buf = Vec::new();
            loop {
                match reader.read_event_into(&mut buf) {
                    Ok(quick_xml::events::Event::Eof) => break,
                    Ok(_) => {}
                    Err(e) => panic!("{name} is not well formed: {e}"),
                }
                buf.clear();
            }
        }
    }
}

#[test]
fn the_pdf_with_a_template_has_its_page_size_pictures_and_transparency() {
    let (bytes, doc, _) = template_export("pdf");
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    let pages = pdf.get_pages();
    assert_eq!(pages.len(), doc.slides.len());
    let first = pdf
        .get_object(*pages.values().next().unwrap())
        .unwrap()
        .as_dict()
        .unwrap();
    let media = first.get(b"MediaBox").unwrap().as_array().unwrap();
    assert_eq!(media[2].as_float().unwrap(), 720.0);
    assert_eq!(media[3].as_float().unwrap(), 540.0);
    let raw = String::from_utf8_lossy(&bytes);
    assert!(raw.contains("/ExtGState"));
    let text = pdf
        .extract_text(&pages.keys().copied().collect::<Vec<_>>())
        .unwrap_or_default();
    assert!(text.contains("Grace Church"), "{text}");
}

// ---------------------------------------------------------------------------
// A design imported from PowerPoint, applied (v0.18.1)
// ---------------------------------------------------------------------------

/// The PowerPoint corpus design with every suggested role, as kept after review.
fn imported_design(store: &ImageStore) -> TemplateDefinition {
    let bytes = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/templates/powerpoint-16x9.pptx"),
    )
    .unwrap();
    let imported = abiding_word_lib::presentation::pptx_import::import(
        &bytes,
        "powerpoint-16x9.pptx",
        &store.templates(),
        &[],
        &|_, _| {},
    )
    .unwrap();
    imported.accept(&imported.suggestions)
}

fn with_imported(
    conn: &Connection,
    store: &ImageStore,
) -> AppResult<abiding_word_lib::domain::Presentation> {
    let s = sermon(conn)?;
    install_bible(conn)?;
    let p = propose(conn, &s.teaching)?;
    let t = presentation_templates::create(
        conn,
        &CreatePresentationTemplate {
            name: "Grace Church Sunday".into(),
            definition: imported_design(store),
            source_format: "pptx".into(),
            source_name: Some("powerpoint-16x9.pptx".into()),
            ..Default::default()
        },
    )?;
    presentations::update(
        conn,
        &UpdatePresentation {
            id: p.id.clone(),
            template_id: Some(t.id.clone()),
            ..Default::default()
        },
    )
}

fn framed_texts(page: &slide_layout::Page) -> Vec<&slide_layout::TextBox> {
    page.blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text(t) if t.frame.is_some() => Some(t),
            _ => None,
        })
        .collect()
}

#[test]
fn an_imported_design_lays_out_long_german_and_korean_scripture_the_same_way_every_time() {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let p = with_imported(conn, &store)?;
        let doc = document::build(conn, &p.id, &store)?;
        let design = doc.design();
        let fonts = FontSet::empty();
        let shaper = abiding_word_lib::presentation::text::Shaper { fonts: &fonts };
        let locale = ExportOptions::default().locale;
        let scripture = doc.slides.iter().find(|s| s.kind == "scripture").unwrap();

        let page = slide_layout::page(scripture, &doc, &design, &shaper, &locale);
        assert_eq!((page.width, page.height), (960.0, 540.0));
        // The cropped photo, the band, the boxes of the "Bible Verse" layout; the logo
        // and the footer come from the master.
        match &page.blocks[0] {
            Block::Picture(b) => {
                assert_eq!((b.w, b.h), (960.0, 540.0));
                assert_eq!(b.crop.left, 0.05);
            }
            other => panic!("background first, got {other:?}"),
        }
        assert!(page
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Rect(r) if (r.fill_opacity - 0.45).abs() < 0.001)));
        let texts = framed_texts(&page);
        let verse = texts
            .iter()
            .find(|t| t.frame.as_ref().unwrap().y == 120.0)
            .expect("the verse box");
        assert_eq!(verse.color, "#FFFFFF");
        assert!(verse.bold);
        assert_eq!(verse.align, slide_layout::Align::Center);
        let reference = texts
            .iter()
            .find(|t| t.frame.as_ref().unwrap().y == 450.0)
            .expect("the passage box");
        assert_eq!(reference.align, slide_layout::Align::Right);
        assert!(reference.italic);

        // Long German: the verse box may shrink (PowerPoint's setting), so it fits smaller.
        let mut german = scripture.clone();
        german.audience.verses = vec![document::SlideVerse {
            chapter: 15,
            verse: 5,
            text: "Ich bin der Weinstock, ihr seid die Reben. Wer in mir bleibt und ich in ihm, \
                   der bringt viel Frucht; denn ohne mich könnt ihr nichts tun. "
                .repeat(4),
        }];
        let page = slide_layout::page(&german, &doc, &design, &shaper, &locale);
        let verse = framed_texts(&page)
            .into_iter()
            .find(|t| t.frame.as_ref().unwrap().y == 120.0)
            .unwrap()
            .clone();
        assert!(verse.size < 36.0 && verse.size >= 14.4, "{}", verse.size);
        assert!(!verse.overflow);
        let again = slide_layout::page(&german, &doc, &design, &shaper, &locale);
        assert_eq!(
            format!("{page:?}"),
            format!("{again:?}"),
            "the same every time"
        );

        // Korean in a box that may not shrink (the quote layout): reported, never shrunk.
        let quote = doc.slides.iter().find(|s| s.kind == "quote");
        let mut korean = quote.cloned().unwrap_or_else(|| {
            let mut s = scripture.clone();
            s.kind = "quote".into();
            s
        });
        korean.audience.verses.clear();
        korean.audience.body = Some(
            "포도나무는 나요 너희는 가지라 저가 내 안에, 내가 저 안에 있으면 이 사람은 과실을 많이 맺나니 "
                .repeat(8),
        );
        let page = slide_layout::page(&korean, &doc, &design, &shaper, &locale);
        let body = framed_texts(&page)
            .into_iter()
            .find(|t| t.frame.as_ref().unwrap().y == 100.0)
            .expect("the quote box");
        assert_eq!(body.size, 36.0);
        assert!(body.italic);
        assert!(body.overflow);
        assert!(body.lines.len() > 5);
        assert_eq!(page.overflowing(), 1);
        Ok(())
    });
}

fn imported_export(format: &str) -> (Vec<u8>, presentation::PresentationDocument) {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let p = with_imported(conn, &store)?;
        let doc = package::build(conn, &p.id, &store)?;
        let (bytes, _) = abiding_word_lib::commands::presentations::render_counted(
            &doc,
            format,
            &options(false),
            FontSet::empty,
        )
        .unwrap();
        Ok((bytes, doc))
    })
}

#[test]
fn an_imported_design_goes_back_to_powerpoint_with_its_size_fonts_and_spacing() {
    let (bytes, doc) = imported_export("pptx");
    let (again, _) = imported_export("pptx");
    assert_eq!(bytes, again, "the same file every time");
    let files = unzip(&bytes);
    let text = |name: &str| -> String {
        String::from_utf8(files.iter().find(|(n, _)| n == name).unwrap().1.clone()).unwrap()
    };
    assert!(text("ppt/presentation.xml").contains(r#"<p:sldSz cx="12192000" cy="6858000"/>"#));
    let theme = text("ppt/theme/theme1.xml");
    assert!(theme.contains(r#"<a:latin typeface="Calibri Light"/>"#));
    assert!(theme.contains(r#"<a:latin typeface="Calibri"/>"#));
    let n = doc
        .slides
        .iter()
        .position(|s| s.kind == "scripture")
        .unwrap()
        + 1;
    let slide = text(&format!("ppt/slides/slide{n}.xml"));
    assert!(slide.contains(r#"typeface="Montserrat SemiBold""#));
    assert!(slide.contains(r#"<a:srcRect l="5000" t="10000" r="5000" b="10000"/>"#));
    assert!(slide.contains(r#"<a:normAutofit/>"#));
    // 110 % spacing goes back as 110 %.
    assert!(slide.contains(r#"<a:spcPct val="110000"/>"#), "{slide}");
    assert!(slide.contains(r#"algn="r""#));
    // The footer is on the layouts that carry it in the source ("Title and Content"),
    // not on the Scripture layout, which has none.
    assert!(!slide.contains("Grace Church · Sunday"));
    let n = doc.slides.iter().position(|s| s.kind == "heading").unwrap() + 1;
    assert!(text(&format!("ppt/slides/slide{n}.xml")).contains("Grace Church · Sunday"));
}

#[test]
fn an_imported_design_in_the_pdf_has_its_page_size_and_footer() {
    let (bytes, doc) = imported_export("pdf");
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    let pages = pdf.get_pages();
    assert_eq!(pages.len(), doc.slides.len());
    let first = pdf
        .get_object(*pages.values().next().unwrap())
        .unwrap()
        .as_dict()
        .unwrap();
    let media = first.get(b"MediaBox").unwrap().as_array().unwrap();
    assert_eq!(media[2].as_float().unwrap(), 960.0);
    assert_eq!(media[3].as_float().unwrap(), 540.0);
    let text = pdf
        .extract_text(&pages.keys().copied().collect::<Vec<_>>())
        .unwrap_or_default();
    assert!(text.contains("Grace Church"), "{text}");
}

#[test]
fn a_passage_shown_for_a_moment_uses_the_scripture_layout_and_the_pages_reach_the_interface_as_json(
) {
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let p = with_imported(conn, &store)?;
        let doc = document::build(conn, &p.id, &store)?;
        let design = doc.design();
        let fonts = FontSet::empty();
        let shaper = abiding_word_lib::presentation::text::Shaper { fonts: &fonts };
        let locale = ExportOptions::default().locale;
        let overlay = document::Slide {
            kind: "scripture".into(),
            audience: document::AudienceSlide {
                reference_label: Some("John 15:5".into()),
                bible: Some("BSB".into()),
                verses: vec![document::SlideVerse {
                    chapter: 15,
                    verse: 5,
                    text: "I am the vine; you are the branches.".into(),
                }],
                ..Default::default()
            },
            ..Default::default()
        };
        let page = slide_layout::page(&overlay, &doc, &design, &shaper, &locale);
        let passage = framed_texts(&page)
            .into_iter()
            .find(|t| t.frame.as_ref().unwrap().y == 450.0)
            .expect("the passage box of the Bible Verse layout");
        assert_eq!(passage.paragraphs, vec!["John 15:5 (BSB)".to_string()]);

        let json = serde_json::to_value(&page).unwrap();
        assert_eq!(json["width"], 960.0);
        let kinds: Vec<&str> = json["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b["type"].as_str().unwrap())
            .collect();
        assert_eq!(kinds[0], "picture");
        assert!(kinds.contains(&"rect") && kinds.contains(&"text"));
        let text = json["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["type"] == "text")
            .unwrap();
        for key in [
            "lines",
            "paragraphs",
            "frame",
            "overflow",
            "family",
            "align",
            "line",
        ] {
            assert!(text.get(key).is_some(), "{key}");
        }
        Ok(())
    });
}

/// v0.18.3 review: a replacement font the person chose for a missing template
/// font ("use Carlito instead of Calibri") is the font of every output — the
/// live view and PDF (one layout) and PowerPoint (theme and every run) —
/// never the missing original. No font file is copied into any output.
#[test]
fn a_chosen_replacement_font_is_used_alike_by_the_live_view_pdf_and_powerpoint() {
    use abiding_word_lib::presentation::template::FontChoice;
    let temp = tempfile::tempdir().unwrap();
    let store = store(temp.path());
    with_db(|conn| {
        let (_, p, template_id) = with_template(conn, &store)?;
        let mut definition = presentation_templates::get(conn, &template_id)?.definition;
        definition.fonts.heading = FontChoice {
            family: "Calibri".into(),
            replacement: Some("Carlito".into()),
        };
        definition.fonts.body = FontChoice {
            family: "Segoe UI".into(),
            replacement: Some("DejaVu Sans".into()),
        };
        presentation_templates::update(
            conn,
            &UpdatePresentationTemplate {
                id: template_id.clone(),
                definition: Some(definition),
                ..Default::default()
            },
        )?;
        // One layout for the live view and the PDF.
        let doc = document::build(conn, &p.id, &store)?;
        let design = doc.design();
        let fonts = FontSet::empty();
        let shaper = abiding_word_lib::presentation::text::Shaper { fonts: &fonts };
        let locale = ExportOptions::default().locale;
        let mut families = std::collections::BTreeSet::new();
        for slide in &doc.slides {
            for block in slide_layout::page(slide, &doc, &design, &shaper, &locale).blocks {
                if let Block::Text(t) = block {
                    families.insert(t.family.clone().unwrap_or_default());
                }
            }
        }
        assert!(
            families.contains("Carlito") && families.contains("DejaVu Sans"),
            "{families:?}"
        );
        assert!(
            !families.contains("Calibri") && !families.contains("Segoe UI"),
            "{families:?}"
        );
        // PowerPoint: the theme's fonts and every run name the replacements.
        let doc = package::build(conn, &p.id, &store)?;
        let (bytes, _) = abiding_word_lib::commands::presentations::render_counted(
            &doc,
            "pptx",
            &options(false),
            FontSet::empty,
        )
        .unwrap();
        let files = unzip(&bytes);
        let theme = files
            .iter()
            .find(|(n, _)| n == "ppt/theme/theme1.xml")
            .map(|(_, d)| String::from_utf8_lossy(d).to_string())
            .unwrap();
        assert!(
            theme.contains(r#"<a:majorFont><a:latin typeface="Carlito"/>"#),
            "heading font in the theme"
        );
        assert!(
            theme.contains(r#"<a:minorFont><a:latin typeface="DejaVu Sans"/>"#),
            "body font in the theme"
        );
        let mut runs_with_replacement = 0;
        for (name, data) in &files {
            if name.ends_with(".xml") {
                let xml = String::from_utf8_lossy(data);
                assert!(
                    !xml.contains("Calibri") && !xml.contains("Segoe UI"),
                    "{name} names a missing font"
                );
                runs_with_replacement += xml.matches(r#"<a:latin typeface="Carlito"/>"#).count();
            }
            assert!(
                !name.starts_with("ppt/fonts/"),
                "no font file is embedded: {name}"
            );
        }
        assert!(
            runs_with_replacement > 1,
            "the text runs are set in the replacement too"
        );
        Ok(())
    });
}
