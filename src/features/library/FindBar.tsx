import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/design-system/Button";
import { formatNumber } from "@/i18n/format";
import { useApi } from "@/lib/ApiContext";
import type { SourceFind, SourceMatch } from "@/types/library";

/** How long typing pauses before the source is searched. */
const SEARCH_DELAY_MS = 300;

/** What "Find in this source" has found, and which match is the current one. */
export interface FindState {
  /** The query as typed (kept while the bar is closed, for reopening). */
  query: string;
  /** The result for `searched`, or null before a search (or for a blank query). */
  result: SourceFind | null;
  /** The query `result` is for. */
  searched: string;
  /** Index into `result.matches` of the current match. */
  index: number;
  status: "idle" | "searching" | "done" | "failed";
}

export const NO_FIND: FindState = { query: "", result: null, searched: "", index: 0, status: "idle" };

/** The current match, if there is one. */
export const activeMatch = (find: FindState): SourceMatch | null => find.result?.matches[find.index] ?? null;

/**
 * Search one source (v0.13): the query is searched in the core after a short
 * pause in typing (or at once on Enter), and stepping moves the current
 * match. `onMatch` is told each time the current match changes, to show it.
 */
export function useSourceFind(sourceId: string, onMatch: (match: SourceMatch, find: FindState) => void) {
  const api = useApi();
  const [find, setFind] = useState<FindState>(NO_FIND);
  const findRef = useRef(find);
  const onMatchRef = useRef(onMatch);
  useEffect(() => {
    onMatchRef.current = onMatch;
  }, [onMatch]);
  const requests = useRef(0);
  const timer = useRef<number | null>(null);

  const update = (next: FindState) => {
    findRef.current = next;
    setFind(next);
  };

  const run = (query: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const request = ++requests.current;
    if (!query.trim()) {
      update({ ...findRef.current, result: null, searched: query, index: 0, status: "idle" });
      return;
    }
    update({ ...findRef.current, status: "searching" });
    api.librarySourceFind(sourceId, query).then(
      (result) => {
        if (request !== requests.current) return;
        update({ ...findRef.current, result, searched: query, index: 0, status: "done" });
        const first = result.matches[0];
        if (first) onMatchRef.current(first, findRef.current);
      },
      (e: unknown) => {
        if (request !== requests.current) return;
        void api.logError(`Find in the source failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
        update({ ...findRef.current, result: null, searched: query, index: 0, status: "failed" });
      },
    );
  };

  const step = (by: 1 | -1) => {
    const now = findRef.current;
    const count = now.result?.matches.length ?? 0;
    if (count === 0) return;
    const index = (now.index + by + count) % count;
    update({ ...now, index });
    onMatchRef.current(now.result!.matches[index]!, findRef.current);
  };

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      requests.current += 1;
    },
    [],
  );

  return {
    find,
    /** The query was typed: search it after a short pause. */
    type(query: string) {
      update({ ...findRef.current, query });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => run(query), SEARCH_DELAY_MS);
    },
    /** Enter: search now if the query changed, else step. */
    submit(backwards: boolean) {
      const now = findRef.current;
      if (now.query !== now.searched || now.status === "failed") run(now.query);
      else step(backwards ? -1 : 1);
    },
    step,
    /** Closing: highlights go, the query stays for next time. */
    clear() {
      if (timer.current !== null) window.clearTimeout(timer.current);
      requests.current += 1;
      update({ ...findRef.current, result: null, searched: "", index: 0, status: "idle" });
    },
  };
}

interface FindBarProps {
  find: FindState;
  /** Changes when the bar is asked for again (Ctrl+F while open): the query is focused and selected. */
  focusKey: number;
  onType: (query: string) => void;
  onSubmit: (backwards: boolean) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}

/** The find bar: query, where the current match is among all, Previous / Next, Close. */
export function FindBar({ find, focusKey, onType, onSubmit, onStep, onClose }: FindBarProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  const count = find.result?.matches.length ?? 0;
  const total = find.result?.total ?? 0;
  const status =
    find.status === "searching"
      ? t("library.find.searching")
      : find.status === "failed"
        ? t("library.find.failed")
        : find.result === null
          ? ""
          : total === 0
            ? t("library.find.none")
            : t(find.result.truncated ? "library.find.positionMore" : "library.find.position", {
                current: formatNumber(find.index + 1),
                total: formatNumber(total),
              });
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit(event.shiftKey);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div role="search" aria-label={t("library.find.label")} className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-subtle bg-bg-secondary px-3 py-1.5">
      <input
        ref={input}
        type="search"
        value={find.query}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={t("library.find.label")}
        placeholder={t("library.find.placeholder")}
        maxLength={200}
        className="min-h-9 min-w-0 flex-1 basis-40 rounded-aw border border-border bg-bg px-2 font-ui text-[0.9375rem] text-text"
      />
      <span role="status" aria-live="polite" className="min-w-[6rem] font-ui type-meta">
        {status}
      </span>
      <div className="flex shrink-0 items-center">
        <Button variant="quiet" aria-label={t("library.find.previous")} title={t("library.find.previous")} disabled={count === 0} onClick={() => onStep(-1)}>
          <ChevronUp className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="quiet" aria-label={t("library.find.next")} title={t("library.find.next")} disabled={count === 0} onClick={() => onStep(1)}>
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
        <Button variant="quiet" aria-label={t("library.find.close")} title={t("library.find.close")} onClick={onClose}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
