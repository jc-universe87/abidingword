import { act, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAutosize } from "@/hooks/useAutosize";

// jsdom does no layout: the text area's scrollHeight is given here, and its
// border, padding and line height come from inline styles.
let scroll = 75;
Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => scroll });

let observed: ResizeObserverCallback | null = null;
class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    observed = callback;
  }
  observe() {}
  disconnect() {}
}

function Field({ text, rows = 2 }: { text: string; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value] = useState(text);
  useAutosize(ref, rows, text);
  return <textarea ref={ref} defaultValue={value} style={{ boxSizing: "border-box", borderTop: "1px solid", borderBottom: "1px solid", padding: "8px 12px", lineHeight: "29.7px" }} />;
}

afterEach(() => {
  observed = null;
  vi.unstubAllGlobals();
  void i18n.changeLanguage("en");
});

describe("useAutosize (v0.23)", () => {
  it("adds the border and the rounding back to scrollHeight", () => {
    scroll = 164; // five lines of 29.7px and 16px padding, rounded down
    const { container } = render(<Field text="five lines" />);
    // Before v0.23 the height was scrollHeight alone (164px): with border-box
    // that left 162px for 164.5px of text and the last line under the border.
    expect((container.querySelector("textarea") as HTMLTextAreaElement).style.height).toBe("167px");
  });

  it("never makes the field smaller than its rows", () => {
    scroll = 10;
    const { container } = render(<Field text="" rows={2} />);
    // 2 × 29.7 + 16 padding + 2 border
    expect(parseFloat((container.querySelector("textarea") as HTMLTextAreaElement).style.height)).toBeCloseTo(77.4, 5);
  });

  it("measures again when the text changes and when the language changes", async () => {
    scroll = 75;
    const { container, rerender } = render(<Field text="a" />);
    const el = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(el.style.height).toBe("78px");
    scroll = 105;
    rerender(<Field text="ab" />);
    expect(el.style.height).toBe("108px");
    scroll = 135;
    await act(async () => {
      await i18n.changeLanguage("ko");
    });
    expect(el.style.height).toBe("138px");
  });

  it("measures again when its width changes, never for a change of its own height", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    scroll = 75;
    const { container } = render(<Field text="a" />);
    const el = container.querySelector("textarea") as HTMLTextAreaElement;
    let width = 400;
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => width });
    act(() => observed?.([], {} as ResizeObserver)); // first report: the width it was observed at
    scroll = 200;
    act(() => observed?.([], {} as ResizeObserver)); // same width: its own height changed, nothing to do
    width = 400;
    expect(el.style.height).not.toBe("203px");
    width = 300; // a narrower pane: the text wraps onto more lines
    act(() => observed?.([], {} as ResizeObserver));
    expect(el.style.height).toBe("203px");
  });

  it("measures again when a font finishes loading", () => {
    const fonts = new EventTarget();
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    scroll = 75;
    const { container } = render(<Field text="a" />);
    const el = container.querySelector("textarea") as HTMLTextAreaElement;
    scroll = 90;
    act(() => {
      fonts.dispatchEvent(new Event("loadingdone"));
    });
    expect(el.style.height).toBe("93px");
  });
});

// Leaves the prototype as other test files expect it.
afterAll(() => {
  delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
});
