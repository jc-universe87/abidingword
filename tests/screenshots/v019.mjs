// The v0.19 review set: Study and Teaching with their information panels
// closed and open, a Hauskreis (group Bible study) being written, a new
// Bible Teaching, Settings › Data and backup with the import and restore
// previews, and the example project. Development only.
//
//   node tests/screenshots/v019.mjs <out-dir> [scene …]
// with the harness server running (see capture.mjs). SCREENSHOT_URL points
// at another copy (an older commit, for "before"); V019_LANGS, V019_THEMES
// and V019_WIDTHS choose the runs (default: en, light and dark, 1280;
// then de and ko at 760 for the narrow window).
// Scenes that need v0.19 are skipped on an older copy (BEFORE=1).
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:1430/tests/screenshots/index.html";
const BEFORE = process.env.BEFORE === "1";
const [out, ...only] = process.argv.slice(2);
if (!out) throw new Error("usage: node tests/screenshots/v019.mjs <out-dir> [scene …]");
mkdirSync(out, { recursive: true });

const LOCALES = process.env.V019_LOCALES ?? new URL("../../src/i18n/locales/", import.meta.url).pathname;
const strings = {};
for (const lang of ["en", "de", "ko", "fr", "es", "pt"]) {
  strings[lang] = {};
  for (const file of readdirSync(`${LOCALES}${lang}`)) strings[lang][file.replace(/\.json$/, "")] = JSON.parse(readFileSync(`${LOCALES}${lang}/${file}`, "utf8"));
}
/** A string by "namespace:dotted.key" in a language. */
const s = (lang, key) => {
  const [ns, dotted] = key.split(":");
  return dotted.split(".").reduce((node, part) => node?.[part], strings[lang][ns]) ?? key;
};
const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(run, query = "") {
  const q = [query, `lang=${run.lang}`, run.theme === "dark" ? "theme=dark" : ""].filter(Boolean).join("&");
  const page = await browser.newPage({ viewport: { width: run.width, height: 900 } });
  await page.goto(`${BASE}?${q}`);
  await page.getByRole("main").first().waitFor();
  await page.waitForTimeout(800);
  return page;
}
const shot = async (page, run, name) => {
  await page.waitForTimeout(500);
  await page.mouse.move(1, 1);
  const file = `${out}/${name}-${run.lang}-${run.theme}-${run.width}${BEFORE ? "-before" : ""}.png`;
  await page.screenshot({ path: file, animations: "disabled" });
  console.log(`  ${file}`);
};
const main = (page) => page.getByRole("main").first();
const openStudy = async (page, title = "Abiding in the Vine") => {
  await main(page).getByRole("button", { name: new RegExp(`^${title}`) }).first().click();
  await page.waitForTimeout(800);
};
const openTeaching = async (page, run) => {
  await openStudy(page);
  await main(page).getByRole("button", { name: s(run.lang, "studies:view.teaching"), exact: true }).click();
  await page.waitForTimeout(800);
};
const openSettings = async (page, run, section) => {
  await page.getByRole("button", { name: s(run.lang, "app:toolbar.settings") }).click();
  await page.waitForTimeout(500);
  const title = s(run.lang, `settings:sections.${section}`);
  const region = page.getByRole("region", { name: title });
  await region.getByRole("button", { name: title }).click();
  await region.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  return region;
};

const scenes = {
  async study(run) {
    const page = await open(run);
    await openStudy(page);
    await shot(page, run, "study");
    if (!BEFORE) {
      await main(page).getByRole("button", { name: s(run.lang, "studies:info.study") }).click();
      await shot(page, run, "study-info");
    }
    await page.close();
  },
  async teaching(run) {
    const page = await open(run);
    await openTeaching(page, run);
    await shot(page, run, "teaching");
    if (!BEFORE) {
      await main(page).getByRole("button", { name: s(run.lang, "studies:info.teaching") }).first().click();
      await shot(page, run, "teaching-info");
    }
    await page.close();
  },
  async "new-teaching"(run) {
    const page = await open(run);
    await openTeaching(page, run);
    const name = BEFORE ? s(run.lang, "studies:teaching.another") : s(run.lang, "studies:teaching.newTeaching");
    await main(page).getByRole("button", { name: exact(name) }).first().click();
    await page.waitForTimeout(600);
    await shot(page, run, "new-teaching");
    await page.close();
  },
  async hauskreis(run) {
    if (BEFORE) return;
    const page = await open(run, "sample=1");
    await openStudy(page, "Abiding in the True Vine");
    await main(page).getByRole("button", { name: s(run.lang, "studies:view.teaching"), exact: true }).click();
    await page.waitForTimeout(700);
    const picker = main(page).getByRole("combobox", { name: s(run.lang, "studies:teaching.which") });
    const value = await picker.locator("option", { hasText: "Branches of the True Vine" }).getAttribute("value");
    await picker.selectOption(value);
    await page.waitForTimeout(800);
    await shot(page, run, "hauskreis");
    await page.close();
  },
  async settings(run) {
    const page = await open(run);
    if (BEFORE) {
      await page.getByRole("button", { name: s(run.lang, "app:toolbar.settings") }).click();
      await page.waitForTimeout(600);
      await shot(page, run, "settings");
    } else {
      const region = await openSettings(page, run, "data");
      await shot(page, run, "settings-data");
      await region.getByRole("button", { name: exact(s(run.lang, "settings:data.import")) }).click();
      await page.waitForTimeout(600);
      await region.getByRole("region", { name: s(run.lang, "settings:data.importPreview") }).scrollIntoViewIfNeeded();
      await shot(page, run, "import-preview");
      await region.getByRole("button", { name: exact(s(run.lang, "settings:data.restore")) }).click();
      await page.waitForTimeout(600);
      await region.getByRole("region", { name: s(run.lang, "settings:data.restorePreview") }).scrollIntoViewIfNeeded();
      await shot(page, run, "restore-preview");
    }
    await page.close();
  },
  async sample(run) {
    if (BEFORE) return;
    const page = await open(run, "empty=1&sample=1");
    await openStudy(page, "Abiding in the True Vine");
    await shot(page, run, "sample-study");
    await main(page).getByRole("button", { name: s(run.lang, "studies:view.teaching"), exact: true }).click();
    await page.waitForTimeout(800);
    await shot(page, run, "sample-teaching");
    await page.close();
  },
};

const list = (v, d) => (process.env[v] ? process.env[v].split(",") : d);
const runs = [];
for (const lang of list("V019_LANGS", ["en"])) for (const theme of list("V019_THEMES", ["light", "dark"])) for (const width of list("V019_WIDTHS", ["1280"])) runs.push({ lang, theme, width: Number(width) });
let failed = false;
for (const run of runs)
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await scene(run);
    } catch (e) {
      failed = true;
      console.error(`${name} (${run.lang} ${run.theme} ${run.width}): ${e.message.split("\n")[0]}`);
    }
  }
await browser.close();
process.exitCode = failed ? 1 : 0;
