import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

describe("adding and managing Bibles", () => {
  it("adds the included Bible after reviewing it", async () => {
    const { api, user } = await renderApp();
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    await user.click(within(scripture).getByRole("button", { name: "Add a Bible…" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Choose a Bible" }), "World English Bible (WEB)");
    await user.click(screen.getByRole("button", { name: "Add…" }));
    const dialog = screen.getByRole("dialog", { name: "Add World English Bible?" });
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));

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

  it("offers the included Bibles in one drop-down, grouped by language", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    const select = await screen.findByRole("combobox", { name: "Choose a Bible" });
    const groups = within(select).getAllByRole("group").map((g) => g.getAttribute("label"));
    expect(groups).toEqual(["English", "Deutsch", "한국어", "Français", "Español", "Português"]);
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Berean Standard Bible (BSB)",
      "World English Bible (WEB)",
      "Lutherbibel 1912 (LUT1912)",
      "Schlachter-Bibel 1951 (SCH1951)",
      "Elberfelder 1905 (unrevidiert) (ELB1905)",
      "성경전서 개역한글판 (KRV)",
      "Louis Segond 1910 (LSG)",
      "Santa Biblia — Reina Valera 1909 (RV1909)",
      "Bíblia Livre (BLIVRE)",
    ]);
    // the first Bible in the interface language is chosen; its language and licence are shown
    expect(select).toHaveDisplayValue("Berean Standard Bible (BSB)");
    expect(screen.getByText("English · Public Domain")).toBeInTheDocument();
    await user.selectOptions(select, "Bíblia Livre (BLIVRE)");
    expect(screen.getByText("Português · CC BY 4.0")).toBeInTheDocument();
  });

  it("asks for confirmation in a dialog, and Cancel or Escape adds nothing", async () => {
    const { api, user } = await renderApp();
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "Choose a Bible" }), "Lutherbibel 1912 (LUT1912)");
    const add = screen.getByRole("button", { name: "Add…" });
    await user.click(add);
    let dialog = screen.getByRole("dialog", { name: "Add Lutherbibel 1912?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Language: Deutsch")).toBeInTheDocument();
    expect(within(dialog).getByText("Licence: Public Domain")).toBeInTheDocument();
    // focus starts in the dialog, on Cancel
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add Lutherbibel 1912?" })).not.toBeInTheDocument();
    // Escape closed only the question; Add a Bible stays open.
    expect(screen.getByRole("dialog", { name: "Add a Bible" })).toBeInTheDocument();
    expect(add).toHaveFocus();

    await user.click(add);
    dialog = screen.getByRole("dialog", { name: "Add Lutherbibel 1912?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add Lutherbibel 1912?" })).not.toBeInTheDocument();
    expect(api.state.pendingPreview).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Add a Bible" })).toBeInTheDocument();
  });

  it("chooses the German Bible first for a German interface, and leaves out what is already added", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("WEB", "web").isBuiltin = true;
    await i18n.changeLanguage("de");
    try {
      const { user } = await renderApp(api);
      await openSettingsSection(user, "Bibelübersetzungen");
      await user.click(await screen.findByRole("button", { name: /Bibel hinzufügen/ }));
      const select = await screen.findByRole("combobox", { name: "Bibel auswählen" });
      expect(within(select).getAllByRole("group")[0]).toHaveAttribute("label", "Deutsch");
      expect(select).toHaveDisplayValue("Lutherbibel 1912 (LUT1912)");
      const options = within(select).getAllByRole("option").map((o) => o.textContent);
      expect(options).toContain("Berean Standard Bible (BSB)");
      expect(options).not.toContain("World English Bible (WEB)"); // already added
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("chooses the Korean Bible first for a Korean interface", async () => {
    await i18n.changeLanguage("ko");
    try {
      const { user } = await renderApp();
      await user.click(screen.getAllByRole("button", { name: /성경 추가/ })[0]!);
      expect(await screen.findByRole("combobox", { name: "성경 선택" })).toHaveDisplayValue("성경전서 개역한글판 (KRV)");
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
    api.state.nextChosenFiles = ["/home/me/bible.rtf"];
    const { user } = await renderApp(api);
    await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
    await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Word files can’t be imported");
  });

  it("lists installed Bibles in Settings and removes one after confirmation", async () => {
    const api = createMemoryApi();
    api.installFixtureBible("FXA", "alpha");
    api.installFixtureBible("FXB", "beta");
    const { user } = await renderApp(api);
    await openSettingsSection(user, "Bible texts");

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
