import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// Find in this source (v0.13), Reading view. All text is invented.

const NOTES: SourceFixture = {
  title: "Notes on Abiding",
  format: "text",
  language: "English",
  segments: [
    { text: "Remain in me, and I in you." },
    { text: "Nothing to see in this paragraph." },
    { text: "Compare John 15:5 where the branches REMAIN in the vine; Römer remain too." },
    ...Array.from({ length: 200 }, (_, i) => ({ text: `Filler paragraph ${i + 1}.` })),
    { text: "Far down the book they still remain." },
  ],
  mentions: [{ segment: 2, reference: "JHN.15.5", matchedText: "John 15:5" }],
};

function withLibrary(...fixtures: SourceFixture[]) {
  const api = createMemoryApi();
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  for (const fixture of fixtures) api.installFixtureSource(fixture);
  return api;
}

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });
type User = Awaited<ReturnType<typeof renderApp>>["user"];

async function openSource(user: User, title: string) {
  await user.click((await within(sourcesPane()).findAllByRole("button", { name: new RegExp(`^${title}`) }))[0]!);
  return within(sourcesPane()).findByRole("region", { name: title });
}
const findButton = (reader: HTMLElement) => within(reader).getByRole("button", { name: "Find" });
const findBox = (reader: HTMLElement) => within(reader).getByRole("searchbox", { name: "Find in this source" });
const status = (reader: HTMLElement) => within(within(reader).getByRole("search")).getByRole("status");
const active = (reader: HTMLElement) => reader.querySelector("mark[data-find-active]");

async function search(user: User, reader: HTMLElement, query: string) {
  await user.click(findButton(reader));
  await user.type(findBox(reader), `${query}{Enter}`);
}

describe("Find in this source", () => {
  it("counts every match, marks them all and the current one, and steps with Enter and Shift+Enter", async () => {
    const { user } = await renderApp(withLibrary(NOTES));
    const reader = await openSource(user, "Notes on Abiding");
    await search(user, reader, "remain");
    await waitFor(() => expect(status(reader)).toHaveTextContent("1 of 4"));
    expect(findBox(reader)).toHaveFocus();
    expect(active(reader)).toHaveTextContent("Remain");
    // every match in view is marked; the paragraph text is unchanged
    const paragraph = active(reader)!.closest("p")!;
    expect(paragraph.textContent).toBe("Remain in me, and I in you.");
    expect(reader.querySelectorAll("mark").length).toBe(3);

    await user.keyboard("{Enter}");
    expect(status(reader)).toHaveTextContent("2 of 4");
    expect(active(reader)).toHaveTextContent("REMAIN");
    // a match beside a Scripture reference leaves the reference working
    expect(within(reader).getByRole("button", { name: "John 15:5 (Scripture reference)" })).toBeInTheDocument();
    expect(findBox(reader)).toHaveFocus();

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(status(reader)).toHaveTextContent("1 of 4");
    // Previous from the first wraps to the last, which is loaded into view
    await user.click(within(reader).getByRole("button", { name: "Previous match" }));
    expect(status(reader)).toHaveTextContent("4 of 4");
    await waitFor(() => expect(active(reader)).toHaveTextContent("remain"));
    expect(active(reader)!.closest("p")).toHaveTextContent("Far down the book they still remain.");
  });

  it("ignores case and accents, says when nothing matches, and leaves Back / Forward alone", async () => {
    const { user } = await renderApp(withLibrary(NOTES));
    const reader = await openSource(user, "Notes on Abiding");
    await search(user, reader, "romer");
    await waitFor(() => expect(status(reader)).toHaveTextContent("1 of 1"));
    expect(active(reader)).toHaveTextContent("Römer");
    await user.clear(findBox(reader));
    await user.type(findBox(reader), "olive{Enter}");
    await waitFor(() => expect(status(reader)).toHaveTextContent("No matches"));
    expect(within(reader).getByRole("button", { name: "Next match" })).toBeDisabled();
    expect(within(reader).getByRole("button", { name: "Back to the previous place" })).toBeDisabled();
  });

  it("Escape closes the bar, removes the marks and returns focus; Ctrl+F opens it with the last query", async () => {
    const { user } = await renderApp(withLibrary(NOTES));
    const reader = await openSource(user, "Notes on Abiding");
    await search(user, reader, "remain");
    await waitFor(() => expect(status(reader)).toHaveTextContent("1 of 4"));
    await user.keyboard("{Escape}");
    expect(within(reader).queryByRole("search")).not.toBeInTheDocument();
    expect(reader.querySelector("mark")).toBeNull();
    await waitFor(() => expect(findButton(reader)).toHaveFocus());
    await user.keyboard("{Control>}f{/Control}");
    expect(findBox(reader)).toHaveFocus();
    expect(findBox(reader)).toHaveValue("remain");
  });

  it("searches after a pause in typing", async () => {
    const api = withLibrary(NOTES);
    const { user } = await renderApp(api);
    const reader = await openSource(user, "Notes on Abiding");
    await user.click(findButton(reader));
    await user.type(findBox(reader), "vine");
    await waitFor(() => expect(status(reader)).toHaveTextContent("1 of 1"));
    expect(active(reader)).toHaveTextContent("vine");
  });
});
