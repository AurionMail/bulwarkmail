"use client";

// Selected text in a message body, for plugins: the right-click menu on it
// (the reader-selection-menu surface, api.ui.setActions), the selection the
// reader's side panel gets as a prop, and the onTextSelectionChange hook.
// An HTML body lives in a sandboxed iframe whose selection the page never
// sees, so the body's own document is watched; a plain-text body sits in the
// page and is watched through the document's selection.
//
// The menu only replaces the browser's own when a plugin put entries in it.
// Copy is kept, since the menu replaces the one that had it.

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PluginActions, usePluginActions } from "@/components/plugins/plugin-actions";
import { useContextMenu } from "@/hooks/use-context-menu";
import { Copy } from "@/components/icons";
import { uiHooks } from "@/lib/plugin-hooks";

export const READER_SELECTION_SURFACE = "reader-selection-menu";
/** How long after the last change the selection goes to plugins. */
export const BODY_SELECTION_DELAY_MS = 150;

export interface ReaderSelectionTarget {
  emailId: string | undefined;
  text: string;
}

export interface Point { x: number; y: number }

/**
 * Where a contextmenu event inside a body iframe is on the page: the frame's
 * offset plus the event's position, scaled when the body was shrunk to fit a
 * narrow screen. The keyboard (Shift+F10, the Menu key) fires the event at
 * 0,0: then the point is under the selection.
 */
export function bodyMenuPoint(
  e: { clientX: number; clientY: number },
  doc: Document,
  frame: HTMLIFrameElement | null,
): Point {
  let x = e.clientX;
  let y = e.clientY;
  if (!x && !y) {
    const sel = doc.getSelection();
    const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (rect && (rect.width || rect.height)) {
      x = rect.left;
      y = rect.bottom;
    }
  }
  if (!frame) return { x, y };
  const frameRect = frame.getBoundingClientRect();
  const laidOut = doc.documentElement.clientWidth;
  const scale = laidOut > 0 && frameRect.width > 0 ? frameRect.width / laidOut : 1;
  return { x: frameRect.left + x * scale, y: frameRect.top + y * scale };
}

export interface BodySelectionWatch {
  emailId: string | undefined;
  /** The selected text as it changes; '' when the selection is gone. */
  onSelection?: (text: string) => void;
  /** A right-click on selected text. Return true when a menu was opened (the browser's is then suppressed). */
  onContextMenu?: (point: Point, text: string) => boolean;
  delayMs?: number;
}

function announce(text: string, emailId: string | undefined): void {
  if (!text || uiHooks.onTextSelectionChange.size === 0) return;
  void uiHooks.onTextSelectionChange.emit({ text, source: "email-body", emailId });
}

/**
 * Watch the document of a body iframe. Returns a function that stops
 * watching; the listeners also die with the document.
 */
export function watchBodySelection(doc: Document, frame: HTMLIFrameElement | null, opts: BodySelectionWatch): () => void {
  const delay = opts.delayMs ?? BODY_SELECTION_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const read = () => doc.getSelection()?.toString() ?? "";
  const publish = () => {
    timer = null;
    const text = read();
    if (text === last) return;
    last = text;
    opts.onSelection?.(text);
    announce(text, opts.emailId);
  };
  const onSelectionChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, delay);
  };
  const onContextMenu = (e: MouseEvent) => {
    const text = read();
    if (!text.trim() || !opts.onContextMenu) return;
    if (opts.onContextMenu(bodyMenuPoint(e, doc, frame), text)) e.preventDefault();
  };
  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("contextmenu", onContextMenu);
  return () => {
    if (timer) clearTimeout(timer);
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("contextmenu", onContextMenu);
  };
}

/** The text selected inside `el`, from the page's selection; '' when the selection is elsewhere. */
export function selectedTextIn(el: Element): string {
  const sel = el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  if (!anchor || !focus || !el.contains(anchor) || !el.contains(focus)) return "";
  return sel.toString();
}

/** Watch a plain-text body that sits in the page itself (no iframe). */
export function watchElementSelection(el: HTMLElement, opts: Pick<BodySelectionWatch, "emailId" | "onSelection" | "delayMs">): () => void {
  const delay = opts.delayMs ?? BODY_SELECTION_DELAY_MS;
  const doc = el.ownerDocument;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const publish = () => {
    timer = null;
    const text = selectedTextIn(el);
    if (text === last) return;
    last = text;
    opts.onSelection?.(text);
    // The page-wide listener (PluginAppEvents) tells plugins about this one.
  };
  const onSelectionChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(publish, delay);
  };
  doc.addEventListener("selectionchange", onSelectionChange);
  return () => {
    if (timer) clearTimeout(timer);
    doc.removeEventListener("selectionchange", onSelectionChange);
  };
}

/** The menu's state, and `open` for a right-click on selected text. */
export function useReaderSelectionMenu() {
  const actions = usePluginActions(READER_SELECTION_SURFACE);
  const menu = useContextMenu<ReaderSelectionTarget>();
  const { openContextMenu } = menu;
  const enabled = actions.length > 0;
  // Body documents are wired once, when they load; they read the latest
  // state through this ref.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const open = useCallback((point: Point, target: ReaderSelectionTarget, e?: React.MouseEvent): boolean => {
    if (!enabledRef.current || !target.text.trim()) return false;
    openContextMenu({
      preventDefault: () => e?.preventDefault(),
      stopPropagation: () => e?.stopPropagation(),
      clientX: point.x,
      clientY: point.y,
    } as React.MouseEvent, target);
    return true;
  }, [openContextMenu]);
  const openRef = useRef(open);
  openRef.current = open;
  /** For a plain-text body in the page: the React contextmenu handler. */
  const onElementContextMenu = useCallback((e: React.MouseEvent, emailId: string | undefined) => {
    const el = e.currentTarget as HTMLElement;
    const text = selectedTextIn(el);
    if (!text.trim()) return;
    const point = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : bodyMenuPoint(e, el.ownerDocument, null);
    openRef.current(point, { emailId, text }, e);
  }, []);
  return { ...menu, open, openRef, onElementContextMenu, enabled };
}

export function ReaderSelectionMenu({ menu }: { menu: ReturnType<typeof useReaderSelectionMenu> }) {
  const t = useTranslations("email_viewer");
  const { contextMenu, closeContextMenu, menuRef } = menu;
  if (!contextMenu.isOpen) return null;
  const target = contextMenu.data;
  const copy = () => {
    closeContextMenu();
    void navigator.clipboard?.writeText(target?.text ?? "").catch(() => {});
  };
  return (
    <ContextMenu ref={menuRef} isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={closeContextMenu}>
      <ContextMenuItem icon={Copy} label={t("copy")} testId="reader-selection-copy" onClick={copy} />
      <ContextMenuSeparator />
      <PluginActions
        surface="reader-selection-menu"
        variant="menu"
        context={{ emailId: target?.emailId, selection: { text: target?.text ?? "" } }}
        onRan={closeContextMenu}
      />
    </ContextMenu>
  );
}
