import type { ReactNode } from "react";

/** A message block. `error` is announced to screen readers immediately. */
export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  const style =
    tone === "error"
      ? "border-l-[3px] border-danger text-danger"
      : "border-l-[3px] border-accent text-text";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`${style} bg-bg-secondary px-4 py-3 text-[0.9375rem]`}>
      {children}
    </div>
  );
}
