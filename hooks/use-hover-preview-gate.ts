import { useCallback, useEffect, useRef } from "react";
import { isContextMenuOpen } from "@/components/ui/context-menu";

/** How far the pointer has to move before a preview may open again. */
const MOVE_THRESHOLD = 4;

const MODAL_SELECTOR = '[aria-modal="true"]';

/**
 * Decides whether a hover preview may open. Not while an editor, a card,
 * a menu or a dialog is open (`overlayOpen` plus any modal on the page),
 * and not after one closed until the pointer really moves: the pointer
 * resting where the dialog was otherwise "hovers" the event under it and
 * the preview opens by itself.
 */
export function useHoverPreviewGate(overlayOpen: boolean): () => boolean {
  const overlayOpenRef = useRef(overlayOpen);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Where the pointer was when previews were held back; null when free.
  const heldAt = useRef<{ x: number; y: number } | null>(null);

  const hold = useCallback(() => {
    heldAt.current = pointer.current ?? { x: Number.NaN, y: Number.NaN };
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent | MouseEvent) => {
      const at = { x: e.clientX, y: e.clientY };
      pointer.current = at;
      const held = heldAt.current;
      if (!held) return;
      // Position unknown when it was held: the first move frees it.
      if (Number.isNaN(held.x) || Math.hypot(at.x - held.x, at.y - held.y) > MOVE_THRESHOLD) {
        heldAt.current = null;
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // An editor, card or quick editor of the calendar closing.
  useEffect(() => {
    const was = overlayOpenRef.current;
    overlayOpenRef.current = overlayOpen;
    if (was && !overlayOpen) hold();
  }, [overlayOpen, hold]);

  // Any other dialog (a confirm, import, shortcuts) portalled onto <body>.
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element && (node.matches(MODAL_SELECTOR) || node.querySelector(MODAL_SELECTOR))) {
            hold();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [hold]);

  return useCallback(() => {
    if (overlayOpenRef.current || isContextMenuOpen() || document.querySelector(MODAL_SELECTOR)) {
      hold();
      return false;
    }
    return heldAt.current === null;
  }, [hold]);
}
