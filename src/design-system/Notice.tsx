import type { ReactNode } from "react";

type Tone = "info" | "success" | "warning" | "error";

const BAR: Record<Tone, string> = {
  info: "border-accent text-text",
  success: "border-success text-text",
  warning: "border-warning text-text",
  error: "border-danger text-danger",
};

/**
 * A message block, one look for every status (v0.18.5): a soft fill that shows
 * on any surface and a coloured bar at its start; the words say what happened
 * (colour is never the only sign). `error` is announced to screen readers
 * immediately, the others politely.
 */
export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border-l-[3px] bg-hover px-4 py-3 text-[0.9375rem] ${BAR[tone]}`}>
      {children}
    </div>
  );
}
