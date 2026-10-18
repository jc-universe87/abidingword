import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryApi } from "../support/memoryApi";
import { renderApp } from "../support/render";

// The Presenter View's reading surface (v0.18.2): Follow app (the default:
// the app's theme in effect and background family, live), or a fixed Light,
// Dark or Warm that never changes the app's appearance. The audience's slides
// keep the presentation's own design or church template either way.

type User = Awaited<ReturnType<typeof renderApp>>["user"];

/** A matchMedia whose "dark" answer the test changes, as the computer would. */
function fakeComputer(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: () => query });
  return {
    set(next: boolean) {
      dark = next;
      act(() => {
        for (const fn of listeners) fn();
      });
    },
  };
}

async function setup(theme: "light" | "dark" | "system", background?: string) {
  if (background) window.localStorage.setItem("abiding-word.appearance.background", JSON.stringify(background));
  const api = createMemoryApi();
  api.state.settings.theme = theme;
  api.installFixtureBible("FXA", "alpha");
  const project = await api.projectCreate({ workspaceId: api.state.workspace.id, title: "John" });
  const { study } = await api.studyCreate({ projectId: project.id, title: "Abiding" });
  const prep = await api.teachingCreate({ studyId: study.id, title: "Remain in the vine", kind: "sermon", points: [{ title: "Stay connected" }] });
  await api.teachingPassageAdd({ preparationId: prep.id, reference: "JHN.15.1-JHN.15.5" });
  return api;
}

async function present(api: ReturnType<typeof createMemoryApi>) {
  const { user } = await renderApp(api);
  await user.click(within(await screen.findByRole("list", { name: "Studies" })).getByRole("button", { name: /Abiding/ }));
  const study = screen.getByRole("main", { name: "Study" });
  await within(study).findByRole("textbox", { name: "Study title" });
  await user.click(within(study).getByRole("button", { name: "Bible Teaching" }));
  await user.click(await within(study).findByRole("button", { name: "Presentation" }));
  const region = await within(study).findByRole("region", { name: "Presentation of “Remain in the vine”" });
  await user.click(within(region).getByRole("button", { name: "Make slides from the teaching" }));
  await waitFor(() => expect(within(region).getByRole("button", { name: "Start Presenter View" })).toBeEnabled());
  await user.click(within(region).getByRole("button", { name: "Start Presenter View" }));
  const view = await screen.findByRole("dialog", { name: /Remain in the vine/ });
  return { user, view };
}

const surface = (view: HTMLElement) => (view.closest("[data-presenter-root]") ?? view.querySelector("[data-presenter-root]") ?? view).getAttribute("style") ?? "";
/** The audience slide as the speaker sees it (its own design). */
const slidePreview = (view: HTMLElement) => {
  const slide = view.querySelector<HTMLElement>('[role="group"].aspect-video');
  expect(slide).not.toBeNull();
  return slide!.getAttribute("style");
};

async function chooseSurface(user: User, view: HTMLElement, name: string) {
  if (!within(view).queryByRole("radio", { name })) await user.click(within(view).getByRole("button", { name: "View" }));
  await user.click(within(view).getByRole("radio", { name }));
}

afterEach(() => {
  window.localStorage.clear();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("the Presenter View's surface", () => {
  it("follows the app by default, carrying its background family into the dark (Dark + Sage → dark sage)", async () => {
    fakeComputer(false);
    const { user, view } = await present(await setup("dark", "sage"));
    expect(surface(view)).toMatch(/background-color: rgb\(26, 32, 28\)/);
    expect(surface(view)).toMatch(/color: rgb\(234, 228, 216\)/);
    await user.click(within(view).getByRole("button", { name: "View" }));
    const choices = within(view).getAllByRole("radio").map((r) => r.closest("label")!.textContent);
    expect(choices.slice(-4)).toEqual(["Follow app", "Light", "Dark", "Warm"]);
    expect(within(view).getByRole("radio", { name: "Follow app" })).toBeChecked();
  });

  it("in Follow app, a change of the computer's setting reaches an open Presenter View", async () => {
    const computer = fakeComputer(false);
    const { view } = await present(await setup("system", "parchment"));
    expect(surface(view)).toMatch(/background-color: rgb\(246, 241, 230\)/); // light parchment
    computer.set(true);
    await waitFor(() => expect(surface(view)).toMatch(/background-color: rgb\(22, 39, 31\)/)); // the brand's Forest
    computer.set(false);
    await waitFor(() => expect(surface(view)).toMatch(/background-color: rgb\(246, 241, 230\)/));
  });

  it("an explicit Light, Dark or Warm stays put, is remembered, and never changes the app", async () => {
    const computer = fakeComputer(true);
    const { user, view } = await present(await setup("system", "mist"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    const audienceSlide = slidePreview(view);
    await chooseSurface(user, view, "Light");
    expect(surface(view)).toMatch(/background-color: rgb\(255, 255, 255\)/);
    // The app is untouched; the audience slide keeps its own design.
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.paper).toBe("mist");
    expect(slidePreview(view)).toBe(audienceSlide);
    expect(JSON.parse(window.localStorage.getItem("abiding-word.presenter")!)).toMatchObject({ appearance: "light" });
    computer.set(false);
    computer.set(true);
    expect(surface(view)).toMatch(/background-color: rgb\(255, 255, 255\)/);
    await chooseSurface(user, view, "Warm");
    expect(surface(view)).toMatch(/background-color: rgb\(246, 241, 230\)/);
    expect(slidePreview(view)).toBe(audienceSlide);
  });

  it("a choice saved before v0.18.2: Warm (then the default) now follows the app; Light or Dark stays", async () => {
    fakeComputer(false);
    window.localStorage.setItem("abiding-word.presenter", JSON.stringify({ theme: "warm", scale: 1.15 }));
    const first = await present(await setup("dark", "stone"));
    expect(surface(first.view)).toMatch(/background-color: rgb\(29, 28, 26\)/); // dark stone
    first.view.ownerDocument.body.innerHTML = "";
    window.localStorage.setItem("abiding-word.presenter", JSON.stringify({ theme: "dark" }));
    const second = await present(await setup("light", "cream"));
    expect(surface(second.view)).toMatch(/background-color: rgb\(18, 18, 18\)/); // the fixed Dark
  });
});
