//! A Bible's language (v0.18.3): read from the files' own structured
//! metadata when they state it, chosen or corrected by the person otherwise,
//! never guessed; and used at once by typed references.

use std::io::Write;
use std::path::{Path, PathBuf};

use abiding_word_lib::db::bibles::{self, SourceRecord};
use abiding_word_lib::db::Database;
use abiding_word_lib::error::AppError;
use abiding_word_lib::scripture::import::{self, ImportOrigin, SuggestedMetadata};
use abiding_word_lib::scripture::language::ReferenceLanguage;
use abiding_word_lib::scripture::resolve::{language_of_tag, resolve, Context};
use abiding_word_lib::scripture::CommitImport;

fn fixture_files() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/usfm-a");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    files.sort();
    files
}

/// The fixture's USFM in a temporary folder, with extra files beside it.
fn with_files(extra: &[(&str, &str)]) -> (tempfile::TempDir, Vec<PathBuf>) {
    let dir = tempfile::tempdir().unwrap();
    let mut paths = Vec::new();
    for file in fixture_files() {
        let to = dir.path().join(file.file_name().unwrap());
        std::fs::copy(&file, &to).unwrap();
        paths.push(to);
    }
    for (name, text) in extra {
        let to = dir.path().join(name);
        std::fs::write(&to, text).unwrap();
        paths.push(to);
    }
    (dir, paths)
}

/// The fixture's USFM in one .zip, with extra entries.
fn zipped(extra: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf) {
    let extra: Vec<(&str, &[u8])> = extra.iter().map(|(n, t)| (*n, t.as_bytes())).collect();
    zipped_bytes(&extra)
}

fn zipped_bytes(extra: &[(&str, &[u8])]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bible.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let options: zip::write::SimpleFileOptions = Default::default();
    for file in fixture_files() {
        zip.start_file(file.file_name().unwrap().to_string_lossy(), options)
            .unwrap();
        zip.write_all(&std::fs::read(&file).unwrap()).unwrap();
    }
    for (name, text) in extra {
        zip.start_file(*name, options).unwrap();
        zip.write_all(text).unwrap();
    }
    zip.finish().unwrap();
    (dir, path)
}

const DBL: &str = r#"<?xml version="1.0"?><DBLMetadata><identification><name>Bíblia Livre</name></identification>
<language><iso>por</iso><name>Português</name><ldml>pt</ldml><rod/><script>Latin</script></language></DBLMetadata>"#;
const PARATEXT: &str = r#"<ScriptureText><Name>LUT</Name><LanguageIsoCode>deu:::</LanguageIsoCode><Language>German</Language></ScriptureText>"#;

#[test]
fn structured_metadata_beside_the_usfm_names_the_language() {
    // Digital Bible Library metadata.xml: the BCP 47 / LDML tag first.
    let (_dir, paths) = with_files(&[("metadata.xml", DBL)]);
    let staged = import::stage(&paths, ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.language_tag.as_deref(), Some("pt"));
    let preview = staged.preview(SuggestedMetadata::default());
    assert_eq!(preview.suggested.language_code, "pt");
    // The metadata file is not read as Scripture.
    assert!(preview
        .issues
        .iter()
        .all(|i| !format!("{i:?}").contains("metadata")));
    // Paratext Settings.xml, inside a .zip.
    let (_dir, zip) = zipped(&[("Settings.xml", PARATEXT)]);
    let staged = import::stage(&[zip], ImportOrigin::UserFiles).unwrap();
    // "deu" is stored as its two-letter code, as the language list has it.
    assert_eq!(staged.language_tag.as_deref(), Some("de"));
    assert_eq!(
        language_of_tag(staged.language_tag.as_deref()),
        Some(ReferenceLanguage::De)
    );
}

#[test]
fn metadata_details_found_in_review() {
    let tag = |files: &[(&str, &str)]| {
        let (_dir, paths) = with_files(files);
        import::stage(&paths, ImportOrigin::UserFiles)
            .unwrap()
            .language_tag
    };
    // A commented-out block states nothing.
    let commented = r#"<DBLMetadata><!-- <language><iso>fra</iso></language> -->
<language><ldml>de</ldml></language></DBLMetadata>"#;
    assert_eq!(tag(&[("metadata.xml", commented)]).as_deref(), Some("de"));
    // DBL "de" and Paratext "deu" are the same language: they agree.
    let dbl_de = "<DBLMetadata><language><ldml>de</ldml></language></DBLMetadata>";
    assert_eq!(
        tag(&[("metadata.xml", dbl_de), ("Settings.xml", PARATEXT)]).as_deref(),
        Some("de")
    );
    // A three-letter ISO code becomes the two-letter one.
    let fra = "<DBLMetadata><language><iso>fra</iso></language></DBLMetadata>";
    assert_eq!(tag(&[("metadata.xml", fra)]).as_deref(), Some("fr"));
    // Paratext's script and region are kept.
    let serbian = "<ScriptureText><LanguageIsoCode>sr:Latn:RS:</LanguageIsoCode></ScriptureText>";
    assert_eq!(
        tag(&[("Settings.xml", serbian)]).as_deref(),
        Some("sr-Latn-RS")
    );
    // A loose metadata file too large to be metadata is not read.
    let huge = format!(
        "<DBLMetadata><language><iso>fra</iso></language>{}</DBLMetadata>",
        " ".repeat(1024 * 1024)
    );
    assert_eq!(tag(&[("metadata.xml", &huge)]), None);
}

#[test]
fn without_trustworthy_metadata_the_language_is_left_unchosen() {
    // Plain USFM: nothing to read; the file name says nothing either.
    let staged = import::stage(&fixture_files(), ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.language_tag, None);
    assert_eq!(
        staged
            .preview(SuggestedMetadata::default())
            .suggested
            .language_code,
        ""
    );
    // A metadata file that only names the language in words gives no tag.
    let (_dir, paths) = with_files(&[(
        "metadata.xml",
        "<DBLMetadata><language><name>Português</name></language></DBLMetadata>",
    )]);
    assert_eq!(
        import::stage(&paths, ImportOrigin::UserFiles)
            .unwrap()
            .language_tag,
        None
    );
    // Two metadata files that disagree: no guess.
    let (_dir, zip) = zipped(&[("metadata.xml", DBL), ("Settings.xml", PARATEXT)]);
    assert_eq!(
        import::stage(&[zip], ImportOrigin::UserFiles)
            .unwrap()
            .language_tag,
        None
    );
    // Unreadable metadata is ignored, never a failed import.
    let (_dir, zip) = zipped_bytes(&[("metadata.xml", &[0xff, 0xfe, 0x00, 0x3c])]);
    let staged = import::stage(&[zip], ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.language_tag, None);
    // An arbitrary .xml beside the Bible's files is set aside and listed
    // with the files left out (v0.22); alone it is refused, as before.
    let (_dir, paths) = with_files(&[("book.xml", "<usx/>")]);
    let staged = import::stage(&paths, ImportOrigin::UserFiles).unwrap();
    assert!(staged
        .content
        .skipped_files
        .contains(&"book.xml".to_string()));
    let alone: Vec<PathBuf> = paths
        .iter()
        .filter(|p| p.ends_with("book.xml"))
        .cloned()
        .collect();
    assert!(matches!(
        import::stage(&alone, ImportOrigin::UserFiles),
        Err(AppError::UnsupportedFormat(_))
    ));
}

fn source() -> SourceRecord {
    SourceRecord {
        origin: "managed_copy",
        path: Some("sources/bibles/test".into()),
        original_file_name: Some("fixture".into()),
        format: "usfm",
        is_builtin: false,
    }
}

fn commit(conn: &rusqlite::Connection, code: Option<&str>) -> Result<String, AppError> {
    let staged = import::stage(&fixture_files(), ImportOrigin::UserFiles)?;
    let id = bibles::new_translation_id();
    let meta = CommitImport {
        preview_id: staged.id.clone(),
        name: "Fixture".into(),
        short_name: format!(
            "F{}",
            NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ),
        language: "Português".into(),
        language_code: code.map(String::from),
        publisher: None,
        copyright_notice: None,
        license_type: None,
        words: Default::default(),
        as_document: false,
    };
    bibles::commit_import(conn, &id, &staged.content, &meta, &source())?;
    Ok(id)
}

static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);

#[test]
fn a_tag_is_stored_normalised_a_name_is_refused_and_no_tag_stays_none() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        let id = commit(conn, Some("PT_br")).unwrap();
        assert_eq!(
            bibles::get(conn, &id)?.language_code.as_deref(),
            Some("pt-BR")
        );
        let id = commit(conn, None).unwrap();
        assert_eq!(bibles::get(conn, &id)?.language_code, None);
        let id = commit(conn, Some("  ")).unwrap();
        assert_eq!(bibles::get(conn, &id)?.language_code, None);
        match commit(conn, Some("Português")) {
            Err(AppError::InvalidInput(message)) => {
                assert_eq!(message.code, Some("bibles.badLanguage"))
            }
            other => panic!("{other:?}"),
        }
        Ok(())
    })
    .unwrap();
}

#[test]
fn correcting_the_language_later_changes_only_the_language_and_reaches_typed_references() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        let id = commit(conn, None).unwrap();
        let before = bibles::get(conn, &id)?;
        let chapter_before = bibles::chapter(conn, &id, "JHN", 1)?;
        // No tag: the interface decides ("Jn 3:5" in English is John).
        let context = |conn: &rusqlite::Connection| {
            Context::new(
                language_of_tag(bibles::get(conn, &id).unwrap().language_code.as_deref()),
                Some(ReferenceLanguage::En),
            )
        };
        assert_eq!(
            resolve("Jn 3:5", context(conn)).unwrap().canonical(),
            "JHN.3.5"
        );
        // Marked Portuguese: the Bible's language decides at once.
        let after = bibles::set_language(conn, &id, "Português (Brasil)", Some("pt-BR"))?;
        assert_eq!(after.language, "Português (Brasil)");
        assert_eq!(after.language_code.as_deref(), Some("pt-BR"));
        assert_eq!(
            resolve("Jn 3:5", context(conn)).unwrap().canonical(),
            "JON.3.5"
        );
        // Nothing else changed.
        assert_eq!(after.name, before.name);
        assert_eq!(after.short_name, before.short_name);
        assert_eq!(after.verse_count, before.verse_count);
        assert_eq!(
            format!("{:?}", bibles::chapter(conn, &id, "JHN", 1)?),
            format!("{chapter_before:?}")
        );
        // Cleared again; a name is refused.
        assert_eq!(
            bibles::set_language(conn, &id, "Português", None)?.language_code,
            None
        );
        assert!(matches!(
            bibles::set_language(conn, &id, "Português", Some("Portuguese")),
            Err(AppError::InvalidInput(_))
        ));
        assert!(matches!(
            bibles::set_language(conn, &id, "  ", Some("pt")),
            Err(AppError::InvalidInput(_))
        ));
        assert!(bibles::set_language(conn, "no-such-bible", "x", Some("pt")).is_err());
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_verse_beyond_the_canon_is_good_when_any_installed_bible_has_it() {
    // Review finding (v0.18.3): a Bible that numbers Psalm titles as verses
    // (Louis Segond's Ps 51:21) made those citations good only while that
    // Bible was the one being read. Any installed Bible's own verses count.
    use abiding_word_lib::scripture::canon;
    use abiding_word_lib::scripture::resolve::resolve_with;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("19-PSA.usfm");
    std::fs::write(
        &file,
        "\\id PSA Extra numbering (test only)\n\\c 117\n\\p\n\\v 1 One.\n\\v 2 Two.\n\\v 3 A third verse the canon does not count.\n",
    )
    .unwrap();
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        let psalms = canon::by_code("PSA").unwrap();
        assert!(!bibles::any_has_verse(conn, psalms, 117, 3));
        let staged = import::stage(std::slice::from_ref(&file), ImportOrigin::UserFiles)?;
        let meta = CommitImport {
            preview_id: staged.id.clone(),
            name: "Extra".into(),
            short_name: "EXTRA".into(),
            language: "Français".into(),
            language_code: Some("fr".into()),
            publisher: None,
            copyright_notice: None,
            license_type: None,
            words: Default::default(),
            as_document: false,
        };
        bibles::commit_import(
            conn,
            &bibles::new_translation_id(),
            &staged.content,
            &meta,
            &source(),
        )?;
        assert!(bibles::any_has_verse(conn, psalms, 117, 3));
        assert!(!bibles::any_has_verse(conn, psalms, 117, 4));
        let has = |book: &'static canon::Book, chapter, verse| {
            bibles::any_has_verse(conn, book, chapter, verse)
        };
        // No Bible being read, another interface: still good.
        let context = Context::new(None, Some(ReferenceLanguage::En));
        assert_eq!(
            resolve_with("Ps 117:3", context, &has).unwrap().canonical(),
            "PSA.117.3"
        );
        assert!(resolve_with("Ps 117:4", context, &has).is_err());
        // Without the installed Bible's verses the canon alone refuses it.
        assert!(resolve("Ps 117:3", context).is_err());
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_damaged_metadata_entry_in_a_zip_is_skipped_never_a_failed_import() {
    // Review finding (v0.18.3): a CRC error in metadata.xml failed the import.
    let marker = "<iso>fra</iso>";
    let dbl = format!("<DBLMetadata><language>{marker}</language></DBLMetadata>");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bible.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
    let stored: zip::write::SimpleFileOptions =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for file in fixture_files() {
        zip.start_file(file.file_name().unwrap().to_string_lossy(), stored)
            .unwrap();
        zip.write_all(&std::fs::read(&file).unwrap()).unwrap();
    }
    zip.start_file("metadata.xml", stored).unwrap();
    zip.write_all(dbl.as_bytes()).unwrap();
    zip.finish().unwrap();
    // Change one stored byte: the entry no longer matches its checksum.
    let mut bytes = std::fs::read(&path).unwrap();
    let at = bytes
        .windows(marker.len())
        .position(|w| w == marker.as_bytes())
        .unwrap();
    bytes[at + 5] = b'x';
    std::fs::write(&path, bytes).unwrap();
    let staged = import::stage(&[path], ImportOrigin::UserFiles).unwrap();
    assert_eq!(staged.language_tag, None);
    assert!(!staged.content.books.is_empty());
}
