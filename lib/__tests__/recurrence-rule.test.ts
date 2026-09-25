import { describe, it, expect } from 'vitest';
import { createRecurrenceRule, sameRecurrenceRules } from '@/lib/recurrence-rule';
import type { CalendarNDay, CalendarRecurrenceRule } from '@/lib/jmap/types';

describe('createRecurrenceRule (#805 — no default SKIP=OMIT)', () => {
  it('does not emit rscale or skip (which serialise to RSCALE=GREGORIAN;SKIP=OMIT)', () => {
    const rule = createRecurrenceRule('yearly');
    expect('skip' in rule).toBe(false);
    expect('rscale' in rule).toBe(false);
    expect(rule.skip).toBeUndefined();
    expect(rule.rscale).toBeUndefined();
  });

  it('builds a clean Gregorian default rule', () => {
    expect(createRecurrenceRule('daily')).toEqual({
      '@type': 'RecurrenceRule',
      frequency: 'daily',
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
    });
  });

  it('applies overrides (interval / count / until) without reintroducing skip', () => {
    const rule = createRecurrenceRule('yearly', { interval: 2, count: 100 });
    expect(rule.interval).toBe(2);
    expect(rule.count).toBe(100);
    expect(rule.until).toBeNull();
    expect('skip' in rule).toBe(false);
  });
});

describe('sameRecurrenceRules', () => {
  const weekly = (overrides: Partial<CalendarRecurrenceRule> = {}) => createRecurrenceRule('weekly', overrides);

  it('matches a rule the editor wrote with its defaults to the server\'s copy without them', () => {
    const fromServer = { '@type': 'RecurrenceRule', frequency: 'weekly' } as CalendarRecurrenceRule;
    expect(sameRecurrenceRules([weekly()], [fromServer])).toBe(true);
    expect(sameRecurrenceRules(null, [])).toBe(true);
  });

  it('ignores the order of by-lists', () => {
    // As 1.0 returns an NDay: typed, nthOfPeriod left out.
    const nday = (day: string) => ({ '@type': 'NDay', day }) as CalendarNDay;
    expect(sameRecurrenceRules(
      [weekly({ byDay: [{ day: 'mo' }, { day: 'we' }] })],
      [weekly({ byDay: [nday('we'), nday('mo')] })],
    )).toBe(true);
  });

  it('tells a custom rule moved from Monday to Tuesday apart', () => {
    expect(sameRecurrenceRules([weekly({ byDay: [{ day: 'mo' }] })], [weekly({ byDay: [{ day: 'tu' }] })])).toBe(false);
  });

  it('tells other frequencies, intervals, ends and a removed rule apart', () => {
    expect(sameRecurrenceRules([weekly()], [createRecurrenceRule('daily')])).toBe(false);
    expect(sameRecurrenceRules([weekly()], [weekly({ interval: 2 })])).toBe(false);
    expect(sameRecurrenceRules([weekly({ count: 5 })], [weekly({ count: 6 })])).toBe(false);
    expect(sameRecurrenceRules([weekly()], null)).toBe(false);
  });
});
