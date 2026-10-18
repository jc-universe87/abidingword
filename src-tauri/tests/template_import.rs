//! Church templates from PowerPoint (v0.18.1). The corpus in
//! `tests/fixtures/templates/` is synthetic (written by
//! `scripts/fixtures/make_template_fixtures.py`), modelled on what
//! PowerPoint, LibreOffice Impress, Google Slides and Keynote save as .pptx.
//! The import reads the design, never the old deck's slides, and reports
//! honestly what it took over, what needs a look and what it cannot show.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use abiding_word_lib::presentation::font_catalog::{CatalogFace, FontStatus};
use abiding_word_lib::presentation::pptx_import::{self, ImportedTemplate, SourceLayout};
use abiding_word_lib::presentation::template::{self, RoleLayout};
use abiding_word_lib::presentation::template_store::TemplateStore;

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/templates")
            .join(name),
    )
    .unwrap()
}

fn import_with(name: &str, faces: &[CatalogFace]) -> (ImportedTemplate, TemplateStore) {
    let dir = tempfile::tempdir().unwrap().keep();
    let store = TemplateStore::from(dir.join("t"));
    let t = pptx_import::import(&fixture(name), name, &store, faces, &|_, _| {}).unwrap();
    (t, store)
}

fn import(name: &str) -> ImportedTemplate {
    import_with(name, &[]).0
}

fn layout<'a>(t: &'a ImportedTemplate, name: &str) -> &'a SourceLayout {
    t.layouts
        .iter()
        .find(|l| l.name == name)
        .unwrap_or_else(|| panic!("no layout {name}"))
}

fn has(t: &ImportedTemplate, level: &str, code: &str, layout: Option<&str>) -> bool {
    t.report.items.iter().any(|i| {
        i.level == level && i.code == code && (layout.is_none() || i.layout.as_deref() == layout)
    })
}

fn face(families: &[&str], bold: bool, italic: bool, weight: u16) -> CatalogFace {
    CatalogFace {
        families: families.iter().map(|s| s.to_string()).collect(),
        bold,
        italic,
        weight,
        path: PathBuf::new(),
        index: 0,
        embeddable: true,
    }
}

#[test]
fn a_powerpoint_design_brings_its_size_colours_fonts_and_layouts() {
    let t = import("powerpoint-16x9.pptx");
    assert_eq!(t.name, "Grace Church Sunday");
    let d = &t.definition;
    assert_eq!((d.width, d.height), (960.0, 540.0));
    assert_eq!(t.report.ratio, "16:9");
    assert_eq!(
        (t.report.masters, t.report.layouts, t.report.slides),
        (1, 8, 3)
    );
    // Theme colours through the master's colour mapping (window text is black).
    assert_eq!(d.colors.background, "#FFFFFF");
    assert_eq!(d.colors.text, "#000000");
    assert_eq!(d.colors.muted, "#44546A");
    assert_eq!(d.colors.accent, "#4472C4");
    assert_eq!(d.fonts.heading.family, "Calibri Light");
    assert_eq!(d.fonts.body.family, "Calibri");
    assert_eq!(d.fonts.others.len(), 1);
    assert_eq!(d.fonts.others[0].family, "Montserrat SemiBold");
    // Nothing from the old deck's slides is taken: it is reported, not imported.
    assert!(has(&t, "supported", "slidesIgnored", None));
    assert!(d.roles.is_empty(), "roles are chosen by the person");
    template::validate(d).unwrap();
}

#[test]
fn the_scripture_layout_keeps_its_cropped_background_band_boxes_and_alignment() {
    let t = import("powerpoint-16x9.pptx");
    let verse = &layout(&t, "Bible Verse").layout;
    let bg = verse.background.as_ref().unwrap().image.as_ref().unwrap();
    assert_eq!(
        (bg.crop.left, bg.crop.top, bg.crop.right, bg.crop.bottom),
        (0.05, 0.1, 0.05, 0.1)
    );
    // A see-through black band, its transparency kept.
    let band = &verse.rects[0];
    assert_eq!(
        (band.x, band.y, band.w, band.h),
        (40.0, 110.0, 880.0, 380.0)
    );
    assert_eq!(band.fill.as_deref(), Some("#000000"));
    assert!((band.fill_opacity.unwrap() - 0.45).abs() < 0.001);
    assert!(has(&t, "attention", "effects", Some("Bible Verse")));

    let body = verse.body.as_ref().unwrap();
    assert_eq!(
        (body.x, body.y, body.w, body.h),
        (60.0, 120.0, 840.0, 330.0)
    );
    assert_eq!(body.font, "Montserrat SemiBold");
    assert!(body.bold);
    assert_eq!(body.size, 36.0);
    assert_eq!(body.align, "center");
    assert_eq!(body.valign, "middle");
    assert_eq!(body.fit, "shrink", "PowerPoint's shrink-on-overflow");
    assert_eq!(body.inset, [18.0, 9.0, 18.0, 9.0]);
    // 110 % of PowerPoint's single spacing (about 1.2 × the size).
    assert!((body.line_spacing - 1.32).abs() < 0.001);
    assert_eq!(body.color, "#FFFFFF");
    // The smaller second box is the passage line: right-aligned, italic, a lighter accent.
    let reference = verse.reference.as_ref().unwrap();
    assert_eq!((reference.y, reference.h), (450.0, 34.0));
    assert_eq!(reference.align, "right");
    assert!(reference.italic);
    assert_eq!(reference.color, "#B4C7E7");
    assert_eq!(reference.fit, "none");
    let title = verse.title.as_ref().unwrap();
    assert_eq!(title.font, "heading");
    assert_eq!(title.size, 32.0);
}

#[test]
fn the_master_logo_in_a_group_and_the_footer_reach_every_layout_that_shows_them() {
    let t = import("powerpoint-16x9.pptx");
    let content = &layout(&t, "Title and Content").layout;
    // The group scales its picture by half: 128×64 in the group is 64×32 on the page.
    let logo = &content.decorations[0];
    assert_eq!((logo.x, logo.y, logo.w, logo.h), (880.0, 20.0, 64.0, 32.0));
    let footer = &content.labels[0];
    assert_eq!(footer.text, "Grace Church · Sunday");
    assert_eq!(
        (footer.frame.x, footer.frame.y, footer.frame.w),
        (318.0, 500.5, 324.0)
    );
    assert_eq!(footer.frame.size, 12.0);
    assert_eq!(footer.frame.align, "center");
    assert_eq!(footer.frame.color, "#44546A");
    // "Hide background graphics" on Blank: no logo there.
    assert!(layout(&t, "Blank").layout.decorations.is_empty());
    assert_eq!(t.definition.assets.len(), 2, "the logo and the photo");
}

#[test]
fn what_cannot_be_reproduced_is_reported_never_dropped_silently() {
    let t = import("powerpoint-16x9.pptx");
    assert!(has(&t, "unsupported", "smartArt", Some("Question")));
    assert!(has(&t, "attention", "justified", Some("Question")));
    assert!(has(&t, "attention", "growsWithText", Some("Question")));
    let question = &layout(&t, "Question").layout;
    assert_eq!(question.body.as_ref().unwrap().align, "left");
    assert_eq!(question.body.as_ref().unwrap().fit, "none");
    // Every report item names a level the interface knows.
    for i in &t.report.items {
        assert!(
            ["supported", "attention", "unsupported"].contains(&i.level.as_str()),
            "{i:?}"
        );
        assert!(i.count > 0);
    }
}

#[test]
fn obvious_layouts_are_suggested_for_roles_and_the_rest_stays_unmapped() {
    let t = import("powerpoint-16x9.pptx");
    let id = |name: &str| layout(&t, name).id.clone();
    let s = &t.suggestions;
    assert_eq!(s.get("scripture"), Some(&id("Bible Verse")));
    assert_eq!(s.get("quote"), Some(&id("Quote")));
    assert_eq!(s.get("question"), Some(&id("Question")));
    assert_eq!(s.get("section"), Some(&id("Section Header")));
    assert_eq!(s.get("title"), Some(&id("Title Slide")));
    assert_eq!(s.get("image"), Some(&id("Picture with Caption")));
    assert_eq!(s.get("heading"), Some(&id("Title and Content")));
    // Google's and LibreOffice's names have no Scripture, quote or picture layout: not guessed.
    let lo = import("libreoffice-4x3.pptx");
    for role in ["scripture", "quote", "image"] {
        assert!(!lo.suggestions.contains_key(role), "{role}");
    }
}

#[test]
fn accepting_lays_out_the_chosen_roles_and_keeps_only_used_images() {
    let t = import("powerpoint-16x9.pptx");
    let mut mapping = t.suggestions.clone();
    mapping.remove("image");
    mapping.insert("not-a-role".into(), layout(&t, "Quote").id.clone());
    let def = t.accept(&mapping);
    template::validate(&def).unwrap();
    assert!(def.roles.contains_key("scripture"));
    assert!(!def.roles.contains_key("image"));
    assert!(!def.roles.contains_key("not-a-role"));
    assert_eq!(def.assets.len(), 2);
    // Only the plain layouts: the photo is no longer used, the logo is.
    let plain: std::collections::BTreeMap<String, String> = [(
        "text".to_string(),
        layout(&t, "Title and Content").id.clone(),
    )]
    .into();
    let def = t.accept(&plain);
    assert_eq!(def.assets.len(), 1);
    assert_eq!(def.used_assets(), vec![def.assets[0].id.as_str()]);
}

#[test]
fn fonts_are_checked_against_this_computer_and_never_replaced_silently() {
    let faces = vec![
        face(&["Calibri"], false, false, 400),
        face(&["Calibri"], false, true, 400),
        face(&["Calibri Light"], false, false, 300),
        face(&["Montserrat"], false, false, 400),
        face(&["Carlito"], true, false, 700),
    ];
    let (t, _) = import_with("powerpoint-16x9.pptx", &faces);
    let font = |family: &str, bold: bool| {
        t.report
            .fonts
            .iter()
            .find(|f| f.family == family && f.bold == bold)
            .unwrap_or_else(|| panic!("{family}"))
    };
    assert_eq!(font("Calibri", false).status, FontStatus::Installed);
    assert_eq!(font("Calibri Light", false).status, FontStatus::Installed);
    // Montserrat is here, but not as "Montserrat SemiBold": missing, with a suggestion only.
    let semi = font("Montserrat SemiBold", true);
    assert_eq!(semi.status, FontStatus::Missing);
    assert_eq!(semi.suggestion.as_deref(), Some("Montserrat"));
    assert_eq!(semi.used_in, vec!["Bible Verse".to_string()]);
    assert!(has(&t, "attention", "fontMissing", None));
    assert!(has(&t, "attention", "wrapRisk", Some("Bible Verse")));
    // A suggestion is never applied by itself.
    assert!(t.definition.fonts.others[0].replacement.is_none());
    assert!(t.definition.fonts.heading.replacement.is_none());
}

#[test]
fn libreoffice_with_two_masters_dark_gradient_and_korean_footer() {
    let t = import("libreoffice-4x3.pptx");
    assert_eq!((t.definition.width, t.definition.height), (720.0, 540.0));
    assert_eq!(t.report.ratio, "4:3");
    assert_eq!(t.report.masters, 2);
    // No title in the file: its name.
    assert_eq!(t.name, "libreoffice-4x3");
    assert_eq!(t.definition.fonts.heading.family, "DejaVu Sans");
    assert_eq!(t.definition.fonts.body.family, "Liberation Serif");
    // The same names in both masters are told apart.
    let names: Vec<&str> = t.layouts.iter().map(|l| l.name.as_str()).collect();
    assert!(names.contains(&"Title Slide") && names.contains(&"Title Slide (2)"));
    // The dark master maps text to light and its gradient becomes its first colour, reported.
    let dark = &layout(&t, "Title Slide (2)").layout;
    assert_eq!(
        dark.background.as_ref().unwrap().color.as_deref(),
        Some("#1C2A3A")
    );
    assert_eq!(dark.title.as_ref().unwrap().color, "#FFFFFF");
    assert!(has(&t, "attention", "gradientBackground", Some("Master 2")));
    let footer = &layout(&t, "Title, Content").layout.labels[0];
    assert_eq!(footer.text, "은혜교회 · 주일 예배");
    assert_eq!(footer.frame.font, "Noto Sans CJK KR");
    assert!(t
        .definition
        .fonts
        .others
        .iter()
        .any(|f| f.family == "Noto Sans CJK KR"));
}

#[test]
fn google_slides_size_names_and_what_it_cannot_show() {
    let t = import("google-slides.pptx");
    assert_eq!((t.definition.width, t.definition.height), (720.0, 405.0));
    assert_eq!(t.report.ratio, "16:9");
    // Arial for both: body boxes stay linked to the body font.
    let body = layout(&t, "Title and body").layout.body.clone().unwrap();
    assert_eq!(body.font, "body");
    assert_eq!(body.size, 18.0);
    assert_eq!(
        layout(&t, "Title and body")
            .layout
            .title
            .as_ref()
            .unwrap()
            .font,
        "heading"
    );
    assert!(has(&t, "unsupported", "imageFormat", Some("Master")));
    assert!(has(&t, "unsupported", "customShape", Some("Main point")));
    assert!(has(&t, "attention", "tiledBackground", Some("Main point")));
    // The shape that cannot be drawn is not turned into something else.
    assert!(layout(&t, "Main point").layout.rects.is_empty());
    assert_eq!(
        t.suggestions.get("section"),
        Some(&layout(&t, "Section header").id)
    );
}

#[test]
fn keynote_size_quote_layout_svg_picture_and_embedded_fonts() {
    let t = import("keynote.pptx");
    assert_eq!((t.definition.width, t.definition.height), (1920.0, 1080.0));
    assert_eq!(t.definition.fonts.heading.family, "Helvetica Neue");
    assert!(has(&t, "attention", "embeddedFonts", None));
    let quote = &layout(&t, "Quote").layout;
    assert_eq!(quote.body.as_ref().unwrap().font, "Georgia");
    assert_eq!(quote.body.as_ref().unwrap().fit, "shrink");
    assert!(quote.reference.is_some());
    assert!(has(&t, "unsupported", "verticalText", Some("Quote")));
    assert!(has(&t, "unsupported", "rotatedShape", Some("Quote")));
    assert!(has(&t, "unsupported", "line", Some("Quote")));
    assert!(has(&t, "attention", "noWrap", Some("Statement")));
    let photo = &layout(&t, "Photo").layout;
    let mark = &photo.decorations[0];
    assert_eq!(mark.opacity, Some(0.8));
    assert_eq!((mark.crop.top, mark.crop.bottom), (0.1, 0.1));
    assert!(has(&t, "attention", "svgAsPicture", Some("Photo")));
    assert_eq!(
        photo.image.as_ref().map(|f| (f.w, f.h)),
        Some((1920.0, 1080.0))
    );
    assert_eq!(t.suggestions.get("quote"), Some(&layout(&t, "Quote").id));
    assert_eq!(t.suggestions.get("image"), Some(&layout(&t, "Photo").id));
}

#[test]
fn every_corpus_file_gives_a_valid_template_and_the_same_result_twice() {
    for name in [
        "powerpoint-16x9.pptx",
        "libreoffice-4x3.pptx",
        "google-slides.pptx",
        "keynote.pptx",
    ] {
        let a = import(name);
        let b = import(name);
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap(),
            "{name}"
        );
        let all = a.accept(&a.suggestions);
        template::validate(&all).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        // Every image the template uses is kept.
        let (t, store) = import_with(name, &[]);
        for asset in &t.definition.assets {
            assert!(store.read(asset).is_some(), "{name}");
        }
        let empty: RoleLayout = RoleLayout::default();
        assert!(t
            .layouts
            .iter()
            .all(|l| l.layout != empty || l.kind == "blank"));
    }
}

#[test]
fn progress_counts_the_layouts_really_read() {
    let seen = RefCell::new(Vec::new());
    let dir = tempfile::tempdir().unwrap();
    let store = TemplateStore::from(dir.path().join("t"));
    pptx_import::import(
        &fixture("libreoffice-4x3.pptx"),
        "x.pptx",
        &store,
        &[],
        &|done, total| seen.borrow_mut().push((done, total)),
    )
    .unwrap();
    assert_eq!(
        seen.into_inner(),
        (1..=6).map(|n| (n, 6)).collect::<Vec<_>>()
    );
}

#[test]
fn a_file_that_is_not_a_presentation_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = TemplateStore::from(dir.path().join("t"));
    let none = |_: usize, _: usize| {};
    assert!(pptx_import::import(b"not a zip", "x.pptx", &store, &[], &none).is_err());
    // A zip without a presentation (a Word document, say).
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        z.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        std::io::Write::write_all(&mut z, b"<w:document/>").unwrap();
        z.finish().unwrap();
    }
    assert!(pptx_import::import(buf.get_ref(), "x.docx", &store, &[], &none).is_err());
    assert!(!dir.path().join("t").exists(), "nothing kept");
}
