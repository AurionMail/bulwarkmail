import { describe, expect, it } from 'vitest';
import { schedulePresets } from '../schedule-presets';

// Local dates, so the expectations hold in any time zone.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('schedulePresets', () => {
  it('offers tomorrow morning and afternoon and next Monday morning', () => {
    // Wednesday 2026-10-14, 18:30
    const presets = schedulePresets(local(2026, 10, 14, 18, 30));
    expect(presets.map((p) => [p.key, p.date.getTime()])).toEqual([
      ['tomorrow_morning', local(2026, 10, 15, 8).getTime()],
      ['tomorrow_afternoon', local(2026, 10, 15, 13).getTime()],
      ['monday_morning', local(2026, 10, 19, 8).getTime()],
    ]);
  });

  it('skips Monday on a Sunday, when it is tomorrow anyway', () => {
    const presets = schedulePresets(local(2026, 10, 11, 18));
    expect(presets.map((p) => p.key)).toEqual(['tomorrow_morning', 'tomorrow_afternoon']);
  });

  it('picks the Monday a week ahead on a Monday', () => {
    const presets = schedulePresets(local(2026, 10, 12, 9));
    expect(presets.find((p) => p.key === 'monday_morning')?.date.getTime()).toBe(local(2026, 10, 19, 8).getTime());
  });

  it('offers this morning and afternoon after midnight, while they are ahead (#1390)', () => {
    // Thursday 2026-10-15, 01:30
    const presets = schedulePresets(local(2026, 10, 15, 1, 30));
    expect(presets.slice(0, 3).map((p) => [p.key, p.date.getTime()])).toEqual([
      ['this_morning', local(2026, 10, 15, 8).getTime()],
      ['this_afternoon', local(2026, 10, 15, 13).getTime()],
      ['tomorrow_morning', local(2026, 10, 16, 8).getTime()],
    ]);
  });

  it('drops a time of today that is past or about to be', () => {
    expect(schedulePresets(local(2026, 10, 15, 9)).map((p) => p.key)[0]).toBe('this_afternoon');
    expect(schedulePresets(local(2026, 10, 15, 12, 58)).map((p) => p.key)[0]).toBe('tomorrow_morning');
  });
});
