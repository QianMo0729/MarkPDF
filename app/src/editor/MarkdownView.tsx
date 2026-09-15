import katex from "katex";
import MarkdownIt from "markdown-it";
import { useMemo } from "react";
import { parseClock } from "../core/utils/time";
import { pageLinkTarget } from "./extensions/pageLinks";
import "./editor.css";

// breaks: true — a single newline is a line break (text boxes on the page behave like Edge's "add text").
const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

// Open links externally; markdown-it renders <a href> — the click handler below routes them.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener");
  return self.renderToken(tokens, idx, options);
};

interface Protected {
  html: string;
}

/**
 * Pull math, timestamps and page links out before markdown-it sees them,
 * then splice the rendered HTML back in. Placeholders use a private-use
 * codepoint so they survive markdown-it untouched.
 */
function preprocess(source: string): { text: string; slots: Protected[] } {
  const slots: Protected[] = [];
  const keep = (html: string) => {
    slots.push({ html });
    return `${slots.length - 1}`;
  };
  let text = source.replace(/\$\$([\s\S]+?)\$\$/g, (_m, src: string) =>
    keep(`<div class="md-math md-math-block">${katex.renderToString(src.trim(), { displayMode: true, throwOnError: false })}</div>`),
  );
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (m, src: string) => {
    if (/^\s|\s$/.test(src)) return m;
    return keep(`<span class="md-math md-math-inline">${katex.renderToString(src.trim(), { displayMode: false, throwOnError: false })}</span>`);
  });
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target: string, label?: string) => {
    const page0 = pageLinkTarget(target);
    if (page0 === null) return m;
    return keep(`<span class="md-chip md-chip-page" data-page="${page0}" role="link">${escapeHtml(label ?? `第 ${page0 + 1} 页`)}</span>`);
  });
  text = text.replace(/\[(\d{1,2}:)?\d{1,2}:\d{2}\]/g, (m) => {
    const inner = m.slice(1, -1);
    const ms = parseClock(inner);
    if (ms === null) return m;
    return keep(`<span class="md-chip md-chip-time" data-ms="${ms}">${inner}</span>`);
  });
  return { text, slots };
}

export function renderMarkdown(source: string): string {
  const { text, slots } = preprocess(source);
  const html = md.render(text);
  return html.replace(/(\d+)/g, (_m, i: string) => slots[Number(i)]?.html ?? "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

interface Props {
  source: string;
  className?: string;
  onOpenPage?: (page0: number) => void;
  onTimestampClick?: (ms: number) => void;
  onLinkClick?: (url: string) => void;
}

/** Read-only renderer (text boxes, summaries, "当时的笔记"). */
export function MarkdownView({ source, className, onOpenPage, onTimestampClick, onLinkClick }: Props) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className={`md-view ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest("[data-page],[data-ms],a[href]") as HTMLElement | null;
        if (!el) return;
        if (el.dataset.page !== undefined) {
          e.preventDefault();
          onOpenPage?.(Number(el.dataset.page));
        } else if (el.dataset.ms !== undefined) {
          e.preventDefault();
          onTimestampClick?.(Number(el.dataset.ms));
        } else if (el instanceof HTMLAnchorElement) {
          e.preventDefault();
          onLinkClick?.(el.href);
        }
      }}
    />
  );
}
