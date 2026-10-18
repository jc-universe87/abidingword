#!/usr/bin/env python3
"""Writes the synthetic church-template corpus used by the PowerPoint
design-import tests (v0.18.1):

    src-tauri/tests/fixtures/templates/*.pptx

Each file is built by hand from Office Open XML, modelled on what
PowerPoint, LibreOffice Impress, Google Slides and Keynote write when a
design is saved as .pptx. No real church's design, logo or font is used;
the pictures are small generated PNGs. The output is deterministic (fixed
zip timestamps), so running this again gives byte-identical files.

    python3 scripts/fixtures/make_template_fixtures.py
"""

import os
import struct
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src-tauri", "tests", "fixtures", "templates")

EMU = 12700  # EMU per point

NS = (
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
)
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


# --------------------------------------------------------------------------
# Pictures
# --------------------------------------------------------------------------


def png(width, height, pixel):
    """A small RGB PNG; `pixel(x, y)` gives (r, g, b)."""
    raw = b""
    for y in range(height):
        raw += b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(width))

    def chunk(kind, data):
        c = kind + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def photo():
    # A soft "photo" gradient, 64×36, for backgrounds.
    return png(64, 36, lambda x, y: (40 + x * 2, 60 + y * 3, 110 + (x + y)))


def logo():
    # A 32×16 mark: a cross on a dark tile.
    def px(x, y):
        return (250, 250, 245) if (13 <= x <= 18) or (6 <= y <= 9) else (30, 50, 80)

    return png(32, 16, px)


EMF = b"\x01\x00\x00\x00" + b"\x00" * 84  # an EMF header: not a picture the app can show


# --------------------------------------------------------------------------
# XML pieces
# --------------------------------------------------------------------------


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def xfrm(x, y, w, h, extra=""):
    return (
        f'<a:xfrm{extra}><a:off x="{int(x * EMU)}" y="{int(y * EMU)}"/>'
        f'<a:ext cx="{int(w * EMU)}" cy="{int(h * EMU)}"/></a:xfrm>'
    )


def color(c):
    """'#RRGGBB' → srgbClr, 'accent1' → schemeClr, ('accent1', mods) → with modifiers."""
    if isinstance(c, tuple):
        name, mods = c
        inner = "".join(f'<a:{k} val="{v}"/>' for k, v in mods)
        if name.startswith("#"):
            return f'<a:srgbClr val="{name[1:]}">{inner}</a:srgbClr>'
        return f'<a:schemeClr val="{name}">{inner}</a:schemeClr>'
    if c.startswith("#"):
        return f'<a:srgbClr val="{c[1:]}"/>'
    return f'<a:schemeClr val="{c}"/>'


def rpr(size=None, bold=None, italic=None, font=None, fill=None, lang=None):
    attrs = ""
    if lang:
        attrs += f' lang="{lang}"'
    if size:
        attrs += f' sz="{int(size * 100)}"'
    if bold is not None:
        attrs += f' b="{1 if bold else 0}"'
    if italic is not None:
        attrs += f' i="{1 if italic else 0}"'
    inner = ""
    if fill:
        inner += f"<a:solidFill>{color(fill)}</a:solidFill>"
    if font:
        inner += f'<a:latin typeface="{esc(font)}"/><a:ea typeface="{esc(font)}"/>'
    return attrs, inner


def lvl1(align=None, line=None, **run):
    attrs, inner = rpr(**run)
    a = f' algn="{align}"' if align else ""
    ln = f'<a:lnSpc><a:spcPct val="{int(line * 100000)}"/></a:lnSpc>' if line else ""
    return f"<a:lvl1pPr{a}>{ln}<a:defRPr{attrs}>{inner}</a:defRPr></a:lvl1pPr>"


def body_pr(anchor=None, fit=None, insets=None, vert=None, wrap=None):
    a = ""
    if anchor:
        a += f' anchor="{anchor}"'
    if vert:
        a += f' vert="{vert}"'
    if wrap:
        a += f' wrap="{wrap}"'
    if insets:
        for k, v in zip(("lIns", "tIns", "rIns", "bIns"), insets):
            a += f' {k}="{int(v * EMU)}"'
    inner = {"shrink": "<a:normAutofit/>", "grow": "<a:spAutoFit/>", "none": "<a:noAutofit/>"}.get(fit, "")
    return f"<a:bodyPr{a}>{inner}</a:bodyPr>"


_ids = [1]


def nid():
    _ids[0] += 1
    return _ids[0]


def placeholder(kind, rect=None, idx=None, name=None, style=None, bp=None, text=""):
    """A placeholder; `rect` None means it inherits the master's position."""
    i = nid()
    t = f' type="{kind}"' if kind != "obj" else ""
    ix = f' idx="{idx}"' if idx is not None else ""
    sp_pr = f"<p:spPr>{xfrm(*rect)}</p:spPr>" if rect else "<p:spPr/>"
    paragraph = f"<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{esc(text)}</a:t></a:r></a:p>" if text else "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>"
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="{esc(name or kind)}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
        f"<p:nvPr><p:ph{t}{ix}/></p:nvPr></p:nvSpPr>{sp_pr}"
        f'<p:txBody>{bp or "<a:bodyPr/>"}<a:lstStyle>{style or ""}</a:lstStyle>{paragraph}</p:txBody></p:sp>'
    )


def rect_shape(rect, fill=None, line=None, effects=False, geometry="rect", rot=None, text=None, run=None, bp=None, para=None):
    i = nid()
    extra = f' rot="{rot}"' if rot else ""
    fill_xml = f"<a:solidFill>{color(fill)}</a:solidFill>" if fill else "<a:noFill/>"
    line_xml = f'<a:ln w="{int(line[1] * EMU)}"><a:solidFill>{color(line[0])}</a:solidFill></a:ln>' if line else ""
    fx = '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>' if effects else ""
    body = ""
    if text is not None:
        attrs, inner = rpr(**(run or {}))
        ppr = para or ""
        body = f'<p:txBody>{bp or "<a:bodyPr/>"}<a:lstStyle/><a:p>{ppr}<a:r><a:rPr{attrs}>{inner}</a:rPr><a:t>{esc(text)}</a:t></a:r></a:p></p:txBody>'
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{i}" name="Shape {i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr>{xfrm(*rect, extra)}<a:prstGeom prst="{geometry}"><a:avLst/></a:prstGeom>{fill_xml}{line_xml}{fx}</p:spPr>'
        f"{body}</p:sp>"
    )


def picture(rid, rect, crop=None, alpha=None, svg_rid=None, name="Picture"):
    i = nid()
    src = ""
    if crop:
        src = '<a:srcRect ' + " ".join(f'{k}="{int(v * 100000)}"' for k, v in zip("ltrb", crop)) + "/>"
    amf = f'<a:alphaModFix amt="{int(alpha * 100000)}"/>' if alpha is not None else ""
    ext = ""
    if svg_rid:
        ext = (
            '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">'
            f'<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="{svg_rid}"/>'
            "</a:ext></a:extLst>"
        )
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{i}" name="{esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill><a:blip r:embed="{rid}">{amf}{ext}</a:blip>{src}<a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        f'<p:spPr>{xfrm(*rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    )


def group(rect, child_rect, children):
    i = nid()
    x, y, w, h = rect
    cx, cy, cw, ch = child_rect
    gx = (
        f'<a:xfrm><a:off x="{int(x * EMU)}" y="{int(y * EMU)}"/><a:ext cx="{int(w * EMU)}" cy="{int(h * EMU)}"/>'
        f'<a:chOff x="{int(cx * EMU)}" y="{int(cy * EMU)}"/><a:chExt cx="{int(cw * EMU)}" cy="{int(ch * EMU)}"/></a:xfrm>'
    )
    return (
        f'<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{i}" name="Group {i}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        f"<p:grpSpPr>{gx}</p:grpSpPr>{''.join(children)}</p:grpSp>"
    )


def smartart(rect):
    i = nid()
    return (
        f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{i}" name="Diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        f'<p:xfrm><a:off x="{int(rect[0] * EMU)}" y="{int(rect[1] * EMU)}"/><a:ext cx="{int(rect[2] * EMU)}" cy="{int(rect[3] * EMU)}"/></p:xfrm>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:graphic></p:graphicFrame>'
    )


def connector(rect):
    i = nid()
    return (
        f'<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="{i}" name="Line {i}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>'
        f'<p:spPr>{xfrm(*rect)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>'
    )


def bg_solid(c):
    return f"<p:bg><p:bgPr><a:solidFill>{color(c)}</a:solidFill><a:effectLst/></p:bgPr></p:bg>"


def bg_image(rid, crop=None, tile=False):
    src = ""
    if crop:
        src = '<a:srcRect ' + " ".join(f'{k}="{int(v * 100000)}"' for k, v in zip("ltrb", crop)) + "/>"
    fill = '<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>' if tile else "<a:stretch><a:fillRect/></a:stretch>"
    return f'<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/>{src}{fill}</a:blipFill><a:effectLst/></p:bgPr></p:bg>'


def bg_gradient(c1, c2):
    return (
        '<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst>'
        f'<a:gs pos="0">{color(c1)}</a:gs><a:gs pos="100000">{color(c2)}</a:gs>'
        '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>'
    )


def bg_ref(idx, c):
    return f'<p:bg><p:bgRef idx="{idx}">{color(c)}</p:bgRef></p:bg>'


def sp_tree(shapes):
    return (
        '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        + "".join(shapes)
        + "</p:spTree>"
    )


def theme_xml(name, colors, major, minor, ea=None):
    order = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    scheme = ""
    for k in order:
        v = colors[k]
        if k == "dk1" and v == "windowText":
            scheme += '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>'
        elif k == "lt1" and v == "window":
            scheme += '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>'
        else:
            scheme += f'<a:{k}><a:srgbClr val="{v[1:]}"/></a:{k}>'
    ea_xml = f'<a:ea typeface="{esc(ea)}"/>' if ea else '<a:ea typeface=""/>'
    return (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme {NS} name="{esc(name)}"><a:themeElements>'
        f'<a:clrScheme name="{esc(name)}">{scheme}</a:clrScheme>'
        f'<a:fontScheme name="{esc(name)}"><a:majorFont><a:latin typeface="{esc(major)}"/>{ea_xml}<a:cs typeface=""/></a:majorFont>'
        f'<a:minorFont><a:latin typeface="{esc(minor)}"/>{ea_xml}<a:cs typeface=""/></a:minorFont></a:fontScheme>'
        '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
        '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
        '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/></a:schemeClr></a:solidFill>'
        '<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'
        "</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"
    )


OFFICE = {
    "dk1": "windowText", "lt1": "window", "dk2": "#44546A", "lt2": "#E7E6E6",
    "accent1": "#4472C4", "accent2": "#ED7D31", "accent3": "#A5A5A5", "accent4": "#FFC000",
    "accent5": "#5B9BD5", "accent6": "#70AD47", "hlink": "#0563C1", "folHlink": "#954F72",
}

CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
CLR_MAP_DARK = CLR_MAP.replace('bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"', 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"')


# --------------------------------------------------------------------------
# A deck
# --------------------------------------------------------------------------


class Part:
    def __init__(self, path, ctype, xml):
        self.path, self.ctype, self.xml = path, ctype, xml
        self.rels = []  # (id, type, target)

    def rel(self, kind, target):
        rid = f"rId{len(self.rels) + 1}"
        self.rels.append((rid, kind, target))
        return rid


def deck(file_name, size, title, masters, slides=0, embedded_fonts=False, app="Microsoft Office PowerPoint"):
    """`masters`: list of dicts with theme, clr_map, bg, shapes(media), title_style,
    body_style and layouts: list of dicts with name, type, show_master, bg, shapes."""
    _ids[0] = 1
    parts = []
    media = {}  # name → bytes

    def media_rel(part, name, data):
        media[name] = data
        return part.rel("image", f"../media/{name}")

    pres = Part("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", None)
    master_ids = []
    layout_no = 0
    for mi, m in enumerate(masters, start=1):
        theme = Part(f"ppt/theme/theme{mi}.xml", "application/vnd.openxmlformats-officedocument.theme+xml", m["theme"])
        parts.append(theme)
        master = Part(f"ppt/slideMasters/slideMaster{mi}.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml", None)
        layout_rels = []
        for layout in m["layouts"]:
            layout_no += 1
            lp = Part(f"ppt/slideLayouts/slideLayout{layout_no}.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml", None)
            lp.rel("slideMaster", f"../slideMasters/slideMaster{mi}.xml")
            resolve = lambda name, data, lp=lp: media_rel(lp, name, data)
            shapes = layout.get("shapes", lambda r: [])(resolve)
            bg = layout.get("bg", lambda r: "")(resolve)
            show = ' showMasterSp="0"' if layout.get("show_master") is False else ""
            lp.xml = (
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout {NS} type="{layout.get("type", "cust")}" preserve="1"{show}>'
                f'<p:cSld name="{esc(layout["name"])}">{bg}{sp_tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
            )
            parts.append(lp)
            layout_rels.append(master.rel("slideLayout", f"../slideLayouts/slideLayout{layout_no}.xml"))
        master.rel("theme", f"../theme/theme{mi}.xml")
        resolve = lambda name, data, mp=master: media_rel(mp, name, data)
        shapes = m.get("shapes", lambda r: [])(resolve)
        bg = m.get("bg", lambda r: "")(resolve)
        ids = "".join(f'<p:sldLayoutId id="{2147483649 + 20 * mi + k}" r:id="{rid}"/>' for k, rid in enumerate(layout_rels))
        master.xml = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster {NS}><p:cSld>{bg}{sp_tree(shapes)}</p:cSld>'
            f'{m.get("clr_map", CLR_MAP)}<p:sldLayoutIdLst>{ids}</p:sldLayoutIdLst>'
            f'<p:txStyles><p:titleStyle>{m.get("title_style", "")}</p:titleStyle><p:bodyStyle>{m.get("body_style", "")}</p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>'
        )
        parts.append(master)
        master_ids.append(pres.rel("slideMaster", f"slideMasters/slideMaster{mi}.xml"))

    slide_ids = []
    for si in range(1, slides + 1):
        sp = Part(f"ppt/slides/slide{si}.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml", None)
        sp.rel("slideLayout", "../slideLayouts/slideLayout1.xml")
        sp.xml = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld {NS}><p:cSld>'
            f'{sp_tree([placeholder("ctrTitle", text=f"Slide {si} of the old deck")])}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
        )
        parts.append(sp)
        slide_ids.append(pres.rel("slide", f"slides/slide{si}.xml"))
    theme_rel = pres.rel("theme", "theme/theme1.xml")
    del theme_rel

    cx, cy = int(size[0] * EMU), int(size[1] * EMU)
    sld_ids = "".join(f'<p:sldId id="{256 + k}" r:id="{rid}"/>' for k, rid in enumerate(slide_ids))
    embedded = '<p:embeddedFontLst><p:embeddedFont><p:font typeface="Church Sans"/></p:embeddedFont></p:embeddedFontLst>' if embedded_fonts else ""
    master_list = "".join(f'<p:sldMasterId id="{2147483648 + 20 * k}" r:id="{rid}"/>' for k, rid in enumerate(master_ids))
    pres.xml = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation {NS} saveSubsetFonts="1">'
        f"<p:sldMasterIdLst>{master_list}</p:sldMasterIdLst>"
        + (f"<p:sldIdLst>{sld_ids}</p:sldIdLst>" if slide_ids else "")
        + f'<p:sldSz cx="{cx}" cy="{cy}"/><p:notesSz cx="6858000" cy="9144000"/>{embedded}'
        '<p:defaultTextStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
        '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>'
    )
    parts.insert(0, pres)

    core = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{esc(title)}</dc:title><dc:creator>Abiding Word tests</dc:creator></cp:coreProperties>"
    )
    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        f"<Application>{esc(app)}</Application></Properties>"
    )

    types = {"png": "image/png", "emf": "image/x-emf", "svg": "image/svg+xml"}
    ct = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        + "".join(f'<Default Extension="{e}" ContentType="{t}"/>' for e, t in types.items())
        + "".join(f'<Override PartName="/{p.path}" ContentType="{p.ctype}"/>' for p in parts)
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'
    )
    root_rels = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{RELS_NS}">'
        f'<Relationship Id="rId1" Type="{REL}/officeDocument" Target="ppt/presentation.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        f'<Relationship Id="rId3" Type="{REL}/extended-properties" Target="docProps/app.xml"/></Relationships>'
    )

    files = [("[Content_Types].xml", ct), ("_rels/.rels", root_rels), ("docProps/core.xml", core), ("docProps/app.xml", app_xml)]
    for p in parts:
        files.append((p.path, p.xml))
        if p.rels:
            d, f = p.path.rsplit("/", 1)
            rels = "".join(f'<Relationship Id="{i}" Type="{REL}/{k}" Target="{t}"/>' for i, k, t in p.rels)
            files.append((f"{d}/_rels/{f}.rels", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="{RELS_NS}">{rels}</Relationships>'))
    for name in sorted(media):
        files.append((f"ppt/media/{name}", media[name]))

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, file_name)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)
    print("wrote", os.path.relpath(path))


# --------------------------------------------------------------------------
# The corpus
# --------------------------------------------------------------------------


def powerpoint_16x9():
    """PowerPoint, 16:9: Calibri theme, logo in a group on the master, a
    footer, a Scripture layout with a cropped photo background and a
    Montserrat SemiBold verse box that shrinks, a quote layout, a question
    layout with SmartArt and a shadowed band, and a picture layout."""
    W, H = 960, 540
    title_style = lvl1(align="l", line=0.9, size=44, font="+mj-lt", fill="tx1")
    body_style = lvl1(line=0.9, size=28, font="+mn-lt", fill="tx1")

    def master_shapes(r):
        logo_id = r("image1.png", logo())
        return [
            placeholder("title", (66, 28.75, 828, 104.4), name="Title Placeholder 1", bp=body_pr(anchor="ctr", fit="shrink")),
            placeholder("body", (66, 143.75, 828, 342.6), idx=1, name="Text Placeholder 2", bp=body_pr(fit="shrink")),
            placeholder("dt", (66, 500.5, 216, 28.75), idx=10),
            placeholder("ftr", (318, 500.5, 324, 28.75), idx=11, style=lvl1(align="ctr", size=12, fill="tx2"), text="Grace Church · Sunday"),
            placeholder("sldNum", (678, 500.5, 216, 28.75), idx=12),
            # The logo sits in a group whose own coordinates are scaled by half.
            group((880, 20, 64, 32), (0, 0, 128, 64), [picture(logo_id, (0, 0, 128, 64), name="Logo")]),
        ]

    layouts = [
        {
            "name": "Title Slide", "type": "title",
            "shapes": lambda r: [
                placeholder("ctrTitle", (120, 88.4, 720, 188), bp=body_pr(anchor="b"), style=lvl1(align="ctr", size=60)),
                placeholder("subTitle", (120, 283.6, 720, 130.4), idx=1, style=lvl1(align="ctr", size=24)),
            ],
        },
        {"name": "Title and Content", "type": "obj", "shapes": lambda r: [placeholder("title"), placeholder("obj", idx=1), placeholder("ftr", idx=11)]},
        {
            "name": "Section Header", "type": "secHead",
            "shapes": lambda r: [
                placeholder("title", (65.5, 134.6, 828, 224.6), bp=body_pr(anchor="b"), style=lvl1(size=60)),
                placeholder("body", (65.5, 361.4, 828, 118.1), idx=1, style=lvl1(size=24, fill="tx2")),
                placeholder("ftr", idx=11),
            ],
        },
        {
            "name": "Bible Verse", "type": "cust",
            "bg": lambda r: bg_image(r("image2.png", photo()), crop=(0.05, 0.1, 0.05, 0.1)),
            "shapes": lambda r: [
                rect_shape((40, 110, 880, 380), fill=("#000000", [("alpha", 45000)]), effects=True),
                placeholder("title", (60, 30, 840, 70), style=lvl1(size=32, fill="#FFFFFF")),
                placeholder("body", (60, 120, 840, 330), idx=1, name="Verse",
                            style=lvl1(align="ctr", size=36, bold=True, font="Montserrat SemiBold", fill="#FFFFFF", line=1.1),
                            bp=body_pr(anchor="ctr", fit="shrink", insets=(18, 9, 18, 9))),
                placeholder("body", (60, 450, 840, 34), idx=2, name="Reference",
                            style=lvl1(align="r", size=20, italic=True, fill=("accent1", [("lumMod", 40000), ("lumOff", 60000)]))),
            ],
        },
        {
            "name": "Quote", "type": "cust",
            "shapes": lambda r: [
                placeholder("body", (120, 100, 720, 260), idx=1, style=lvl1(align="ctr", size=36, italic=True), bp=body_pr(anchor="ctr", fit="none")),
                placeholder("body", (120, 380, 720, 40), idx=2, style=lvl1(align="r", size=20, fill="tx2")),
            ],
        },
        {
            "name": "Question", "type": "cust",
            "shapes": lambda r: [
                placeholder("title", (66, 28.75, 828, 80)),
                smartart((66, 300, 828, 160)),
                rect_shape((66, 120, 828, 6), fill="accent2", effects=True),
                placeholder("body", (66, 140, 828, 150), idx=1, bp=body_pr(fit="grow"), style=lvl1(align="just", size=32)),
            ],
        },
        {
            "name": "Picture with Caption", "type": "picTx",
            "shapes": lambda r: [
                placeholder("title", (66, 36, 310, 126), style=lvl1(size=32)),
                placeholder("pic", (408, 78, 486, 384), idx=1),
                placeholder("body", (66, 162, 310, 300), idx=2, style=lvl1(size=16)),
            ],
        },
        {"name": "Blank", "type": "blank", "show_master": False, "shapes": lambda r: []},
    ]
    deck(
        "powerpoint-16x9.pptx", (W, H), "Grace Church Sunday",
        [{
            "theme": theme_xml("Office Theme", OFFICE, "Calibri Light", "Calibri"),
            "bg": lambda r: bg_ref(1001, "bg1"),
            "shapes": master_shapes, "title_style": title_style, "body_style": body_style,
            "layouts": layouts,
        }],
        slides=3,
    )


def libreoffice_4x3():
    """LibreOffice Impress, 4:3: two masters (a light one and a dark one with
    a gradient), DejaVu Sans and Liberation Serif, Korean footer text, and
    the same layout names in both masters."""
    colors = dict(OFFICE, dk1="#000000", lt1="#FFFFFF", dk2="#1C1C1C", lt2="#EEEEEE", accent1="#004586", accent2="#FF420E")

    def master(dark):
        return {
            "theme": theme_xml("LibreOffice" + (" Dark" if dark else ""), colors, "DejaVu Sans", "Liberation Serif"),
            "clr_map": CLR_MAP_DARK if dark else CLR_MAP,
            "bg": (lambda r: bg_gradient("#1C2A3A", "#000000")) if dark else (lambda r: bg_solid("#FDFBF7")),
            "title_style": lvl1(align="ctr", size=44, font="+mj-lt"),
            "body_style": lvl1(size=32, font="+mn-lt"),
            "shapes": lambda r: [
                placeholder("title", (36, 21.6, 648, 90)),
                placeholder("body", (36, 126, 648, 356.4), idx=1),
                placeholder("ftr", (246, 491.6, 228, 37.2), idx=2, style=lvl1(align="ctr", size=14, font="Noto Sans CJK KR"), text="은혜교회 · 주일 예배"),
            ],
            "layouts": [
                {"name": "Title Slide", "type": "title", "shapes": lambda r: [placeholder("ctrTitle", (36, 150, 648, 120)), placeholder("subTitle", (36, 280, 648, 180), idx=1)]},
                {"name": "Title, Content", "type": "obj", "shapes": lambda r: [placeholder("title"), placeholder("obj", idx=1), placeholder("ftr", idx=2)]},
                {"name": "Title Only", "type": "titleOnly", "shapes": lambda r: [placeholder("title")]},
            ],
        }

    deck("libreoffice-4x3.pptx", (720, 540), "", [master(False), master(True)], slides=1, app="LibreOffice/24.8")


def google_slides():
    """Google Slides, 720×405 points: Google's layout names, Arial theme
    fonts, a rounded shape filled with colour, a tiled background picture
    and an EMF picture that cannot be shown."""
    colors = dict(OFFICE, dk1="#000000", lt1="#FFFFFF", dk2="#595959", lt2="#EEEEEE", accent1="#4285F4")

    def shapes_master(r):
        return [
            placeholder("title", (24.9, 35.1, 670.2, 45.1), style=lvl1(size=28)),
            placeholder("body", (24.9, 90.8, 670.2, 269), idx=1, style=lvl1(size=18)),
            picture(r("image1.emf", EMF), (650, 360, 50, 30), name="Old logo"),
        ]

    deck(
        "google-slides.pptx", (720, 405), "Youth Night",
        [{
            "theme": theme_xml("Simple Light", colors, "Arial", "Arial"),
            "bg": lambda r: bg_solid("lt1"),
            "title_style": lvl1(size=28, font="+mj-lt"), "body_style": lvl1(size=18, font="+mn-lt"),
            "shapes": shapes_master,
            "layouts": [
                {"name": "Title slide", "type": "title", "shapes": lambda r: [placeholder("ctrTitle", (24.5, 58.6, 670.9, 161.6), style=lvl1(size=52, align="ctr")), placeholder("subTitle", (24.5, 223.2, 670.9, 62.4), idx=1, style=lvl1(size=28, align="ctr"))]},
                {"name": "Section header", "type": "secHead", "shapes": lambda r: [placeholder("title", (24.5, 169.4, 670.9, 66.2), style=lvl1(size=36, align="ctr"))]},
                {"name": "Title and body", "type": "tx", "shapes": lambda r: [placeholder("title"), placeholder("body", idx=1)]},
                {
                    "name": "Main point", "type": "cust",
                    "bg": lambda r: bg_image(r("image2.png", photo()), tile=True),
                    "shapes": lambda r: [
                        rect_shape((40, 60, 640, 285), fill="accent1", geometry="roundRect"),
                        placeholder("title", (48.9, 70, 622.2, 265), style=lvl1(size=48)),
                    ],
                },
                {"name": "Blank", "type": "blank", "shapes": lambda r: []},
            ],
        }],
        slides=2, app="Google Slides",
    )


def keynote():
    """Keynote, 1920×1080 points: Helvetica Neue, a "Quote" layout with a
    vertical attribution, a rotated decoration, a line, an SVG picture with
    its PNG fallback and embedded fonts."""
    colors = dict(OFFICE, dk1="#000000", lt1="#FFFFFF", dk2="#2B2B2B", lt2="#F4F4F4", accent1="#E05A2B")

    def shapes_master(r):
        return [
            placeholder("title", (108, 72, 1704, 240), style=lvl1(size=96, bold=True)),
            placeholder("body", (108, 340, 1704, 640), idx=1, style=lvl1(size=56)),
        ]

    def photo_shapes(r):
        png_id = r("image1.png", logo())
        svg_id = r("image2.svg", b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><rect width="2" height="1" fill="#1E3250"/></svg>')
        return [
            picture(png_id, (1600, 60, 240, 120), svg_rid=svg_id, alpha=0.8, crop=(0, 0.1, 0, 0.1), name="Mark"),
            placeholder("pic", (0, 0, 1920, 1080), idx=1),
            placeholder("title", (108, 820, 1704, 160), style=lvl1(size=72, fill="#FFFFFF")),
        ]

    deck(
        "keynote.pptx", (1920, 1080), "Easter Sunday",
        [{
            "theme": theme_xml("Basic White", colors, "Helvetica Neue", "Helvetica Neue"),
            "bg": lambda r: bg_solid("#FFFFFF"),
            "title_style": lvl1(size=96, font="+mj-lt"), "body_style": lvl1(size=56, font="+mn-lt"),
            "shapes": shapes_master,
            "layouts": [
                {"name": "Title & Subtitle", "type": "title", "shapes": lambda r: [placeholder("ctrTitle", (108, 300, 1704, 300), style=lvl1(size=128, align="ctr")), placeholder("subTitle", (108, 620, 1704, 160), idx=1, style=lvl1(size=56, align="ctr"))]},
                {"name": "Bullets", "type": "obj", "shapes": lambda r: [placeholder("title"), placeholder("body", idx=1)]},
                {
                    "name": "Quote", "type": "cust",
                    "shapes": lambda r: [
                        rect_shape((80, 120, 40, 600), fill="accent1", rot=600000),
                        connector((200, 760, 1520, 0)),
                        placeholder("body", (200, 160, 1520, 560), idx=1, style=lvl1(size=80, align="ctr", font="Georgia"), bp=body_pr(anchor="ctr", fit="shrink")),
                        placeholder("body", (200, 800, 1520, 120), idx=2, style=lvl1(size=40, align="r"), bp=body_pr(vert="vert")),
                    ],
                },
                {"name": "Photo", "type": "cust", "shapes": photo_shapes},
                {"name": "Statement", "type": "cust", "shapes": lambda r: [placeholder("title", (108, 300, 1704, 480), style=lvl1(size=120, align="ctr"), bp=body_pr(anchor="ctr", wrap="none"))]},
            ],
        }],
        slides=4, embedded_fonts=True, app="Keynote",
    )


if __name__ == "__main__":
    powerpoint_16x9()
    libreoffice_4x3()
    google_slides()
    keynote()
