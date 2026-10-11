import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPageText, rangeParts, toPageTextItems } from "@/lib/pdfPageText";
import { minimalPdf } from "../support/minimalPdf";

// Regression cover for the interactive Original PDF (v0.13) against the real, pinned
// PDF.js: the text content it reports for a page, turned into the page-text map.
// The PDF is written here, by hand; its text is invented.

async function pageText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes, useWasm: false, useSystemFonts: false });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = toPageTextItems(content as never, page.getViewport({ scale: 1 }));
  await task.destroy();
  return { items, map: buildPageText(items) };
}

describe("PDF.js page text (pinned version)", () => {
  it("is the version the text-layer mapping was checked against", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["pdfjs-dist"]).toBe("6.3.289");
  });

  it("reports items whose map places references exactly, and leaves headers and rotated text unmarkable", async () => {
    const { items, map } = await pageText(
      minimalPdf([
        [
          { size: 9, y: 820, text: "A RUNNING HEADER" },
          { size: 11, y: 700, text: "Abide in me; see John 15:4 for this." },
          { size: 11, x: 40, y: 300, text: "Sideways John 3:16", sideways: true },
        ],
      ]),
    );
    expect(map.text).toContain("Abide in me; see John 15:4 for this.");
    const body = items.findIndex((i) => i.str.includes("John 15:4"));
    const header = items.findIndex((i) => i.str.includes("RUNNING HEADER"));
    const sideways = items.findIndex((i) => i.str.includes("Sideways"));
    expect(items[body]!.top).toBeCloseTo((842 - 700) / 842, 2);
    expect(map.usable[body]).toBe(true);
    expect(map.usable[header]).toBe(false);
    expect(items[sideways]!.upright).toBe(false);
    expect(map.usable[sideways]).toBe(false);
    const start = map.text.indexOf("John 15:4");
    expect(rangeParts(map, start, start + 9)).toEqual([{ item: body, from: items[body]!.str.indexOf("John"), to: items[body]!.str.indexOf("John") + 9 }]);
    const turned = map.text.indexOf("John 3:16");
    expect(rangeParts(map, turned, turned + 9)).toBeNull();
  });

  it("reports no text for a page that draws none", async () => {
    const { map } = await pageText(minimalPdf([{ raw: "0 0 1 rg 72 72 200 200 re f" }]));
    expect(map.hasText).toBe(false);
  });
});
