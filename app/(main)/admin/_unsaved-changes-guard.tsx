'use client';

import { useEffect, useRef } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useAdminUnsavedStore, selectHasUnsaved } from '@/stores/admin-unsaved-store';

// Marks the history entry the guard puts on top of a page with unsaved
// edits. It carries a copy of the page entry's own state, so Next's router
// treats it as that page.
const GUARD_KEY = '__adminUnsavedGuard';

function onGuardEntry(): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return !!state && state[GUARD_KEY] === true;
}

// Marks the page's own entry under the copy, so Back onto it is told apart
// from a later visit to the same page.
const GUARDED_KEY = '__adminUnsavedGuarded';

/** Puts the copy on top; returns the mark left on the page's entry under it. */
function pushGuardEntry(): string {
  const state = (window.history.state as Record<string, unknown> | null) ?? {};
  const mark = `${Date.now()}-${Math.random()}`;
  window.history.replaceState({ ...state, [GUARDED_KEY]: mark }, '', window.location.href);
  window.history.pushState({ ...state, [GUARDED_KEY]: mark, [GUARD_KEY]: true }, '', window.location.href);
  return mark;
}

function guardedMark(): unknown {
  const state = window.history.state as Record<string, unknown> | null;
  return state?.[GUARDED_KEY];
}

/**
 * Asks before the admin leaves a section with unsaved edits (#1255). Tab
 * buttons and sign out go through requestLeave themselves; links anywhere on
 * the page are caught here, so are browser Back and the phone's back
 * gesture, and closing or reloading the tab gets the browser's own prompt.
 */
export function UnsavedChangesGuard() {
  const hasUnsaved = useAdminUnsavedStore(selectHasUnsaved);
  const pendingLeave = useAdminUnsavedStore((s) => s.pendingLeave);
  const requestLeave = useAdminUnsavedStore((s) => s.requestLeave);
  const confirmLeave = useAdminUnsavedStore((s) => s.confirmLeave);
  const cancelLeave = useAdminUnsavedStore((s) => s.cancelLeave);
  const isOpen = pendingLeave !== null;

  // Back and the back gesture are a same-document popstate (the pages switch
  // through pushState), which can't be cancelled. So while something is
  // unsaved a copy of the page's entry sits on top: Back only takes that
  // one off, the page stays, and the prompt asks. Stay puts the copy back;
  // Leave goes back past the page for real.
  // The mark on the page entry the copy was put on top of.
  const guard = useRef<string | null>(null);
  useEffect(() => {
    if (!hasUnsaved || onGuardEntry()) return;
    guard.current = pushGuardEntry();
  }, [hasUnsaved]);

  useEffect(() => {
    const onPopState = () => {
      // Landing on the page's own entry under the copy: Back took the copy off.
      if (onGuardEntry() || !guard.current || guardedMark() !== guard.current) return;
      if (!selectHasUnsaved(useAdminUnsavedStore.getState())) {
        // A copy left over from edits saved or discarded since: Back goes
        // on as asked.
        guard.current = null;
        window.history.back();
        return;
      }
      guard.current = pushGuardEntry();
      useAdminUnsavedStore.getState().requestLeave(() => {
        guard.current = null;
        window.history.go(-2);
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  useEffect(() => {
    if (!hasUnsaved) return;
    // Capture phase on document runs before React's root listener, so a
    // Next <Link> never starts its client-side navigation.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      // Read the store, not the render: after "Leave" the click is replayed
      // before React has removed this listener.
      if (!selectHasUnsaved(useAdminUnsavedStore.getState())) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin
        && url.pathname === window.location.pathname
        && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      requestLeave(() => {
        // Nothing is dirty any more, so the second click goes through.
        if (anchor.isConnected) anchor.click();
        else window.location.assign(anchor.href);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [hasUnsaved, requestLeave]);

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={cancelLeave}
      onConfirm={confirmLeave}
      title="Unsaved changes"
      message="You have changes that haven't been saved. If you leave now, they will be lost."
      cancelText="Stay"
      confirmText="Leave"
      variant="destructive"
    />
  );
}
