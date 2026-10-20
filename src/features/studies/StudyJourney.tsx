import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/design-system/Button";
import type { TeachingSummary } from "@/types/teaching";
import type { Phase, PhaseRun } from "./journey";

export const runId = (studyId: string, index: number) => `study-${studyId}-phase-${index}`;

/** The phase's name in the interface language. */
export function usePhaseName() {
  const { t } = useTranslation();
  return (phase: Phase) => t(`studies.journey.phase.${phase}`);
}

/**
 * The study's outline (v0.18.6): its phases on one quiet line, from the text
 * to teaching. It stays at the top of the pane while the study scrolls, marks
 * the phase in view, and takes the person to a phase on a click. It is a
 * way of finding one's place, never a sequence to follow: every part stays
 * open to work on.
 */
export function JourneyOutline({ studyId, runs, current, onGo }: { studyId: string; runs: readonly PhaseRun[]; current: number; onGo: (index: number) => void }) {
  const { t } = useTranslation();
  const name = usePhaseName();
  // One entry per phase where it first appears; a phase met again later goes to its first place.
  const entries = runs
    .map((run, index) => ({ run, index }))
    .filter(({ run }, i, all) => run.phase && all.findIndex((e) => e.run.phase === run.phase) === i);
  const currentPhase = runs[current]?.phase ?? null;
  // In a narrow pane the line scrolls sideways; the phase in view is kept in sight on it.
  const line = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = line.current;
    const here = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !here || nav.scrollWidth <= nav.clientWidth) return;
    const left = here.offsetLeft; // the line itself is positioned (sticky)
    if (left < nav.scrollLeft || left + here.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 16);
  }, [currentPhase]);
  return (
    <nav ref={line} aria-label={t("studies.journey.label")} className="sticky top-0 z-10 -mx-2 overflow-x-auto bg-pane-work px-2 [scrollbar-width:none]" data-journey="">
      <ol className="m-0 flex list-none items-center gap-0 whitespace-nowrap p-0 text-[0.875rem]">
        {entries.map(({ run, index }, i) => (
          <li key={run.phase} className="flex items-center">
            {i > 0 && (
              <span aria-hidden="true" className="px-0.5 text-text-muted">
                ·
              </span>
            )}
            <button
              type="button"
              aria-current={run.phase === currentPhase ? "step" : undefined}
              aria-controls={runId(studyId, index)}
              aria-label={t("studies.journey.goTo", { phase: name(run.phase!) })}
              onClick={() => onGo(index)}
              className="aw-tab min-h-10 !px-1.5 text-[0.875rem]"
            >
              {name(run.phase!)}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The run of the study's parts in view: the last whose top has passed the
 * outline at the top of the pane. Read on scroll (one frame at a time) and on
 * resize; nothing is measured while nothing moves.
 */
export function useCurrentRun(article: RefObject<HTMLElement | null>, studyId: string, count: number, enabled: boolean, activeSection: string | null = null): number {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const root = article.current?.closest<HTMLElement>("[data-scroll-root]") ?? null;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      // The part being worked in, while it is on screen, says where the person is.
      const active = activeSection ? document.getElementById(`section-anchor-${activeSection}`) : null;
      const activeBox = active?.getBoundingClientRect();
      const activeRun = active?.closest<HTMLElement>("[data-phase-run]");
      if (activeBox && activeRun && activeBox.bottom > box.top + 48 && activeBox.top < box.bottom) {
        setCurrent(Number(activeRun.dataset.phaseRun));
        return;
      }
      // Otherwise the last phase whose start has passed the upper third of the pane.
      const line = box.top + box.height / 3;
      let found = 0;
      for (let i = 0; i < count; i++) {
        const el = document.getElementById(runId(studyId, i));
        if (el && el.getBoundingClientRect().top <= line) found = i;
      }
      // At the very end of the study the last phase is the one in view, however short it is.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) found = count - 1;
      setCurrent(found);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [article, studyId, count, enabled, activeSection]);
  return Math.min(current, Math.max(0, count - 1));
}

/**
 * A run of parts of one phase: named above when the name adds something,
 * set apart from the phase before by space and a firmer rule (no box, no
 * colour of its own). The group is announced with its phase's name.
 */
export function PhaseGroup({ id, index, label, first, children }: { id: string; index: number; label: string | null; first: boolean; children: ReactNode }) {
  const labelId = `${id}-label`;
  return (
    <div
      id={id}
      data-phase-run={index}
      role="group"
      aria-labelledby={label ? labelId : undefined}
      // A new phase begins with more space and a firmer rule than a new part within one.
      className={`aw-phase scroll-mt-14 flex flex-col gap-3 ${first ? "" : "mt-6"}`}
    >
      {label && (
        <p id={labelId} className="caps-label m-0 -mb-1.5 text-text-muted">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The end of the study's movement (v0.18.6): a quiet, optional way on to a
 * Bible Teaching. Nothing says a study must become one; where one has been
 * prepared, it is named and opened instead.
 */
export function NextStep({ teachings, onOpenTeaching }: { teachings: readonly TeachingSummary[] | null; onOpenTeaching: () => void }) {
  const { t } = useTranslation();
  if (teachings === null) return null;
  const text =
    teachings.length === 0
      ? t("studies.journey.next.ready")
      : teachings.length === 1
        ? t("studies.journey.next.existing", { title: teachings[0]!.title })
        : t("studies.journey.next.existingMany", { count: teachings.length });
  return (
    <aside aria-label={t("studies.view.teaching")} className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
      <p className="type-meta m-0 min-w-0 flex-1 basis-64">{text}</p>
      <Button variant="quiet" className="min-h-11" onClick={onOpenTeaching}>
        {teachings.length === 0 ? t("studies.journey.next.prepare") : t("studies.journey.next.open")}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </aside>
  );
}
