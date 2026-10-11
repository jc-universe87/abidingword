// A tiny PDF writer for tests and the screenshot harness: A4 pages of
// Helvetica text lines, written by hand. Nothing here ships with the app.

/** One line of text: size in points, baseline `y` up from the bottom of the page, optional rotation. */
export interface PdfLine {
  size: number;
  x?: number;
  y: number;
  text: string;
  /** Draws the line turned a quarter (reading upwards), like a sideways label. */
  sideways?: boolean;
}

/** PDF string escaping, and WinAnsi for the few typographic characters the samples use. */
function literal(text: string): string {
  const winAnsi: Record<string, string> = { "’": "\\222", "“": "\\223", "”": "\\224", "–": "\\226", "—": "\\227" };
  return text.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[’“”–—]/g, (c) => winAnsi[c]!);
}

/** A PDF of the given pages; a page may be a raw content stream instead of lines. */
export function minimalPdf(pages: (PdfLine[] | { raw: string })[]): Uint8Array {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const kids: number[] = [];
  for (const page of pages) {
    const content =
      "raw" in page
        ? page.raw
        : page
            .map((l) =>
              l.sideways
                ? `BT /F1 ${l.size} Tf 0 1 -1 0 ${l.x ?? 72} ${l.y} Tm (${literal(l.text)}) Tj ET`
                : `BT /F1 ${l.size} Tf ${l.x ?? 72} ${l.y} Td (${literal(l.text)}) Tj ET`,
            )
            .join("\n");
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
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
  // Latin-1 bytes: the escapes above keep every character in one byte.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
