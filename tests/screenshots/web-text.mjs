// Extracts the bundled World English Bible (public domain) into the verse
// shape the interface uses, for the documentation screenshots only.
// Usage: node tests/screenshots/web-text.mjs <output.json>
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const ZIP = new URL("../../resources/scripture/engwebp/engwebp_usfm.zip", import.meta.url).pathname;
const out = process.argv[2];
if (!out) throw new Error("usage: node tests/screenshots/web-text.mjs <output.json>");

const files = execFileSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".usfm"));
const chapters = {};
for (const file of files) {
  const usfm = execFileSync("unzip", ["-p", ZIP, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const book = /\\id ([A-Z0-9]{3})/.exec(usfm)?.[1];
  if (!book || ["FRT", "GLO", "BAK", "OTH", "INT", "CNC", "TDX", "XXA"].includes(book)) continue;
  const clean = usfm
    .replace(/\\f .*?\\f\*/gs, "")
    .replace(/\\x .*?\\x\*/gs, "")
    .replace(/\\\+?w ([^|\\]*)\|[^\\]*\\\+?w\*/g, "$1")
    .replace(/^\\(s\d?|ms\d?|mr|r|d|sp|h|toc\d|mt\d?|ide|id|rem|sr|cl)\b.*$/gm, "");
  let chapter = 0;
  for (const part of clean.split(/(?=\\c \d+)|(?=\\v \d+)/)) {
    const c = /^\\c (\d+)/.exec(part);
    if (c) { chapter = Number(c[1]); continue; }
    const v = /^\\v (\d+)(?:-\d+)?\s*([\s\S]*)$/.exec(part);
    if (!v || !chapter) continue;
    const text = v[2].replace(/\\[a-z0-9+]+\*?/g, " ").replace(/\s+/g, " ").replace(/ ([,.;:!?’”])/g, "$1").trim();
    if (!text) continue;
    (chapters[`${book}|${chapter}`] ??= []).push({ canonical: `${book}.${chapter}.${v[1]}`, chapter, verse: Number(v[1]), text });
  }
}
writeFileSync(out, JSON.stringify(chapters));
console.log(`${Object.keys(chapters).length} chapters written to ${out}`);
