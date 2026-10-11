import { describe, expect, it } from "vitest";
import { buildPageText, findOnPage, MARGIN, rangeParts, type PageTextItem } from "@/lib/pdfPageText";

// The page-text map of a PDF page (v0.13): the second representation, made from PDF.js's text items.
const item = (str: string, more: Partial<PageTextItem> = {}): PageTextItem => ({ str, hasEOL: false, dir: "ltr", upright: true, top: 0.5, ...more });

describe("the page-text map", () => {
  it("joins the items in drawing order, a line break after each line, and knows where each starts", () => {
    const map = buildPageText([item("Abide in "), item("me", { hasEOL: true }), item(""), item("and I in you.")]);
    expect(map.text).toBe("Abide in me\nand I in you.");
    expect(map.starts).toEqual([0, 9, 12, 12]);
    expect(map.lengths).toEqual([9, 2, 0, 13]);
    expect(map.hasText).toBe(true);
    expect(buildPageText([item(" "), item("", { hasEOL: true })]).hasText).toBe(false);
    expect(buildPageText([]).hasText).toBe(false);
  });

  it("lets only upright, left-to-right text in the body of the page carry a mark", () => {
    const map = buildPageText([
      item("body"),
      item("header", { top: MARGIN / 2 }),
      item("footer", { top: 1 - MARGIN / 2 }),
      item("vertical", { upright: false }),
      item("עברית", { dir: "rtl" }),
      item("縦", { dir: "ttb" }),
    ]);
    expect(map.usable).toEqual([true, false, false, false, false, false]);
  });

  it("maps a range to the pieces of the items it covers, or to nothing if any piece is unusable", () => {
    const map = buildPageText([item("see John "), item("15:4 here", { hasEOL: true }), item("Ps 23", { top: 0.01 })]);
    const start = map.text.indexOf("John");
    expect(rangeParts(map, start, start + "John 15:4".length)).toEqual([
      { item: 0, from: 4, to: 9 },
      { item: 1, from: 0, to: 4 },
    ]);
    const header = map.text.indexOf("Ps 23");
    expect(rangeParts(map, header, header + 5)).toBeNull();
    // the line break belongs to no item
    expect(rangeParts(map, map.text.indexOf("\n"), map.text.indexOf("\n") + 1)).toBeNull();
    expect(rangeParts(map, 3, 3)).toBeNull();
  });

  it("finds a query as the core's find does: case, accents and spacing ignored, exact ranges", () => {
    const text = "Röm 6 and  ROM 8;\nrom x";
    const places = findOnPage(text, "rom");
    expect(places.map(([a, b]) => text.slice(a, b))).toEqual(["Röm", "ROM", "rom"]);
    expect(findOnPage("abide  in\nme", "abide in me").map(([a, b]) => b - a)).toEqual([12]);
    expect(findOnPage("𝔄 λόγος", "λογος").map(([a, b]) => "𝔄 λόγος".slice(a, b))).toEqual(["λόγος"]);
    expect(findOnPage("한 사람", "하")).toEqual([]);
    expect(findOnPage("anything", "  ")).toEqual([]);
  });
});
