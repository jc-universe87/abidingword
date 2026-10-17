//! PowerPoint (.pptx), from the same document and the same slide layout as
//! the PDF: one slide per audience slide, with the same headings,
//! Scripture, images and text at the same places and sizes. Plain,
//! conservative Office Open XML (one master, one blank layout, text boxes
//! and pictures) that PowerPoint, Keynote, LibreOffice and Google Slides
//! open. The speaker's manuscript and notes go into the notes pages only
//! when asked for. Written directly, with no other program needed.

use std::io::{Cursor, Write as _};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::document::{PresentationDocument, Slide};
use super::fonts::FontSet;
use super::layout::{self, Align, Block, Palette, Role};
use super::pdf::ImageData;
use super::text::Shaper;
use super::ExportOptions;
use crate::error::{AppError, AppResult};

const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DECL: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;
/// English Metric Units per point.
const EMU: f32 = 12_700.0;

fn emu(points: f32) -> i64 {
    (points * EMU).round() as i64
}

/// Text made safe for XML (characters XML cannot hold are left out).
pub fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

fn hex(color: &str) -> String {
    color.trim_start_matches('#').to_ascii_uppercase()
}

struct Media {
    name: String,
}

pub fn render(
    doc: &PresentationDocument,
    image_data: &ImageData,
    fonts: &FontSet,
    options: &ExportOptions,
) -> AppResult<Vec<u8>> {
    let palette = layout::palette(&doc.theme);
    let shaper = Shaper { fonts };
    let lang = esc(&options.locale.language);
    let notes = options.speaker_notes;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut media: Vec<(String, Media)> = Vec::new();
    let n = doc.slides.len();

    for (i, slide) in doc.slides.iter().enumerate() {
        let number = i + 1;
        let blocks = layout::slide(slide, doc, &shaper, &options.locale);
        let mut rels = vec![format!(
            r#"<Relationship Id="rId1" Type="{REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>"#
        )];
        let mut shapes = String::new();
        for (shape_id, block) in (2..).zip(blocks.iter()) {
            match block {
                Block::Text(b) => {
                    shapes.push_str(&text_shape(shape_id, b, &palette, &lang));
                }
                Block::Image(i)
                    if image_data
                        .get(&i.asset_id)
                        .is_some_and(|(_, h)| h.media_type != "image/webp") =>
                {
                    let (bytes, header) = &image_data[&i.asset_id];
                    let existing = media.iter().position(|(id, _)| id == &i.asset_id);
                    let name = match existing {
                        Some(k) => media[k].1.name.clone(),
                        None => {
                            let name = format!("image{}.{}", media.len() + 1, header.extension());
                            files.push((format!("ppt/media/{name}"), bytes.clone()));
                            media.push((i.asset_id.clone(), Media { name: name.clone() }));
                            name
                        }
                    };
                    let rid = format!("rId{}", rels.len() + 1);
                    rels.push(format!(
                        r#"<Relationship Id="{rid}" Type="{REL}/image" Target="../media/{name}"/>"#
                    ));
                    let alt = slide
                        .audience
                        .image
                        .as_ref()
                        .and_then(|im| im.caption.clone())
                        .unwrap_or_default();
                    shapes.push_str(&format!(
                        r#"<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}" descr="{alt}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>"#,
                        emu(i.x),
                        emu(i.y),
                        emu(i.w),
                        emu(i.h),
                        alt = esc(&alt),
                    ));
                }
                Block::Image(layout::ImageBox { x, y, w, h, .. })
                | Block::Missing { x, y, w, h } => {
                    let label = &options.locale.labels.image_unavailable;
                    shapes.push_str(&format!(
                        r#"<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Image unavailable {shape_id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="{muted}"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="{lang}" sz="2200" dirty="0"><a:solidFill><a:srgbClr val="{muted}"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp>"#,
                        emu(*x),
                        emu(*y),
                        emu(*w),
                        emu(*h),
                        esc(label),
                        muted = hex(&palette.muted),
                    ));
                }
            }
        }
        if notes && has_speaker_text(slide) {
            rels.push(format!(
                r#"<Relationship Id="rId{}" Type="{REL}/notesSlide" Target="../notesSlides/notesSlide{number}.xml"/>"#,
                rels.len() + 1
            ));
            files.push((
                format!("ppt/notesSlides/notesSlide{number}.xml"),
                notes_slide(slide, options, &lang).into_bytes(),
            ));
            files.push((
                format!("ppt/notesSlides/_rels/notesSlide{number}.xml.rels"),
                rels_xml(&[
                    format!(r#"<Relationship Id="rId1" Type="{REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>"#),
                    format!(r#"<Relationship Id="rId2" Type="{REL}/slide" Target="../slides/slide{number}.xml"/>"#),
                ])
                .into_bytes(),
            ));
        }
        files.push((
            format!("ppt/slides/slide{number}.xml"),
            format!(
                r#"{DECL}<p:sld {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>{group}{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
                bg = hex(&palette.background),
                group = GROUP,
            )
            .into_bytes(),
        ));
        files.push((
            format!("ppt/slides/_rels/slide{number}.xml.rels"),
            rels_xml(&rels).into_bytes(),
        ));
    }

    let with_notes = files.iter().any(|(p, _)| p.starts_with("ppt/notesSlides/"));
    let mut package: Vec<(String, Vec<u8>)> = vec![
        ("[Content_Types].xml".into(), content_types(n, &files, with_notes).into_bytes()),
        (
            "_rels/.rels".into(),
            rels_xml(&[
                format!(r#"<Relationship Id="rId1" Type="{REL}/officeDocument" Target="ppt/presentation.xml"/>"#),
                r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>"#.to_string(),
                format!(r#"<Relationship Id="rId3" Type="{REL}/extended-properties" Target="docProps/app.xml"/>"#),
            ])
            .into_bytes(),
        ),
        (
            "docProps/core.xml".into(),
            format!(
                r#"{DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>Abiding Word</dc:creator></cp:coreProperties>"#,
                esc(&doc.title)
            )
            .into_bytes(),
        ),
        (
            "docProps/app.xml".into(),
            format!(
                r#"{DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Abiding Word</Application><Slides>{n}</Slides><Notes>{}</Notes></Properties>"#,
                files.iter().filter(|(p, _)| p.starts_with("ppt/notesSlides/notesSlide")).count()
            )
            .into_bytes(),
        ),
        ("ppt/presentation.xml".into(), presentation(n, with_notes).into_bytes()),
        ("ppt/_rels/presentation.xml.rels".into(), presentation_rels(n, with_notes).into_bytes()),
        ("ppt/presProps.xml".into(), format!(r#"{DECL}<p:presentationPr {NS}/>"#).into_bytes()),
        (
            "ppt/viewProps.xml".into(),
            format!(r#"{DECL}<p:viewPr {NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>"#).into_bytes(),
        ),
        (
            "ppt/tableStyles.xml".into(),
            format!(r#"{DECL}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}}"/>"#).into_bytes(),
        ),
        ("ppt/slideMasters/slideMaster1.xml".into(), master(&palette).into_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels".into(),
            rels_xml(&[
                format!(r#"<Relationship Id="rId1" Type="{REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>"#),
                format!(r#"<Relationship Id="rId2" Type="{REL}/theme" Target="../theme/theme1.xml"/>"#),
            ])
            .into_bytes(),
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml".into(),
            format!(r#"{DECL}<p:sldLayout {NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>{GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#).into_bytes(),
        ),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels".into(),
            rels_xml(&[format!(r#"<Relationship Id="rId1" Type="{REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>"#)]).into_bytes(),
        ),
        ("ppt/theme/theme1.xml".into(), theme("Abiding Word", &palette).into_bytes()),
    ];
    if with_notes {
        package.push((
            "ppt/notesMasters/notesMaster1.xml".into(),
            NOTES_MASTER.replace("{NS}", NS).into_bytes(),
        ));
        package.push((
            "ppt/notesMasters/_rels/notesMaster1.xml.rels".into(),
            rels_xml(&[format!(
                r#"<Relationship Id="rId1" Type="{REL}/theme" Target="../theme/theme2.xml"/>"#
            )])
            .into_bytes(),
        ));
        package.push((
            "ppt/theme/theme2.xml".into(),
            theme("Notes", &layout::palette("light")).into_bytes(),
        ));
    }
    package.extend(files);
    zip(package)
}

fn has_speaker_text(slide: &Slide) -> bool {
    !slide.speaker.manuscript.is_empty() || !slide.speaker.notes.is_empty()
}

const GROUP: &str = r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#;

fn run(text: &str, size: f32, bold: bool, color: &str, lang: &str) -> String {
    format!(
        r#"<a:r><a:rPr lang="{lang}" sz="{}"{} dirty="0"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r>"#,
        (size * 100.0).round() as i64,
        if bold { r#" b="1""# } else { "" },
        esc(text)
    )
}

fn text_shape(id: usize, b: &layout::TextBox, palette: &Palette, lang: &str) -> String {
    let color = hex(match b.role {
        Role::Text => &palette.text,
        Role::Muted => &palette.muted,
        Role::Accent => &palette.accent,
    });
    let algn = match b.align {
        Align::Left => "l",
        Align::Center => "ctr",
    };
    let paragraphs: String = b
        .paragraphs
        .iter()
        .map(|p| {
            if p.trim().is_empty() {
                format!(r#"<a:p><a:pPr algn="{algn}"/><a:endParaRPr lang="{lang}" sz="{}"/></a:p>"#, (b.size * 100.0) as i64)
            } else {
                format!(
                    r#"<a:p><a:pPr algn="{algn}"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr>{}</a:p>"#,
                    run(p, b.size, b.bold, &color, lang)
                )
            }
        })
        .collect();
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Text {id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"#,
        emu(b.x),
        emu(b.y),
        emu(b.w),
        emu(b.h)
    )
}

fn notes_slide(slide: &Slide, options: &ExportOptions, lang: &str) -> String {
    let loc = &options.locale;
    let mut paragraphs = String::new();
    let para = |text: &str, bold: bool| -> String {
        format!(
            r#"<a:p><a:r><a:rPr lang="{lang}"{} dirty="0"/><a:t>{}</a:t></a:r></a:p>"#,
            if bold { r#" b="1""# } else { "" },
            esc(text)
        )
    };
    for part in &slide.speaker.manuscript {
        paragraphs.push_str(&para(loc.field(&part.field), true));
        for line in loc.part_text(&part.field, &part.text).lines() {
            paragraphs.push_str(&para(line, false));
        }
    }
    if !slide.speaker.notes.is_empty() {
        paragraphs.push_str(&para(&loc.labels.speaker_notes, true));
        for line in slide.speaker.notes.lines() {
            paragraphs.push_str(&para(line, false));
        }
    }
    format!(
        r#"{DECL}<p:notes {NS}><p:cSld><p:spTree>{GROUP}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
    )
}

fn rels_xml(rels: &[String]) -> String {
    format!(
        r#"{DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{}</Relationships>"#,
        rels.concat()
    )
}

fn content_types(n: usize, files: &[(String, Vec<u8>)], notes: bool) -> String {
    let ct = "application/vnd.openxmlformats-officedocument.presentationml";
    let mut overrides = vec![
        format!(r#"<Override PartName="/ppt/presentation.xml" ContentType="{ct}.presentation.main+xml"/>"#),
        format!(r#"<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="{ct}.slideMaster+xml"/>"#),
        format!(r#"<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="{ct}.slideLayout+xml"/>"#),
        r#"<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>"#.to_string(),
        format!(r#"<Override PartName="/ppt/presProps.xml" ContentType="{ct}.presProps+xml"/>"#),
        format!(r#"<Override PartName="/ppt/viewProps.xml" ContentType="{ct}.viewProps+xml"/>"#),
        format!(r#"<Override PartName="/ppt/tableStyles.xml" ContentType="{ct}.tableStyles+xml"/>"#),
        r#"<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>"#.to_string(),
        r#"<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>"#.to_string(),
    ];
    if notes {
        overrides.push(format!(r#"<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="{ct}.notesMaster+xml"/>"#));
        overrides.push(r#"<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>"#.to_string());
    }
    for i in 1..=n {
        overrides.push(format!(
            r#"<Override PartName="/ppt/slides/slide{i}.xml" ContentType="{ct}.slide+xml"/>"#
        ));
    }
    for (path, _) in files
        .iter()
        .filter(|(p, _)| p.starts_with("ppt/notesSlides/notesSlide"))
    {
        overrides.push(format!(
            r#"<Override PartName="/{path}" ContentType="{ct}.notesSlide+xml"/>"#
        ));
    }
    format!(
        r#"{DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>{}</Types>"#,
        overrides.concat()
    )
}

/// Relationship ids in presentation.xml.rels: master, theme, properties,
/// then the notes master and the slides.
fn presentation_rels(n: usize, notes: bool) -> String {
    let mut rels = vec![
        format!(
            r#"<Relationship Id="rId1" Type="{REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>"#
        ),
        format!(r#"<Relationship Id="rId2" Type="{REL}/theme" Target="theme/theme1.xml"/>"#),
        format!(r#"<Relationship Id="rId3" Type="{REL}/presProps" Target="presProps.xml"/>"#),
        format!(r#"<Relationship Id="rId4" Type="{REL}/viewProps" Target="viewProps.xml"/>"#),
        format!(r#"<Relationship Id="rId5" Type="{REL}/tableStyles" Target="tableStyles.xml"/>"#),
    ];
    if notes {
        rels.push(format!(r#"<Relationship Id="rId6" Type="{REL}/notesMaster" Target="notesMasters/notesMaster1.xml"/>"#));
    }
    for i in 1..=n {
        rels.push(format!(
            r#"<Relationship Id="rId{}" Type="{REL}/slide" Target="slides/slide{i}.xml"/>"#,
            i + 9
        ));
    }
    rels_xml(&rels)
}

fn presentation(n: usize, notes: bool) -> String {
    let slides: String = (1..=n)
        .map(|i| format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 255 + i, i + 9))
        .collect();
    let notes_master = if notes {
        r#"<p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst>"#
    } else {
        ""
    };
    format!(
        r#"{DECL}<p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>{notes_master}<p:sldIdLst>{slides}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>"#
    )
}

fn master(palette: &Palette) -> String {
    format!(
        r#"{DECL}<p:sldMaster {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>{GROUP}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>"#,
        hex(&palette.background)
    )
}

fn theme(name: &str, palette: &Palette) -> String {
    let fonts = r#"<a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hang" typeface="Malgun Gothic"/><a:font script="Jpan" typeface="Yu Gothic"/><a:font script="Hans" typeface="Microsoft YaHei"/>"#;
    let fill = r#"<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>"#;
    let line = r#"<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>"#;
    format!(
        r#"{DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="{name}"><a:themeElements><a:clrScheme name="{name}"><a:dk1><a:srgbClr val="{text}"/></a:dk1><a:lt1><a:srgbClr val="{bg}"/></a:lt1><a:dk2><a:srgbClr val="{muted}"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="{accent}"/></a:accent1><a:accent2><a:srgbClr val="7A4A24"/></a:accent2><a:accent3><a:srgbClr val="5F7A8C"/></a:accent3><a:accent4><a:srgbClr val="8C6A5F"/></a:accent4><a:accent5><a:srgbClr val="4F6F52"/></a:accent5><a:accent6><a:srgbClr val="A67C52"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="{name}"><a:majorFont>{fonts}</a:majorFont><a:minorFont>{fonts}</a:minorFont></a:fontScheme><a:fmtScheme name="{name}"><a:fillStyleLst>{fill}{fill}{fill}</a:fillStyleLst><a:lnStyleLst>{line}{line}{line}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>{fill}{fill}{fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"#,
        text = hex(&palette.text),
        bg = hex(&palette.background),
        muted = hex(&palette.muted),
        accent = hex(&palette.accent),
    )
}

const NOTES_MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>"#;

/// The files in a fixed order with fixed dates: the same presentation gives
/// the same file.
fn zip(files: Vec<(String, Vec<u8>)>) -> AppResult<Vec<u8>> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let fail = |e: &dyn std::fmt::Display| AppError::Unexpected(format!("PowerPoint: {e}"));
    for (path, data) in files {
        let method = if path.starts_with("ppt/media/") {
            CompressionMethod::Stored
        } else {
            CompressionMethod::Deflated
        };
        let options = SimpleFileOptions::default()
            .compression_method(method)
            .last_modified_time(zip::DateTime::default());
        writer.start_file(path, options).map_err(|e| fail(&e))?;
        writer.write_all(&data).map_err(|e| fail(&e))?;
    }
    let cursor = writer.finish().map_err(|e| fail(&e))?;
    Ok(cursor.into_inner())
}
