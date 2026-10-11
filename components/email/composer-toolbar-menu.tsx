"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, type AppIcon } from "@/components/icons";
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
