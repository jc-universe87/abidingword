import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { openSettingsSection, renderApp } from "../support/render";

// A Bible's language (v0.18.3): chosen on import (from the files' own
// metadata when they state it, otherwise by the person — never guessed),
// correctable later in Settings, and used at once by typed references.

async function importFiles(files: string[]) {
  const api = createMemoryApi();
  api.state.nextChosenFiles = files;
  const { user } = await renderApp(api);
  await user.click(screen.getByRole("button", { name: "Add a Bible…" }));
  await user.click(await screen.findByRole("button", { name: "Choose Bible files…" }));
  await screen.findByRole("heading", { level: 1, name: "New Bible" });
  return { api, user };
}

describe("a Bible's language", () => {
  it("is left unchosen for files without language metadata, and must be chosen before adding", async () => {
    const { api, user } = await importFiles(["/home/me/Biblia Livre (Portuguese).zip"]);
    const language = screen.getByRole("combobox", { name: "Language" });
    // Not guessed from the file name.
    expect(language).toHaveValue("");
    expect(language).toHaveAccessibleDescription(/abbreviations you type/);
    await user.type(screen.getByLabelText(/Short name/), "BLV");
    expect(screen.getByRole("button", { name: "Add this Bible" })).toBeDisabled();
    await user.selectOptions(language, "pt");
    expect(within(language).getByRole("option", { selected: true })).toHaveTextContent("Portuguese (português)");
    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    await waitFor(() => expect(api.state.bibles.at(-1)).toMatchObject({ shortName: "BLV", language: "português", languageCode: "pt" }));
  });

  it("is filled in from the files' own metadata, and can still be changed", async () => {
    const { api, user } = await importFiles(["/home/me/with-metadata-pt-BR.zip"]);
    const language = screen.getByRole("combobox", { name: "Language" });
    expect(language).toHaveValue("pt-BR");
    await user.type(screen.getByLabelText(/Short name/), "NVI");
    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    // Named as a choice from the list would be: in the language itself.
    await waitFor(() => expect(api.state.bibles.at(-1)).toMatchObject({ shortName: "NVI", languageCode: "pt-BR", language: "português (Brasil)" }));
  });

  it("can be a language outside the list, by name only (no tag)", async () => {
    const { api, user } = await importFiles(["/home/me/latin.zip"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "Another language…");
    const name = screen.getByRole("textbox", { name: "Name of the language" });
    // Focus moves to the name; it is required and described by the hint.
    expect(name).toHaveFocus();
    expect(name).toBeRequired();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/abbreviations you type/);
    await user.type(name, "Latina");
    expect(name).toHaveAttribute("aria-invalid", "false");
    await user.type(screen.getByLabelText(/Short name/), "VUL");
    await user.click(screen.getByRole("button", { name: "Add this Bible" }));
    await waitFor(() => expect(api.state.bibles.at(-1)).toMatchObject({ shortName: "VUL", language: "Latina", languageCode: null }));
  });

  it("is corrected later in Settings, changing nothing else, and typed passages follow it at once", async () => {
    const api = createMemoryApi();
    const bible = api.installFixtureBible("FXA", "alpha");
    bible.languageCode = null;
    api.state.bibles[0]!.languageCode = null;
    const { user } = await renderApp(api);
    // "Jn 3:5" with no Bible language and an English interface: John.
    const scripture = screen.getByRole("complementary", { name: "Scripture" });
    const goTo = within(scripture).getByRole("textbox", { name: "Go to passage" });
    await user.type(goTo, "Jn 3:5{Enter}");
    await within(scripture).findByRole("heading", { name: /John 3/ });

    const section = await openSettingsSection(user, "Bible texts");
    await user.click(within(section).getByRole("button", { name: "Details" }));
    await user.click(within(section).getByRole("button", { name: "Change language" }));
    await user.selectOptions(within(section).getByRole("combobox", { name: "Language" }), "pt");
    const before = { ...api.state.bibles[0]! };
    await user.click(within(section).getByRole("button", { name: "Save language" }));
    await waitFor(() => expect(api.state.bibles[0]).toMatchObject({ language: "português", languageCode: "pt" }));
    expect(api.state.bibles[0]).toMatchObject({ name: before.name, shortName: before.shortName, verseCount: before.verseCount });
    expect(await within(section).findByText("português")).toBeInTheDocument();
    // Focus is back on "Change language"; Cancel returns it there too.
    await waitFor(() => expect(within(section).getByRole("button", { name: "Change language" })).toHaveFocus());
    await user.click(within(section).getByRole("button", { name: "Change language" }));
    await user.click(within(section).getByRole("button", { name: "Cancel" }));
    expect(within(section).getByRole("button", { name: "Change language" })).toHaveFocus();

    // The Bible's language now decides: "Jn" is Jonah in Portuguese.
    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    const scriptureAgain = screen.getByRole("complementary", { name: "Scripture" });
    const box = within(scriptureAgain).getByRole("textbox", { name: "Go to passage" });
    await user.clear(box);
    await user.type(box, "Jn 3:5{Enter}");
    await within(scriptureAgain).findByRole("heading", { name: /Jonah 3/ });
  });
});
