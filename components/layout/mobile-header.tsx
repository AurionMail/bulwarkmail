"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, ArrowLeft, Plus, Search, X, MoreVertical, Terminal, Bell } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore } from "@/stores/settings-store";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { AccountSwitcher } from "@/components/layout/account-switcher";
import { PluginActions } from "@/components/plugins/plugin-actions";
import { useMenuNavigation } from "@/hooks/use-menu-navigation";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { openCommandPalette } from "@/lib/app-commands";
import { NotificationSheet, formatBadgeCount, useUnreadNotificationCount } from "@/components/notifications/notification-center";

/** Plugin buttons in the top bar are not about any one item. */
const TOP_BAR_CONTEXT: Record<string, unknown> = {};

/**
 * The phone header's overflow menu: the notifications (the desktop bell), the
 * command palette (no Ctrl+K on a phone) and what the desktop top bar shows
 * as buttons (plugin top-bar-actions) and has no room for here.
 */
function MobileHeaderMenu() {
  const t = useTranslations('top_bar');
  const tPalette = useTranslations('command_palette');
  const tNotifications = useTranslations('notification_center');
  const unread = useUnreadNotificationCount();
  const [showNotifications, setShowNotifications] = useState(false);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { menuRef, onKeyDown } = useMenuNavigation<HTMLDivElement>({ open, onClose: close, triggerRef });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, menuRef]);

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        className={cn("relative h-11 w-11", open && "bg-accent")}
        aria-label={unread > 0 ? `${t('more')} (${tNotifications('unread_count', { count: unread })})` : t('more')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-2 end-2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-background" aria-hidden="true" />
        )}
      </Button>
      {open && (
        <div
          ref={menuRef}
          onKeyDown={onKeyDown}
          role="menu"
          aria-label={t('more')}
          className="absolute end-0 top-full mt-1 z-50 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background py-1 shadow-lg"
        >
          <ContextMenuItem
            icon={Bell}
            label={tNotifications('title')}
            shortcut={unread > 0 ? formatBadgeCount(unread) : undefined}
            onClick={() => { close(); setShowNotifications(true); }}
          />
          <ContextMenuItem
            icon={Terminal}
            label={tPalette('title')}
            onClick={() => { close(); openCommandPalette(); }}
          />
          <PluginActions surface="top-bar-actions" context={TOP_BAR_CONTEXT} variant="menu" onRan={close} />
        </div>
      )}
      {showNotifications && <NotificationSheet onClose={() => setShowNotifications(false)} />}
    </div>
  );
}

interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  onCompose?: () => void;
  onSearch?: () => void;
  className?: string;
  /** Id of the sidebar this header's menu button toggles. */
  sidebarId?: string;
  /**
   * When set, the mailbox title is replaced by a tappable search field and
   * this fires instead. The folder name stays visible in the drawer, so the
   * bar spends its width on the thing you act on rather than a label.
   */
  onOpenSearch?: () => void;
  /** Placeholder shown inside the search field. */
  searchPlaceholder?: string;
  /** Clears the active query without opening the search panel. */
  onClearSearch?: () => void;
  /** Whether a query is currently applied, which reveals the clear button. */
  searchActive?: boolean;
  /** Mountain View: opens the merged across-accounts inbox from the avatar's popover. */
  onSelectAllInboxes?: () => void;
  allInboxesSelected?: boolean;
}

export function MobileHeader({
  title,
  showBack = false,
  onBack,
  onCompose,
  onSearch,
  className,
  sidebarId,
  onOpenSearch,
  searchPlaceholder,
  onClearSearch,
  searchActive = false,
  onSelectAllInboxes,
  allInboxesSelected = false,
}: MobileHeaderProps) {
  const t = useTranslations('sidebar');
  const { toggleSidebar, goBack, sidebarOpen } = useUIStore(useShallow((state) => ({ toggleSidebar: state.toggleSidebar, goBack: state.goBack, sidebarOpen: state.sidebarOpen })));
  const mountainView = useSettingsStore((state) => state.interfaceLayout === 'mountain-view');
  // Pane-aware: in Pro split mode the viewport is desktop-wide while the
  // pane is narrow. The Tailwind `lg:hidden` variant alone would never fire
  // there, so we additionally hide via JS when the surrounding pane is
  // desktop-sized. Outside of Pro this still returns the viewport value.
  const isPaneDesktop = useIsDesktop();
  if (isPaneDesktop) return null;

  const handleLeftAction = () => {
    if (showBack && onBack) {
      onBack();
    } else if (showBack) {
      goBack();
    } else {
      toggleSidebar();
    }
  };

  return (
    <header
      data-mobile-mail-header=""
      className={cn(
        "flex items-center justify-between h-14 shrink-0",
        mountainView
          ? "mx-2 mt-2 mb-1 rounded-full border-0 bg-muted px-2 shadow-sm"
          : "border-b border-border bg-background px-4",
        className
      )}
    >
      {/* Left action: Menu or Back button */}
      <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleLeftAction}
          className={cn(
            "h-11 w-11",
            !showBack && sidebarOpen && "bg-accent"
          )}
          data-sidebar-toggle={!showBack ? "" : undefined}
          aria-label={showBack ? t('mobile.go_back') : t('mobile.toggle_menu')}
          aria-expanded={!showBack ? sidebarOpen : undefined}
          aria-controls={!showBack ? sidebarId : undefined}
        >
          {showBack ? (
            <ArrowLeft className="h-5 w-5" />
          ) : sidebarOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>

        {/* Title, unless the bar is in search-first mode */}
        {!onOpenSearch && <h1 className="font-semibold text-lg truncate">{title}</h1>}
      </div>

      {onOpenSearch && (
        /* Not a single button: the clear control is a button of its own, and
           nesting one inside another is invalid markup. */
        <div
          data-mobile-mail-search=""
          className={cn(
            "flex-1 min-w-0 h-10 flex items-center rounded-full pe-1",
            mountainView ? "mx-0 bg-transparent ps-2" : "mx-1 bg-muted ps-3"
          )}
        >
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex-1 min-w-0 h-full flex items-center gap-2 text-start text-muted-foreground"
            aria-label={searchPlaceholder || title}
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="truncate text-sm">{searchPlaceholder || title}</span>
          </button>
          {searchActive && onClearSearch && (
            <button
              type="button"
              onClick={onClearSearch}
              className="h-8 w-8 flex-shrink-0 grid place-items-center rounded-full text-muted-foreground hover:bg-background/60"
              aria-label={t('clear_search')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Right actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {onSearch && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onSearch}
            className="h-11 w-11"
            aria-label={t('mobile.search')}
          >
            <Search className="h-5 w-5" />
          </Button>
        )}
        {onCompose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onCompose}
            className="h-11 w-11 text-primary"
            aria-label={t('mobile.compose')}
          >
            <Plus className="h-5 w-5" />
          </Button>
        )}

        <MobileHeaderMenu />

        {/* Which account you are reading is otherwise only visible after
            opening the drawer. Last in this group so it sits on the far
            edge — opposite the menu button, and mirrored under RTL because
            the header is laid out with flex rather than fixed sides. */}
        <AccountSwitcher
          variant="header"
          onSelectAllInboxes={onSelectAllInboxes}
          allInboxesSelected={allInboxesSelected}
        />
      </div>
    </header>
  );
}
