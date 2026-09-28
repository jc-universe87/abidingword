import { useEffect, useState, type ReactNode } from "react";
import { Splitter } from "@/design-system/Splitter";
import { readLocal, writeLocal } from "@/lib/storage";

const SIDE_MIN = 240;
const SIDE_MAX = 560;

interface WorkspaceLayoutProps {
  scripture: ReactNode;
  study: ReactNode;
  sources: ReactNode;
  scriptureOpen: boolean;
  sourcesOpen: boolean;
}

/**
 * The three-pane research desk: Scripture | Study | Sources.
 * Side panes can be resized (drag or keyboard) and hidden; widths are
 * remembered on this device. The Study pane always takes the remaining room.
 */
export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const [left, setLeft] = useState(() => readLocal("layout.scriptureWidth", 300));
  const [right, setRight] = useState(() => readLocal("layout.sourcesWidth", 320));

  useEffect(() => writeLocal("layout.scriptureWidth", left), [left]);
  useEffect(() => writeLocal("layout.sourcesWidth", right), [right]);

  return (
    <div className="flex min-h-0 flex-1">
      {props.scriptureOpen && (
        <>
          <aside
            id="pane-scripture"
            aria-labelledby="pane-scripture-title"
            style={{ width: left }}
            className="flex min-w-0 shrink-0 flex-col bg-bg-secondary"
          >
            {props.scripture}
          </aside>
          <Splitter
            label="Resize Scripture pane"
            controls="pane-scripture"
            value={left}
            min={SIDE_MIN}
            max={SIDE_MAX}
            direction={1}
            onChange={setLeft}
          />
        </>
      )}

      <main id="pane-study" aria-labelledby="pane-study-title" className="flex min-w-0 flex-1 flex-col bg-bg">
        {props.study}
      </main>

      {props.sourcesOpen && (
        <>
          <Splitter
            label="Resize Sources pane"
            controls="pane-sources"
            value={right}
            min={SIDE_MIN}
            max={SIDE_MAX}
            direction={-1}
            onChange={setRight}
          />
          <aside
            id="pane-sources"
            aria-labelledby="pane-sources-title"
            style={{ width: right }}
            className="flex min-w-0 shrink-0 flex-col bg-bg-secondary"
          >
            {props.sources}
          </aside>
        </>
      )}
    </div>
  );
}
