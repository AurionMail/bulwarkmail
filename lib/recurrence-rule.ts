import type { CalendarRecurrenceRule } from '@/lib/jmap/types';

type Frequency = CalendarRecurrenceRule['frequency'];

/**
 * A plain Gregorian recurrence rule with all by-parts unset. `rscale`/`skip`
 * are intentionally omitted: they only matter for non-Gregorian scales /
 * invalid-date handling, and defaulting them made Stalwart serialise
 * `RSCALE=GREGORIAN;SKIP=OMIT` into the RRULE, which DAVx5 rejects (#805).
 */
export function createRecurrenceRule(
  frequency: Frequency,
  overrides: Partial<CalendarRecurrenceRule> = {},
): CalendarRecurrenceRule {
  return {
    '@type': 'RecurrenceRule',
    frequency,
    interval: 1,
    firstDayOfWeek: 'mo',
    byDay: null,
    byMonthDay: null,
    byMonth: null,
    byYearDay: null,
    byWeekNo: null,
    byHour: null,
    byMinute: null,
    bySecond: null,
    bySetPosition: null,
    count: null,
    until: null,
    ...overrides,
  };
}

// What a rule means when a part is left out (RFC 8984 4.3.3).
const RULE_DEFAULTS: Record<string, unknown> = { interval: 1, firstDayOfWeek: 'mo', rscale: 'gregorian', skip: 'omit' };

function ruleKey(rule: CalendarRecurrenceRule): string {
  const parts = Object.entries(rule as unknown as Record<string, unknown>)
    .filter(([name, value]) => name !== '@type' && value != null
      && !(Array.isArray(value) && value.length === 0) && RULE_DEFAULTS[name] !== value)
    .map(([name, value]) => {
      if (!Array.isArray(value)) return [name, value];
      const items = value.map((item) => (item && typeof item === 'object'
        ? JSON.stringify([(item as { day?: string }).day, (item as { nthOfPeriod?: number | null }).nthOfPeriod ?? null])
        : JSON.stringify(item)));
      return [name, items.sort()];
    })
    .sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));
  return JSON.stringify(parts);
}

/**
 * Whether two sets of recurrence rules describe the same occurrences as far
 * as their parts go: parts left out and parts set to their default are the
 * same, and so are by-lists in another order. A server returns a rule with
 * its defaults dropped that the editor wrote with them.
 */
export function sameRecurrenceRules(
  a: CalendarRecurrenceRule[] | null | undefined,
  b: CalendarRecurrenceRule[] | null | undefined,
): boolean {
  const keys = (rules: CalendarRecurrenceRule[] | null | undefined) => (rules ?? []).map(ruleKey).sort();
  return JSON.stringify(keys(a)) === JSON.stringify(keys(b));
}
