import { describe, expect, it } from "vitest";
import { buildPageText, offsetInLayer } from "@/lib/pdfPageText";
import { foldForMatch, pageToStored, placeSegments, storedToPage, type PageSegment } from "@/lib/pdfTextMatch";
import { textItem } from "../support/fakePdfEngine";

// A drawn page (PDF.js items) and the stored paragraphs of that page, as the import made them.
const drawn = "Chapter 3\nAbide in me, and I in you. As the branch can-\nnot bear fruit by it-\nself, neither can you.\nThe ﬁrst fruit is love.\n12\n";
const stored: PageSegment[] = [
  { segmentId: "a", position: 10, text: "Abide in me, and I in you. As the branch cannot bear fruit by itself, neither can you." },
  { segmentId: "b", position: 11, text: "The first fruit is love." },
];

describe("placing stored text on a drawn PDF page", () => {
  it("folds both sides alike: spaces, line-end hyphens before lower case, ligatures, case and accents", () => {
    expect(foldForMatch("by it-\nself", true).folded).toBe("byitself");
    expect(foldForMatch("well-\nKnown", true).folded).toBe("well-known");
    expect(foldForMatch("ﬁrst Élan").folded).toBe("firstelan");
    expect(foldForMatch("요한복음 15장").folded).toBe("요한복음15장");
  });

  it("maps stored words to the drawn text and drawn words back to the stored text", () => {
    const placement = placeSegments(drawn, stored);
    expect(placement.placed.map((p) => p.segmentId)).toEqual(["a", "b"]);
    const from = stored[0]!.text.indexOf("bear fruit");
    const range = storedToPage(placement, "a", from, from + "bear fruit".length)!;
    expect(drawn.slice(...range)).toBe("bear fruit");
    // Across the broken word: the drawn range runs over the hyphen and line break.
    const itself = stored[0]!.text.indexOf("itself");
    const across = storedToPage(placement, "a", itself, itself + 6)!;
    expect(drawn.slice(...across)).toBe("it-\nself");
    // The ligature is one drawn character for two stored ones.
    const first = stored[1]!.text.indexOf("first");
    expect(drawn.slice(...storedToPage(placement, "b", first, first + 5)!)).toBe("ﬁrst");

    // And back: a drawn selection becomes stored offsets and the stored quote.
    const back = pageToStored(placement, drawn.indexOf("it-"), drawn.indexOf("self,") + 4)!;
    expect(back.quote).toBe("itself");
    expect(back.start).toEqual({ segmentId: "a", offset: itself });
    // Across two paragraphs: one quote, joined with a line break.
    const two = pageToStored(placement, drawn.indexOf("neither"), drawn.indexOf("ﬁrst") + "ﬁrst".length)!;
    expect(two.quote).toBe("neither can you.\nThe first");
  });

  it("never anchors text that is not a placed paragraph (a running header, a page number)", () => {
    const placement = placeSegments(drawn, stored);
    expect(pageToStored(placement, 0, "Chapter 3".length)).toBeNull();
    expect(pageToStored(placement, drawn.indexOf("Chapter"), drawn.indexOf("me,"))).toBeNull();
    expect(pageToStored(placement, drawn.indexOf("12"), drawn.length)).toBeNull();
  });

  it("leaves a paragraph unplaced when its text occurs twice or not at all, rather than guess", () => {
    const twice = "Grace and peace.\nGrace and peace.\n";
    expect(placeSegments(twice, [{ segmentId: "x", position: 0, text: "Grace and peace." }]).placed).toEqual([]);
    expect(placeSegments(drawn, [{ segmentId: "y", position: 0, text: "Words that are not on this page." }]).placed).toEqual([]);
    expect(storedToPage(placeSegments(twice, [{ segmentId: "x", position: 0, text: "Grace and peace." }]), "x", 0, 5)).toBeNull();
  });

  it("works with Korean and characters outside the BMP", () => {
    const page = "요한복음 15장 4절:\n내 안에 거하라 𝔊.\n";
    const placement = placeSegments(page, [{ segmentId: "k", position: 0, text: "요한복음 15장 4절: 내 안에 거하라 𝔊." }]);
    const text = "요한복음 15장 4절: 내 안에 거하라 𝔊.";
    const from = text.indexOf("거하라");
    expect(page.slice(...storedToPage(placement, "k", from, from + 3)!)).toBe("거하라");
    const g = text.indexOf("𝔊");
    expect(page.slice(...storedToPage(placement, "k", g, g + 2)!)).toBe("𝔊");
  });
});

describe("selection ends in a drawn text layer", () => {
  it("are offsets of the page text, between spans counting as the next span's start", () => {
    const items = [textItem("Abide in me,"), textItem("and I in you.")];
    const map = buildPageText(items);
    const container = document.createElement("div");
    const spans = items.map((item) => {
      const span = document.createElement("span");
      span.textContent = item.str;
      container.append(span, document.createElement("br"));
      return span;
    });
    document.body.replaceChildren(container);
    expect(offsetInLayer(container, spans, map, spans[1]!.firstChild!, 4)).toBe(map.starts[1]! + 4);
    expect(map.text.slice(offsetInLayer(container, spans, map, spans[0]!.firstChild!, 6)!)).toMatch(/^in me,/);
    // The point between the first line's break and the second span.
    expect(offsetInLayer(container, spans, map, container, 2)).toBe(map.starts[1]);
    expect(offsetInLayer(container, spans, map, document.body, 0)).toBeNull();
  });
});
