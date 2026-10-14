"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, iconForName, Puzzle, type AppIcon } from "@/components/icons";
import { usePluginActions } from "@/components/plugins/plugin-actions";
import { runAction } from "@/lib/plugin-sandbox/actions";
import { cn } from "@/lib/utils";

interface ComposerToolbarMenuProps {
  icon: AppIcon;
  label: string;
  /** Number of options that are switched on, shown as a badge on the button. */
  activeCount?: number;
  testId?: string;
  children: (close: () => void) => React.ReactNode;
}

/**
 * A labelled toolbar button that opens a small menu above it. The label is
 * always the accessible name; it is only hidden visually on narrow screens.
 */
export function ComposerToolbarMenu({ icon: Icon, label, activeCount = 0, testId, children }: ComposerToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className={cn("h-9 gap-1.5 px-2 sm:px-2.5", open && "bg-muted")}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={testId}
      >
        <Icon className="w-4 h-4" />
        <span className="hidden sm:inline text-sm">{label}</span>
        {activeCount > 0 && (
          <span className="min-w-4 h-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {activeCount}
          </span>
        )}
        <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-muted-foreground" />
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute start-0 bottom-full z-50 mb-2 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  icon?: AppIcon;
  onSelect: () => void;
  testId?: string;
  children: React.ReactNode;
}

export function ComposerToolbarMenuItem({ icon: Icon, onSelect, testId, children }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      data-testid={testId}
      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground"
    >
      {Icon ? <Icon className="w-4 h-4 shrink-0 text-muted-foreground" /> : null}
      <span className="flex-1">{children}</span>
    </button>
  );
}

interface CheckItemProps {
  checked: boolean;
  onToggle: () => void;
  description?: string;
  testId?: string;
  children: React.ReactNode;
}

/** A menu entry that stays open on click so several options can be set in one go. */
export function ComposerToolbarMenuCheckItem({ checked, onToggle, description, testId, children }: CheckItemProps) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onToggle}
      data-testid={testId}
      className="flex w-full items-start gap-2 rounded-sm px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground"
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
        )}
        aria-hidden="true"
      >
        {checked && <Check className="w-3 h-3" />}
      </span>
      <span className="flex-1">
        <span className="block">{children}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </button>
  );
}

interface PluginItemsProps {
  /** A surface of kind 'action' in lib/plugin-slot-catalog.ts. */
  surface: string;
  /** What the click is about; a function is read at click time. */
  context: Record<string, unknown> | (() => Record<string, unknown>);
  /** Called before the plugin gets the click, e.g. to close the menu. */
  onSelect?: () => void;
  /** Draw a separator before the entries (when the menu has its own above). */
  separator?: boolean;
}

/**
 * Buttons plugins declared for the composer's bottom bar
 * (composer-toolbar-actions), drawn like Attach and Templates. An action's
 * shortcut is shown in its tooltip; the composer binds it.
 */
export function ComposerPluginToolbarButtons({ surface, context }: { surface: "composer-toolbar-actions"; context: () => Record<string, unknown> }) {
  const actions = usePluginActions(surface);
  if (actions.length === 0) return null;
  return (
    <>
      {actions.map((action) => {
        const Icon = iconForName(action.icon) ?? Puzzle;
        const tip = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
        return (
          <Button
            key={`${action.pluginId}:${action.id}`}
            type="button"
            variant="ghost"
            className={cn("h-9 gap-1.5 px-2 sm:px-2.5", action.danger && "text-destructive")}
            title={tip}
            aria-label={action.label}
            aria-keyshortcuts={action.shortcut}
            data-plugin-action={`${action.pluginId}:${action.id}`}
            onClick={() => { void runAction(action, surface, context()); }}
          >
            <Icon className="w-4 h-4" />
            {/* The label only when the bar has room for it next to the app's own
                buttons; otherwise the icon, with the label as tooltip. */}
            <span className="hidden @[44rem]/composer-bar:inline text-sm">{action.label}</span>
          </Button>
        );
      })}
    </>
  );
}

/** Entries plugins declared for a composer menu, drawn like the menu's own. */
export function ComposerPluginMenuItems({ surface, context, onSelect, separator }: PluginItemsProps) {
  const actions = usePluginActions(surface);
  if (actions.length === 0) return null;
  return (
    <>
      {separator && <div role="separator" className="my-1 h-px bg-border" />}
      {actions.map((action) => {
        const Icon = iconForName(action.icon) ?? Puzzle;
        if (action.checked !== undefined) {
          // An option like the menu's own (plain text, read receipt): stays
          // open, so several can be set in one go.
          return (
            <ComposerToolbarMenuCheckItem
              key={`${action.pluginId}:${action.id}`}
              checked={action.checked}
              description={action.description}
              onToggle={() => { void runAction(action, surface, typeof context === "function" ? context() : context); }}
            >
              {action.label}
            </ComposerToolbarMenuCheckItem>
          );
        }
        return (
          <button
            key={`${action.pluginId}:${action.id}`}
            type="button"
            role="menuitem"
            title={action.pluginName}
            onClick={() => {
              onSelect?.();
              void runAction(action, surface, typeof context === "function" ? context() : context);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground",
              action.danger && "text-destructive",
            )}
          >
            <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block">{action.label}</span>
              {action.description && <span className="block text-xs text-muted-foreground">{action.description}</span>}
            </span>
          </button>
        );
      })}
    </>
  );
}
