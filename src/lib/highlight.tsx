import type { ReactNode } from "react";

/** Turns U+0002 … U+0003 match markers from a search index into <mark>. */
export function highlighted(snippet: string): ReactNode[] {
  const parts: ReactNode[] = [];
  snippet.split("\u0002").forEach((chunk, i) => {
    if (i === 0) return parts.push(chunk);
    const [match, rest] = chunk.split("\u0003");
    parts.push(
      <mark key={i} className="bg-note font-semibold text-text">
        {match}
      </mark>,
      rest ?? "",
    );
  });
  return parts;
}
