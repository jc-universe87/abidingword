// Writes src-tauri/src/scripture/verse_counts.rs: the verses of every chapter
// of the 66-book canon, for validating typed references (v0.18.3).
//
// Source: the English versification systems of the OpenBible.info Bible
// Passage Reference Parser (npm `bible-passage-reference-parser`, MIT,
// © Stephen Smith) — "default" and its Protestant variants "kjv", "csb",
// "nlt", "nrsv". Per chapter the LARGEST count across them is kept, so a
// reference valid in any of these English traditions is never refused
// (they differ only at 2 Corinthians 13, Revelation 12 and 3 John).
// Catholic/Vulgate systems are not used: their book and chapter structure
// differs from this app's canon.
//
// Usage: node scripts/scripture/build_verse_counts.mjs <package>/esm/lang/en.js
// then `cargo fmt` in src-tauri/ (the checked-in file is rustfmt-formatted;
// `cargo fmt -- --check` fails until it is).
import fs from "node:fs";

const source = fs.readFileSync(process.argv[2], "utf8");
const start = source.indexOf("this.systems = {");
let depth = 0;
let at = source.indexOf("{", start);
const open = at;
for (; at < source.length; at++) {
  if (source[at] === "{") depth++;
  else if (source[at] === "}" && --depth === 0) break;
}
// The literal is plain data (numbers, strings, nested objects).
const systems = Function(`return ${source.slice(open, at + 1)}`)();
const base = systems.default.chapters;
const variants = ["kjv", "csb", "nlt", "nrsv"].map((name) => systems[name].chapters);

const OSIS_TO_USFM = {
  Gen: "GEN", Exod: "EXO", Lev: "LEV", Num: "NUM", Deut: "DEU", Josh: "JOS", Judg: "JDG", Ruth: "RUT",
  "1Sam": "1SA", "2Sam": "2SA", "1Kgs": "1KI", "2Kgs": "2KI", "1Chr": "1CH", "2Chr": "2CH", Ezra: "EZR",
  Neh: "NEH", Esth: "EST", Job: "JOB", Ps: "PSA", Prov: "PRO", Eccl: "ECC", Song: "SNG", Isa: "ISA",
  Jer: "JER", Lam: "LAM", Ezek: "EZK", Dan: "DAN", Hos: "HOS", Joel: "JOL", Amos: "AMO", Obad: "OBA",
  Jonah: "JON", Mic: "MIC", Nah: "NAM", Hab: "HAB", Zeph: "ZEP", Hag: "HAG", Zech: "ZEC", Mal: "MAL",
  Matt: "MAT", Mark: "MRK", Luke: "LUK", John: "JHN", Acts: "ACT", Rom: "ROM", "1Cor": "1CO", "2Cor": "2CO",
  Gal: "GAL", Eph: "EPH", Phil: "PHP", Col: "COL", "1Thess": "1TH", "2Thess": "2TH", "1Tim": "1TI",
  "2Tim": "2TI", Titus: "TIT", Phlm: "PHM", Heb: "HEB", Jas: "JAS", "1Pet": "1PE", "2Pet": "2PE",
  "1John": "1JN", "2John": "2JN", "3John": "3JN", Jude: "JUD", Rev: "REV",
};

const rows = Object.entries(OSIS_TO_USFM).map(([osis, code]) => {
  const counts = base[osis].map((n, i) => Math.max(n, ...variants.map((v) => v[osis]?.[i] ?? 0)));
  return `    ("${code}", &[${counts.join(", ")}]),`;
});
if (rows.length !== 66) throw new Error(`expected 66 books, got ${rows.length}`);

const out = `//! Verses per chapter of the 66-book canon (generated; do not edit).
//!
//! Written by \`scripts/scripture/build_verse_counts.mjs\` from the English
//! versification systems of the OpenBible.info Bible Passage Reference Parser
//! (MIT): per chapter, the largest count across its "default", "kjv", "csb",
//! "nlt" and "nrsv" systems, so a reference valid in any of these English
//! Protestant traditions is accepted (2 Corinthians 13: 14, Revelation 12: 18,
//! 3 John: 15). Canon validation, not translation content: an installed
//! Bible may lack a verse that exists here.

/// \`(book code, verses of chapter 1, 2, …)\`, in canon order.
pub const VERSE_COUNTS: &[(&str, &[u16])] = &[
${rows.join("\n")}
];
`;
fs.writeFileSync("src-tauri/src/scripture/verse_counts.rs", out);
console.log("wrote", rows.length, "books");
