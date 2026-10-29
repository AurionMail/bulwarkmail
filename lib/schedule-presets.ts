export type SchedulePresetKey = 'this_morning' | 'this_afternoon' | 'tomorrow_morning' | 'tomorrow_afternoon' | 'monday_morning';

export interface SchedulePreset {
  key: SchedulePresetKey;
  date: Date;
}

function at(base: Date, daysAhead: number, hour: number): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** How far ahead a time for today must be to be offered, so it is not past by the click. */
const TODAY_LEAD_MS = 5 * 60_000;

/**
 * One-click times for "Schedule send", like other mail clients offer:
 * tomorrow at 8:00 and 13:00, and next Monday at 8:00. Monday is left out
 * when it is tomorrow anyway (on a Sunday). Today's 8:00 and 13:00 come
 * first while they are still ahead, so a message written after midnight can
 * go out the same morning (#1390).
 */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const presets: SchedulePreset[] = [
    { key: 'this_morning' as const, date: at(now, 0, 8) },
    { key: 'this_afternoon' as const, date: at(now, 0, 13) },
  ].filter((preset) => preset.date.getTime() - now.getTime() >= TODAY_LEAD_MS);
  presets.push(
    { key: 'tomorrow_morning', date: at(now, 1, 8) },
    { key: 'tomorrow_afternoon', date: at(now, 1, 13) },
  );
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  if (daysToMonday > 1) presets.push({ key: 'monday_morning', date: at(now, daysToMonday, 8) });
  return presets;
}
