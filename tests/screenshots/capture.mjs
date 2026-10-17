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

const openTeaching = async (page) => {
  await openStudy(page);
  await page.getByRole("main").getByRole("button", { name: "Bible Teaching", exact: true }).click();
  await page.waitForTimeout(800);
};

const scenes = {
  async teaching() {
    const page = await open("", { width: 1440, height: 1500 });
    await openTeaching(page);
    await shot(page, "teaching");
    await page.close();
  },
  async "teaching-help"() {
    const page = await open("", { width: 1440, height: 1000 });
    await openTeaching(page);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "AI Help with Introduction" }).click();
    await main.getByRole("menuitem", { name: "Improve my wording" }).click();
    await main.getByRole("menuitem", { name: "Make it sound natural" }).click();
    const panel = page.getByTestId("assist-panel");
    await panel.getByRole("button", { name: "Ask" }).click();
    await panel.getByRole("heading", { name: "Suggested wording" }).waitFor();
    // The whole window: the panel floats over the workspace, the teaching stays where it was.
    await shot(page, "teaching-help");
    await page.close();
  },
  async "teaching-menu"() {
    const page = await open("", { width: 1440, height: 1400 });
    await openTeaching(page);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "AI Help with Introduction" }).click();
    const menu = main.getByRole("menu");
    await menu.waitFor();
    const box = await menu.boundingBox();
    await shot(page, "teaching-menu", { screenshot: (o) => page.screenshot({ ...o, clip: { x: box.x - 420, y: box.y - 90, width: box.width + 440, height: box.height + 110 } }) });
    await page.close();
  },
  async appearance() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    const section = page.getByRole("region", { name: "Appearance" });
    await section.getByRole("button", { name: "Appearance" }).click();
    await section.getByRole("radio", { name: "Sage" }).check({ force: true });
    await page.waitForTimeout(400);
    await shot(page, "appearance", section);
    await page.close();
  },
  async "add-bible-sheet"() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    const section = page.getByRole("region", { name: "Bible texts" });
    await section.getByRole("button", { name: "Bible texts" }).click();
    await section.getByRole("button", { name: "Add a Bible…" }).click();
    await page.getByRole("dialog", { name: "Add a Bible" }).waitFor();
    await shot(page, "add-bible-sheet");
    await page.close();
  },
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
    await page.getByRole("dialog", { name: /^Add Berean/ }).waitFor();
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
    const section = page.getByRole("region", { name: "Bible texts" });
    await section.getByRole("button", { name: "Bible texts" }).click();
    await page.waitForTimeout(400);
    await shot(page, "bible-texts", section);
    await page.close();
  },
  async updates() {
    const page = await open();
    await page.getByRole("button", { name: "Settings" }).click();
    const section = page.getByRole("region", { name: "Updates" });
    await section.getByRole("button", { name: "Updates" }).click();
    await page.waitForTimeout(400);
    await shot(page, "updates", section);
    await page.close();
  },
  async "settings-assistant"() {
    const page = await open("", { width: 1440, height: 2600 });
    await page.getByRole("button", { name: "Settings" }).click();
    const section = page.getByRole("region", { name: "AI Assistant" });
    await section.getByRole("button", { name: "AI Assistant" }).click();
    await section.getByText("How do I get a key?").click();
    await page.waitForTimeout(400);
    await shot(page, "settings-assistant", section);
    await page.close();
  },
  async "pdf-original"() {
    const page = await open("sourcesWidth=440", { width: 1440, height: 1000 });
    await page.getByRole("combobox", { name: /Search in/ }).selectOption({ label: "Library" });
    await page.getByRole("searchbox").first().press("Enter");
    await page.getByRole("button", { name: /A Short Guide to Bible Study/ }).first().click();
    await page.getByRole("button", { name: "Original" }).click();
    await page.getByRole("button", { name: "Open full reader" }).click();
    const ref = page.locator("[data-pdf-reference] button").first();
    await ref.waitFor();
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(1200);
    await ref.scrollIntoViewIfNeeded();
    await ref.click();
    await shot(page, "pdf-original");
    await page.close();
  },
  async "source-marks"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openSource(page, "Notes on Abiding");
    await sources(page).getByRole("button", { name: /mark here: Note/ }).click();
    await page.waitForTimeout(500);
    await shot(page, "source-marks", sources(page));
    await page.close();
  },
  async "source-selection"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openSource(page, "Notes on Abiding");
    // Select words as a reader would, then wait for the small bar.
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("[data-segment-id]")].find((el) => el.textContent?.includes("Galatians"));
      if (!p) return;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes("love, joy, peace")) node = walker.nextNode();
      if (!node) return;
      const text = node.textContent ?? "";
      const range = document.createRange();
      range.setStart(node, text.indexOf("love, joy, peace"));
      range.setEnd(node, text.indexOf("love, joy, peace") + "love, joy, peace".length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    });
    await sources(page).getByRole("group", { name: "Mark the selected text" }).waitFor();
    await shot(page, "source-selection", sources(page));
    await page.close();
  },
  async "pdf-marks"() {
    const page = await open("sourcesWidth=440", { width: 1440, height: 1000 });
    await page.getByRole("combobox", { name: /Search in/ }).selectOption({ label: "Library" });
    await page.getByRole("searchbox").first().press("Enter");
    await page.getByRole("button", { name: /A Short Guide to Bible Study/ }).first().click();
    await page.getByRole("button", { name: "Original" }).click();
    await page.getByRole("button", { name: "Open full reader" }).click();
    const drawn = page.locator("[data-pdf-mark]").first();
    await drawn.waitFor();
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(1200);
    await page.locator("[data-pdf-mark]").first().scrollIntoViewIfNeeded();
    console.log("    marks drawn:", await page.locator("[data-pdf-mark]").count());
    await shot(page, "pdf-marks");
    await page.close();
  },
  async "pdf-selection"() {
    const page = await open("sourcesWidth=440", { width: 1440, height: 1000 });
    await page.getByRole("combobox", { name: /Search in/ }).selectOption({ label: "Library" });
    await page.getByRole("searchbox").first().press("Enter");
    await page.getByRole("button", { name: /A Short Guide to Bible Study/ }).first().click();
    await page.getByRole("button", { name: "Original" }).click();
    await page.getByRole("button", { name: "Open full reader" }).click();
    await page.locator("[data-pdf-mark]").first().waitFor();
    await page.getByRole("button", { name: "Fit page" }).click();
    await page.getByRole("button", { name: "Next page" }).click();
    await page.waitForTimeout(1000);
    // Select "first readers before asking" on page 13, in PDF.js's own text layer, as a reader would.
    const sheet = page.getByRole("group", { name: "Page 13" });
    await sheet.scrollIntoViewIfNeeded();
    await sheet.locator(".textLayer span").first().waitFor();
    await page.waitForTimeout(800);
    const picked = await page.evaluate(() => {
      const layer = document.querySelector('[data-page="13"] .textLayer');
      const span = [...(layer?.querySelectorAll("span") ?? [])].find((s) => s.textContent?.includes("first readers"));
      const node = span?.firstChild;
      if (!node) return null;
      const text = node.textContent ?? "";
      const range = document.createRange();
      range.setStart(node, text.indexOf("first readers"));
      range.setEnd(node, text.indexOf("first readers") + "first readers before asking".length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return range.toString();
    });
    console.log("    selected:", picked);
    const bar = page.getByRole("group", { name: "Mark the selected text" });
    await bar.waitFor();
    console.log("    quote:", await bar.getByTestId("source-selection-quote").textContent());
    await shot(page, "pdf-selection");
    await page.close();
  },
  async "add-to-study"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openStudy(page);
    await openSource(page, "Notes on Abiding");
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("[data-segment-id]")].find((el) => el.textContent?.startsWith("Jesus does not ask"));
      if (!p) return;
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent?.includes("apart from him")) node = walker.nextNode();
      if (!node) return;
      const text = node.textContent ?? "";
      const range = document.createRange();
      range.setStart(node, text.indexOf("apart from him"));
      range.setEnd(node, text.indexOf("apart from him") + "apart from him we can do nothing".length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    });
    const strip = sources(page).getByRole("group", { name: "Mark the selected text" });
    await strip.waitFor();
    await strip.getByRole("button", { name: "Add to Study" }).click();
    const panel = sources(page).getByRole("region", { name: /^Add to Study/ });
    await panel.waitFor();
    await panel.getByRole("textbox", { name: "Your note (optional)" }).fill("Even my study of this depends on him.");
    await page.waitForTimeout(500);
    await shot(page, "add-to-study", sources(page));
    await page.close();
  },
  async "source-in-study"() {
    const page = await open("", { width: 1440, height: 1000 });
    await openStudy(page);
    const note = page.locator("li > article", { hasText: "Abiding is receiving" }).first();
    await note.scrollIntoViewIfNeeded();
    await shot(page, "source-in-study", note);
    await page.close();
  },
  async "find-in-source"() {
    const page = await open("sourcesWidth=440", { width: 1600, height: 1000 });
    await openSource(page, "Notes on Abiding");
    await sources(page).getByRole("button", { name: "Find", exact: true }).click();
    await sources(page).getByRole("searchbox", { name: "Find in this source" }).fill("remain");
    await sources(page).getByRole("searchbox", { name: "Find in this source" }).press("Enter");
    await page.waitForTimeout(800);
    await shot(page, "find-in-source", sources(page));
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
