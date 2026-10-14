// How slot iframes are sized. Shared by the host (which sizes the iframe)
// and the sandbox runtime (which measures the plugin's content).

import type { SlotName } from '../plugin-types';

/**
 * Slots that sit in a row next to host controls (toolbars, attachment chips,
 * the event form's action row). Their iframe takes the plugin content's own
 * width; everything else fills the width of its container.
 */
export const INLINE_SLOTS: ReadonlySet<SlotName> = new Set<SlotName>([
  'toolbar-actions',
  'composer-toolbar',
  'composer-attachment-source',
  'attachment-actions',
  'calendar-event-actions',
]);

export function isInlineSlot(slot: SlotName | string | null | undefined): boolean {
  return !!slot && INLINE_SLOTS.has(slot as SlotName);
}

/** Tallest a slot iframe gets; content past this scrolls inside it. */
export const MAX_SLOT_HEIGHT = 2000;
/** Widest an inline slot gets, so one plugin can't push the host's buttons off screen. */
export const MAX_INLINE_SLOT_WIDTH = 480;

function clamp(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(0, Math.ceil(value)));
}

/** A reported height the host can use, or null for garbage (NaN, strings). */
export function clampSlotHeight(height: unknown): number | null {
  return clamp(height, MAX_SLOT_HEIGHT);
}

export function clampSlotWidth(width: unknown): number | null {
  return clamp(width, MAX_INLINE_SLOT_WIDTH);
}
