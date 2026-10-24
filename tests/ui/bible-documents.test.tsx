import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// Bibles from documents (v0.23): the review, the two ways to add one, the
// reader in the Scripture pane, and looking for verses later.

async function chooseDocuments(files: string[], withBible = true) {
  const api = createMemoryApi();
  if (withBible) api.installFixtureBible("WEB", "web");
  api.state.nextChosenFiles = files.map((f) => `/home/you/Documents/${f}`);
  const rendered = await renderApp(api);
  const { user } = rendered;
  if (withBible) {
    await openSettingsSection(user, "Bible texts");
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
  } else {
    await user.click(within(screen.getByRole("complementary", { name: "Scripture" })).getByRole("button", { name: "Add a Bible…" }));
  }
  await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
  await screen.findByRole("heading", { level: 1, name: "New Bible" });
  return rendered;
}

async function fillDetails(user: Awaited<ReturnType<typeof renderApp>>["user"], short: string) {
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Invented Bible");
  await user.type(screen.getByLabelText("Short name"), short);
  await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "English");
}

describe("Bibles from documents", () => {
  it("reviews a PDF in plain words and adds it by book, chapter and verse", async () => {
    const { api, user } = await chooseDocuments(["invented-bible.pdf"]);
    expect(screen.getByText("PDF, 5 pages, their text can be read")).toBeInTheDocument();
    expect(screen.getByText("Its original layout stays available for reading.")).toBeInTheDocument();
    expect(screen.getByText("15 verses detected")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /By book, chapter and verse/ })).toBeChecked();
    expect(screen.getByText(/Word information \(dictionary forms, grammar, lexical numbers\): none/)).toBeInTheDocument();
    await fillDetails(user, "INV");
    await user.type(screen.getByLabelText("Copyright or licence (optional)"), "Invented for tests");
    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    expect(await screen.findByText(/is ready to read/)).toBeInTheDocument();
    const bible = api.state.bibles.find((b) => b.shortName === "INV")!;
    expect(bible.kind).toBe("structured");
    expect(bible.copyrightNotice).toBe("Invented for tests");
    expect(api.state.bibleDocuments.get(bible.id)?.documents).toHaveLength(1);
  });

  it("adds it as a document when the person chooses so, and reads it in the Scripture pane", async () => {
    const { api, user } = await chooseDocuments(["invented-bible.pdf"]);
    await user.click(screen.getByRole("radio", { name: /As a document to read/ }));
    expect(screen.getByRole("button", { name: "Add to read as a document" })).toBeInTheDocument();
    await fillDetails(user, "DOC");
    await user.click(screen.getByRole("button", { name: "Add to read as a document" }));
    expect(await screen.findByText(/was added to read as a document/)).toBeInTheDocument();
    expect(api.state.bibles.find((b) => b.shortName === "DOC")?.kind).toBe("document");
    await user.click(screen.getByRole("button", { name: "Read it now" }));
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const pane = await screen.findByRole("complementary", { name: "Scripture" });
    expect(await within(pane).findByRole("heading", { name: "Invented Bible" })).toBeInTheDocument();
    expect(within(pane).getByText("Read as a document")).toBeInTheDocument();
    // The Bible read by passage is not changed: going back returns to it.
    await user.click(within(pane).getByRole("button", { name: "Back to WEB" }));
    expect(within(pane).getByRole("combobox", { name: "Translation" })).toHaveDisplayValue("WEB");
  });

  it("searches a document Bible's text and opens the place found", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "web");
    api.state.nextChosenFiles = ["/home/you/Documents/invented.md"];
    const preview = await api.bibleImportPreview({ paths: ["/home/you/Documents/invented.md"] });
    await api.bibleImportCommit({ previewId: preview.previewId, name: "Markdown Bible", shortName: "MD", language: "English", asDocument: true });
    const { user } = await renderApp(api);
    const pane = screen.getByRole("complementary", { name: "Scripture" });
    await user.selectOptions(within(pane).getByRole("combobox", { name: "Translation" }), "MD");
    // Markdown is shown as its text.
    expect(await within(pane).findAllByText(/Invented words of Romans/)).not.toHaveLength(0);
    await user.type(within(pane).getByRole("searchbox", { name: "Search in this Bible’s text" }), "Romans");
    await user.click(within(pane).getByRole("button", { name: "Search" }));
    expect(await within(pane).findByText("4 places found")).toBeInTheDocument();
  });

  it("searching Scripture while a document is read shows the verses found in the Bible read by passage", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "web");
    const preview = await api.bibleImportPreview({ paths: ["/home/you/Documents/invented.md"] });
    await api.bibleImportCommit({ previewId: preview.previewId, name: "Markdown Bible", shortName: "MD", language: "English", asDocument: true });
    const { user } = await renderApp(api);
    const pane = screen.getByRole("complementary", { name: "Scripture" });
    await user.selectOptions(within(pane).getByRole("combobox", { name: "Translation" }), "MD");
    await within(pane).findByText("Read as a document");
    await user.type(screen.getByRole("searchbox", { name: /Search Scripture/i }), "Fixture{Enter}");
    await waitFor(() => expect(within(pane).queryByText("Read as a document")).not.toBeInTheDocument());
    expect(within(pane).getByRole("combobox", { name: "Translation" })).toHaveDisplayValue("WEB");
  });

  it("corrects a heading that names no book, then the verses can be used", async () => {
    const { user } = await chooseDocuments(["psalms-unclear.epub"]);
    expect(screen.getByText(/Some places are unclear/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to read as a document" })).toBeInTheDocument();
    const choice = screen.getByRole("combobox", { name: "Book for “The Book of Praises”" });
    await user.selectOptions(choice, "Psalms");
    expect(await screen.findByRole("radio", { name: /By book, chapter and verse/ })).toBeChecked();
    expect(screen.getByRole("button", { name: "Add this Bible" })).toBeInTheDocument();
  });

  it("a scanned PDF can only be added to read page by page", async () => {
    const { user } = await chooseDocuments(["old-scanned.pdf"]);
    expect(screen.getByText("PDF, 5 scanned pages: no text to read or search")).toBeInTheDocument();
    expect(screen.getByText(/There is no text to look for verses in/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await fillDetails(user, "SCAN");
    expect(screen.getByRole("button", { name: "Add to read as a document" })).toBeEnabled();
  });

  it("cancelling the review adds nothing", async () => {
    const { api, user } = await chooseDocuments(["invented-bible.pdf"]);
    await user.click(screen.getAllByRole("button", { name: "Cancel" })[0]!);
    expect(api.state.pendingPreview).toBeNull();
    expect(api.state.bibles.map((b) => b.shortName)).toEqual(["WEB"]);
    expect(api.state.bibleDocuments.size).toBe(0);
  });

  it("looks for verses later and, once confirmed, reads the Bible by passage", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "web");
    const preview = await api.bibleImportPreview({ paths: ["/home/you/Documents/invented.pdf"] });
    await api.bibleImportCommit({ previewId: preview.previewId, name: "PDF Bible", shortName: "PDFB", language: "English", asDocument: true });
    const { user } = await renderApp(api);
    const pane = screen.getByRole("complementary", { name: "Scripture" });
    await user.selectOptions(within(pane).getByRole("combobox", { name: "Translation" }), "PDFB");
    await user.click(await within(pane).findByText("What can I do with this Bible?"));
    await user.click(within(pane).getByRole("button", { name: "Look for verses…" }));
    const dialog = await screen.findByRole("dialog", { name: "Look for verses in PDF Bible" });
    expect(await within(dialog).findByText("15 verses detected")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Use these verses" }));
    expect(await within(dialog).findByText("PDF Bible can now be read by book, chapter and verse.")).toBeInTheDocument();
    expect(api.state.bibles.find((b) => b.shortName === "PDFB")?.kind).toBe("structured");
  });

  it("Settings says what a document Bible is and offers no word information", async () => {
    const api = createMemoryApi();
    const preview = await api.bibleImportPreview({ paths: ["/home/you/Documents/invented.epub"] });
    await api.bibleImportCommit({ previewId: preview.previewId, name: "EPUB Bible", shortName: "EPB", language: "English", asDocument: true });
    const { user } = await renderApp(api);
    const section = await openSettingsSection(user, "Bible texts");
    expect(within(section).getByText(/Read as a document/)).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Details" }));
    expect(within(section).getByText("A document to read (1 file); no verses")).toBeInTheDocument();
    expect(within(section).getByText("None: documents carry no word information.")).toBeInTheDocument();
  });
});
