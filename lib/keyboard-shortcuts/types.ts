import type { InterfaceLayout } from "@/stores/settings-store";
import type { FeatureGates } from "@/lib/admin/types";

/**
 * One row of the help modal. `key` is written in the shortcut notation of
 * lib/shortcut-keys ("Mod + K", alternatives "j / ↓"); `description` is a
 * translation key. `layout` limits a row to one interface layout: Mountain
 * View adds the `g` sequences and gives `x` to selection.
 */
export interface ShortcutEntry {
  readonly key: string;
  readonly description: string;
  readonly layout?: InterfaceLayout;
  /** Listed only in the Pro shell, or only outside it. */
  readonly shell?: "pro" | "standard";
  /** Listed only while this admin policy feature gate is on. */
  readonly feature?: keyof FeatureGates;
}

/** A titled group of rows. A section with no rows (after filtering) is not drawn. */
export interface ShortcutSection {
  readonly id: string;
  /** Translation key of the heading. */
  readonly title: string;
  readonly entries: readonly ShortcutEntry[];
  /** Spans both columns of the modal. */
  readonly wide?: boolean;
}

export type ShortcutAppId = "mail" | "calendar" | "contacts" | "files" | "settings";
