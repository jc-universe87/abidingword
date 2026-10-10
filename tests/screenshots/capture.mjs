// Captures the user guide's screenshots from the real interface (see main.tsx).
//
//   node tests/screenshots/web-text.mjs <data>/web.json
//   SCREENSHOT_DATA=<data> npx vite --config tests/screenshots/vite.config.ts   # leave running
//   node tests/screenshots/capture.mjs [scene …]                                # all scenes by default
//
// Needs Playwright with a Chromium (`npm i --no-save playwright` once, or set
// PLAYWRIGHT_MODULE to an installed copy, and CHROMIUM_PATH if its browser is
// elsewhere). Images are written to docs/guide/images/.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const BASE = process.env.SCREENSHOT_URL ?? "http://localhost:1430/tests/screenshots/index.html";
const OUT = new URL("../../docs/guide/images/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/** Opens the app with the sample library; `query` adds harness options (theme, lang, passage). */
async function open(query = "", { width = 1440, height = 900, scale = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.goto(`${BASE}${query ? `?${query}` : ""}`);
  await page.getByRole("main").first().waitFor();
  await page.waitForTimeout(800);
  return page;
}
const shot = async (page, name, target) => {
  await page.waitForTimeout(500);
  await (target ?? page).screenshot({ path: `${OUT}${name}.png`, animations: "disabled" });
  console.log(`  ${name}.png`);
};
const scripture = (page) => page.getByRole("complementary", { name: "Scripture" });
const sources = (page) => page.getByRole("complementary", { name: "Sources" });
const openStudy = async (page, title = "Abiding in the Vine") => {
  await page.getByRole("main").getByRole("button", { name: new RegExp(`^${title}`) }).first().click();
  await page.waitForTimeout(700);
};
const openSource = async (page, title) => {
  await sources(page).getByRole("button", { name: new RegExp(`^${title}`) }).first().click();
  await page.waitForTimeout(700);
};

const scenes = {
  async workspace() {
    const page = await open();
    await openStudy(page);
    await shot(page, "workspace");
    await page.close();
  },
  async "workspace-dark"() {
    const page = await open("theme=dark");
    await openStudy(page);
    await shot(page, "workspace-dark");
    await page.close();
  },
  async projects() {
    const page = await open();
    await shot(page, "projects", page.getByRole("main"));
    await page.close();
  },
  async "scripture-pane"() {
    const page = await open("scriptureWidth=420", { width: 1600, height: 1000 });
    await shot(page, "scripture-pane", scripture(page));
    await page.close();
  },
  async marks() {
    const page = await open("scriptureWidth=420", { width: 1600, height: 1000 });
    await scripture(page).getByRole("button", { name: "Marks", exact: true }).click();
    await shot(page, "marks", scripture(page));
    await page.close();
  },
  async concordance() {
    const page = await open("scriptureWidth=420", { width: 1600, height: 1000 });
    await scripture(page).getByRole("button", { name: "Concordance", exact: true }).click();
    await scripture(page).getByRole("textbox", { name: "Word" }).fill("remain");
    await scripture(page).getByRole("textbox", { name: "Word" }).press("Enter");
    await page.waitForTimeout(800);
    await shot(page, "concordance", scripture(page));
    await page.close();
  },
  async study() {
    const page = await open("", { height: 1000 });
    await openStudy(page);
    await shot(page, "study", page.getByRole("main"));
    await page.close();
  },
  async "source-reading"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openSource(page, "Notes on Abiding");
    await shot(page, "source-reading", sources(page));
    await page.close();
  },
  async "scripture-link"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openSource(page, "Andachten zum Johannesevangelium");
    await sources(page).getByRole("button", { name: "Malachi 4:3 (Scripture reference)" }).click();
    await shot(page, "scripture-link", sources(page));
    await page.close();
  },
  async search() {
    const page = await open();
    await page.getByRole("combobox", { name: /Search in/ }).selectOption({ label: "Library" });
    const box = page.getByRole("searchbox").first();
    await box.fill("remain");
    await box.press("Enter");
    await page.waitForTimeout(800);
    await shot(page, "search");
    await page.close();
  },
  async settings() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(600);
    await shot(page, "settings");
    await page.close();
  },
  async "german-ui"() {
    const page = await open("lang=de&scriptureWidth=340");
    await openStudy(page);
    await shot(page, "german-ui");
    await page.close();
  },
};

Object.assign(scenes, {
  async "first-start"() {
    const page = await open("empty=1");
    await shot(page, "first-start");
    await page.close();
  },
  async "add-bible"() {
    const page = await open("empty=1");
    await page.getByRole("button", { name: "Add a Bible…" }).first().click();
    await page.waitForTimeout(800);
    await shot(page, "add-bible");
    await page.close();
  },
  async "add-bible-confirm"() {
    const page = await open("empty=1");
    await page.getByRole("button", { name: "Add a Bible…" }).first().click();
    await page.getByRole("combobox", { name: "Choose a Bible" }).selectOption({ label: "Berean Standard Bible (BSB)" });
    await page.getByRole("button", { name: "Add…" }).click();
    await page.getByRole("dialog").waitFor();
    await shot(page, "add-bible-confirm");
    await page.close();
  },
  async findings() {
    const page = await open("", { height: 1000 });
    await openStudy(page);
    const section = page.getByRole("main").locator("section", { has: page.getByRole("heading", { name: "Observations", exact: true }) }).first();
    await section.scrollIntoViewIfNeeded();
    await shot(page, "findings", section);
    await page.close();
  },
  async "add-menu"() {
    const page = await open();
    await openStudy(page);
    await page.getByRole("main").getByRole("button", { name: "Add", exact: true }).first().click();
    await shot(page, "add-menu", page.getByRole("main"));
    await page.close();
  },
  async "new-study"() {
    const page = await open();
    await page.getByRole("main").getByRole("button", { name: "New study" }).first().click();
    await shot(page, "new-study", page.getByRole("main"));
    await page.close();
  },
  async highlights() {
    const page = await open("scriptureWidth=440", { width: 1600, height: 1000 });
    await scripture(page).getByRole("button", { name: /^Verse 9\b/ }).first().scrollIntoViewIfNeeded();
    await shot(page, "highlights", scripture(page));
    await page.close();
  },
  async "verse-tools"() {
    const page = await open("scriptureWidth=440", { width: 1600, height: 1000 });
    const verse = scripture(page).getByRole("button", { name: /^Verse 7\b/ }).first();
    await verse.scrollIntoViewIfNeeded();
    await verse.click();
    await page.waitForTimeout(500);
    await scripture(page).getByText("Tools for verse 7").scrollIntoViewIfNeeded();
    await shot(page, "verse-tools", scripture(page));
    await page.close();
  },
  async "back-to-study"() {
    const page = await open();
    await openStudy(page);
    await openSource(page, "Notes on Abiding");
    await sources(page).getByRole("button", { name: "Romans 8:1 (Scripture reference)" }).click();
    await sources(page).getByRole("menuitem", { name: "Open in Bible" }).click();
    await page.waitForTimeout(700);
    await shot(page, "back-to-study");
    await page.close();
  },
  async "add-source"() {
    const page = await open();
    await page.evaluate(() => {
      window.api.state.library.nextChosenFile = "C:/Users/You/Documents/Bible study handbook.pdf";
    });
    await page.getByRole("combobox", { name: /Search in/ }).selectOption({ label: "Library" });
    await page.getByRole("searchbox").first().press("Enter");
    await page.getByRole("button", { name: "Add to library…" }).click();
    await page.getByRole("button", { name: "Choose a file…" }).click();
    await page.waitForTimeout(900);
    await shot(page, "add-source");
    await page.close();
  },
  async "bible-texts"() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    const heading = page.getByRole("heading", { name: "Bible Texts" });
    await heading.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -40));
    await shot(page, "bible-texts", page.locator("section", { has: heading }).first());
    await page.close();
  },
  async updates() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    const heading = page.getByRole("heading", { name: "Updates" });
    await heading.scrollIntoViewIfNeeded();
    await shot(page, "updates", page.locator("section", { has: heading }).first());
    await page.close();
  },
  async "pane-sources-wide"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openStudy(page);
    await shot(page, "sources", sources(page));
    await page.close();
  },
});

const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(scenes)) {
  if (wanted.length && !wanted.includes(name)) continue;
  try {
    await run();
  } catch (error) {
    console.error(`  ${name}: ${error.message.split("\n")[0]}`);
    process.exitCode = 1;
  }
}
await browser.close();
