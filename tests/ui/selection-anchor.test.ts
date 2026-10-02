import { anchorFromRange, anchorFromSelection } from "@/lib/selectionAnchor";

// Mirrors the reader: verse number, verse text in its own element, marker.
function reader(verses: { verse: string; html: string }[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = verses
    .map(
      ({ verse, html }) =>
        `<div><p><button class="select-none">${verse.split(".")[2]}</button>` +
        `<span data-verse-text="${verse}">${html}</span><span class="marker">✎</span></p></div>`,
    )
    .join("");
  document.body.replaceChildren(root);
  return root;
}

const text = (root: HTMLElement, verse: string) =>
  root.querySelector(`[data-verse-text="${verse}"]`)!.firstChild!;

function range(start: [Node, number], end: [Node, number]): Range {
  const r = document.createRange();
  r.setStart(...start);
  r.setEnd(...end);
  return r;
}

describe("selection → phrase anchor", () => {
  it("anchors part of one verse with UTF-16 offsets", () => {
    const root = reader([{ verse: "JHN.15.4", html: "Remain in me, and I in you." }]);
    const t = text(root, "JHN.15.4");
    const anchor = anchorFromRange(range([t, 0], [t, 12]), root)!;
    expect(anchor.start).toEqual({ verse: "JHN.15.4", offset: 0 });
    expect(anchor.end).toEqual({ verse: "JHN.15.4", offset: 12 });
    expect(anchor.quote).toBe("Remain in me");
  });

  it("spans adjacent verses, joining their parts with one space", () => {
    const root = reader([
      { verse: "JHN.15.4", html: "Remain in me." },
      { verse: "JHN.15.5", html: "I am the vine." },
    ]);
    const anchor = anchorFromRange(range([text(root, "JHN.15.4"), 7], [text(root, "JHN.15.5"), 4]), root)!;
    expect(anchor.parts).toEqual([
      { verse: "JHN.15.4", start: 7, end: 13 },
      { verse: "JHN.15.5", start: 0, end: 4 },
    ]);
    expect(anchor.quote).toBe("in me. I am");
  });

  it("leaves out verse numbers and markers at either end", () => {
    const root = reader([
      { verse: "JHN.15.4", html: "Remain in me." },
      { verse: "JHN.15.5", html: "I am the vine." },
    ]);
    const number5 = root.querySelectorAll("button")[1]!.firstChild!;
    const marker4 = root.querySelectorAll(".marker")[0]!.firstChild!;
    // From inside verse 4 to the marker after it.
    let anchor = anchorFromRange(range([text(root, "JHN.15.4"), 7], [marker4, 1]), root)!;
    expect(anchor.quote).toBe("in me.");
    // From verse 5's number into its text.
    anchor = anchorFromRange(range([number5, 0], [text(root, "JHN.15.5"), 4]), root)!;
    expect(anchor.start).toEqual({ verse: "JHN.15.5", offset: 0 });
    expect(anchor.quote).toBe("I am");
    // A whole paragraph, ending at the start of the next one (triple click).
    const paragraphs = root.querySelectorAll("p");
    anchor = anchorFromRange(range([paragraphs[0]!, 0], [paragraphs[1]!, 0]), root)!;
    expect(anchor.parts).toEqual([{ verse: "JHN.15.4", start: 0, end: 13 }]);
  });

  it("keeps punctuation and non-ASCII text, trims surrounding spaces", () => {
    const root = reader([{ verse: "PSA.23.1", html: "«Yahweh» is my shepherd—I shall lack nothing." }]);
    const t = text(root, "PSA.23.1");
    expect(anchorFromRange(range([t, 0], [t, 8]), root)!.quote).toBe("«Yahweh»");
    const spaced = anchorFromRange(range([t, 8], [t, 12]), root)!;
    expect(spaced.quote).toBe("is");
    expect(spaced.start.offset).toBe(9);
    expect(anchorFromRange(range([t, 14], [t, 25]), root)!.quote).toBe("shepherd—I");
  });

  it("never splits a surrogate pair", () => {
    const root = reader([{ verse: "GEN.1.1", html: "In the beginning 𝔊od created" }]);
    const t = text(root, "GEN.1.1");
    // 17 is the high surrogate of 𝔊; 18 would split the pair.
    const anchor = anchorFromRange(range([t, 18], [t, 21]), root)!;
    expect(anchor.start.offset).toBe(17);
    expect(anchor.quote).toBe("𝔊od");
    const end = anchorFromRange(range([t, 17], [t, 18]), root)!;
    expect(end.end.offset).toBe(19);
    expect(end.quote).toBe("𝔊");
  });

  it("measures offsets however the verse text is split into elements", () => {
    const root = reader([{ verse: "JHN.15.4", html: "Remain <mark>in me</mark>, and I in you." }]);
    const mark = root.querySelector("mark")!.firstChild!;
    const after = root.querySelector("mark")!.nextSibling!;
    const anchor = anchorFromRange(range([mark, 3], [after, 7]), root)!;
    expect(anchor.parts).toEqual([{ verse: "JHN.15.4", start: 10, end: 19 }]);
    expect(anchor.quote).toBe("me, and I");
  });

  it("gives nothing for selections without Scripture text or across chapters", () => {
    const root = reader([
      { verse: "JHN.15.27", html: "You also testify." },
      { verse: "JHN.16.1", html: "I have said these things." },
    ]);
    const numbers = root.querySelectorAll("button");
    expect(anchorFromRange(range([numbers[0]!.firstChild!, 0], [numbers[0]!.firstChild!, 2]), root)).toBeNull();
    const t = text(root, "JHN.15.27");
    expect(anchorFromRange(range([t, 4], [t, 4]), root)).toBeNull();
    expect(anchorFromRange(range([t, 4], [text(root, "JHN.16.1"), 6]), root)).toBeNull();
  });

  it("reads the document selection only inside the reader", () => {
    const root = reader([{ verse: "JHN.15.4", html: "Remain in me." }]);
    const outside = document.createElement("p");
    outside.textContent = "Elsewhere";
    document.body.append(outside);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range([outside.firstChild!, 0], [outside.firstChild!, 4]));
    expect(anchorFromSelection(selection, root)).toBeNull();
    selection.removeAllRanges();
    selection.addRange(range([text(root, "JHN.15.4"), 0], [text(root, "JHN.15.4"), 6]));
    expect(anchorFromSelection(selection, root)!.quote).toBe("Remain");
    selection.removeAllRanges();
    expect(anchorFromSelection(selection, root)).toBeNull();
  });
});
