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
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const isHorizontal = orientation === "horizontal";

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPos.current = isHorizontal ? e.clientY : e.clientX;
    document.body.style.cursor = isHorizontal ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    onResizeStart?.();
  }, [onResizeStart, isHorizontal]);

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
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = (isHorizontal ? e.clientY : e.clientX) - startPos.current;
      onResize(delta);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onResizeEnd?.();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onResize, onResizeEnd, isHorizontal]);

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      aria-label="Resize"
      data-testid={testId}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onDoubleClick={onDoubleClick}
      className={cn(
        // Centered over the seam with negative margins so the handle adds no
        // net layout space (panes sit flush) while staying draggable.
        "flex-shrink-0 hover:bg-primary/30 active:bg-primary/50 transition-colors relative group z-10",
        "focus-visible:outline-none focus-visible:bg-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50",
        isHorizontal ? "h-1 -my-0.5 cursor-row-resize bg-border" : "w-1 -mx-0.5 cursor-col-resize",
        className
      )}
    >
      <div className={cn("absolute", isHorizontal ? "inset-x-0 -top-1 -bottom-1" : "inset-y-0 -left-1 -right-1")} />
    </div>
  );
}
