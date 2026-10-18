// The app's background families in each mode, as colours for places that
// cannot read the CSS tokens (the Settings swatches, the Presenter View's
// reading surface when it follows the app). The same values as tokens.css;
// tests/ui/appearance-themes.test.tsx keeps the two identical.
import type { Background, Resolved } from "@/features/settings/ThemeContext";

export interface AppPalette {
  background: string;
  secondary: string;
  text: string;
  muted: string;
  /** For emphasis (time running out, the slide on screen): the link colour, readable as text. */
  accent: string;
}

const LIGHT_TEXT = { text: "#2b2b2b", muted: "#5f5c56", accent: "#762e32" };
const DARK_TEXT = { text: "#eae4d8", muted: "#b8b0a2", accent: "#d9a55b" };

export const APP_PALETTES: Record<Resolved, Record<Background, AppPalette>> = {
  light: {
    parchment: { background: "#f6f1e6", secondary: "#ede6d8", ...LIGHT_TEXT },
    cream: { background: "#faf7ef", secondary: "#f1ece0", ...LIGHT_TEXT },
    sage: { background: "#eef1e9", secondary: "#e3e8dc", ...LIGHT_TEXT },
    stone: { background: "#efece7", secondary: "#e5e1da", ...LIGHT_TEXT },
    mist: { background: "#eef1f3", secondary: "#e3e7ea", ...LIGHT_TEXT },
    clear: { background: "#fbfbf9", secondary: "#f1f1ee", ...LIGHT_TEXT },
  },
  dark: {
    parchment: { background: "#16271f", secondary: "#1f352a", ...DARK_TEXT },
    cream: { background: "#1e1b16", secondary: "#28241e", ...DARK_TEXT },
    sage: { background: "#1a201c", secondary: "#232a25", ...DARK_TEXT },
    stone: { background: "#1d1c1a", secondary: "#272523", ...DARK_TEXT },
    mist: { background: "#181d22", secondary: "#21272d", ...DARK_TEXT },
    clear: { background: "#1b1b1b", secondary: "#252525", ...DARK_TEXT },
  },
};
