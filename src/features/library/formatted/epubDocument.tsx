import { createElement, Fragment, memo, useCallback, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { safeExternalUrl } from "@/lib/externalLink";
import type { EpubElement, EpubItem, EpubNode } from "@/types/library";
import type { DetectedReference, ScriptureRef } from "@/types/scripture";
import { ScriptureReference, type ScriptureReferenceClasses } from "../ScriptureReference";

/**
 * A formatted EPUB page, drawn by the interface from the tree the core built
 * (see `adapters/epub_view.rs`). The page is untrusted, so:
 *
 * - No markup is ever parsed here. The tree is turned into elements one at a
 *   time, and only from the lists below: an unknown tag, attribute or style
 *   property is not drawn, whatever the core sent (a second, independent check
 *   behind the core's own).
 * - Text is text. A link is an ordinary anchor whose click is handled by the
 *   reader (it never navigates the web view); nothing is ever opened.
 * - A Scripture reference found in a piece of text (by the core, in the
 *   source's language) is drawn around that same text as a quiet "Open in
 *   Bible" action (v0.11). The file is never changed, and text inside a link
 *   is left to the link.
 * - The page's style lives in a shadow root of its own: the book's CSS cannot
 *   reach anything outside it, and the app's styles do not reach in. The page
 *   is always a light sheet, like a PDF page, whatever the app's theme.
 */

const TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "blockquote", "pre", "code", "em", "i", "strong", "b", "u", "s",
  "small", "sub", "sup", "mark", "cite", "q", "abbr", "dfn", "kbd", "samp", "var", "time", "ruby", "rt", "rp", "br", "hr",
  "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "figure", "figcaption", "img", "a",
]);
const VOID = new Set(["br", "hr", "img", "col"]);
const ROLES = new Set(["doc-noteref", "doc-footnote", "doc-endnote", "doc-pagebreak", "doc-backlink"]);
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Attribute name as the core sends it → the React prop. Anything else is dropped. */
const ATTRS: Record<string, string> = {
  id: "id",
  class: "className",
  lang: "lang",
  dir: "dir",
  title: "title",
  role: "role",
  colSpan: "colSpan",
  rowSpan: "rowSpan",
  scope: "scope",
  start: "start",
  type: "type",
  value: "value",
  width: "width",
  height: "height",
  src: "src",
  alt: "alt",
};

/** A sanitised style attribute as a style object; anything with a resource or an odd character is skipped. */
function styleOf(text: string): CSSProperties | undefined {
  const style: Record<string, string> = {};
  for (const declaration of text.split(";")) {
    const at = declaration.indexOf(":");
    if (at < 0) continue;
    const property = declaration.slice(0, at).trim();
    const value = declaration.slice(at + 1).trim();
    if (!/^[a-z-]+$/.test(property) || !value || /url\(|expression|javascript|[\\<>{}@]/i.test(value)) continue;
    style[property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return Object.keys(style).length ? (style as CSSProperties) : undefined;
}

function propsOf(el: EpubElement): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(el.a ?? {})) {
    if (typeof value !== "string") continue;
    if (name === "style") {
      const style = styleOf(value);
      if (style) props.style = style;
      continue;
    }
    const prop = ATTRS[name];
    if (!prop) continue;
    if (name === "role" && !ROLES.has(value)) continue;
    if (name === "src" && !IMAGE_URL.test(value)) continue;
    props[prop] = value;
  }
  return props;
}

export interface EpubLinkTarget {
  item: string;
  id: string | null;
  /** Followed from the keyboard (not a pointer click). */
  keyboard?: boolean;
}

/** A person's mark on part of one drawn text piece (v0.14): UTF-16 offsets into that piece. */
export interface TextMark {
  id: string;
  start: number;
  end: number;
  /** Highlight colour; null for noted words. */
  color: string | null;
  note: boolean;
}

interface Context {
  onLink: (target: EpubLinkTarget) => void;
  /** The person's marks, by the index of the text piece they are on (in drawing order, see `drawnStrings`). */
  marks?: Map<number, TextMark[]>;
  /** Counts the text pieces as they are drawn, so each finds its marks. */
  counter: { n: number };
  /** Opens a web address (checked again here) in the system browser; without it a web link is plain text. */
  onExternal?: (url: string) => void;
  tableLabel: string;
  /** Scripture references found in pieces of the page's text, by that text. */
  references?: Map<string, DetectedReference[]>;
  onScripture?: (reference: ScriptureRef) => void;
  /** Inside a link: its text stays plain (no control inside another). */
  inLink?: boolean;
}

/** The look of a Scripture reference on the page (the page has its own styles, in its shadow root). */
const PAGE_REFERENCE_CLASSES: ScriptureReferenceClasses = { wrap: "aw-sref", trigger: "aw-sref-trigger", menu: "aw-sref-menu", item: "aw-sref-item" };

/**
 * `text.slice(from, to)` with the person's marks drawn in it: a highlight in its colour, noted words
 * underlined with dots. Marks crossing the edges are cut to them; the text itself is kept exactly.
 */
function marked(text: string, from: number, to: number, marks: TextMark[] | undefined): ReactNode {
  if (!marks || marks.length === 0) return text.slice(from, to);
  const cuts = new Set([from, to]);
  for (const m of marks) [m.start, m.end].forEach((x) => x > from && x < to && cuts.add(x));
  const points = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const over = marks.filter((m) => m.start <= a && m.end >= b);
    if (over.length === 0) {
      out.push(text.slice(a, b));
      continue;
    }
    const color = over.find((m) => m.color)?.color ?? null;
    const note = over.some((m) => m.note);
    const classes = ["aw-mark", color ? `aw-mark-${color}` : "", note ? "aw-mark-note" : ""].filter(Boolean).join(" ");
    out.push(
      <mark key={`m${a}`} className={classes} data-mark-id={over[0]!.id} data-mark={color ?? "note"}>
        {text.slice(a, b)}
      </mark>,
    );
  }
  return out.length === 1 ? out[0] : out;
}

/** A piece of text with its Scripture references as actions (and the person's marks); everything between them kept exactly. */
function textWithReferences(text: string, found: DetectedReference[], onScripture: (reference: ScriptureRef) => void, marks?: TextMark[]): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const ref of [...found].sort((a, b) => a.start - b.start)) {
    if (ref.start < at || ref.end > text.length || ref.start >= ref.end) continue;
    if (ref.start > at) out.push(<Fragment key={`t${at}`}>{marked(text, at, ref.start, marks)}</Fragment>);
    out.push(
      <ScriptureReference key={`${ref.start}-${ref.end}`} reference={ref.reference} onOpen={onScripture} classes={PAGE_REFERENCE_CLASSES}>
        {marked(text, ref.start, ref.end, marks)}
      </ScriptureReference>,
    );
    at = ref.end;
  }
  if (at < text.length) out.push(<Fragment key={`t${at}`}>{marked(text, at, text.length, marks)}</Fragment>);
  return out;
}

/**
 * The page's text pieces in the order they are drawn (v0.14): what the stored text is placed on
 * to draw marks. Walks exactly as drawing does: elements that are not drawn, and the inside of
 * empty ones, are left out.
 */
export function drawnStrings(nodes: EpubNode[]): string[] {
  const out: string[] = [];
  const walk = (node: EpubNode) => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (!node || typeof node !== "object" || typeof node.t !== "string" || !TAGS.has(node.t)) return;
    if (VOID.has(node.t)) return;
    for (const child of node.c ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

/** The pieces of a page's text that may hold a Scripture reference (not inside a link; once each). */
export function pageTexts(nodes: EpubNode[]): string[] {
  const out = new Set<string>();
  const walk = (node: EpubNode, inLink: boolean) => {
    if (typeof node === "string") {
      if (!inLink && /\d/.test(node)) out.add(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const child of node.c ?? []) walk(child, inLink || node.t === "a");
  };
  for (const node of nodes) walk(node, false);
  return [...out];
}

function renderNode(node: EpubNode, key: number, ctx: Context): ReactNode {
  if (typeof node === "string") {
    const marks = ctx.marks?.get(ctx.counter.n++);
    const found = !ctx.inLink && ctx.onScripture ? ctx.references?.get(node) : undefined;
    if (found && found.length > 0 && ctx.onScripture) return textWithReferences(node, found, ctx.onScripture, marks);
    return marks ? <Fragment key={key}>{marked(node, 0, node.length, marks)}</Fragment> : node;
  }
  if (!node || typeof node !== "object" || typeof node.t !== "string" || !TAGS.has(node.t)) return null;
  const inner = node.t === "a" && !ctx.inLink ? { ...ctx, inLink: true } : ctx;
  const children = VOID.has(node.t) ? undefined : (node.c ?? []).map((child, i) => renderNode(child, i, inner));
  const props: Record<string, unknown> = { key, ...propsOf(node) };
  if (node.t === "a") {
    const target = node.l;
    const web = !target && ctx.onExternal ? safeExternalUrl(node.x) : null;
    if (web) {
      // A link to the web: a link in name only. The href is never the address (so no middle-click or
      // context-menu route out of the reader); a click hands the checked address to the system browser.
      props.href = "#";
      props.title = web;
      props.onClick = (event: { preventDefault(): void }) => {
        event.preventDefault();
        ctx.onExternal?.(web);
      };
    } else if (!target || typeof target.item !== "string") {
      return children;
    } else {
      // Never an address: the reader decides where the link goes.
      props.href = "#";
      props.onClick = (event: { preventDefault(): void; detail: number }) => {
        event.preventDefault();
        // Enter on a link is a click with no click count; a pointer click counts at least one.
        ctx.onLink({ item: target.item, id: typeof target.id === "string" ? target.id : null, keyboard: event.detail === 0 });
      };
    }
  }
  if (node.t === "table") {
    // A table wider than the page scrolls within itself, and can be reached by keyboard.
    return (
      <div key={key} className="aw-table-scroll" tabIndex={0} role="group" aria-label={ctx.tableLabel}>
        {createElement("table", { ...props, key: undefined }, children)}
      </div>
    );
  }
  return createElement(node.t, props, children);
}

export function renderEpubNodes(nodes: EpubNode[], ctx: Omit<Context, "counter">): ReactNode[] {
  const counted: Context = { ...ctx, counter: { n: 0 } };
  return nodes.map((node, i) => renderNode(node, i, counted));
}

const LINK = "#762e32";
const FOCUS = "#2563eb";

/** The reader's own defaults for a page; the book's style comes after, and a few protections come last. */
const BASE_CSS = `
:host { display: block; }
.aw-doc { box-sizing: border-box; max-width: 46rem; margin: 0 auto; padding: 1.75rem 1.5rem 5rem; background: #fff; color: #1d1b17;
  font-family: "Noto Serif", Georgia, "Times New Roman", serif; font-size: 1.0625rem; line-height: 1.65; overflow-wrap: break-word; }
.aw-doc h1, .aw-doc h2, .aw-doc h3, .aw-doc h4, .aw-doc h5, .aw-doc h6 { line-height: 1.25; margin: 1.4em 0 0.5em; }
.aw-doc h1 { font-size: 1.7em; } .aw-doc h2 { font-size: 1.4em; } .aw-doc h3 { font-size: 1.2em; }
.aw-doc p { margin: 0 0 0.9em; }
.aw-doc blockquote { margin: 1em 1.5em; }
.aw-doc ul, .aw-doc ol { margin: 0 0 1em; padding-left: 1.75em; }
.aw-doc li { margin: 0.2em 0; }
.aw-doc hr { border: 0; border-top: 1px solid #c9c3b6; margin: 1.5em 0; }
.aw-doc figure { margin: 1.25em 0; }
.aw-doc figcaption, .aw-doc caption { font-size: 0.9em; color: #555; }
.aw-doc table { border-collapse: collapse; margin: 1em 0; }
.aw-doc th, .aw-doc td { border: 1px solid #c9c3b6; padding: 0.35em 0.6em; vertical-align: top; text-align: left; }
.aw-doc th { background: #f4f0e8; }
.aw-doc sup, .aw-doc sub { line-height: 0; }
.aw-doc a { color: ${LINK}; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.aw-doc a:focus-visible, .aw-table-scroll:focus-visible { outline: 2px solid ${FOCUS}; outline-offset: 2px; }
.aw-doc .aw-missing-image { display: inline-block; padding: 0.15em 0.5em; border: 1px dashed #999; color: #555; font-size: 0.9em; }
.aw-table-scroll { overflow-x: auto; max-width: 100%; margin: 1em 0; }
.aw-table-scroll table { margin: 0; }
.aw-doc mark.aw-mark { color: inherit; background: transparent; padding: 0; }
.aw-doc mark.aw-mark-amber { background: #f0d78c; } .aw-doc mark.aw-mark-green { background: #bcd9b0; }
.aw-doc mark.aw-mark-blue { background: #b9d1e8; } .aw-doc mark.aw-mark-rose { background: #ecc0c4; }
.aw-doc mark.aw-mark-grey { background: #d3d0c8; }
.aw-doc mark.aw-mark-note { text-decoration: underline dotted 2px #b45309; text-underline-offset: 4px; }
.aw-sref { position: relative; display: inline; }
.aw-sref-trigger { all: unset; display: inline; cursor: pointer; text-decoration: underline dotted 1px; text-underline-offset: 3px; }
.aw-sref-trigger:hover { text-decoration-style: solid; }
.aw-sref-trigger:focus-visible { outline: 2px solid ${FOCUS}; outline-offset: 1px; border-radius: 2px; }
.aw-sref-trigger[aria-expanded="true"] { background: #fbf3d8; }
.aw-sref-menu { position: absolute; left: 0; top: 100%; z-index: 5; margin-top: 4px; display: flex; flex-direction: column; min-width: max-content;
  padding: 4px; background: #fff; border: 1px solid #c9c3b6; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.aw-sref-item { all: unset; box-sizing: border-box; min-height: 2.5rem; padding: 0 0.75rem; display: flex; align-items: center; white-space: nowrap; cursor: pointer;
  font-family: system-ui, sans-serif; font-size: 0.9375rem; color: #1d1b17; border-radius: 4px; }
.aw-sref-item:hover { background: #f4f0e8; }
.aw-sref-item:focus-visible { outline: 2px solid ${FOCUS}; outline-offset: 1px; }
`;

/** Last of all: whatever a book says, a page stays inside the reader. */
const GUARD_CSS = `
.aw-doc { margin-left: auto !important; margin-right: auto !important; max-width: 46rem !important; width: auto !important;
  padding-left: 1.5rem !important; padding-right: 1.5rem !important; box-sizing: border-box !important; }
.aw-doc img, .aw-doc svg { max-width: 100% !important; height: auto !important; }
.aw-doc pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
.aw-doc * { max-width: 100%; box-sizing: border-box; }
.aw-doc .aw-table-scroll table { max-width: none; }
`;

interface EpubDocumentProps {
  item: EpubItem;
  onLink: (target: EpubLinkTarget) => void;
  /** Opens a web address in the system browser; absent: web links are plain text. */
  onExternal?: (url: string) => void;
  tableLabel: string;
  /** Receives the page's shadow root (null when it goes), so the reader can find places in it. */
  onRoot?: (root: ShadowRoot | null) => void;
  /** Called once the page's content is in its shadow root (it is drawn a render after the root exists). */
  onDrawn?: () => void;
  /** Scripture references found in the page's text, by text; drawn as "Open in Bible" actions. */
  references?: Map<string, DetectedReference[]>;
  onScripture?: (reference: ScriptureRef) => void;
  /** The person's marks, by text piece (v0.14). */
  marks?: Map<number, TextMark[]>;
}

/** One page of the book, in a shadow root of its own. */
export const EpubDocument = memo(function EpubDocument({ item, onLink, onExternal, tableLabel, onRoot, onDrawn, references, onScripture, marks }: EpubDocumentProps) {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    if (shadow) onDrawn?.();
  }, [shadow, onDrawn]);
  const attach = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) {
        onRoot?.(null);
        return;
      }
      const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      setShadow(root);
      onRoot?.(root);
    },
    [onRoot],
  );
  const css = useMemo(() => `${BASE_CSS}\n${item.css.replace(/@import/gi, "")}\n${GUARD_CSS}`, [item.css]);
  const bodyProps = useMemo(() => {
    const { id: _id, ...rest } = propsOf({ t: "div", a: item.root });
    void _id; // the body's id is not a place of the page
    return rest;
  }, [item.root]);
  const body = useMemo(
    () => renderEpubNodes(item.nodes, { onLink, onExternal, tableLabel, references, onScripture, marks }),
    [item.nodes, onLink, onExternal, tableLabel, references, onScripture, marks],
  );
  const className = ["aw-doc", typeof bodyProps.className === "string" ? bodyProps.className : ""].join(" ").trim();
  return (
    <div ref={attach} data-testid="epub-page">
      {shadow &&
        createPortal(
          <>
            <style>{css}</style>
            <div {...bodyProps} className={className}>
              {body}
            </div>
          </>,
          shadow as unknown as Element,
        )}
    </div>
  );
});
