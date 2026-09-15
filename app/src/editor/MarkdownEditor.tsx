import { AtomicCodeMirrorEditor, type AtomicCodeMirrorEditorHandle } from "@atomic-editor/editor";
import { ATOMIC_CODE_LANGUAGES } from "@atomic-editor/editor/code-languages";
import "@atomic-editor/editor/styles.css";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { resolvedTheme } from "../core/theme/theme";
import { useSetting } from "../stores/settings";
import { wrapSelection } from "./commands";
import { mathPreview } from "./extensions/math";
import { pageLinks } from "./extensions/pageLinks";
import { timestampChips } from "./extensions/timestampChip";
import "./editor.css";

export type EditorMode = "live" | "source" | "reading";

export interface MarkdownEditorHandle {
  getView: () => EditorView | null;
  focus: () => void;
  getMarkdown: () => string;
}

interface Props {
  /** Changing this remounts the editor with `value` (deckId:page). */
  documentId: string;
  value: string;
  mode: EditorMode;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Smaller type for text boxes on the page (docs/SPEC.md 6.5.5). */
  compact?: boolean;
  fontSize?: number;
  pageCount?: number;
  onOpenPage?: (page0: number) => void;
  /** Present in replay: clicking a `[12:03]` chip seeks. */
  onTimestampClick?: ((ms: number) => void) | null;
  /** Returns the token to insert for Ctrl+Shift+T, or null when unavailable. */
  timestampToken?: () => string | null;
  autoFocus?: boolean;
  onBlur?: () => void;
  handleRef?: Ref<MarkdownEditorHandle>;
  /** Extra CodeMirror extensions, captured at mount (key them with documentId). */
  extraExtensions?: Extension[];
}

function openExternal(url: string) {
  openUrl(url).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

/** Obsidian-style live preview editor with source and reading modes (docs/SPEC.md 6.5.7). */
export function MarkdownEditor({
  documentId,
  value,
  mode,
  onChange,
  placeholder,
  compact,
  fontSize,
  pageCount = 0,
  onOpenPage,
  onTimestampClick = null,
  timestampToken,
  autoFocus,
  onBlur,
  handleRef,
  extraExtensions,
}: Props) {
  const themePref = useSetting("theme");
  const [scheme, setScheme] = useState(() => resolvedTheme(themePref));
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setScheme(resolvedTheme(themePref));
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [themePref]);

  const atomicRef = useRef<AtomicCodeMirrorEditorHandle | null>(null);
  const sourceViewRef = useRef<EditorView | null>(null);
  const sourceHost = useRef<HTMLDivElement>(null);
  const latest = useRef({ onChange, onOpenPage, onTimestampClick, timestampToken, pageCount, onBlur });
  latest.current = { onChange, onOpenPage, onTimestampClick, timestampToken, pageCount, onBlur };
  // The text an editor starts from when it (re)mounts: the prop for a new document,
  // otherwise whatever was typed since. A mode switch must never fall back to the
  // last saved value (audit F1).
  const doc = useRef({ id: documentId, text: value });
  if (doc.current.id !== documentId) doc.current = { id: documentId, text: value };
  const emit = (md: string) => {
    doc.current.text = md;
    latest.current.onChange(md);
  };

  const getView = () => {
    if (mode === "source") return sourceViewRef.current;
    const dom = atomicRef.current?.getContentDOM();
    return dom ? EditorView.findFromDOM(dom) : null;
  };

  useImperativeHandle(
    handleRef,
    () => ({
      getView,
      focus: () => (mode === "source" ? sourceViewRef.current?.focus() : atomicRef.current?.focus()),
      getMarkdown: () => (mode === "source" ? (sourceViewRef.current?.state.doc.toString() ?? doc.current.text) : (atomicRef.current?.getMarkdown() ?? doc.current.text)),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, documentId],
  );

  // Extensions are captured at mount by atomic-editor, so key them on documentId.
  const sharedExtensions = useMemo<Extension[]>(
    () => [
      cmPlaceholder(placeholder ?? ""),
      timestampChips(latest.current.onTimestampClick ? (ms) => latest.current.onTimestampClick?.(ms) : null),
      mathPreview(),
      pageLinks({ pageCount: () => latest.current.pageCount, onOpen: (p) => latest.current.onOpenPage?.(p) }),
      Prec.high(
        keymap.of([
          { key: "Mod-b", run: (v) => (wrapSelection(v, "**"), true) },
          { key: "Mod-i", run: (v) => (wrapSelection(v, "*"), true) },
          {
            key: "Mod-Shift-t",
            run: (v) => {
              const token = latest.current.timestampToken?.();
              if (!token) return false;
              const { from, to } = v.state.selection.main;
              v.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } });
              return true;
            },
          },
        ]),
      ),
      EditorView.domEventHandlers({
        blur: () => {
          latest.current.onBlur?.();
          return false;
        },
      }),
      ...(extraExtensions ?? []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentId, placeholder, onTimestampClick !== null],
  );

  // atomic-editor never focuses itself; do it after mount when asked.
  useEffect(() => {
    if (!autoFocus || mode === "source") return;
    const t = window.setTimeout(() => atomicRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [autoFocus, mode, documentId]);

  // ----- source mode: a plain CodeMirror view -----
  useEffect(() => {
    if (mode !== "source" || !sourceHost.current) return;
    const readOnly = new Compartment();
    const view = new EditorView({
      parent: sourceHost.current,
      state: EditorState.create({
        doc: doc.current.text,
        extensions: [
          history(),
          markdown({ base: markdownLanguage, codeLanguages: ATOMIC_CODE_LANGUAGES }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          readOnly.of(EditorState.readOnly.of(false)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) emit(u.state.doc.toString());
          }),
          ...sharedExtensions,
        ],
      }),
    });
    sourceViewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      sourceViewRef.current = null;
    };
    // value is the mount-time document; later edits flow through onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, documentId, sharedExtensions]);

  const cls = ["md-editor", compact ? "compact" : "", mode === "reading" ? "reading" : "", mode === "source" ? "source" : ""]
    .filter(Boolean)
    .join(" ");
  const style = fontSize ? ({ "--md-editor-size": `${fontSize}px` } as React.CSSProperties) : undefined;

  if (mode === "source") {
    return <div className={cls} data-theme={scheme} style={style} ref={sourceHost} />;
  }
  return (
    <div className={cls} data-theme={scheme} style={style}>
      <AtomicCodeMirrorEditor
        key={documentId}
        documentId={documentId}
        markdownSource={doc.current.text}
        readOnly={mode === "reading"}
        onMarkdownChange={emit}
        onLinkClick={openExternal}
        editorHandleRef={atomicRef}
        codeLanguages={ATOMIC_CODE_LANGUAGES}
        extensions={sharedExtensions}
        blurEditorOnMount={!autoFocus}
      />
    </div>
  );
}
