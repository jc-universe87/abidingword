import type { ReactNode } from "react";

/** The labelled strip at the top of each workspace pane. */
export function PaneHeader({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-2 border-b border-border-subtle px-5">
      {/* Not a heading: it names the pane landmark (aria-labelledby), and
          the pane's own content supplies the heading outline. */}
      <div id={id} className="caps-label">
        {title}
      </div>
      {children}
    </div>
  );
}
