// Small per-device interface preferences (pane widths, last open study).
// Study data never goes here: it lives in the SQLite database.
// Storage can be unavailable, so every access is guarded.

const PREFIX = "abiding-word.";

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === undefined || value === null) {
      window.localStorage.removeItem(PREFIX + key);
    } else {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // Preference not remembered; nothing else is affected.
  }
}
