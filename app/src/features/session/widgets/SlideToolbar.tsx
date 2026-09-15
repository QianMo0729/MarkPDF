import { HIGHLIGHT_COLORS, INK_COLORS, TEXT_BOX_FILL_COLORS } from "../../../core/palette";
import { Fragment } from "react";
import { S } from "../../../core/strings";
import { useContextMenu } from "../../../core/ui/ContextMenu";
import { Icon } from "../../../core/ui/Icon";
import { useSettings } from "../../../stores/settings";
import { useSessionUi, useViewerState, type Tool } from "../sessionStore";
import { RecordButton } from "./RecordButton";
import "./toolbar.css";

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "select", icon: "arrow_selector_tool", label: S.tools.select, key: "V" },
  { id: "highlight", icon: "ink_highlighter", label: S.tools.highlight, key: "H" },
  { id: "draw", icon: "draw", label: S.tools.draw, key: "D" },
  { id: "text", icon: "text_fields", label: S.tools.text, key: "T" },
  { id: "erase", icon: "ink_eraser", label: S.tools.erase, key: "E" },
];

const INK_WIDTHS = [1, 2, 4, 8];
const FONT_SIZES = [0, 12, 16, 20, 24, 32];
const fontLabel = (f: number) => (f === 0 ? "自动" : `${f} pt`);
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

interface Props {
  onSearch: () => void;
  /** Deck reader: the record button starts a class on this deck (docs/SPEC.md 6.5.3). */
  onStartClass?: () => void;
  onExportPdf: () => void;
  onExportMarkdown: () => void;
  onPrint: () => void;
}

/** Edge-aligned tool strip above the viewer (docs/SPEC.md 6.5.3). */
export function SlideToolbar({ onSearch, onStartClass, onExportPdf, onExportMarkdown, onPrint }: Props) {
  const tool = useSessionUi((s) => s.tool);
  const mode = useSessionUi((s) => s.mode);
  const setTool = useSessionUi((s) => s.setTool);
  const controller = useSessionUi((s) => s.controller);
  const state = useViewerState();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const zoomMenu = useContextMenu();
  const viewMenu = useContextMenu();
  const exportMenu = useContextMenu();
  const widthMenu = useContextMenu();
  const fontMenu = useContextMenu();

  const zoomLabel =
    state.scaleValue === "page-width" ? S.tools.fitWidth : state.scaleValue === "page-fit" ? S.tools.fitPage : `${Math.round(state.scale * 100)}%`;

  return (
    <div className="slide-toolbar" role="toolbar" aria-label="PDF 工具">
      <div className="tool-group" role="group" aria-label="PDF 跳转历史">
        <button className="icon-btn" aria-label="返回上个阅读位置" title="返回上个阅读位置" disabled={!state.canGoBack} onClick={() => controller?.goBack()}>
          <Icon name="arrow_back" size={20} />
        </button>
        <button className="icon-btn" aria-label="前进到下个阅读位置" title="前进到下个阅读位置" disabled={!state.canGoForward} onClick={() => controller?.goForward()}>
          <Icon name="arrow_forward" size={20} />
        </button>
      </div>
      <span className="toolbar-sep" />
      <div className="tool-group">
        {TOOLS.map((t) => (
          <Fragment key={t.id}>
            {/* select | highlight draw text erase */}
            {t.id === "highlight" && <span className="toolbar-sep" />}
            <button
              className={`icon-btn ${tool === t.id ? "active" : ""}`}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.id)}
            >
              <Icon name={t.icon} size={20} />
            </button>
          </Fragment>
        ))}
      </div>
      <span className="toolbar-sep" />
      {mode === "live" && (
        <>
          <RecordButton compact currentPage={state.currentPage} />
          <span className="toolbar-sep" />
        </>
      )}
      {mode === "reading" && onStartClass && (
        <>
          <RecordButton compact currentPage={state.currentPage} onStart={onStartClass} />
          <span className="toolbar-sep" />
        </>
      )}
      {tool === "highlight" && <Swatches colors={HIGHLIGHT_COLORS} value={settings.highlightColor} onChange={(c) => set("highlightColor", c)} />}
      {tool === "draw" && (
        <>
          <Swatches colors={INK_COLORS} value={settings.inkColor} onChange={(c) => set("inkColor", c)} />
          <button className="btn btn-outlined toolbar-small" onClick={(e) => widthMenu.open(e, INK_WIDTHS.map((w) => ({ label: `${w} pt`, onClick: () => set("inkWidth", w) })))}>
            {settings.inkWidth} pt
          </button>
        </>
      )}
      {tool === "text" && (
        <>
          <Swatches colors={INK_COLORS} value={settings.textColor} onChange={(c) => set("textColor", c)} />
          <button className="btn btn-outlined toolbar-small" onClick={(e) => fontMenu.open(e, FONT_SIZES.map((f) => ({ label: fontLabel(f), onClick: () => set("textBoxFontSize", f) })))}>
            {fontLabel(settings.textBoxFontSize)}
          </button>
          <span className="toolbar-sep" />
          <span className="text2 row" title={S.tools.border}>
            <Icon name="border_color" size={16} />
          </span>
          <Swatches colors={INK_COLORS} value={settings.textBoxBorderColor} allowNone onChange={(c) => set("textBoxBorderColor", c)} />
          <span className="text2 row" title={S.tools.fill}>
            <Icon name="format_color_fill" size={16} />
          </span>
          <Swatches colors={TEXT_BOX_FILL_COLORS} value={settings.textBoxFillColor} allowNone onChange={(c) => set("textBoxFillColor", c)} />
        </>
      )}
      <span className="grow" />
      <button className="icon-btn" aria-label={S.tools.zoomOut} title={`${S.tools.zoomOut} (Ctrl −)`} onClick={() => controller?.zoomOut()}>
        <Icon name="remove" size={20} />
      </button>
      <button
        className="btn btn-text toolbar-small tabular"
        onClick={(e) =>
          zoomMenu.open(e, [
            { label: S.tools.fitWidth, onClick: () => controller?.setScaleValue("page-width") },
            { label: S.tools.fitPage, onClick: () => controller?.setScaleValue("page-fit") },
            ...ZOOM_PRESETS.map((z) => ({ label: `${Math.round(z * 100)}%`, onClick: () => controller?.setScaleValue(String(z)) })),
          ])
        }
      >
        {zoomLabel}
      </button>
      <button className="icon-btn" aria-label={S.tools.zoomIn} title={`${S.tools.zoomIn} (Ctrl +)`} onClick={() => controller?.zoomIn()}>
        <Icon name="add" size={20} />
      </button>
      <span className="toolbar-sep" />
      <button className="icon-btn" aria-label={S.tools.rotate} title={S.tools.rotate} onClick={() => controller?.rotate(90)}>
        <Icon name="rotate_right" size={20} />
      </button>
      <button
        className="icon-btn"
        aria-label={S.tools.view}
        title={S.tools.view}
        onClick={(e) =>
          viewMenu.open(e, [
            { label: `${state.viewMode === "single" ? "✓ " : ""}${S.tools.single}`, icon: "crop_portrait", onClick: () => controller?.setViewMode("single") },
            { label: `${state.viewMode === "continuous" ? "✓ " : ""}${S.tools.continuous}`, icon: "view_agenda", onClick: () => controller?.setViewMode("continuous") },
          ])
        }
      >
        <Icon name="view_agenda" size={20} />
      </button>
      <button className="icon-btn" aria-label={S.tools.search} title={`${S.tools.search} (Ctrl F)`} onClick={onSearch}>
        <Icon name="search" size={20} />
      </button>
      <button
        className="icon-btn"
        aria-label={S.tools.export}
        title={S.tools.export}
        onClick={(e) =>
          exportMenu.open(e, [
            { label: S.session.exportPdf, icon: "picture_as_pdf", onClick: onExportPdf },
            { label: S.session.exportMarkdown, icon: "description", onClick: onExportMarkdown },
            { label: S.session.print, icon: "print", onClick: onPrint },
          ])
        }
      >
        <Icon name="download" size={20} />
      </button>
      {zoomMenu.element}
      {viewMenu.element}
      {exportMenu.element}
      {widthMenu.element}
      {fontMenu.element}
    </div>
  );
}

function Swatches({ colors, value, allowNone, onChange }: { colors: string[]; value: string; allowNone?: boolean; onChange: (c: string) => void }) {
  return (
    <div className="tool-group" role="radiogroup">
      {allowNone && (
        <button role="radio" aria-checked={value === ""} aria-label={S.tools.none} title={S.tools.none} className={`tool-swatch none ${value === "" ? "selected" : ""}`} onClick={() => onChange("")} />
      )}
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          className={`tool-swatch ${c.toLowerCase() === value.toLowerCase() ? "selected" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
