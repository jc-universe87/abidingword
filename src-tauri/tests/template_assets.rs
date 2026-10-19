//! Template images are staged until a template is saved (v0.18.3): a
//! cancelled or failed import leaves nothing in the store, a saved one keeps
//! exactly its images, and nothing shared is ever deleted.

use std::path::{Path, PathBuf};

use abiding_word_lib::presentation::pptx_import;
use abiding_word_lib::presentation::template::TemplateAsset;
use abiding_word_lib::presentation::template_store::TemplateStore;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/templates")
            .join(name),
    )
    .unwrap()
}

/// The image files in the store itself (not in `staging/`).
fn kept_files(store: &TemplateStore) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(&store.dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    files
}

fn staged_files(store: &TemplateStore) -> usize {
    std::fs::read_dir(store.staging_dir())
        .map(|e| e.count())
        .unwrap_or(0)
}

/// A real 1×1 PNG, made distinct by its text chunk.
fn png(tag: u8) -> Vec<u8> {
    let mut bytes = vec![
        0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R', 0, 0,
        0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89,
    ];
    bytes.extend_from_slice(&[0, 0, 0, 1, b't', b'E', b'X', b't', tag, 0, 0, 0, 0]);
    bytes.extend_from_slice(&[0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82]);
    bytes
}

fn store() -> (tempfile::TempDir, TemplateStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = TemplateStore::from(dir.path().join("presentation-templates"));
    (dir, store)
}

#[test]
fn a_powerpoint_import_stages_its_images_and_cancelling_leaves_the_store_empty() {
    let (_dir, store) = store();
    let imported = pptx_import::import(
        &fixture("powerpoint-16x9.pptx"),
        "church.pptx",
        &store,
        &[],
        &|_, _| {},
    )
    .unwrap();
    assert!(
        !imported.definition.assets.is_empty(),
        "the fixture has images"
    );
    // Under review: readable (previews), but nothing in the store.
    for asset in &imported.definition.assets {
        assert!(store.read(asset).is_some());
        assert!(store.has(asset));
    }
    assert_eq!(kept_files(&store), Vec::<PathBuf>::new());
    assert!(staged_files(&store) > 0);
    // Cancelled (and the app restarted): staging is emptied, the store untouched.
    store.clear_staging();
    assert_eq!(staged_files(&store), 0);
    assert_eq!(kept_files(&store), Vec::<PathBuf>::new());
    for asset in &imported.definition.assets {
        assert!(store.read(asset).is_none());
    }
}

#[test]
fn an_import_that_fails_halfway_leaves_nothing_in_the_store() {
    let (_dir, store) = store();
    store.add(&png(1), "logo.png").unwrap();
    assert!(store.add(b"not an image", "broken.png").is_err());
    assert!(pptx_import::import(b"not a zip", "x.pptx", &store, &[], &|_, _| {}).is_err());
    assert_eq!(kept_files(&store), Vec::<PathBuf>::new());
}

#[test]
fn keeping_copies_exactly_the_templates_images_and_a_failed_save_takes_back_only_those() {
    let (_dir, store) = store();
    let imported =
        pptx_import::import(&fixture("keynote.pptx"), "k.pptx", &store, &[], &|_, _| {}).unwrap();
    let assets = imported.definition.assets.clone();
    let copied = store.keep(&assets).unwrap();
    assert_eq!(copied.len(), assets.len());
    assert_eq!(kept_files(&store).len(), assets.len());
    // Kept images stay readable after staging is emptied.
    store.clear_staging();
    for asset in &assets {
        assert_eq!(store.read(asset).map(|b| !b.is_empty()), Some(true));
    }
    // Keeping again copies nothing.
    assert!(store.keep(&assets).unwrap().is_empty());

    // A second template: one image already kept, one new. Its save fails: only
    // the new one is taken back out.
    let shared = assets[0].clone();
    let new = store.add(&png(7), "new.png").unwrap();
    let copied = store.keep(&[shared.clone(), new.clone()]).unwrap();
    assert_eq!(
        copied.iter().map(|a| a.id.clone()).collect::<Vec<_>>(),
        vec![new.id.clone()]
    );
    store.unkeep(&copied);
    assert!(
        store.path(&shared).is_file(),
        "an image another template uses is never removed"
    );
    assert!(!store.path(&new).is_file());
}

#[test]
fn the_same_image_twice_is_one_file_and_shared_images_are_never_deleted() {
    let (_dir, store) = store();
    let a = store.add(&png(3), "logo.png").unwrap();
    let b = store.add(&png(3), "again.png").unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(staged_files(&store), 1);
    // Two templates share it; keeping for each stores it once.
    store.keep(std::slice::from_ref(&a)).unwrap();
    store.keep(std::slice::from_ref(&b)).unwrap();
    assert_eq!(kept_files(&store).len(), 1);
    // Deleting a template (a soft delete in the database) touches no file;
    // nothing removes kept images, so the other template and any restored
    // backup keep theirs.
    store.clear_staging();
    assert!(store.read(&a).is_some());
}

#[test]
fn an_image_changed_in_staging_is_not_kept() {
    let (_dir, store) = store();
    let asset = store.add(&png(9), "logo.png").unwrap();
    let staged = store
        .staging_dir()
        .join(store.path(&asset).file_name().unwrap());
    std::fs::write(&staged, png(10)).unwrap();
    assert!(store.read(&asset).is_none());
    assert!(store.keep(std::slice::from_ref(&asset)).is_err());
    assert_eq!(kept_files(&store), Vec::<PathBuf>::new());
    let missing = TemplateAsset {
        id: "0".repeat(64),
        ..asset
    };
    assert!(store.keep(&[missing]).is_err());
}
