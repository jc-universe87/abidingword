//! Scripture ranges written with any ordinary dash (v0.19.1): "John 15:1–11"
//! is John 15:1 to 11, not John 15:1. The shared parser reads the hyphen,
//! hyphen-minus, non-breaking hyphen, figure dash, en dash and em dash, with
//! or without spaces, in every grammar; and nothing else changes: canonical
//! ranges, UTF-16 offsets, language priority, the canon's verse counts and
//! the protections against prose. All text is invented.

use abiding_word_lib::db::{library, Database};
use abiding_word_lib::library::import;
use abiding_word_lib::library::CommitSourceImport;
use abiding_word_lib::scripture::language::ReferenceLanguage::{self, De, En, Es, Fr, Ko, Pt};
use abiding_word_lib::scripture::recognise::Recogniser;
use abiding_word_lib::scripture::resolve::{resolve, Context};

/// (text as written, canonical, UTF-16 start, UTF-16 end) of each reference.
fn found(text: &str, language: ReferenceLanguage) -> Vec<(String, String, usize, usize)> {
    Recogniser::for_source(language)
        .detect(text)
        .into_iter()
        .map(|d| (d.text, d.reference.canonical, d.start, d.end))
        .collect()
}

fn utf16(s: &str) -> usize {
    s.encode_utf16().count()
}

const DASHES: [&str; 6] = [
    "-", "\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}",
];

#[test]
fn every_ordinary_dash_makes_a_range_with_or_without_spaces() {
    for dash in DASHES {
        for (before, after) in [("", ""), (" ", " "), (" ", ""), ("", " ")] {
            let written = format!("John 15:1{before}{dash}{after}11");
            let text = format!("Read {written} aloud.");
            assert_eq!(
                found(&text, En),
                vec![(
                    written.clone(),
                    "JHN.15.1-JHN.15.11".into(),
                    5,
                    5 + utf16(&written)
                )],
                "{text:?}"
            );
        }
    }
}

#[test]
fn ranges_across_chapters_and_of_chapters_read_with_an_en_dash() {
    assert_eq!(found("See John 15:1–16:4.", En)[0].1, "JHN.15.1-JHN.16.4");
    assert_eq!(found("See John 14 – 16.", En)[0].1, "JHN.14-JHN.16");
    assert_eq!(found("Römer 8,1–9,5 lesen", De)[0].1, "ROM.8.1-ROM.9.5");
    assert_eq!(
        found("요한복음 15장 1절–16장 4절", Ko)[0].1,
        "JHN.15.1-JHN.16.4"
    );
    assert_eq!(found("요한복음 14–16장", Ko)[0].1, "JHN.14-JHN.16");
}

#[test]
fn each_language_reads_its_own_notation_with_an_en_dash() {
    let cases: [(&str, ReferenceLanguage); 9] = [
        ("Johannes 15,1–11", De),
        ("Joh 15,1 – 11", De),
        ("Jean 15,1–11", Fr),
        ("Jn 15,1–11", Fr),
        ("Juan 15:1–11", Es),
        ("João 15:1–11", Pt),
        ("요한복음 15:1–11", Ko),
        ("요한복음 15장 1–11절", Ko),
        ("요 15:1–11", Ko),
    ];
    for (text, language) in cases {
        let refs = found(text, language);
        assert_eq!(refs.len(), 1, "{text:?}: {refs:?}");
        assert_eq!(refs[0].1, "JHN.15.1-JHN.15.11", "{text:?}");
        assert_eq!((refs[0].2, refs[0].3), (0, utf16(text)), "{text:?}");
    }
}

#[test]
fn typed_references_read_every_dash_too() {
    for dash in DASHES {
        for typed in [
            format!("John 15:1{dash}11"),
            format!("John 15:1 {dash} 11"),
            format!("Johannes 15,1{dash}11"),
            format!("요한복음 15:1{dash}11"),
        ] {
            let reference = resolve(&typed, Context::new(None, Some(En)))
                .unwrap_or_else(|e| panic!("{typed:?}: {e}"));
            assert_eq!(reference.canonical(), "JHN.15.1-JHN.15.11", "{typed:?}");
        }
    }
}

#[test]
fn impossible_ranges_are_still_refused() {
    // Typed references are checked against the canon: John 15 has 27 verses.
    for typed in [
        "John 15:1–99",
        "John 15:11–1",
        "John 30:1–3",
        "John 15:1 — 99",
    ] {
        assert!(
            resolve(typed, Context::new(None, Some(En))).is_err(),
            "{typed:?}"
        );
    }
    // Running text checks chapters (and order); verse counts are deliberately
    // not checked there, so a source in another versification keeps its
    // references (docs/correctness-hardening-v0.18.3.md §2). The dash changes
    // nothing about either rule.
    assert!(found("Read John 30:1–3 aloud.", En).is_empty());
    assert!(found("Read John 15:11–1 aloud.", En).is_empty());
    assert_eq!(
        found("Read John 15:1–99 aloud.", En),
        found("Read John 15:1-99 aloud.", En)
            .into_iter()
            .map(|(t, c, a, b)| (t.replace('-', "–"), c, a, b))
            .collect::<Vec<_>>()
    );
}

#[test]
fn a_dash_in_prose_does_not_become_a_reference() {
    assert!(found("The years 1990–2000 were hard.", En).is_empty());
    assert!(found("Pages 1–11 explain the vine.", En).is_empty());
    // "John" with a number after an em dash in prose is not a chapter range.
    assert!(found("In John—as in Luke—the vine is central.", En).is_empty());
    assert!(found("Grace – 15 minutes of prayer.", En).is_empty());
    // A dash after a reference and before a count of something is prose.
    assert_eq!(
        found("Read John 15:5 — 11 of us came.", En)[0].0,
        "John 15:5 — 11",
        "known limit: a number right after a spaced dash reads as the range's end"
    );
    // A reference followed by an em dash and words keeps only the reference.
    assert_eq!(
        found("Read John 15:5—the heart of it.", En),
        vec![("John 15:5".into(), "JHN.15.5".into(), 5, 14)]
    );
}

#[test]
fn offsets_count_utf16_units_before_and_inside_the_range() {
    // Astral characters before the reference take two UTF-16 units each.
    let text = "🍇🍇 Read John 15:1–11 aloud.";
    let refs = found(text, En);
    assert_eq!(refs[0].1, "JHN.15.1-JHN.15.11");
    assert_eq!(refs[0].2, utf16("🍇🍇 Read "));
    assert_eq!(refs[0].3, utf16("🍇🍇 Read John 15:1–11"));
    let ko = "오늘은 요한복음 15장 1–11절을 읽습니다.";
    let refs = found(ko, Ko);
    assert_eq!(refs[0].0, "요한복음 15장 1–11절");
    assert_eq!(refs[0].2, utf16("오늘은 "));
}

#[test]
fn a_library_source_is_indexed_with_the_whole_range() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("vine.md");
    std::fs::write(
        &path,
        "# The Vine\n\nRead John 15:1–11 slowly, then John 15:12 — 17 together.\n",
    )
    .unwrap();
    let staged = import::stage(&path).unwrap();
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        let id = abiding_word_lib::db::new_id();
        let relative = library::managed_relative_path(&id, &staged);
        library::commit_import(
            conn,
            &id,
            &staged,
            &CommitSourceImport {
                preview_id: staged.id.clone(),
                title: "The Vine".into(),
                ..Default::default()
            },
            &relative,
        )?;
        let mut stmt = conn.prepare(
            "SELECT passage, matched_text FROM source_passages WHERE source_id = ?1 ORDER BY start_offset",
        )?;
        let rows: Vec<(String, String)> = stmt
            .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        assert_eq!(
            rows,
            vec![
                ("JHN.15.1-JHN.15.11".to_string(), "John 15:1–11".to_string()),
                ("JHN.15.12-JHN.15.17".to_string(), "John 15:12 — 17".to_string()),
            ]
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn the_example_projects_references_read_as_written() {
    let sample: serde_json::Value = serde_json::from_str(include_str!(
        "../../resources/sample/abiding-in-christ.json"
    ))
    .unwrap();
    let opening = sample["teachings"][1]["introduction"].as_str().unwrap();
    assert!(opening.contains("John 15:1–11"));
    assert_eq!(found(opening, En)[0].1, "JHN.15.1-JHN.15.11");
    // Every passage the example names is a real passage of the canon.
    let mut named = vec![sample["study"]["passage"].as_str().unwrap().to_string()];
    for note in sample["study"]["notes"].as_array().unwrap() {
        if let Some(p) = note["passage"].as_str() {
            named.push(p.into());
        }
    }
    for teaching in sample["teachings"].as_array().unwrap() {
        for point in teaching["points"].as_array().unwrap() {
            if let Some(p) = point["passage"].as_str() {
                named.push(p.into());
            }
        }
    }
    for canonical in named {
        abiding_word_lib::scripture::reference::ScriptureRef::from_canonical(&canonical)
            .unwrap_or_else(|e| panic!("{canonical}: {e}"));
    }
}
