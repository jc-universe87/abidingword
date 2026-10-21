//! Teaching materials as Word documents (v0.18.8). The documents are those
//! the interface's material model makes (tests/fixtures/materials, kept in
//! step by tests/ui/material-docx-fixtures.test.ts), so what is checked here
//! is the real content: everything the model holds, in its order, and
//! nothing else; nothing for the leader on a sheet for the group; question
//! numbers as the model gives them; Korean and German intact; long
//! documents whole; and saving that never replaces a file it was not asked
//! to, nor leaves a part-written one behind.

use std::io::Read;
use std::path::Path;

use abiding_word_lib::commands::materials::{material_save_docx, SaveMaterialDocx};
use abiding_word_lib::materials::docx::{self, Block, MaterialDocument};
use quick_xml::events::Event;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    name: String,
    participant: bool,
    document: MaterialDocument,
}

fn fixtures() -> Vec<Fixture> {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/materials/documents.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn fixture(name: &str) -> MaterialDocument {
    fixtures()
        .into_iter()
        .find(|f| f.name == name)
        .unwrap()
        .document
}

/// The parts of a .docx package by name.
fn unzip(bytes: &[u8]) -> Vec<(String, String)> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("a ZIP package");
    (0..archive.len())
        .map(|i| {
            let mut file = archive.by_index(i).unwrap();
            let mut text = String::new();
            file.read_to_string(&mut text).unwrap();
            (file.name().to_string(), text)
        })
        .collect()
}

/// A paragraph of the document: its style and its text (tabs and line breaks kept).
#[derive(Debug, Clone, PartialEq)]
struct Para {
    style: String,
    text: String,
}

/// Reads document.xml as Word would: well-formed or the test fails.
fn paragraphs(xml: &str) -> Vec<Para> {
    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut out = Vec::new();
    let mut current: Option<Para> = None;
    let mut in_text = false;
    loop {
        let event = reader.read_event().expect("well-formed XML");
        let name = |e: &quick_xml::events::BytesStart| e.name().as_ref().to_string();
        match event {
            Event::Start(e) if name(&e) == "w:p" => {
                current = Some(Para {
                    style: String::new(),
                    text: String::new(),
                })
            }
            Event::Empty(e) if name(&e) == "w:p" => out.push(Para {
                style: String::new(),
                text: String::new(),
            }),
            Event::Empty(e) if name(&e) == "w:pStyle" => {
                if let Some(p) = current.as_mut() {
                    p.style = e
                        .try_get_attribute("w:val")
                        .unwrap()
                        .unwrap()
                        .value
                        .to_string();
                }
            }
            Event::Empty(e) if name(&e) == "w:tab" => {
                if let Some(p) = current.as_mut() {
                    p.text.push('\t');
                }
            }
            Event::Empty(e) if name(&e) == "w:br" => {
                if let Some(p) = current.as_mut() {
                    p.text.push('\n');
                }
            }
            Event::Start(e) if name(&e) == "w:t" => in_text = true,
            Event::End(e) if e.name().as_ref() == "w:t" => in_text = false,
            Event::Text(t) if in_text => {
                if let Some(p) = current.as_mut() {
                    p.text.push_str(&t);
                }
            }
            Event::GeneralRef(r) if in_text => {
                if let Some(p) = current.as_mut() {
                    p.text.push(match &*r {
                        "amp" => '&',
                        "lt" => '<',
                        "gt" => '>',
                        "quot" => '"',
                        "apos" => '\'',
                        other => panic!("unexpected entity {other:?}"),
                    });
                }
            }
            Event::End(e) if e.name().as_ref() == "w:p" => {
                if let Some(p) = current.take() {
                    out.push(p);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn document_of(doc: &MaterialDocument) -> (Vec<(String, String)>, Vec<Para>) {
    let parts = unzip(&docx::render(doc).unwrap());
    let xml = parts
        .iter()
        .find(|(n, _)| n == "word/document.xml")
        .expect("word/document.xml")
        .1
        .clone();
    (parts, paragraphs(&xml))
}

/// Every piece of text the model holds, in its order (what each block shows).
fn model_texts(doc: &MaterialDocument) -> Vec<String> {
    doc.blocks
        .iter()
        .flat_map(|b| match b {
            Block::Title { text }
            | Block::Passages { text }
            | Block::Notice { text }
            | Block::Text { text } => vec![text.clone()],
            Block::Message { label, text } | Block::Field { label, text } => {
                vec![label.clone(), text.clone()]
            }
            Block::Heading { text, detail } => std::iter::once(text.clone())
                .chain(detail.clone())
                .collect(),
            Block::Question { text, .. } => vec![text.clone()],
            Block::Scripture {
                label,
                verses,
                note,
                attribution,
            } => {
                let mut all = vec![label.clone()];
                all.extend(verses.iter().map(|v| v.text.clone()));
                all.extend(note.clone());
                all.extend(attribution.clone());
                all
            }
            Block::Space { label, .. } => label.iter().cloned().collect(),
        })
        .collect()
}

#[test]
fn every_document_is_a_word_package_with_its_parts_and_well_formed_xml() {
    for f in fixtures() {
        let (parts, paras) = document_of(&f.document);
        let names: Vec<&str> = parts.iter().map(|(n, _)| n.as_str()).collect();
        for needed in [
            "[Content_Types].xml",
            "_rels/.rels",
            "word/document.xml",
            "word/styles.xml",
            "word/_rels/document.xml.rels",
            "docProps/core.xml",
        ] {
            assert!(names.contains(&needed), "{}: no {needed}", f.name);
        }
        for (name, xml) in &parts {
            let mut reader = quick_xml::Reader::from_str(xml);
            loop {
                match reader.read_event() {
                    Ok(Event::Eof) => break,
                    Ok(_) => {}
                    Err(e) => panic!("{}: {name} is not well-formed: {e}", f.name),
                }
            }
        }
        assert_eq!(paras[0].style, "Title", "{}", f.name);
        // The same material gives the same file.
        assert_eq!(
            docx::render(&f.document).unwrap(),
            docx::render(&f.document).unwrap()
        );
        assert!(parts
            .iter()
            .find(|(n, _)| n == "docProps/core.xml")
            .unwrap()
            .1
            .contains("<dc:title>"));
    }
}

#[test]
fn a_document_holds_what_the_material_holds_in_its_order_and_nothing_more() {
    for f in fixtures() {
        let (_, paras) = document_of(&f.document);
        let all: String = paras
            .iter()
            .map(|p| p.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let mut from = 0;
        for text in model_texts(&f.document) {
            let at = all[from..]
                .find(&text)
                .unwrap_or_else(|| panic!("{}: {text:?} missing or out of order", f.name));
            from += at;
        }
        // No text of its own: every paragraph's words come from the model (numbers and verse numbers aside).
        let model = model_texts(&f.document).join("\n");
        for p in &paras {
            for word in p
                .text
                .split(|c: char| c.is_whitespace() || c == '\u{a0}')
                .filter(|w| w.chars().any(char::is_alphabetic))
            {
                assert!(
                    model.contains(word.trim_matches(|c: char| !c.is_alphanumeric())),
                    "{}: {word:?} is not in the material",
                    f.name
                );
            }
        }
    }
}

#[test]
fn nothing_for_the_leader_reaches_a_sheet_for_the_group() {
    let all = fixtures();
    assert!(all.iter().filter(|f| f.participant).count() >= 4);
    for f in all.iter().filter(|f| f.participant) {
        let (parts, _) = document_of(&f.document);
        for (name, xml) in &parts {
            assert!(
                !xml.contains("LEADER") && !xml.contains("PRIVATE"),
                "{}: {name} has text for the leader",
                f.name
            );
        }
    }
    let (_, leader) = document_of(&fixture("leader-version"));
    let text: String = leader.iter().map(|p| p.text.clone()).collect();
    assert!(text.contains("LEADER: it may lead to verse 9."));
    assert_eq!(
        leader[1].style, "AwNotice",
        "the leader's version says so at the top"
    );
    // The opening and closing are on the group's sheet only when chosen.
    let (_, plain) = document_of(&fixture("group-sheet"));
    assert!(!plain.iter().any(|p| p.text.contains("OPENING")));
    let (_, framed) = document_of(&fixture("group-sheet-with-frame"));
    assert!(framed.iter().any(|p| p.text.contains("OPENING")));
}

#[test]
fn questions_keep_the_numbers_the_material_gives_them() {
    for name in [
        "group-sheet",
        "leader-version",
        "korean-sheet",
        "lesson-worksheet",
    ] {
        let doc = fixture(name);
        let numbers: Vec<u32> = doc
            .blocks
            .iter()
            .filter_map(|b| match b {
                Block::Question { number, .. } => Some(*number),
                _ => None,
            })
            .collect();
        let (_, paras) = document_of(&doc);
        let written: Vec<u32> = paras
            .iter()
            .filter(|p| p.style == "AwQuestion")
            .map(|p| p.text.split('.').next().unwrap().parse().unwrap())
            .collect();
        assert_eq!(written, numbers, "{name}");
    }
    // The group's sheet and the leader's version number the same questions alike (an unworded one is not counted).
    let group = fixture("group-sheet");
    let leader = fixture("leader-version");
    let numbered = |d: &MaterialDocument| -> Vec<(u32, String)> {
        d.blocks
            .iter()
            .filter_map(|b| match b {
                Block::Question { number, text } => Some((*number, text.clone())),
                _ => None,
            })
            .collect()
    };
    assert_eq!(numbered(&group), numbered(&leader));
    assert_eq!(
        numbered(&group).iter().map(|q| q.0).collect::<Vec<_>>(),
        [1, 2]
    );
}

#[test]
fn scripture_is_set_apart_with_verse_numbers_and_says_what_is_lacking() {
    let (parts, paras) = document_of(&fixture("korean-sheet"));
    let xml = &parts
        .iter()
        .find(|(n, _)| n == "word/document.xml")
        .unwrap()
        .1;
    let scripture = paras
        .iter()
        .find(|p| p.style == "AwScripture")
        .expect("a Scripture paragraph");
    assert!(scripture
        .text
        .contains("나는 참포도나무요 내 아버지는 농부라"));
    assert!(scripture.text.starts_with("1\u{a0}나는"));
    assert!(xml.contains("<w:vertAlign w:val=\"superscript\"/>"));
    assert!(paras.iter().any(|p| p.text.contains("개역한글")));
    let (_, sermon) = document_of(&fixture("sermon-manuscript"));
    assert!(sermon
        .iter()
        .any(|p| p.style == "AwNote" && p.text.contains("15:2, 15:3")));
}

#[test]
fn long_documents_and_other_scripts_come_through_whole() {
    let doc = fixture("sermon-manuscript");
    let (_, paras) = document_of(&doc);
    // Twelve long points, each with its paragraph, and the conclusion at the end.
    assert_eq!(
        paras
            .iter()
            .filter(|p| p.style == "Heading1" && p.text.starts_with("Point "))
            .count(),
        12
    );
    assert!(paras
        .iter()
        .any(|p| p.text.starts_with("Paragraph 12.") && p.text.len() > 2000));
    assert!(paras
        .iter()
        .any(|p| p.text.contains("Stay close to him this week.")));
    // The person's own < and & and line breaks.
    assert!(paras
        .iter()
        .any(|p| p.text.contains("<of> the vine & branches")));
    assert!(paras
        .iter()
        .any(|p| p.text == "Have you ever pruned a rose?\nIt looks harsh."));
    let (_, korean) = document_of(&fixture("korean-sheet"));
    assert!(korean[0].text.contains("포도나무에 붙어 있으라"));
    assert!(korean.iter().any(|p| p
        .text
        .matches("가지는 포도나무에서 생명을 얻습니다.")
        .count()
        == 30));
    let (_, german) = document_of(&fixture("german-leader"));
    assert!(german.iter().any(|p| p
        .text
        .contains("„bleiben“ für Glaubensgeschwisterverhältnisse")));
}

#[test]
fn saving_writes_a_docx_where_asked_and_never_replaces_a_file_it_was_not_asked_about() {
    let dir = std::env::temp_dir().join(format!("aw-material-docx-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let doc = fixture("group-sheet");
    let save = |path: &Path| {
        material_save_docx(SaveMaterialDocx {
            path: path.to_string_lossy().into_owned(),
            document: doc.clone(),
        })
    };

    let saved = save(&dir.join("Group sheet")).unwrap();
    assert!(saved.ends_with("Group sheet.docx"));
    assert_eq!(std::fs::read(&saved).unwrap(), docx::render(&doc).unwrap());

    // "Sermon.txt" was asked about; "Sermon.txt.docx", someone else's, was not.
    let other = dir.join("Sermon.txt.docx");
    std::fs::write(&other, "kept").unwrap();
    assert!(save(&dir.join("Sermon.txt")).is_err());
    assert_eq!(std::fs::read_to_string(&other).unwrap(), "kept");
    // The very file the dialog named is replaced.
    save(&other).unwrap();
    assert_ne!(std::fs::read_to_string(&other).unwrap_or_default(), "kept");
    // A file that cannot be written leaves nothing behind.
    let blocked = dir.join("folder.docx");
    std::fs::create_dir_all(&blocked).unwrap();
    assert!(save(&blocked).is_err());
    assert!(save(Path::new("relative.docx")).is_err());
    let left: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("abidingword-part"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
    let _ = std::fs::remove_dir_all(dir);
}
