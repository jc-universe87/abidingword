import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/app/App";
import { createMemoryApi, type MemoryApi } from "./memoryApi";

/** Window width the app sees; a typical desktop unless a test says otherwise. */
export function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

/** Renders the whole app against an in-memory API and waits for the shell. */
export async function renderApp(api: MemoryApi = createMemoryApi(), { width = 1440 } = {}) {
  setWindowWidth(width);
  const user = userEvent.setup();
  render(<App api={api} />);
  if (api.state.info.ready) {
    await screen.findByRole("main", { name: /study/i });
  }
  return { api, user };
}
