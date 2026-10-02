import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Supplied by the workspace layout to each pane, so the pane's header can
 * offer "Move left" / "Move right". Outside the layout there is none.
 */
export interface PaneControls {
  /** Pane name as the user knows it ("Scripture"), in the interface language. */
  name: string;
  /** DOM id prefix for the move buttons, so focus can follow a moved pane. */
  idPrefix: string;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  move: (direction: -1 | 1) => void;
}

const PaneControlsContext = createContext<PaneControls | null>(null);
export const PaneControlsProvider = PaneControlsContext.Provider;

const moveButton =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-aw text-text-muted " +
  "hover:bg-bg hover:text-text-strong disabled:opacity-40 disabled:hover:bg-transparent";

/** The labelled strip at the top of each workspace pane. */
export function PaneHeader({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const controls = useContext(PaneControlsContext);
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-border-subtle px-5 py-1">
      {/* Not a heading: it names the pane landmark (aria-labelledby), and
          the pane's own content supplies the heading outline. */}
      <div id={id} className="caps-label">
        {title}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {children}
        {controls && (
          <div className="flex items-center" role="group" aria-label={t("app.panes.arrange", { pane: controls.name })}>
            <button
              type="button"
              id={`${controls.idPrefix}-move-left`}
              className={moveButton}
              disabled={!controls.canMoveLeft}
              onClick={() => controls.move(-1)}
              aria-label={t("app.panes.moveLeft", { pane: controls.name })}
              title={t("app.panes.moveLeft", { pane: controls.name })}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              id={`${controls.idPrefix}-move-right`}
              className={moveButton}
              disabled={!controls.canMoveRight}
              onClick={() => controls.move(1)}
              aria-label={t("app.panes.moveRight", { pane: controls.name })}
              title={t("app.panes.moveRight", { pane: controls.name })}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
