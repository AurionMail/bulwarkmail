/**
 * Pending edits on an admin page, keyed by config key. An edit that puts the
 * saved value back is no edit: typing into an empty field and deleting it
 * again leaves nothing to save, so the save bar goes away.
 */

/** Whether a field holds what is saved: an empty field equals an unset key. */
export function sameConfigValue(value: unknown, saved: unknown): boolean {
  const blank = (v: unknown) => v === undefined || v === null || v === '';
  if (blank(value) || blank(saved)) return blank(value) && blank(saved);
  if (typeof value === 'object' || typeof saved === 'object') return JSON.stringify(value) === JSON.stringify(saved);
  // A number field hands back text.
  return String(value) === String(saved);
}

/** `edits` with `key` set to `value`, or without `key` when `value` is what is saved. */
export function withEdit<T>(edits: Record<string, T>, key: string, value: T, saved: unknown): Record<string, T> {
  const next = { ...edits };
  if (sameConfigValue(value, saved)) delete next[key];
  else next[key] = value;
  return next;
}
