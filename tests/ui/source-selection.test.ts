import { describe, expect, it } from "vitest";
import { selectionFromRange, wholeParagraph, type StoredText } from "@/features/library/annotations/sourceSelection";

// Paragraphs as the Reading view draws them: one [data-segment-id] each, with
// links, marks and buttons inside; buttons that are not text carry data-aw-skip.
function page(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

function storedFrom(texts: Record<string, StoredText>) {
  return (id: string) => texts[id];
}

/** A range from (element, character offset in its own text) to another. */
function rangeIn(start: [Element, number], end: [Element, number]): Range {
  const at = ([element, offset]: [Element, number]): [Node, number] => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("[data-aw-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let left = offset;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (left <= length) return [node, left];
      left -= length;
    }
    throw new Error("beyond");
  };
  const range = document.createRange();
  range.setStart(...at(start));
  range.setEnd(...at(end));
  return range;
}

describe("selection anchors in the stored text of a source", () => {
  it("counts UTF-16 units, Korean and characters outside the BMP alike", () => {
    const text = "𝔊𝔬𝔡 요한복음 15장: 내 안에 거하라.";
    const root = page(`<p data-segment-id="a">${text}</p>`);
    const p = root.querySelector("p")!;
    const from = text.indexOf("내");
    const selection = selectionFromRange(rangeIn([p, from], [p, from + "내 안에".length]), root, storedFrom({ a: { position: 0, text } }))!;
    expect(selection.quote).toBe("내 안에");
    expect(selection.start).toEqual({ segmentId: "a", offset: from });
    expect(from).toBe(text.indexOf("내")); // three Fraktur letters: six units
  });

  it("never counts a mark's button or an open menu inside the paragraph", () => {
    const text = "See John 15:4 for this.";
    const root = page(
      `<p data-segment-id="a">See <span><button>John 15:4</button><span role="menu" data-aw-skip=""><button>Open in Bible</button></span></span> for this.<button data-aw-skip="">1 mark</button></p>`,
    );
    const p = root.querySelector("p")!;
    const from = text.indexOf("for");
    const selection = selectionFromRange(rangeIn([p, from], [p, text.length]), root, storedFrom({ a: { position: 0, text } }))!;
    expect(selection.quote).toBe("for this.");
    expect(selection.start.offset).toBe(from);
    expect(selection.end.offset).toBe(text.length);
  });

  it("joins paragraphs with one line break and covers inner ones whole", () => {
    const root = page(`<p data-segment-id="a">One two.</p><p data-page-marker>p. 2</p><p data-segment-id="b">Three.</p><p data-segment-id="c">Four five.</p>`);
    const [a, , , c] = [...root.children];
    const stored = storedFrom({ a: { position: 4, text: "One two." }, b: { position: 5, text: "Three." }, c: { position: 6, text: "Four five." } });
    const selection = selectionFromRange(rangeIn([a!, 4], [c!, 4]), root, stored)!;
    expect(selection.quote).toBe("two.\nThree.\nFour");
    expect(selection.start).toEqual({ segmentId: "a", offset: 4 });
    expect(selection.end).toEqual({ segmentId: "c", offset: 4 });
    expect([selection.firstPosition, selection.lastPosition]).toEqual([4, 6]);
  });

  it("leaves out spaces at either end and never splits a surrogate pair", () => {
    const text = "  a 𝔊b  ";
    const root = page(`<p data-segment-id="a">${text}</p>`);
    const p = root.querySelector("p")!;
    // From inside the leading spaces to between the halves of 𝔊.
    const range = document.createRange();
    range.setStart(p.firstChild!, 1);
    range.setEnd(p.firstChild!, 5);
    const selection = selectionFromRange(range, root, storedFrom({ a: { position: 0, text } }))!;
    expect(selection.quote).toBe("a 𝔊");
    expect(selection.start.offset).toBe(2);
    expect(selection.end.offset).toBe(6);
  });

  it("marks nothing when the drawn text is not the stored text, or paragraphs do not follow on", () => {
    const root = page(`<p data-segment-id="a">Drawn differently.</p><p data-segment-id="b">Second.</p>`);
    const p = root.querySelector("p")!;
    expect(selectionFromRange(rangeIn([p, 0], [p, 5]), root, storedFrom({ a: { position: 0, text: "Stored text." } }))).toBeNull();
    const [a, b] = [...root.children];
    const gap = storedFrom({ a: { position: 0, text: "Drawn differently." }, b: { position: 7, text: "Second." } });
    expect(selectionFromRange(rangeIn([a!, 0], [b!, 3]), root, gap)).toBeNull();
    // Only spaces selected: nothing to mark.
    const spaces = page(`<p data-segment-id="s">a   b</p>`);
    const sp = spaces.querySelector("p")!;
    expect(selectionFromRange(rangeIn([sp, 1], [sp, 4]), spaces, storedFrom({ s: { position: 0, text: "a   b" } }))).toBeNull();
  });

  it("selects a whole paragraph for the keyboard path", () => {
    expect(wholeParagraph("a", { position: 3, text: " Abide in me. " })).toMatchObject({ quote: "Abide in me.", start: { offset: 1 }, end: { offset: 13 } });
    expect(wholeParagraph("a", { position: 3, text: "   " })).toBeNull();
  });
});
