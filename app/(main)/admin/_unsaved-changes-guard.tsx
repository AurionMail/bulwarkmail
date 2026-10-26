'use client';

import { useEffect, useId } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from '@/components/icons';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { useAdminUnsavedStore, selectHasUnsaved } from '@/stores/admin-unsaved-store';

/**
 * Asks before the admin leaves a section with unsaved edits (#1255). Tab
 * buttons and sign out go through requestLeave themselves; links anywhere on
 * the page are caught here, and closing or reloading the tab gets the
 * browser's own prompt.
 */
export function UnsavedChangesGuard() {
  const hasUnsaved = useAdminUnsavedStore(selectHasUnsaved);
  const pendingLeave = useAdminUnsavedStore((s) => s.pendingLeave);
  const requestLeave = useAdminUnsavedStore((s) => s.requestLeave);
  const confirmLeave = useAdminUnsavedStore((s) => s.confirmLeave);
  const cancelLeave = useAdminUnsavedStore((s) => s.cancelLeave);
  const isOpen = pendingLeave !== null;
  const id = useId();

  const dialogRef = useFocusTrap({ isActive: isOpen, restoreFocus: true });

  // On document, not the dialog, so Escape means "Stay" wherever focus is.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelLeave();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, cancelLeave]);

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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancelLeave(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md animate-in zoom-in-95 duration-200"
      >
        <div className="p-6 flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-semibold text-foreground">
              Unsaved changes
            </h2>
            <p id={`${id}-message`} className="mt-2 text-sm text-muted-foreground">
              You have changes that haven&apos;t been saved. If you leave now, they will be lost.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          <Button variant="outline" onClick={cancelLeave}>Stay</Button>
          <Button variant="destructive" onClick={confirmLeave} className="shadow-sm">Leave</Button>
        </div>
      </div>
    </div>
  );
}
