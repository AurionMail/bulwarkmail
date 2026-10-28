"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/ui/icon-button";
import { Tag } from "@/components/icons";
import { TagPicker } from "./tag-picker";
import type { TagScope } from "@/hooks/use-account-tags";

const TAG_PICKER_WIDTH = 224;

/**
 * The tag entry of the selection toolbar: opens the shared tag picker for
 * every selected message at once. (#1077)
 *
 * The picker is portalled to the body because the toolbar clips its overflow
 * to animate open and shut.
 */
export function BatchTagButton({
  title,
  selectedIds,
  partialIds,
  onToggle,
  active,
  disabled,
  scope = null,
}: {
  title: string;
  /** Tags every selected message carries. */
  selectedIds: string[];
  /** Tags only some of them carry. */
  partialIds: string[];
  onToggle: (tagId: string) => void;
  /** Whether there is a selection to tag; the picker shuts without one. */
  active: boolean;
  disabled?: boolean;
  /** The account of the whole selection (commonTagScope); null: the user's own tags. */
  scope?: TagScope | null;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setPos(null), []);
  const isOpen = pos !== null && active;

  useEffect(() => {
    if (!pos) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The anchor is left to its own click handler, which toggles the picker
      // shut - closing here first would let that click reopen it.
      if (buttonRef.current?.contains(target)) return;
      if (!pickerRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [pos, close]);

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={title}
        data-testid="batch-tag"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPos((open) =>
            open
              ? null
              : {
                  top: rect.bottom + 4,
                  left: Math.max(8, Math.min(rect.left, window.innerWidth - TAG_PICKER_WIDTH - 8)),
                },
          );
        }}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        <Tag />
      </IconButton>
      {isOpen &&
        createPortal(
          <div
            ref={pickerRef}
            data-testid="batch-tag-picker"
            role="menu"
            className="fixed z-50 w-56 max-w-[18rem] rounded-lg border border-border bg-popover py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            <TagPicker selectedIds={selectedIds} partialIds={partialIds} onToggle={onToggle} scope={scope} />
          </div>,
          document.body,
        )}
    </>
  );
}
