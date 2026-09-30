import { useEffect } from "react";
import type { FindingType } from "@/types/studies";

/** Keyboard shortcuts while a study is open. Listed in Settings. */
export const STUDY_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Alt+N", action: "New finding" },
  { keys: "Alt+O", action: "New observation" },
  { keys: "Alt+Q", action: "New question" },
  { keys: "Alt+↓ / Alt+↑", action: "Next / previous section" },
  { keys: "Alt+G", action: "Go to a Scripture passage" },
  { keys: "Ctrl+Enter", action: "Save the finding being written" },
];

interface Handlers {
  onCapture: (type?: FindingType) => void;
  onSection: (delta: 1 | -1) => void;
}

export function useStudyShortcuts({ onCapture, onSection }: Handlers) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (key === "n") run(() => onCapture());
      else if (key === "o") run(() => onCapture("observation"));
      else if (key === "q") run(() => onCapture("question"));
      else if (event.key === "ArrowDown") run(() => onSection(1));
      else if (event.key === "ArrowUp") run(() => onSection(-1));
      else if (key === "g") run(() => document.getElementById("scripture-go-to")?.focus());
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onCapture, onSection]);
}
