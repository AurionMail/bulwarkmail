"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ZoomIn, ZoomOut, RotateCw, Maximize2 } from "@/components/icons";
import { cn } from "@/lib/utils";

const MAX_SCALE = 10;
const BUTTON_STEP = 1.5;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 6;

interface View {
  /** Zoom relative to the fitted size; 1 = the whole image fits. */
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** A click or tap that lands outside the image, e.g. to close the viewer. */
  onBackgroundClick?: () => void;
  className?: string;
  imageClassName?: string;
}

/**
 * An image that fits its box and can be zoomed (wheel, pinch, double-click,
 * buttons, + / - / 0), panned by dragging while zoomed, and rotated (r).
 */
export function ZoomableImage({ src, alt, onBackgroundClick, className, imageClassName }: ZoomableImageProps) {
  const t = useTranslations("files");
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>(FIT);
  const [rotation, setRotation] = useState(0);
  const [animate, setAnimate] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  // Reset when another image is shown.
  useEffect(() => {
    setView(FIT);
    setRotation(0);
    setNatural({ w: 0, h: 0 });
  }, [src]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sideways = rotation % 180 !== 0;
  // An SVG without a size reports 0; give it a square that fits.
  const fallback = Math.min(box.w, box.h) * 0.8 || 300;
  const natW = natural.w || fallback;
  const natH = natural.h || fallback;
  const visualW = sideways ? natH : natW;
  const visualH = sideways ? natW : natH;
  // Fit the whole image, but never blow a small one up past its real size.
  const fit = box.w && box.h ? Math.min(box.w / visualW, box.h / visualH, 1) : 1;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  // Zoom that shows the image at its real pixel size (at least 2x the fit).
  const actualScale = Math.max(2, 1 / fit);

  const clamp = useCallback((v: View): View => {
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale));
    const w = visualW * fit * scale;
    const h = visualH * fit * scale;
    const maxX = Math.max(0, (w - box.w) / 2);
    const maxY = Math.max(0, (h - box.h) / 2);
    return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  }, [visualW, visualH, fit, box.w, box.h]);
  const clampRef = useRef(clamp);
  clampRef.current = clamp;

  /** Zoom to `scale`, keeping the point (px, py) - relative to the box centre - in place. */
  const zoomAt = useCallback((scale: number, px = 0, py = 0, smooth = false) => {
    const cur = viewRef.current;
    const next = Math.min(MAX_SCALE, Math.max(1, scale));
    const ratio = next / cur.scale;
    setAnimate(smooth);
    setView(clampRef.current({ scale: next, x: px - (px - cur.x) * ratio, y: py - (py - cur.y) * ratio }));
  }, []);

  const pointFromEvent = useCallback((clientX: number, clientY: number) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, []);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinch arrives as ctrl+wheel with small deltas.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const p = pointFromEvent(e.clientX, e.clientY);
      zoomAt(viewRef.current.scale * Math.exp(-delta * speed), p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, pointFromEvent]);

  // ---- Pointers: drag to pan, two fingers to pinch, taps -------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number; startY: number; moved: boolean;
    view: View; pinchDist?: number; pinchMid?: { x: number; y: number };
  } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  // Pointer capture retargets later events at the box, so remember where the press began.
  const downOnImage = useRef(false);
  const [dragging, setDragging] = useState(false);

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const g: NonNullable<typeof gesture.current> = {
      startX: pts[0].x, startY: pts[0].y, moved: gesture.current?.moved ?? false, view: viewRef.current,
    };
    if (pts.length >= 2) {
      g.pinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      g.pinchMid = pointFromEvent((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    }
    gesture.current = g;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-viewer-controls]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointers.current.size === 0) downOnImage.current = e.target === imgRef.current;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.pinchDist && g.pinchMid) {
      g.moved = true;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const mid = pointFromEvent((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      const scale = Math.min(MAX_SCALE, Math.max(1, g.view.scale * (dist / g.pinchDist)));
      const ratio = scale / g.view.scale;
      setAnimate(false);
      setView(clampRef.current({
        scale,
        x: mid.x - (g.pinchMid.x - g.view.x) * ratio,
        y: mid.y - (g.pinchMid.y - g.view.y) * ratio,
      }));
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    g.moved = true;
    if (g.view.scale > 1) {
      setDragging(true);
      setAnimate(false);
      setView(clampRef.current({ ...g.view, x: g.view.x + dx, y: g.view.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // One finger of a pinch lifted: carry on panning with the other.
      startGesture();
      return;
    }
    gesture.current = null;
    setDragging(false);
    if (!g || g.moved || e.type === "pointercancel") return;

    if (!downOnImage.current) {
      lastTap.current = null;
      onBackgroundClick?.();
      return;
    }
    // Double-tap or double-click on the image: zoom in there, or back to fit.
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && now - prev.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
      lastTap.current = null;
      if (viewRef.current.scale > 1.01) {
        setAnimate(true);
        setView(FIT);
      } else {
        const p = pointFromEvent(e.clientX, e.clientY);
        zoomAt(actualScale, p.x, p.y, true);
      }
    } else {
      lastTap.current = { time: now, x: e.clientX, y: e.clientY };
    }
  };

  // ---- Keyboard ---------------------------------------------------------------
  const zoomBy = useCallback((factor: number) => zoomAt(viewRef.current.scale * factor, 0, 0, true), [zoomAt]);
  const resetView = useCallback(() => { setAnimate(true); setView(FIT); }, []);
  const rotate = useCallback(() => {
    setAnimate(true);
    setRotation((r) => r + 90);
    setView(FIT);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(BUTTON_STEP); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / BUTTON_STEP); }
      else if (e.key === "0") { e.preventDefault(); resetView(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); rotate(); }
      else if (viewRef.current.scale > 1 && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = 80;
        const cur = viewRef.current;
        setAnimate(true);
        setView(clampRef.current({
          ...cur,
          x: cur.x + (e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0),
          y: cur.y + (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0),
        }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, resetView, rotate]);

  // Keep the view inside the box when the window or rotation changes.
  useEffect(() => {
    setView((v) => clamp(v));
  }, [clamp]);

  const zoomed = view.scale > 1.01;
  // The percentage is of the image's real pixels, like other image viewers.
  const percent = Math.round(view.scale * (natural.w ? fit : 1) * 100);
  const ready = natural.w > 0 || box.w > 0;

  return (
    <div
      ref={boxRef}
      className={cn(
        "relative w-full h-full overflow-hidden select-none touch-none",
        zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Clicks are handled as taps above; keep them from reaching the dialog.
      onClick={(e) => e.stopPropagation()}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className={cn(
          "absolute left-1/2 top-1/2 max-w-none",
          zoomed ? "" : "cursor-zoom-in",
          animate && "transition-transform duration-200 ease-out",
          !ready && "invisible",
          imageClassName,
        )}
        style={{
          width: natW * fit,
          height: natH * fit,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${rotation}deg)`,
        }}
        onTransitionEnd={() => setAnimate(false)}
      />

      <div
        data-viewer-controls
        className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-black/70 text-white px-1.5 py-1 shadow-lg backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ControlButton label={t("zoom_out")} onClick={() => zoomBy(1 / BUTTON_STEP)} disabled={!zoomed}>
          <ZoomOut className="w-4 h-4" />
        </ControlButton>
        <button
          type="button"
          onClick={resetView}
          className="min-w-[3.5rem] h-8 px-2 rounded-full text-xs tabular-nums hover:bg-white/15 transition-colors"
          title={t("zoom_reset")}
          aria-label={t("zoom_reset")}
        >
          {percent}%
        </button>
        <ControlButton label={t("zoom_in")} onClick={() => zoomBy(BUTTON_STEP)} disabled={view.scale >= MAX_SCALE}>
          <ZoomIn className="w-4 h-4" />
        </ControlButton>
        <span className="w-px h-5 bg-white/20 mx-1" aria-hidden />
        <ControlButton label={t("zoom_reset")} onClick={resetView} disabled={!zoomed}>
          <Maximize2 className="w-4 h-4" />
        </ControlButton>
        <ControlButton label={t("rotate")} onClick={rotate}>
          <RotateCw className="w-4 h-4" />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}
