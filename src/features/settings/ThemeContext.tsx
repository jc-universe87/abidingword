import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ApiContext";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Theme } from "@/types/domain";

/**
 * Calm backgrounds for the light theme, for long reading and writing. Each is
 * a set of colour tokens in tokens.css (`[data-paper]`), checked for text
 * contrast. A device preference, like the layout: it is not study data.
 */
export const BACKGROUNDS = ["parchment", "cream", "sage", "stone", "mist", "clear"] as const;
export type Background = (typeof BACKGROUNDS)[number];
const BACKGROUND_KEY = "appearance.background";

const savedBackground = (): Background => {
  const value = readLocal<string>(BACKGROUND_KEY, "parchment");
  return (BACKGROUNDS as readonly string[]).includes(value) ? (value as Background) : "parchment";
};

interface ThemeValue {
  theme: Theme;
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

  useEffect(() => {
    document.documentElement.dataset.paper = background;
  }, [background]);

  const setBackground = useCallback((next: Background) => {
    setBackgroundState(next);
    writeLocal(BACKGROUND_KEY, next);
  }, []);

  useEffect(() => {
    const query = darkQuery();
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && !!query?.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    if (theme !== "system" || !query) return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback(
    async (next: Theme) => {
      const saved = await api.settingsUpdate({ theme: next });
      setThemeState(saved.theme);
    },
    [api],
  );

  const value = useMemo(() => ({ theme, setTheme, background, setBackground }), [theme, setTheme, background, setBackground]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
