import { useEffect } from "react";
import type { FindingType } from "@/types/studies";

/**
 * Keyboard shortcuts while a study is open, listed in Settings: translation
 * keys for the key names (e.g. Ctrl is "Strg" on German keyboards) and the
 * action.
 */
export const STUDY_SHORTCUTS = [
  { keys: "studies.shortcuts.newFinding.keys", action: "studies.shortcuts.newFinding.action" },
  { keys: "studies.shortcuts.newObservation.keys", action: "studies.shortcuts.newObservation.action" },
  { keys: "studies.shortcuts.newQuestion.keys", action: "studies.shortcuts.newQuestion.action" },
  { keys: "studies.shortcuts.section.keys", action: "studies.shortcuts.section.action" },
  { keys: "studies.shortcuts.goTo.keys", action: "studies.shortcuts.goTo.action" },
  { keys: "studies.shortcuts.saveFinding.keys", action: "studies.shortcuts.saveFinding.action" },
] as const;

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
