import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

describe("adding and managing Bibles", () => {
  it("adds the included Bible after reviewing it", async () => {
    const { api, user } = await renderApp();
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.click(within(scripture).getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Add World English Bible" }));

    expect(await screen.findByRole("heading", { level: 1, name: "New Bible" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("World English Bible");
    expect(screen.getByText("3 books detected")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Books" })).getByText("Romans")).toBeInTheDocument();
    expect(screen.getByText(/1 warning — worth reviewing/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    expect(await screen.findByText(/is ready to read/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Read it now" }));

    expect(api.state.bibles.map((b) => b.shortName)).toEqual(["WEB"]);
    const pane = await screen.findByRole("complementary", { name: "Scripture" });
    expect(within(pane).getByRole("combobox", { name: "Translation" })).toHaveDisplayValue("WEB");
  });

  it("offers every included Bible in one list, the interface language's first", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    const included = await screen.findByRole("heading", { level: 2, name: "Included with Abiding Word" });
    const list = within(included.closest("section")!).getByRole("list");
    const offered = within(list).getAllByRole("button").map((b) => b.textContent);
    expect(offered).toEqual([
      "Add Berean Standard Bible",
      "Add World English Bible",
      "Add Lutherbibel 1912",
      "Add Schlachter-Bibel 1951",
      "Add Elberfelder 1905 (unrevidiert)",
      "Add Louis Segond 1910",
      "Add Santa Biblia — Reina Valera 1909",
      "Add Bíblia Livre",
    ]);
    // the heading is not repeated for each Bible
    expect(screen.getAllByRole("heading", { name: "Included with Abiding Word" })).toHaveLength(1);
    expect(within(list).getByText(/Português · CC BY 4\.0/)).toBeInTheDocument();
  });

  it("puts the German Bible first for a German interface, and keeps offering the others once one is added", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "web").isBuiltin = true;
    await i18n.changeLanguage("de");
    try {
      const { user } = await renderApp(api);
      await user.click(screen.getByRole("button", { name: "Einstellungen" }));
      await user.click(await screen.findByRole("button", { name: /Bibel hinzufügen/ }));
      const included = await screen.findByRole("heading", { level: 2, name: "In Abiding Word enthalten" });
      const names = within(included.closest("section")!)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("strong")?.textContent);
      expect(names.slice(0, 3)).toEqual(["Lutherbibel 1912", "Schlachter-Bibel 1951", "Elberfelder 1905 (unrevidiert)"]);
      expect(names).toContain("Berean Standard Bible");
      expect(names).not.toContain("World English Bible"); // already added
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("will not add a Bible with problems, and says why", async () => {
    const api = createMemoryApi();
    api.state.nextChosenFiles = ["/home/me/broken.zip"];
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));

    expect(await screen.findByText(/1 problem must be fixed/)).toBeInTheDocument();
    expect(screen.getByText("John 15:1 appears twice.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add this Bible" })).toBeDisabled();
  });

  it("refuses unsupported files with a plain message", async () => {
    const api = createMemoryApi();
    api.state.nextChosenFiles = ["/home/me/bible.pdf"];
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("PDF files can’t be imported");
  });

  it("lists installed Bibles in Settings and removes one after confirmation", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    const list = await screen.findByRole("list", { name: "Installed Bibles" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(list).getByRole("button", { name: "Remove Fixture FXA" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Your studies, passage links and notes are kept.");
    await user.click(within(confirm).getByRole("button", { name: "Remove FXA" }));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(api.state.bibles.map((b) => b.shortName)).toEqual(["FXB"]);
  });
});
