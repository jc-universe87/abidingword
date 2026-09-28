import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/ApiContext";
import type { Theme } from "@/types/domain";

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const darkQuery = () =>
  typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** Applies the saved theme to <html data-theme> and follows the OS for "system". */
export function ThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  const api = useApi();
  const [theme, setThemeState] = useState<Theme>(initial);

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

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}
