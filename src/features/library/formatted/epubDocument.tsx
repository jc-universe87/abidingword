import { createElement, memo, useCallback, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { safeExternalUrl } from "@/lib/externalLink";
import type { EpubElement, EpubItem, EpubNode } from "@/types/library";

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

interface Context {
  onLink: (target: EpubLinkTarget) => void;
  /** Opens a web address (checked again here) in the system browser; without it a web link is plain text. */
  onExternal?: (url: string) => void;
  tableLabel: string;
}

function renderNode(node: EpubNode, key: number, ctx: Context): ReactNode {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || typeof node.t !== "string" || !TAGS.has(node.t)) return null;
  const children = VOID.has(node.t) ? undefined : (node.c ?? []).map((child, i) => renderNode(child, i, ctx));
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

export function renderEpubNodes(nodes: EpubNode[], ctx: Context): ReactNode[] {
  return nodes.map((node, i) => renderNode(node, i, ctx));
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
}

/** One page of the book, in a shadow root of its own. */
export const EpubDocument = memo(function EpubDocument({ item, onLink, onExternal, tableLabel, onRoot, onDrawn }: EpubDocumentProps) {
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
  const body = useMemo(() => renderEpubNodes(item.nodes, { onLink, onExternal, tableLabel }), [item.nodes, onLink, onExternal, tableLabel]);
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
