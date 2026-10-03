import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Interactions between features of the v0.5 branch: Bible, translation
// switching, the verse inspector, and Marks.

const V1 = "Fixture alpha JHN 15:1 about the vine.";

function setup() {
  const api = createMemoryApi();
  const alpha = api.installFixtureBible("FXA", "alpha");
  api.installFixtureBible("FXB", "beta");
  api.state.settings.scripturePassage = "JHN.15";
  return { api, alpha };
}

const pane = () => screen.getByRole("complementary", { name: "Scripture" });
const mode = (name: "Bible" | "Marks") => within(pane()).getByRole("button", { name });
const translation = () => within(pane()).getByRole("combobox", { name: "Translation" }) as HTMLSelectElement;
const shown = () => translation().selectedOptions[0]?.textContent;
const ready = () => waitFor(() => expect(pane().querySelector('[data-verse-text="JHN.15.1"]')).not.toBeNull());
const verseButton = (n: number) => within(pane()).getByRole("button", { name: new RegExp(`^Verse ${n}[.,]`) });
const inspector = () => screen.queryByRole("region", { name: /Tools for/ });
const marksList = () => waitFor(() => expect(within(pane()).queryByText("Loading your marks…")).toBeNull());

afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("a phrase note across translations, Marks and the inspector", () => {
  it("is found in Marks as not shown, opens its verse without switching Bible, and its inspector works", async () => {
    const { api, alpha } = setup();
    const at = V1.indexOf("about the vine");
    await api.annotationCreate({
      reference: "JHN.15.1",
      kind: "note",
      content: "Christ is the vine",
      anchor: { translationId: alpha.id, start: { verse: "JHN.15.1", offset: at }, end: { verse: "JHN.15.1", offset: at + 14 }, quote: "about the vine" },
    });
    const { user } = await renderApp(api);
    await ready();

    // Read it in another wording: the phrase is no longer drawn.
    await user.selectOptions(translation(), "FXB");
    await waitFor(() => expect(shown()).toBe("FXB"));
    await waitFor(() => expect(pane().querySelector("[data-phrase-note], mark, u, .underline")).toBeNull());

    // Marks says so, plainly.
    await user.click(mode("Marks"));
    await marksList();
    const card = await within(pane()).findByRole("button", { name: /John 15:1/ });
    expect(card).toHaveTextContent("Christ is the vine");
    expect(card).toHaveTextContent("Not shown in this wording");

    // Back to the verse, in the same Bible.
    await user.click(card);
    expect(await within(pane()).findByText(/showing John 15:1/)).toBeInTheDocument();
    expect(shown()).toBe("FXB");

    // The inspector for that verse still lists the note, also as not shown here.
    await user.click(verseButton(1));
    const region = await screen.findByRole("region", { name: /Tools for/ });
    expect(within(region).getByText("Christ is the vine")).toBeInTheDocument();
    expect(within(region).getByText(/Not shown in this wording/)).toBeInTheDocument();
  });
});

describe("navigating while verse tools are open", () => {
  it("closes the verse tools when a mark in the same chapter is opened", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.5", kind: "bookmark" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    await screen.findByRole("region", { name: /Tools for/ });

    await user.click(mode("Marks"));
    await marksList();
    await user.click(await within(pane()).findByRole("button", { name: /John 15:5/ }));
    expect(await within(pane()).findByText(/showing John 15:5/)).toBeInTheDocument();
    // The verse the tools were for is no longer the one in focus: they are gone, not stale.
    expect(inspector()).toBeNull();
  });

  it("closes the verse tools on another chapter and keeps Marks as it was", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.2", kind: "bookmark" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(verseButton(1));
    await screen.findByRole("region", { name: /Tools for/ });
    await user.click(within(pane()).getByRole("button", { name: /Next chapter/ }));
    await waitFor(() => expect(inspector()).toBeNull());
    await user.click(mode("Marks"));
    await marksList();
    expect(await within(pane()).findByRole("button", { name: /John 15:2/ })).toBeInTheDocument();
  });

  it("shows the Bible when a Scripture search result is opened from Marks", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "ROM.8.28", kind: "note", content: "x" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(mode("Marks"));
    await marksList();
    await user.type(screen.getByRole("searchbox", { name: "Search Scripture" }), "vine{Enter}");
    const results = await within(pane()).findByRole("list", { name: "Search results" });
    await user.click(within(results).getByRole("button", { name: /John 15:1/ }));
    expect(await within(pane()).findByText(/showing John 15:1/)).toBeInTheDocument();
    expect(mode("Bible")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { level: 2, name: "Marks" })).toBeNull();
  });
});

describe("Marks stays true to what was done in the Bible", () => {
  it("drops a note deleted in the inspector, and picks up one added, the next time Marks is opened", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "JHN.15.1", kind: "note", content: "Only note" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(mode("Marks"));
    await marksList();
    expect(await within(pane()).findByText("Only note")).toBeInTheDocument();
    await user.click(mode("Bible"));

    await user.click(within(pane()).getByRole("button", { name: /^Verse 1.*Show annotations/ }));
    const region = await screen.findByRole("region", { name: /Tools for/ });
    await user.click(within(region).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(0));
    await user.click(within(region).getByRole("button", { name: "Bookmark" }));
    await waitFor(() => expect(api.state.annotations).toHaveLength(1));

    await user.click(mode("Marks"));
    await marksList();
    expect(within(pane()).queryByText("Only note")).toBeNull();
    expect(await within(pane()).findByRole("button", { name: /John 15:1.*Bookmark/ })).toBeInTheDocument();
  });

  it("keeps the same marks, in the other languages' book names, when the language changes", async () => {
    const { api } = setup();
    await api.annotationCreate({ reference: "ROM.8.28", kind: "bookmark" });
    const { user } = await renderApp(api);
    await ready();
    await user.click(mode("Marks"));
    await marksList();
    expect(await screen.findByRole("button", { name: /Romans 8:28/ })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    expect(await screen.findByRole("button", { name: /Romanos 8:28/ })).toBeInTheDocument();
  });
});
