export type SchedulePresetKey = 'tomorrow_morning' | 'tomorrow_afternoon' | 'monday_morning';

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

/**
 * One-click times for "Schedule send", like other mail clients offer:
 * tomorrow at 8:00 and 13:00, and next Monday at 8:00. Monday is left out
 * when it is tomorrow anyway (on a Sunday).
 */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const presets: SchedulePreset[] = [
    { key: 'tomorrow_morning', date: at(now, 1, 8) },
    { key: 'tomorrow_afternoon', date: at(now, 1, 13) },
  ];
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  if (daysToMonday > 1) presets.push({ key: 'monday_morning', date: at(now, daysToMonday, 8) });
  return presets;
}
