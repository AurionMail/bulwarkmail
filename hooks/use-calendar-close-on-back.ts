"use client";

import { useEffect, useRef } from "react";
import { generateUUID } from "@/lib/utils";

const STATE_KEY = "__closeOnBack";

// Closing one overlay leaves a Back traversal in flight; the next one must
// not push its entry until that has landed, or the Back would pop it.
let pendingBack: Promise<void> | null = null;

interface UseCloseOnBackOptions {
  /** Whether the overlay is open: it holds a history entry while it is. */
  open: boolean;
  /** Called when browser Back (or the phone's back gesture) leaves the entry. */
  onBack: () => void;
  /**
   * Whether Back should stay on the overlay for now, e.g. an editor with
   * unsaved changes that asks first: the entry is put back, so a later Back
   * asks again, and `onBack` decides whether to close.
   */
  shouldHold?: () => boolean;
  enabled?: boolean;
}

/**
 * Browser Back closes an overlay instead of leaving the page (R5). The
 * overlay gets a history entry of its own while it is open; closing it any
 * other way takes that entry back off, so no stray steps are left for Back
 * to walk through. The URL is left alone: the entry copies the current one,
 * Next's router state included, and after the clean-up Back the address bar
 * is set to whatever the page showed last.
 */
export function useCloseOnBack({ open, onBack, shouldHold, enabled = true }: UseCloseOnBackOptions) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const shouldHoldRef = useRef(shouldHold);
  shouldHoldRef.current = shouldHold;

  useEffect(() => {
    if (!open || !enabled || typeof window === "undefined") return;
    const entryId = generateUUID();
    let cancelled = false;
    let pushed = false;
    const push = () => {
      window.history.pushState({ ...window.history.state, [STATE_KEY]: entryId }, "");
      pushed = true;
    };
    const onPop = () => {
      if ((window.history.state as Record<string, unknown> | null)?.[STATE_KEY] === entryId) return;
      pushed = false;
      if (shouldHoldRef.current?.()) push();
      onBackRef.current();
    };
    // Deferred so Strict Mode's setup/cleanup/setup doesn't push and pop.
    const timer = window.setTimeout(async () => {
      if (pendingBack) await pendingBack;
      if (cancelled) return;
      push();
      window.addEventListener("popstate", onPop);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      if (!pushed || (window.history.state as Record<string, unknown> | null)?.[STATE_KEY] !== entryId) return;
      // After this commit's effects, so the URL the page writes for the
      // closed state is the one restored once Back has landed.
      queueMicrotask(() => {
        // A navigation in the same commit (leaving the calendar through the
        // rail) has pushed its own entry by now: that one must not be undone.
        if ((window.history.state as Record<string, unknown> | null)?.[STATE_KEY] !== entryId) return;
        const url = window.location.href;
        pendingBack = new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => {
            if (window.location.href !== url) window.history.replaceState(window.history.state, "", url);
            pendingBack = null;
            resolve();
          }, { once: true });
        });
        window.history.back();
      });
    };
  }, [open, enabled]);
}
