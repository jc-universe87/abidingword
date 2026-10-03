import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi, type SourceFixture } from "../support/memoryApi";
import { renderApp } from "../support/render";

// All library text here is invented for the tests.
const NOTES: SourceFixture = {
  title: "Notes on the Vine",
  author: "J. Example",
  format: "markdown",
  language: "English",
  segments: Array.from({ length: 40 }, (_, i) => ({ text: `Paragraph ${i + 1} about abiding.`, sectionPath: "Part one" })),
};

const sourcesPane = () => screen.getByRole("complementary", { name: "Sources" });

async function openFullReader(api = createMemoryApi()) {
  api.installFixtureBible("FXA", "alpha");
  api.state.settings.scripturePassage = "PSA.23";
  api.installFixtureSource(NOTES);
  const result = await renderApp(api);
  const { user } = result;
  await user.click(await within(sourcesPane()).findByRole("button", { name: "Open library" }));
  const library = await screen.findByRole("main");
  await user.click((await within(library).findAllByRole("button", { name: /Notes on the Vine/ }))[0]!);
  await screen.findByRole("heading", { level: 1, name: "Notes on the Vine" });
  return result;
}

describe("full source reader", () => {
  it("keeps Back in a header that is outside the scrolling text", async () => {
    await openFullReader();
    const main = screen.getByRole("main");
    const header = within(main).getByTestId("reader-header");
    const body = within(main).getByTestId("reader-body");

    // Back and the title live in the header; the text lives in the body.
    expect(within(header).getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(within(header).getByRole("heading", { level: 1, name: "Notes on the Vine" })).toBeInTheDocument();
    expect(await within(body).findByText("Paragraph 1 about abiding.")).toBeInTheDocument();
    expect(within(body).queryByRole("button", { name: "Back" })).toBeNull();

    // The header and the content stage (which holds the body) are siblings in a
    // flex column: only the body scrolls, so the header cannot scroll away.
    expect(header.parentElement).toBe(main);
    expect(body.parentElement?.parentElement).toBe(main);
    expect(header.contains(body) || body.contains(header)).toBe(false);
    expect(main.className).toMatch(/\bflex-col\b/);
    expect(header.className).toMatch(/\bshrink-0\b/);
    expect(body.className).toMatch(/\boverflow-y-auto\b/);
    expect(main.className).not.toMatch(/overflow-y-auto/);
  });

  it("goes back to the Library from the header", async () => {
    const { user } = await openFullReader();
    await user.click(within(screen.getByTestId("reader-header")).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
  });

  it("focuses the title when opened, for keyboard and screen-reader users", async () => {
    await openFullReader();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Notes on the Vine" })).toHaveFocus());
  });
});
