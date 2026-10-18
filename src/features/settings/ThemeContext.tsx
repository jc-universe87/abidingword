import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Theme } from "@/types/domain";

/**
 * Calm backgrounds for long reading and writing: six families, each with a
 * light and a dark variant in tokens.css (`[data-theme][data-paper]`),
 * checked for contrast. The variant follows the effective theme. A device
 * preference, like the layout: it is not study data.
 */
export const BACKGROUNDS = ["parchment", "cream", "sage", "stone", "mist", "clear"] as const;
export type Background = (typeof BACKGROUNDS)[number];
const BACKGROUND_KEY = "appearance.background";

const savedBackground = (): Background => {
  const value = readLocal<string>(BACKGROUND_KEY, "parchment");
  return (BACKGROUNDS as readonly string[]).includes(value) ? (value as Background) : "parchment";
};

/** The theme in effect: the chosen one, or the computer's for "system" (live). */
export type Resolved = "light" | "dark";

interface ThemeValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (theme: Theme) => Promise<void>;
  background: Background;
  setBackground: (background: Background) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const darkQuery = () =>
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** Applies the saved theme to <html data-theme> and follows the OS for "system". */
export function ThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  const api = useApi();
  const [theme, setThemeState] = useState<Theme>(initial);
  const [background, setBackgroundState] = useState<Background>(savedBackground);
  const [systemDark, setSystemDark] = useState<boolean>(() => !!darkQuery()?.matches);
  const resolved: Resolved = theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";

  useEffect(() => {
    document.documentElement.dataset.paper = background;
  }, [background]);

  const setBackground = useCallback((next: Background) => {
    setBackgroundState(next);
    writeLocal(BACKGROUND_KEY, next);
  }, []);

  // The computer's setting, followed live (it may change at sunset).
  useEffect(() => {
    const query = darkQuery();
    if (!query) return;
    const follow = () => setSystemDark(query.matches);
    follow();
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setTheme = useCallback(
    async (next: Theme) => {
      const saved = await api.settingsUpdate({ theme: next });
      setThemeState(saved.theme);
    },
    [api],
  );

  const value = useMemo(
    () => ({ theme, resolved, setTheme, background, setBackground }),
    [theme, resolved, setTheme, background, setBackground],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
