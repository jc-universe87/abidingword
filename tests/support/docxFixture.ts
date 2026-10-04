import type { ContentsItem, EpubElement, EpubItem, EpubNode, EpubStructureItem } from "@/types/library";
import type { SourceFixture } from "./memoryApi";

// A small invented Word document, as the core would hand it to the interface:
// two body parts and the notes, with every kind of element the formatted view
// shows, and ids that agree with the segments exactly as the core makes them
// (paragraph "p<segment>", heading "h<n>", bookmark "bm-<name>", note marker
// "fr<id>" / "er<id>", note "fn<id>" / "en<id>"). No real text.

const el = (t: string, c: EpubNode[] = [], a: Record<string, string> = {}, l?: { item: string; id?: string }): EpubElement => ({
  t,
  ...(Object.keys(a).length ? { a } : {}),
  ...(c.length ? { c } : {}),
  ...(l ? { l } : {}),
});

/** A 1 x 1 transparent PNG. */
export const DOCX_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const CSS = ".aw-doc .aw-title { font-size: 2em; text-align: center; }";

interface Texts {
  text: string;
  section: string;
}

/** Builds one part: every call to `p` is the next segment, as the core numbers them. */
function builder(first: number, section: string) {
  const segments: Texts[] = [];
  const anchors: Record<string, number> = {};
  const next = () => first + segments.length;
  let headings = 0;
  return {
    segments,
    anchors,
    count: () => segments.length,
    /** A paragraph (or list item, caption …) that is one segment. */
    seg(text: string, make: (id: string) => EpubElement, plain = text): EpubElement {
      const at = next();
      const id = `p${at}`;
      anchors[id] = at;
      void text;
      const made = make(id);
      segments.push({ text: plain, section });
      return made;
    },
    heading(level: number, text: string, index: number): EpubElement {
      const id = `h${index}`;
      anchors[id] = next();
      headings += 1;
      return el(`h${level}`, [text], { id });
    },
    mark(id: string, at = next()) {
      anchors[id] = at;
    },
    headings: () => headings,
  };
}

const PART_ONE = builder(0, "Chapter One");
const b1 = PART_ONE;
const one: EpubNode[] = [
  b1.heading(1, "Chapter One · Εἰς τὸ ὄνομα", 0),
  b1.seg("Plain bold italic", (id) =>
    el("p", ["Plain ", el("strong", ["bold"]), " ", el("em", ["italic"]), " ", el("u", ["underline"]), " ", el("s", ["struck"]), " x", el("sup", ["2"]), " H", el("sub", ["2"]), "."], { id, style: "text-align:center" }),
  "Plain bold italic underline struck x2 H2."),
  b1.seg("Links", (id) => {
    b1.mark("fr2");
    b1.mark("er3");
    return el(
      "p",
      [
        "Go to ",
        el("a", ["part two"], {}, { item: "d1", id: "bm-part_two" }),
        ", the ",
        el("a", ["middle"], {}, { item: "d0", id: "bm-middle" }),
        el("sup", [el("a", ["1"], { role: "doc-noteref", id: "fr2" }, { item: "notes", id: "fn2" })]),
        " and an endnote",
        el("sup", [el("a", ["i"], { role: "doc-noteref", id: "er3" }, { item: "notes", id: "en3" })]),
        ".",
      ],
      { id },
    );
  }, "Go to part two, the middle1 and an endnotei."),
];
const li = (text: string) => b1.seg(text, (id) => el("li", [text], { id }));
// Built in document order, as the core numbers them; the nesting is attached after.
const first = li("First");
const nestedA = li("Nested a");
const deep = li("Deep i");
const second = li("Second");
nestedA.c!.push(el("ol", [deep], { type: "i" }));
first.c!.push(el("ol", [nestedA], { type: "a" }));
one.push(el("ol", [first, second]));
one.push(
  el("table", [
    el("thead", [
      el("tr", [
        b1.seg("Term", (id) => el("th", [el("p", ["Term"], { id })], { scope: "col" })),
        b1.seg("Meaning", (id) => el("th", [el("p", ["Meaning"], { id })], { scope: "col" })),
      ]),
    ]),
    el("tbody", [
      el("tr", [
        b1.seg("μένω", (id) => el("td", [el("p", ["μένω"], { id })], { rowSpan: "2" })),
        b1.seg("remain", (id) => el("td", [el("p", ["remain"], { id })])),
      ]),
      el("tr", [b1.seg("abide", (id) => el("td", [el("p", ["abide"], { id })]))]),
    ]),
  ]),
);
one.push(el("figure", [el("img", [], { src: DOCX_PIXEL, alt: "A small picture", width: "200", height: "100" }), b1.seg("A caption.", (id) => el("figcaption", ["A caption."], { id }))]));
b1.mark("bm-middle");
one.push(el("span", [], { id: "bm-middle" }));
one.push(b1.seg("The middle paragraph.", (id) => el("p", ["The middle paragraph."], { id })));
// Links to the web: one safe address, and ones the interface must refuse even if sent.
one.push(
  b1.seg("Visit the web page, or not a script or an ftp site.", (id) => ({
    t: "p",
    a: { id },
    c: [
      "Visit ",
      { t: "a", c: ["the web page"], x: "https://example.org/page?q=1&r=2" },
      ", or ",
      { t: "a", c: ["a script"], x: "javascript:alert(1)" },
      " or ",
      { t: "a", c: ["an ftp site"], x: "ftp://example.org/file" },
      ".",
    ],
  })),
);
one.push(el("hr", [], { class: "aw-pagebreak", role: "doc-pagebreak" }));

const b2 = builder(b1.count(), "Chapter Two");
const two: EpubNode[] = [
  b2.heading(1, "Chapter Two", 1),
  el("span", [], { id: "bm-part_two" }),
  b2.seg("Back to the marker.", (id) => el("p", ["Back to the ", el("a", ["marker"], {}, { item: "d0", id: "fr2" }), "."], { id }), "Back to the marker."),
  b2.seg("A missing picture follows.", (id) => el("p", ["A missing picture follows. ", el("span", ["a picture"], { class: "aw-missing-image" })], { id })),
];
b2.mark("bm-part_two", b1.count());
const WIDE = Array.from({ length: 8 }, (_, i) => `Column ${i}`);
two.push(
  el("table", [
    el("thead", [el("tr", WIDE.map((w) => b2.seg(w, (id) => el("th", [el("p", [w], { id })], { scope: "col" }))))]),
    el("tbody", [el("tr", WIDE.map((_, i) => b2.seg(`Value ${i}`, (id) => el("td", [el("p", [`Value ${i} with some words in it`], { id })]))))]),
  ]),
);

const b3 = builder(b1.count() + b2.count(), "");
const notes: EpubNode[] = [];
{
  const fnItem = b3.seg("The first footnote.", (id) => el("p", ["The first footnote. ", el("a", ["↩"], { role: "doc-backlink" }, { item: "d0", id: "fr2" })], { id }));
  b3.mark("fn2", b1.count() + b2.count());
  notes.push(el("ol", [el("li", [fnItem], { id: "fn2" })]));
  const end = b3.seg("An endnote.", (id) => el("p", ["An endnote. ", el("a", ["↩"], { role: "doc-backlink" }, { item: "d0", id: "er3" })], { id }));
  b3.mark("en3", b1.count() + b2.count() + 1);
  notes.push(el("hr"));
  notes.push(el("ol", [el("li", [end], { id: "en3" })], { type: "i" }));
}

const item = (id: string, nodes: EpubNode[], missingImages = 0): EpubItem => ({ id, nodes, css: CSS, root: {}, missingImages });

const structure: EpubStructureItem[] = [
  { id: "d0", startSegment: 0, segmentCount: b1.count(), anchors: b1.anchors },
  { id: "d1", startSegment: b1.count(), segmentCount: b2.count(), anchors: b2.anchors },
  { id: "notes", startSegment: b1.count() + b2.count(), segmentCount: b3.count(), anchors: b3.anchors },
];

const contents: ContentsItem[] = [
  { id: "n0", title: "Chapter One · Εἰς τὸ ὄνομα", target: { kind: "segment", position: 0 }, children: [] },
  { id: "n1", title: "Chapter Two", target: { kind: "segment", position: b1.count() }, children: [] },
];

export const DOCX_PARTS = { d0: b1.count(), d1: b2.count(), notes: b3.count() };

export const FORMATTED_DOCX: SourceFixture = {
  title: "A Formatted Document",
  format: "docx",
  language: "English",
  segments: [...b1.segments, ...b2.segments, ...b3.segments].map((s) => ({ text: s.text, sectionPath: s.section || undefined })),
  contents,
  formatted: {
    kind: "docx",
    structure,
    items: { d0: item("d0", one), d1: item("d1", two, 1), notes: item("notes", notes) },
  },
};
