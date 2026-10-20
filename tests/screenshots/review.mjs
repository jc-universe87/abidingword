// The v0.18.5 visual-system review set: capture.mjs's review scenes ("r-…")
// in Light and Dark at 980 and 1440 px, and the dense ones in German and
// Korean at 980 px. Development only; nothing here ships with the app.
//
//   node tests/screenshots/review.mjs <out-dir> [scene …]
// with the harness server running (see capture.mjs); SCREENSHOT_URL points
// at another copy of it (for before/after comparisons from an older commit).
// REVIEW_WIDTHS=1100,1280,1600,1920 captures Light only at those widths instead
// (the width pass; at 1100 and 1280 all three panes are open, the constrained
// arrangement).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node tests/screenshots/review.mjs <out-dir> [scene …]");
mkdirSync(out, { recursive: true });
const capture = fileURLToPath(new URL("./capture.mjs", import.meta.url));
const ALL = ["r-workspace", "r-study-deep", "r-teaching", "r-library", "r-reader", "r-reader-pdf", "r-settings", "r-settings-assistant", "r-presentation", "r-presenter", "r-template-import", "r-template-designer", "r-dialog"];
/** Scenes whose navigation uses only translated words (see WORDS in capture.mjs). */
const LANGUAGE_SCENES = ["r-workspace", "r-study-deep", "r-teaching", "r-library", "r-settings"];
const pick = (list) => (only.length ? list.filter((s) => only.includes(s)) : list);

const runs = [];
const widths = (process.env.REVIEW_WIDTHS ?? "").split(",").map(Number).filter(Boolean);
if (widths.length) for (const width of widths) runs.push({ theme: "light", width, lang: "", scenes: pick(ALL) });
else {
  for (const theme of ["light", "dark"]) for (const width of [980, 1440]) runs.push({ theme, width, lang: "", scenes: pick(ALL) });
  for (const lang of ["de", "ko"]) runs.push({ theme: "light", width: 980, lang, scenes: pick(LANGUAGE_SCENES) });
}
let failed = false;
for (const run of runs) {
  if (!run.scenes.length) continue;
  const suffix = `-${run.lang ? `${run.lang}-` : ""}${run.theme}-${run.width}`;
  const result = spawnSync(process.execPath, [capture, ...run.scenes], {
    stdio: "inherit",
    env: { ...process.env, SCREENSHOT_OUT: out, REVIEW_THEME: run.theme === "dark" ? "dark" : "", REVIEW_LANG: run.lang, REVIEW_WIDTH: String(run.width), REVIEW_SUFFIX: suffix },
  });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
