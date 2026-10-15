// Short labels and dots plugins put on calendar days (`api.ui.setDayLabels`):
// a holiday name under the day header, a dot in the small month calendar.
// Data only; the host draws them.

export interface DayLabel {
  /** YYYY-MM-DD */
  date: string;
  /** Shown under the day's name in the day and week views (max 24 characters). */
  text?: string;
  /** Tooltip (max 120 characters). */
  title?: string;
  /** A dot on the day in the small month calendar. */
  dot?: boolean;
}

export interface RegisteredDayLabel extends DayLabel {
  pluginId: string;
  pluginName: string;
}

export const MAX_DAY_LABELS = 400;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function checkDayLabels(value: unknown): DayLabel[] {
  if (!Array.isArray(value)) throw new Error('labels must be a list');
  if (value.length > MAX_DAY_LABELS) throw new Error(`At most ${MAX_DAY_LABELS} day labels`);
  return value.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw new Error(`labels[${i}] must be an object`);
    const l = raw as Record<string, unknown>;
    if (typeof l.date !== 'string' || !DATE_RE.test(l.date)) throw new Error(`labels[${i}].date must be YYYY-MM-DD`);
    const out: DayLabel = { date: l.date };
    if (l.text !== undefined) {
      if (typeof l.text !== 'string' || l.text.length > 24) throw new Error(`labels[${i}].text must be at most 24 characters`);
      if (l.text.trim()) out.text = l.text.trim();
    }
    if (l.title !== undefined) {
      if (typeof l.title !== 'string' || l.title.length > 120) throw new Error(`labels[${i}].title must be at most 120 characters`);
      if (l.title.trim()) out.title = l.title.trim();
    }
    if (l.dot !== undefined) out.dot = l.dot === true;
    if (!out.text && !out.dot) throw new Error(`labels[${i}] needs text or dot`);
    return out;
  });
}

const byPlugin = new Map<string, RegisteredDayLabel[]>();
const listeners = new Set<() => void>();
let snapshot: Map<string, RegisteredDayLabel[]> | null = null;

function changed(): void {
  snapshot = null;
  for (const l of listeners) {
    try { l(); } catch { /* ignore */ }
  }
}

export function subscribeDayLabels(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setDayLabels(pluginId: string, pluginName: string, labels: DayLabel[]): void {
  if (labels.length === 0) byPlugin.delete(pluginId);
  else byPlugin.set(pluginId, labels.map((l) => ({ ...l, pluginId, pluginName })));
  changed();
}

export function clearDayLabels(pluginId: string): void {
  if (byPlugin.delete(pluginId)) changed();
}

/** Labels by date. Stable between changes (for useSyncExternalStore). */
export function dayLabelsByDate(): Map<string, RegisteredDayLabel[]> {
  if (snapshot) return snapshot;
  const out = new Map<string, RegisteredDayLabel[]>();
  for (const labels of byPlugin.values()) {
    for (const l of labels) {
      const list = out.get(l.date);
      if (list) list.push(l);
      else out.set(l.date, [l]);
    }
  }
  snapshot = out;
  return out;
}

/** Test helper. */
export function resetDayLabels(): void {
  byPlugin.clear();
  changed();
}
