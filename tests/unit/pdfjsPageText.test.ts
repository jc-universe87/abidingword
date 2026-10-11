import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPageText, rangeParts, toPageTextItems } from "@/lib/pdfPageText";

// Regression cover for the interactive Original PDF (v0.13) against the real, pinned
// PDF.js: the text content it reports for a page, turned into the page-text map.
// The PDF is written here, by hand; its text is invented.

/** A one-page A4 PDF drawing the given content stream with Helvetica as /F1. */
function pdf(content: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

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
      pdf(
        [
          "BT /F1 9 Tf 72 820 Td (A RUNNING HEADER) Tj ET",
          "BT /F1 11 Tf 72 700 Td (Abide in me; see John 15:4 for this.) Tj ET",
          "BT /F1 11 Tf 0 1 -1 0 40 300 Tm (Sideways John 3:16) Tj ET",
        ].join("\n"),
      ),
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
    const { map } = await pageText(pdf("0 0 1 rg 72 72 200 200 re f"));
    expect(map.hasText).toBe(false);
  });
});
