"use client";

// The composer-sidebar and composer-sidebar-right plugin panels. Each gets a
// fixed width and a toggle to fold it to a thin strip. When the composer is
// too narrow for an open panel next to it, the panel folds by itself (right
// first); opening it anyway lays it over the composer instead of squeezing
// the message into a column nobody can write in.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "@/components/icons";
import { PluginSlot } from "@/components/plugins/plugin-slot";
import { usePluginSlotOffers } from "@/hooks/use-plugin-slot-offers";
import { cn } from "@/lib/utils";

/** Width of an open panel. */
export const COMPOSER_SIDEBAR_WIDTH = 260;
/** Width of a folded panel (the strip with its toggle). */
export const COMPOSER_SIDEBAR_STRIP = 37;
/** Narrowest the composer itself may get next to open panels. */
export const MIN_COMPOSER_WIDTH = 480;

export type ComposerSidebarSide = "left" | "right";
/** docked: open beside the composer; folded: a strip; overlay: open over the composer. */
export type ComposerSidebarMode = "docked" | "folded" | "overlay";

interface SideState {
  present: boolean;
  /** Folded by the user. */
  collapsed: boolean;
  /** Opened by the user while there was no room for it. */
  overlayOpen?: boolean;
}

/**
 * How each panel is shown in a composer `width` px wide (0 = not measured
 * yet: everything the user left open is shown open). The left panel gets
 * room first, since the right one is folded first.
 */
export function composerSidebarModes(
  width: number,
  left: SideState,
  right: SideState,
): Record<ComposerSidebarSide, ComposerSidebarMode | null> {
  const present = (left.present ? 1 : 0) + (right.present ? 1 : 0);
  let room = width > 0 ? width - MIN_COMPOSER_WIDTH - present * COMPOSER_SIDEBAR_STRIP : Infinity;
  const place = (side: SideState): ComposerSidebarMode | null => {
    if (!side.present) return null;
    if (side.collapsed) return "folded";
    const extra = COMPOSER_SIDEBAR_WIDTH - COMPOSER_SIDEBAR_STRIP;
    if (extra <= room) {
      room -= extra;
      return "docked";
    }
    return side.overlayOpen ? "overlay" : "folded";
  };
  const l = place(left);
  return { left: l, right: place(right) };
}

const storageKey = (side: ComposerSidebarSide) => `composerPluginSidebarCollapsed:${side}`;

function readCollapsed(side: ComposerSidebarSide): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(storageKey(side)) === "1"; } catch { return false; }
}

/** Layout state of both panels for a composer whose root element is `root`. */
export function useComposerSidebars(root: HTMLElement | null) {
  const hasLeft = usePluginSlotOffers("composer-sidebar").length > 0;
  const hasRight = usePluginSlotOffers("composer-sidebar-right").length > 0;
  const [width, setWidth] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<ComposerSidebarSide, boolean>>(() => ({
    left: readCollapsed("left"),
    right: readCollapsed("right"),
  }));
  const [overlayOpen, setOverlayOpen] = useState<Record<ComposerSidebarSide, boolean>>({ left: false, right: false });

  useEffect(() => {
    if (!root || (!hasLeft && !hasRight) || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0]?.contentRect.width ?? root.getBoundingClientRect().width));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [root, hasLeft, hasRight]);

  const modes = composerSidebarModes(
    width,
    { present: hasLeft, collapsed: collapsed.left, overlayOpen: overlayOpen.left },
    { present: hasRight, collapsed: collapsed.right, overlayOpen: overlayOpen.right },
  );

  const setSideCollapsed = (side: ComposerSidebarSide, value: boolean) => {
    setCollapsed((prev) => ({ ...prev, [side]: value }));
    try { localStorage.setItem(storageKey(side), value ? "1" : "0"); } catch { /* storage blocked */ }
  };

  /** Open a folded panel: beside the composer when it fits, over it otherwise. */
  const open = (side: ComposerSidebarSide) => {
    const next = { ...collapsed, [side]: false };
    const fits = composerSidebarModes(
      width,
      { present: hasLeft, collapsed: next.left },
      { present: hasRight, collapsed: next.right },
    )[side] === "docked";
    setSideCollapsed(side, false);
    setOverlayOpen((prev) => ({ ...prev, [side]: !fits }));
  };
  const close = (side: ComposerSidebarSide) => {
    setSideCollapsed(side, true);
    setOverlayOpen((prev) => ({ ...prev, [side]: false }));
  };

  return { modes, open, close };
}

/** One plugin panel of the composer, in the mode useComposerSidebars picked. */
export function ComposerPluginSidebar({
  side,
  mode,
  onOpen,
  onClose,
}: {
  side: ComposerSidebarSide;
  mode: ComposerSidebarMode | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("email_viewer");
  if (!mode) return null;
  const border = side === "left" ? "border-e" : "border-s";
  const OpenIcon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  const CloseIcon = side === "left" ? PanelLeftClose : PanelRightClose;

  if (mode === "folded") {
    return (
      <div
        className={cn("hidden md:flex flex-col items-center shrink-0 h-full border-border bg-background", border)}
        style={{ width: COMPOSER_SIDEBAR_STRIP }}
        data-composer-sidebar={side}
        data-composer-sidebar-mode="folded"
      >
        <button
          type="button"
          onClick={onOpen}
          className="m-1 grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("plugin_panel_show")}
          aria-label={t("plugin_panel_show")}
        >
          <OpenIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "hidden md:flex flex-col shrink-0 h-full border-border bg-background overflow-hidden",
        border,
        mode === "overlay" && cn("absolute inset-y-0 z-30 shadow-xl", side === "left" ? "start-0" : "end-0"),
      )}
      style={{ width: COMPOSER_SIDEBAR_WIDTH }}
      data-composer-sidebar={side}
      data-composer-sidebar-mode={mode}
    >
      <div className={cn("flex items-center px-1 py-1 border-b border-border shrink-0", side === "left" ? "justify-end" : "justify-start")}>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t("plugin_panel_hide")}
          aria-label={t("plugin_panel_hide")}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {side === "left"
          ? <PluginSlot name="composer-sidebar" className="flex flex-col" />
          : <PluginSlot name="composer-sidebar-right" className="flex flex-col" />}
      </div>
    </div>
  );
}
