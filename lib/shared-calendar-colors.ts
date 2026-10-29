import type { Calendar } from '@/lib/jmap/types';

/**
 * Palette of calendar colors offered in the color picker. Defined here (rather
 * than in the settings UI component) so non-React modules can reuse it without
 * pulling in component code. The settings color picker re-exports this.
 */
export const CALENDAR_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#6366f1", // indigo
  "#a855f7", // purple
  "#e11d48", // rose
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#d946ef", // fuchsia
];

/**
 * Stable key for a shared calendar's local color override. Independent of the
 * Pro-shell id prefix (which changes with the active account), so the override
 * survives shell-mode and account switches. Built from the owning JMAP account
 * + the calendar's original server id.
 */
export function sharedCalendarColorKey(
  cal: Pick<Calendar, 'id' | 'originalId' | 'accountId' | 'localAccountId'>,
): string {
  const localAccount = cal.localAccountId ?? '';
  const account = cal.accountId ?? '';
  const id = cal.originalId ?? cal.id;
  return `${localAccount}|${account}|${id}`;
}

/**
 * Pick a random palette color not present in `usedColors`. Once every palette
 * entry is taken, fall back to a random palette color (collisions are
 * unavoidable past CALENDAR_COLORS.length calendars).
 */
export function pickUnusedCalendarColor(usedColors: Iterable<string>): string {
  const used = new Set<string>();
  for (const c of usedColors) {
    if (c) used.add(c.toLowerCase());
  }
  const available = CALENDAR_COLORS.filter((c) => !used.has(c.toLowerCase()));
  const pool = available.length > 0 ? available : CALENDAR_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pick an unused palette color for every shared calendar that has neither a
 * color from the server nor a local override, so several of them don't
 * collide on the default color. A shared calendar the server gives a color
 * keeps it until the viewer picks their own (#1414). Returns only the new
 * overrides, keyed by sharedCalendarColorKey().
 */
export function autoAssignSharedCalendarColors(
  calendars: Calendar[],
  overrides: Record<string, string>,
): Record<string, string> {
  // Seed "used" with every color already on screen: personal and server
  // colors plus the existing shared overrides.
  const used = new Set<string>();
  for (const c of calendars) {
    if (c.color) used.add(c.color.toLowerCase());
  }
  for (const color of Object.values(overrides)) {
    if (color) used.add(color.toLowerCase());
  }
  const assigned: Record<string, string> = {};
  for (const cal of calendars) {
    if (!cal.isShared || cal.color) continue;
    const key = sharedCalendarColorKey(cal);
    if (overrides[key] || assigned[key]) continue;
    const color = pickUnusedCalendarColor(used);
    used.add(color.toLowerCase());
    assigned[key] = color;
  }
  return assigned;
}
