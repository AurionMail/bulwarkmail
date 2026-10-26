"use client";

// The right-click menu on selected text in the composer. It only appears
// when a plugin declared entries for it (the composer-selection-menu
// surface, api.ui.setActions); otherwise the browser's own menu stays, with
// its spelling suggestions. Cut and Copy are kept, since the menu replaces
// the one that had them. A click on a plugin entry carries the composer id
// and the selected text.

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PluginActions, usePluginActions } from "@/components/plugins/plugin-actions";
import { useContextMenu } from "@/hooks/use-context-menu";
import { Copy, Scissors } from "@/components/icons";

export const COMPOSER_SELECTION_SURFACE = "composer-selection-menu";

export interface SelectionMenuTarget {
  /** The selected text, as the plugin gets it. */
  text: string;
}

/**
 * Where the menu opens for a contextmenu event. The keyboard (Shift+F10,
 * the Menu key) fires it at 0,0: then the menu opens under the selection.
 */
export function selectionMenuPoint(
  e: { clientX: number; clientY: number; currentTarget?: EventTarget | null },
  selection: Selection | null = typeof window === "undefined" ? null : window.getSelection(),
): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width || rect.height) return { x: rect.left, y: rect.bottom };
  }
  const el = e.currentTarget instanceof Element ? e.currentTarget : null;
  const rect = el?.getBoundingClientRect();
  return rect ? { x: rect.left + 16, y: rect.top + 16 } : { x: 0, y: 0 };
}

/** The menu's state and the contextmenu handler for the message text. */
export function useComposerSelectionMenu() {
  const actions = usePluginActions(COMPOSER_SELECTION_SURFACE);
  const menu = useContextMenu<SelectionMenuTarget>();
  const { openContextMenu } = menu;
  const enabled = actions.length > 0;
  const onContextMenu = useCallback((e: React.MouseEvent, read: () => string) => {
    if (!enabled) return;
    const text = read();
    if (!text.trim()) return;
    const point = selectionMenuPoint(e);
    openContextMenu({
      preventDefault: () => e.preventDefault(),
      stopPropagation: () => e.stopPropagation(),
      clientX: point.x,
      clientY: point.y,
    } as React.MouseEvent, { text });
  }, [enabled, openContextMenu]);
  return { ...menu, onContextMenu, enabled };
}

export function ComposerSelectionMenu({
  menu,
  composerId,
  onClipboard,
}: {
  menu: ReturnType<typeof useComposerSelectionMenu>;
  composerId: string | null;
  /** Cut or copy the selection the menu was opened on. */
  onClipboard: (command: "cut" | "copy") => void;
}) {
  const t = useTranslations("email_composer");
  const { contextMenu, closeContextMenu, menuRef } = menu;
  if (!contextMenu.isOpen) return null;
  const text = contextMenu.data?.text ?? "";
  return (
    <ContextMenu ref={menuRef} isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={closeContextMenu}>
      <ContextMenuItem icon={Scissors} label={t("cut")} testId="composer-selection-cut" onClick={() => { closeContextMenu(); onClipboard("cut"); }} />
      <ContextMenuItem icon={Copy} label={t("copy")} testId="composer-selection-copy" onClick={() => { closeContextMenu(); onClipboard("copy"); }} />
      <ContextMenuSeparator />
      <PluginActions
        surface="composer-selection-menu"
        variant="menu"
        context={{ composerId, selection: { text } }}
        onRan={closeContextMenu}
      />
    </ContextMenu>
  );
}
