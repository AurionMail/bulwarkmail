"use client";

import { useEffect, useRef, useState } from "react";
import { generateUUID } from "@/lib/utils";

// Closing one layer can leave an asynchronous Back traversal in flight. The
// next layer must not install its popstate listener until that completes, or
// the traversal would close it at once.
let pendingHistoryBack: Promise<void> | null = null;

/**
 * Lets the browser's Back (and the phone's back gesture) close an overlay
 * instead of leaving the page: while `active`, the overlay holds a history
 * entry of its own, and Back calls `onBack`. Closed any other way, the entry
 * is taken back off, so the history ends where it was.
 *
 * `onBack` runs after the entry is gone. A layer that decides to stay open
 * (an editor that asked "Discard changes?" and heard "Keep editing") calls
 * the returned `rearm` to hold an entry again. `armed` tells whether the
 * entry is there now, e.g. before a `router.back()` that must leave for real.
 */
export function useCloseOnBack(onBack: () => void, active = true): { rearm: () => void; armed: () => boolean } {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const rearmRef = useRef<() => void>(() => {});
  const armedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let entryId: string | null = null;
    let poppedByBack = false;

    const onPop = () => {
      if (!entryId) return;
      entryId = null;
      armedRef.current = false;
      poppedByBack = true;
      window.removeEventListener("popstate", onPop);
      onBackRef.current();
    };
    const push = () => {
      if (cancelled || entryId) return;
      entryId = generateUUID();
      armedRef.current = true;
      poppedByBack = false;
      window.history.pushState({ ...window.history.state, __filePreview: entryId }, "");
      window.addEventListener("popstate", onPop);
    };
    rearmRef.current = push;

    // Deferred, so Strict Mode's setup/cleanup/setup replay can cancel the
    // first setup without scheduling a browser Back traversal.
    const timer = window.setTimeout(async () => {
      if (pendingHistoryBack) await pendingHistoryBack;
      push();
    }, 0);

    return () => {
      cancelled = true;
      rearmRef.current = () => {};
      armedRef.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      const ours = entryId;
      if (ours && !poppedByBack && window.history.state?.__filePreview === ours) {
        pendingHistoryBack = new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => {
            pendingHistoryBack = null;
            resolve();
          }, { once: true });
        });
        window.history.back();
      }
    };
  }, [active]);

  // The same object every render, so callers can list it as a dependency.
  const [api] = useState(() => ({ rearm: () => rearmRef.current(), armed: () => armedRef.current }));
  return api;
}
