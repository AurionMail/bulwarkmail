"use client";

import * as React from "react";
import { Search, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Input } from "@/components/ui/input";
import { IconButton, type IconButtonProps } from "@/components/ui/icon-button";
import { TOUCH_HIT_AREA } from "@/components/ui/button";

// One look for the header rows of Mail, Calendar, Contacts and Files: 32px
// controls, muted icon buttons, one tint for a toggle that is on, and one
// search field.

/** A toggle, panel or menu that is on. */
export const TOOLBAR_ACTIVE = "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

export interface ToolbarButtonProps extends IconButtonProps {
  /** The toggle is on, or its panel or menu is open. */
  active?: boolean;
}

/** An icon button in a header row: muted until hovered, tinted while active. */
export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ active, className, ...props }, ref) => (
    <IconButton
      ref={ref}
      className={cn("shrink-0", active ? TOOLBAR_ACTIVE : "text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  ),
);
ToolbarButton.displayName = "ToolbarButton";

/** A small button inside the search field, after the text (the filter toggle). */
export const ToolbarSearchAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>(
  ({ active, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "p-1 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        TOUCH_HIT_AREA,
        active ? TOOLBAR_ACTIVE : "text-muted-foreground hover:text-foreground hover:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
ToolbarSearchAction.displayName = "ToolbarSearchAction";

export interface ToolbarSearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> {
  value: string;
  /** Empties the field. The clear button shows while there is text. */
  onClear?: () => void;
  /** The clear button's name; needed with onClear. */
  clearLabel?: string;
  /** Keep the clear button when the field is empty (it closes a phone's search row). */
  alwaysShowClear?: boolean;
  /** The key that focuses the field from anywhere, shown as a key cap while empty. */
  shortcut?: string;
  /** Controls after the clear button. */
  trailing?: React.ReactNode;
  /** For the wrapper, which sets the width. */
  className?: string;
  inputClassName?: string;
}

/** The search field in a header row. */
export const ToolbarSearch = React.forwardRef<HTMLInputElement, ToolbarSearchProps>(
  ({ value, onClear, clearLabel, alwaysShowClear, shortcut, trailing, className, inputClassName, type = "search", ...props }, ref) => {
    // A key cap only where there is a keyboard to press it on (R8).
    const touch = useMediaQuery("(pointer: coarse)");
    const showKey = !!shortcut && !value && !touch;
    const showClear = !!onClear && (!!value || !!alwaysShowClear);
    const endItems = (showKey || showClear ? 1 : 0) + (trailing ? 1 : 0);
    return (
      <div className={cn("relative group/search", className)}>
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
        {/* type="search" keeps password managers out (Bitwarden skips search fields). */}
        <Input
          ref={ref}
          type={type}
          value={value}
          aria-keyshortcuts={shortcut && !touch ? shortcut : undefined}
          className={cn(
            "h-8 ps-8 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
            endItems === 2 ? "pe-16" : endItems === 1 ? "pe-8" : "pe-3",
            inputClassName,
          )}
          {...props}
        />
        {endItems > 0 && (
          <div className="absolute end-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {showKey && (
              <kbd
                aria-hidden="true"
                className="pointer-events-none mx-1 rounded border border-border px-1.5 font-sans text-[11px] leading-4 text-muted-foreground group-focus-within/search:invisible"
              >
                {shortcut}
              </kbd>
            )}
            {showClear && (
              <button
                type="button"
                onClick={onClear}
                // The wrapper places it: the hit area's `relative` would beat
                // an `absolute` on the button and push it under the field.
                className={cn("p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors", TOUCH_HIT_AREA)}
                aria-label={clearLabel}
                title={clearLabel}
                data-testid="search-clear"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {trailing}
          </div>
        )}
      </div>
    );
  },
);
ToolbarSearch.displayName = "ToolbarSearch";
