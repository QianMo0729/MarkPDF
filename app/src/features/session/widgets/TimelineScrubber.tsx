import { useCallback, useEffect, useRef, useState } from "react";
import { fmtClock } from "../../../core/utils/time";
import type { Timeline } from "../../../domain/timeline";
import "./scrubber.css";

interface Props {
  timeline: Timeline | null;
  durationMs: number;
  playheadMs: number;
  mode: "live" | "replay";
  onSeek?: (ms: number) => void;
  /** Called at most every 200 ms while dragging, and on release. */
}

const MARKER_COLORS: Record<string, string> = { important: "#F5C542", confused: "#F0803C", homework: "#2FA36B" };
const MARKER_LABEL: Record<string, string> = { important: "重点", confused: "没听懂", homework: "作业" };
const PAD = 16;
const TRACK_H = 16;

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Page bands, snapshot ticks, marker pins and the playhead (docs/SPEC.md 6.5.17). */
export function TimelineScrubber({ timeline, durationMs, playheadMs, mode, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  const lastSeek = useRef(0);

  const msAtX = useCallback(
    (clientX: number) => {
      const host = hostRef.current;
      if (!host || durationMs <= 0) return 0;
      const r = host.getBoundingClientRect();
      const frac = (clientX - r.left - PAD) / Math.max(1, r.width - 2 * PAD);
      return Math.round(Math.max(0, Math.min(1, frac)) * durationMs);
    },
    [durationMs],
  );

  // ----- draw -----
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const W = host.clientWidth;
    const H = host.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const width = W - 2 * PAD;
    const x = (ms: number) => PAD + (durationMs > 0 ? (ms / durationMs) * width : 0);
    const top = (H - TRACK_H) / 2;
    const c = {
      surface2: cssVar(host, "--surface2") || "#EDEFF2",
      alt: cssVar(host, "--scrubber-alt") || "#D9DCE1",
      text3: cssVar(host, "--text3") || "#8A919C",
      highlight: cssVar(host, "--highlight") || "#F5C542",
      accent: cssVar(host, "--accent") || "#4457D6",
      record: cssVar(host, "--record") || "#E5484D",
      surface: cssVar(host, "--surface") || "#fff",
    };

    // bands
    const intervals = timeline?.intervals ?? [];
    if (!intervals.length) {
      ctx.fillStyle = c.surface2;
      ctx.fillRect(PAD, top, width, TRACK_H);
    }
    ctx.font = "12px Source Sans 3, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    intervals.forEach((iv, i) => {
      const x0 = x(iv.t0Ms);
      const x1 = x(iv.t1Ms);
      ctx.fillStyle = i % 2 === 0 ? c.surface2 : c.alt;
      ctx.fillRect(x0, top, Math.max(0, x1 - x0), TRACK_H);
      if (x1 - x0 >= 40) {
        ctx.fillStyle = c.text3;
        ctx.fillText(String(iv.pageIndex + 1), (x0 + x1) / 2, top + TRACK_H / 2);
      }
    });
    // 5-minute ticks
    ctx.fillStyle = c.text3;
    for (let t = 300_000; t < durationMs; t += 300_000) ctx.fillRect(Math.round(x(t)), top - 3, 1, 3);
    // note snapshot ticks
    for (const s of timeline?.allNoteSnapshots() ?? []) {
      ctx.fillStyle = c.highlight;
      ctx.fillRect(x(s.tMs) - 0.75, top + TRACK_H - 6, 1.5, 6);
    }
    for (const t of timeline?.annotationCreationTimes() ?? []) {
      ctx.fillStyle = c.accent;
      ctx.fillRect(x(t) - 0.75, top + TRACK_H - 4, 1.5, 4);
    }
    // markers
    for (const m of timeline?.markers ?? []) {
      ctx.beginPath();
      ctx.arc(x(m.tMs), top, 4, 0, Math.PI * 2);
      ctx.fillStyle = MARKER_COLORS[m.kind] ?? c.accent;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.surface;
      ctx.stroke();
    }
    // playhead
    const ph = dragMs ?? playheadMs;
    const px = Math.round(x(mode === "live" ? durationMs : ph));
    ctx.fillStyle = mode === "live" ? c.record : c.accent;
    ctx.fillRect(px - 1, 0, 2, H);
    if (mode === "replay") {
      ctx.beginPath();
      ctx.arc(px, 5, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [timeline, durationMs, playheadMs, dragMs, mode]);

  // Redraw on resize.
  const [, force] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => force((v) => v + 1));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "replay" || !onSeek) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const ms = msAtX(e.clientX);
    setDragMs(ms);
    onSeek(ms);
    lastSeek.current = Date.now();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ms = msAtX(e.clientX);
    if (dragMs !== null && onSeek) {
      setDragMs(ms);
      if (Date.now() - lastSeek.current > 200) {
        onSeek(ms);
        lastSeek.current = Date.now();
      }
    }
    const iv = timeline?.intervalAt(ms);
    const marker = (timeline?.markers ?? []).find((m) => Math.abs(m.tMs - ms) < durationMs * 0.01);
    const host = hostRef.current;
    const rel = host ? e.clientX - host.getBoundingClientRect().left : 0;
    if (marker) setTip({ x: rel, text: `${MARKER_LABEL[marker.kind] ?? marker.kind}  ${fmtClock(marker.tMs)}` });
    else if (iv) setTip({ x: rel, text: `第 ${iv.pageIndex + 1} 页  ${fmtClock(iv.t0Ms)}–${fmtClock(iv.t1Ms)}` });
    else setTip(null);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragMs !== null && onSeek) onSeek(msAtX(e.clientX));
    setDragMs(null);
  };

  return (
    <div
      ref={hostRef}
      className={`scrubber ${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setTip(null)}
      role={mode === "replay" ? "slider" : undefined}
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={playheadMs}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {tip && (
        <div className="scrubber-tip caption" style={{ left: tip.x }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
