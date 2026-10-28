"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle, Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";
import { TOUCH_HIT_AREA } from "@/components/ui/button";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  onClick?: () => void;
  /**
   * Called when the user closes the toast: the close button, a click on the
   * toast or on one of its actions. Not called when it times out.
   */
  onDismiss?: () => void;
  icon?: React.ReactNode;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  /**
   * A third action. Three buttons do not fit beside the text, so a toast
   * that has one lays its actions out on a row of their own.
   */
  tertiaryAction?: ToastAction;
  /**
   * Work in progress, e.g. an upload: 0..1, or null while the amount is
   * unknown. The bottom line then shows progress instead of a countdown,
   * and the toast stays until it is updated or removed.
   */
  progress?: number | null;
  /**
   * Hovering pauses the countdown so a toast can be read. Off for a toast
   * whose action stops working at a fixed time, like Undo send: there the
   * countdown has to match the time that is left.
   */
  pauseOnHover?: boolean;
}

interface ToastProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

// Only errors and warnings carry colour; success and info stay neutral
// (repos/branding/APP.md).
const iconStyles = {
  success: "text-muted-foreground",
  error: "text-red-600 dark:text-red-400",
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
};

const progressBarStyles = {
  success: "bg-muted-foreground",
  error: "bg-destructive",
  info: "bg-muted-foreground",
  warning: "bg-warning",
};

// A sideways swipe this far (px) on a touch screen dismisses the toast.
const SWIPE_DISMISS_DISTANCE = 72;

export function ToastItem({ toast, onClose }: ToastProps) {
  const tCommon = useTranslations("common");
  const Icon = icons[toast.type];
  const [exiting, setExiting] = useState(false);
  // Swipe to dismiss (touch only): how far it is dragged, and where it flew off to.
  const [dragX, setDragX] = useState(0);
  const [flungTo, setFlungTo] = useState<number | null>(null);
  const swipeRef = useRef<{ id: number; x: number; y: number; horizontal: boolean | null } | null>(null);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(toast.duration ?? 5000);
  const startRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProgress = toast.progress !== undefined;

  // A toast updated in place (a finished upload) starts a fresh countdown.
  const lastDurationRef = useRef(toast.duration);
  if (lastDurationRef.current !== toast.duration) {
    lastDurationRef.current = toast.duration;
    remainingRef.current = toast.duration ?? 5000;
  }

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onClose(toast.id), 280);
  }, [onClose, toast.id]);

  const dismissByUser = useCallback(() => {
    try {
      toast.onDismiss?.();
    } catch {
      // A failing listener must not keep the toast on screen.
    }
    dismiss();
  }, [toast, dismiss]);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0 || isProgress) return;

    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
      remainingRef.current = remainingRef.current - (Date.now() - startRef.current);
      return;
    }

    startRef.current = Date.now();
    timerRef.current = setTimeout(dismiss, remainingRef.current);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.duration, paused, dismiss, isProgress]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || exiting) return;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, horizontal: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (swipe.horizontal === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      swipe.horizontal = Math.abs(dx) > Math.abs(dy);
      if (swipe.horizontal) setPaused(true);
    }
    if (swipe.horizontal) setDragX(dx);
  };
  const endSwipe = (e: React.PointerEvent) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.id !== e.pointerId) return;
    swipeRef.current = null;
    if (!swipe.horizontal) return;
    const dx = e.clientX - swipe.x;
    if (Math.abs(dx) >= SWIPE_DISMISS_DISTANCE) {
      setFlungTo(Math.sign(dx) * window.innerWidth);
      try {
        toast.onDismiss?.();
      } catch {
        // A failing listener must not keep the toast on screen.
      }
      setTimeout(() => onClose(toast.id), 200);
    } else {
      setDragX(0);
      setPaused(false);
    }
  };
  // The click that ends a swipe is not a tap on the toast.
  const swiped = dragX !== 0 || flungTo !== null;

  const actionButton = (action: ToastAction) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        try {
          action.onClick();
          dismissByUser();
        } catch {
          // Don't close toast on error so user can retry
        }
      }}
      className={cn(
        "text-[13px] font-semibold text-foreground px-1.5 py-0.5 rounded-md transition-colors",
        TOUCH_HIT_AREA,
        "underline underline-offset-[3px] hover:bg-foreground/5"
      )}
    >
      {action.label}
    </button>
  );

  return (
    <div
      className={cn(
        "toast-item group relative flex items-start gap-2.5 w-[360px] max-w-[calc(100vw-2.5rem)] rounded-md",
        "bg-popover text-popover-foreground border border-border",
        "shadow-[0_6px_16px_rgb(0,0,0,0.1)] dark:shadow-[0_6px_16px_rgb(0,0,0,0.4)]",
        "overflow-hidden pt-3 pe-2.5 pb-3.5 ps-3.5",
        // Phone: as wide as the screen allows (the container keeps 12px).
        "max-sm:w-full max-sm:max-w-none touch-pan-y rtl:[--toast-slide:-1]",
        exiting ? "toast-exit" : "toast-enter",
        toast.onClick && !toast.action && "cursor-pointer"
      )}
      style={
        flungTo !== null
          ? { transform: `translateX(${flungTo}px)`, opacity: 0, transition: "transform 200ms ease-out, opacity 200ms ease-out" }
          : dragX !== 0
            ? { transform: `translateX(${dragX}px)`, opacity: Math.max(0.3, 1 - Math.abs(dragX) / 240) }
            : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endSwipe}
      onPointerCancel={endSwipe}
      onMouseEnter={() => { if (toast.pauseOnHover !== false) setPaused(true); }}
      onMouseLeave={() => setPaused(false)}
      onClick={() => {
        if (swiped) return;
        if (toast.onClick && !toast.action) {
          toast.onClick();
          dismissByUser();
        }
      }}
    >
      {/* Icon */}
      {toast.icon !== undefined ? (
        toast.icon
      ) : isProgress ? (
        <Loader2 className="w-[18px] h-[18px] flex-shrink-0 mt-px text-muted-foreground animate-spin" />
      ) : (
        <Icon className={cn("w-[18px] h-[18px] flex-shrink-0 mt-px", iconStyles[toast.type])} />
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 pt-px">
        <p className="text-[13.5px] font-medium text-foreground leading-snug">{toast.title}</p>
        {toast.message && (
          <p className="text-[12.5px] mt-0.5 text-muted-foreground leading-snug">{toast.message}</p>
        )}
        {toast.tertiaryAction && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5 -ms-1.5">
            {actionButton(toast.tertiaryAction)}
            {toast.secondaryAction && actionButton(toast.secondaryAction)}
            {toast.action && actionButton(toast.action)}
          </div>
        )}
      </div>

      {!toast.tertiaryAction && (toast.action || toast.secondaryAction) && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {toast.secondaryAction && actionButton(toast.secondaryAction)}
          {toast.action && actionButton(toast.action)}
        </div>
      )}

      {/* Close button. Phones swipe the toast away instead. */}
      <button
        type="button"
        aria-label={tCommon("close")}
        title={tCommon("close")}
        onClick={(e) => {
          e.stopPropagation();
          dismissByUser();
        }}
        className={cn(
          "flex-shrink-0 p-1 rounded-md transition-all max-sm:hidden",
          TOUCH_HIT_AREA,
          "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
          "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
        )}
      >
        <X className="w-3.5 h-3.5" />
      </button>

      {/* Progress line: the same line as the countdown, filled by the work done */}
      {isProgress && (
        <div
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground/[0.06]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={toast.progress == null ? undefined : Math.round(toast.progress * 100)}
        >
          <div
            className={cn("h-full opacity-60 transition-[width] duration-300", progressBarStyles[toast.type], toast.progress == null && "w-1/3 animate-pulse")}
            style={toast.progress == null ? undefined : { width: `${Math.max(0, Math.min(1, toast.progress)) * 100}%` }}
          />
        </div>
      )}

      {/* Countdown line */}
      {!isProgress && !!toast.duration && toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground/[0.06]">
          <div
            className={cn("h-full opacity-60", progressBarStyles[toast.type])}
            style={{
              animation: `toast-progress ${toast.duration}ms linear forwards`,
              animationPlayState: paused ? "paused" : "running",
            }}
          />
        </div>
      )}
    </div>
  );
}

export function ToastContainer({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={cn(
        // Newest at the bottom, at the end corner (bottom left in RTL);
        // lifted over an open composer's footer.
        "fixed bottom-5 end-5 z-[99999] flex flex-col gap-2.5 [html[data-composer-open]_&]:bottom-20",
        // Phone: full width with 12px margins, above the bottom controls
        // (the tab bar, or whichever bar registered with useBottomControls).
        "max-sm:inset-x-3 max-sm:bottom-[calc(var(--bottom-controls-height,3.75rem)+0.75rem)]",
        "max-sm:[html[data-composer-open]_&]:bottom-[max(5rem,calc(var(--bottom-controls-height,3.75rem)+0.75rem))]"
      )}
      role="status"
      aria-live="polite"
      style={{ pointerEvents: "none" }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: "auto" }}>
          <ToastItem toast={toast} onClose={onClose} />
        </div>
      ))}
    </div>,
    document.body
  );
}
