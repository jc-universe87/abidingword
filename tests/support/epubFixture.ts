import type { EpubElement, EpubItem, EpubNode, EpubStructureItem } from "@/types/library";
import type { SourceFixture } from "./memoryApi";

// A small invented book, as the core would hand it to the interface: three
// reading-order documents (two chapters and the notes), with every kind of
// element the formatted view supports. No real text.

const el = (t: string, c: EpubNode[] = [], a: Record<string, string> = {}, l?: { item: string; id?: string }): EpubElement => ({ t, ...(Object.keys(a).length ? { a } : {}), ...(c.length ? { c } : {}), ...(l ? { l } : {}) });

/** A 1 x 1 transparent PNG. */
export const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const c1: EpubItem = {
  id: "c1",
  css: ".note { color: #333; } .lead { text-indent: 1.5em; }",
  root: { class: "book" },
  missingImages: 0,
  nodes: [
    el("h1", ["Chapter One · Εἰς τὸ ὄνομα"], { id: "top" }),
    el("p", ["First paragraph with a ", el("strong", ["bold"]), " word, ", el("em", ["italic"]), " too, and a note", el("a", ["1"], { id: "r1", role: "doc-noteref" }, { item: "nt", id: "fn1" }), "."], { class: "lead" }),
    el("p", ["Jump to ", el("a", ["chapter two"], {}, { item: "c2", id: "sec" }), " or ", el("a", ["the middle"], {}, { item: "c1", id: "mid" }), "."]),
    el("blockquote", [el("p", ["A quotation."])]),
    el("ol", [el("li", ["One"]), el("li", ["Two", el("ul", [el("li", ["Nested", el("ul", [el("li", ["Deep"])])])])])], { start: "3" }),
    el("table", [el("caption", ["Cap"]), el("thead", [el("tr", [el("th", ["Head"], { scope: "col" })])]), el("tbody", [el("tr", [el("td", ["Cell"])])])]),
    el("figure", [el("img", [], { src: PIXEL, alt: "A small picture" }), el("figcaption", ["Caption"])]),
    el("p", ["The middle paragraph."], { id: "mid" }),
  ],
};

const c2: EpubItem = {
  id: "c2",
  css: "",
  root: {},
  missingImages: 1,
  nodes: [
    el("h2", ["Chapter Two"], { id: "sec" }),
    el("p", ["Back to ", el("a", ["the marker"], {}, { item: "c1", id: "r1" }), "."]),
    el("p", [el("span", ["a picture"], { class: "aw-missing-image" })], { id: "deep" }),
  ],
};

const nt: EpubItem = {
  id: "nt",
  css: "",
  root: {},
  missingImages: 0,
  nodes: [el("h1", ["Notes"]), el("ol", [el("li", ["First note. ", el("a", ["↩"], { role: "doc-backlink" }, { item: "c1", id: "r1" })], { id: "fn1" }), el("li", ["Second note."], { id: "fn2" })])],
};

const structure: EpubStructureItem[] = [
  { id: "c1", startSegment: 0, segmentCount: 4, anchors: { top: 0, r1: 0, mid: 3 } },
  { id: "c2", startSegment: 4, segmentCount: 2, anchors: { sec: 4, deep: 5 } },
  { id: "nt", startSegment: 6, segmentCount: 2, anchors: { fn1: 6, fn2: 7 } },
];

export const FORMATTED_BOOK: SourceFixture = {
  title: "A Formatted Book",
  format: "epub",
  language: "English",
  segments: [
    { text: "First paragraph with a bold word, italic too, and a note1.", sectionPath: "Chapter One" },
    { text: "Jump to chapter two or the middle.", sectionPath: "Chapter One" },
    { text: "A quotation.", sectionPath: "Chapter One" },
    { text: "The middle paragraph.", sectionPath: "Chapter One" },
    { text: "Back to the marker.", sectionPath: "Chapter Two" },
    { text: "More of chapter two.", sectionPath: "Chapter Two" },
    { text: "First note.", sectionPath: "Notes" },
    { text: "Second note.", sectionPath: "Notes" },
  ],
  contents: [
    { id: "n0", title: "Chapter One", target: { kind: "segment", position: 0 }, children: [] },
    { id: "n1", title: "Chapter Two", target: { kind: "segment", position: 4 }, children: [] },
    { id: "n2", title: "Notes", target: { kind: "segment", position: 6 }, children: [] },
  ],
  links: [{ position: 0, start: 52, end: 57, target: 6 }],
  formatted: { structure, items: { c1, c2, nt } },
};
