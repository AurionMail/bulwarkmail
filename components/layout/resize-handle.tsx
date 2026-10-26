"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  onResizeStart?: () => void;
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  onDoubleClick?: () => void;
  orientation?: "vertical" | "horizontal";
  className?: string;
  /** Stable hook for tests (not user-visible). */
  testId?: string;
}

const KEYBOARD_STEP = 10;

export function ResizeHandle({ onResizeStart, onResize, onResizeEnd, onDoubleClick, orientation = "vertical", className, testId }: ResizeHandleProps) {
  const handleRef = useRef<HTMLDivElement>(null);
  // Id of the pointer that started the drag, or null when idle. Only that
  // pointer may move or end the drag, so a second finger or button can't
  // hijack it.
  const activePointer = useRef<number | null>(null);
  const startPos = useRef(0);
  const isHorizontal = orientation === "horizontal";

  // Latest callbacks, so the document listeners below never go stale and
  // never need re-subscribing while a drag is in progress.
  const callbacks = useRef({ onResizeStart, onResize, onResizeEnd });
  callbacks.current = { onResizeStart, onResize, onResizeEnd };

  const endDrag = useCallback(() => {
    if (activePointer.current === null) return;
    const pointerId = activePointer.current;
    activePointer.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const el = handleRef.current;
    if (el && typeof el.hasPointerCapture === "function" && el.hasPointerCapture(pointerId)) {
      el.releasePointerCapture(pointerId);
    }
    callbacks.current.onResizeEnd?.();
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Primary button only; ignore a second pointer while one is dragging.
    if (e.button !== 0 || activePointer.current !== null) return;
    e.preventDefault();
    activePointer.current = e.pointerId;
    startPos.current = isHorizontal ? e.clientY : e.clientX;
    document.body.style.cursor = isHorizontal ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    // Capture routes every later pointer event for this drag to the handle,
    // even when the pointer is over an iframe (message body, plugin panel)
    // or outside the window. Without it the release over an iframe never
    // reaches this document and the handle keeps following the mouse.
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === "function") {
      try { el.setPointerCapture(e.pointerId); } catch { /* unsupported pointer */ }
    }
    callbacks.current.onResizeStart?.();
  }, [isHorizontal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0;
    if (isHorizontal) {
      if (e.key === "ArrowUp") delta = -KEYBOARD_STEP;
      else if (e.key === "ArrowDown") delta = KEYBOARD_STEP;
      else return;
    } else {
      if (e.key === "ArrowLeft") delta = -KEYBOARD_STEP;
      else if (e.key === "ArrowRight") delta = KEYBOARD_STEP;
      else return;
    }
    e.preventDefault();
    onResize(delta);
    onResizeEnd?.();
  }, [onResize, onResizeEnd, isHorizontal]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (activePointer.current === null || e.pointerId !== activePointer.current) return;
      // A move with no button held means the release happened somewhere we
      // never heard about (another frame, outside the window). Stop instead
      // of dragging the divider around with a released mouse.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        endDrag();
        return;
      }
      const delta = (isHorizontal ? e.clientY : e.clientX) - startPos.current;
      callbacks.current.onResize(delta);
    };

    const handlePointerEnd = (e: PointerEvent) => {
      if (activePointer.current === null || e.pointerId !== activePointer.current) return;
      endDrag();
    };

    // Listen on the document rather than the handle so the fallback without
    // pointer capture still sees moves anywhere in the page.
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerEnd);
    document.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", endDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerEnd);
      document.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", endDrag);
    };
  }, [endDrag, isHorizontal]);

  // Unmounting mid-drag (the pane layout switched) must not leave the body
  // cursor and selection lock behind.
  useEffect(() => endDrag, [endDrag]);

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      aria-label="Resize"
      data-testid={testId}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        // Centered over the seam with negative margins so the handle adds no
        // net layout space (panes sit flush) while staying draggable.
        "flex-shrink-0 hover:bg-primary/30 active:bg-primary/50 transition-colors relative group z-10",
        "focus-visible:outline-none focus-visible:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50",
        // touch-none keeps the browser from turning a touch drag into a
        // scroll and cancelling the pointer.
        "touch-none",
        isHorizontal ? "h-1 -my-0.5 cursor-row-resize bg-border" : "w-1 -mx-0.5 cursor-col-resize",
        className
      )}
    >
      <div className={cn("absolute", isHorizontal ? "inset-x-0 -top-1 -bottom-1" : "inset-y-0 -left-1 -right-1")} />
    </div>
  );
}
