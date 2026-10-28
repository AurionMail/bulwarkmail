import { describe, it, expect } from 'vitest';
import {
  formatPrintTimeZone,
  groupEventsByDay,
  layoutMonthWeekForPrint,
  monthCellCapacity,
  printHourRange,
} from '../calendar-print';
import { buildWeekSegments, type CalendarWeekSegment } from '../calendar-utils';
import type { CalendarEvent, CalendarTask } from '@/lib/jmap/types';

function event(id: string, start: string, duration: string, allDay = false): CalendarEvent {
  return {
    id, uid: id, title: id, start, duration, showWithoutTime: allDay,
    calendarIds: { cal: true }, status: 'confirmed',
  } as unknown as CalendarEvent;
}

const segment = (id: string, startIndex: number, span: number, row: number): CalendarWeekSegment => ({
  event: event(id, '2026-10-26T00:00:00', 'P1D', true), startIndex, span, row, continuesBefore: false, continuesAfter: false,
});
const noTasks = (): CalendarTask[][] => Array.from({ length: 7 }, () => []);

describe('monthCellCapacity', () => {
  it('fits more lines in a month of four weeks than of six, and more on a portrait page', () => {
    expect(monthCellCapacity(6, 'landscape')).toBe(5);
    expect(monthCellCapacity(4, 'landscape')).toBeGreaterThan(monthCellCapacity(6, 'landscape'));
    expect(monthCellCapacity(6, 'portrait')).toBeGreaterThan(monthCellCapacity(6, 'landscape'));
  });
});

describe('layoutMonthWeekForPrint', () => {
  it('shows every entry of a day that fits, with no "+N more"', () => {
    const segments = [0, 1, 2].map((row) => segment(`e${row}`, 0, 1, row));
    const layout = layoutMonthWeekForPrint(segments, noTasks(), 3);
    expect(layout.chips).toHaveLength(3);
    expect(layout.more).toEqual([]);
  });

  it('gives a day that overflows one line less and a "+N more" in its last line', () => {
    const segments = [0, 1, 2, 3].map((row) => segment(`e${row}`, 2, 1, row));
    const layout = layoutMonthWeekForPrint(segments, noTasks(), 3);
    expect(layout.chips.map((c) => c.key)).toEqual(['e0-2-0', 'e1-2-1']);
    expect(layout.more).toEqual([{ dayIndex: 2, lane: 2, count: 2 }]);
  });

  it('keeps a span on the days it fits and cuts it on the one that overflows', () => {
    // A three-day bar on line 2; Tuesday (index 1) has two more events below it.
    const segments = [
      segment('bar', 0, 3, 2),
      segment('a', 1, 1, 0), segment('b', 1, 1, 1), segment('c', 1, 1, 3),
    ];
    const layout = layoutMonthWeekForPrint(segments, noTasks(), 3);
    const bars = layout.chips.filter((c) => c.item.kind === 'event' && c.item.event.id === 'bar');
    expect(bars.map((c) => [c.startIndex, c.span, c.continuesBefore, c.continuesAfter])).toEqual([
      [0, 1, false, true],
      [2, 1, true, false],
    ]);
    expect(layout.more).toEqual([{ dayIndex: 1, lane: 2, count: 2 }]);
  });

  it('stacks tasks under their day\'s events and counts the ones that do not fit', () => {
    const tasks = noTasks();
    tasks[4] = [1, 2, 3].map((n) => ({ id: `t${n}`, title: `t${n}`, calendarIds: {} } as unknown as CalendarTask));
    const layout = layoutMonthWeekForPrint([segment('e', 4, 1, 0)], tasks, 3);
    expect(layout.chips.filter((c) => c.item.kind === 'task').map((c) => c.lane)).toEqual([1]);
    expect(layout.more).toEqual([{ dayIndex: 4, lane: 2, count: 2 }]);
  });
});

describe('printHourRange', () => {
  const working = { startMinutes: 8 * 60, endMinutes: 18 * 60, restricted: true };
  const day = new Date(2026, 9, 28);

  it('widens the configured hours to whole hours around an event outside them', () => {
    const early = event('early', '2026-10-28T06:30:00', 'PT45M');
    const late = event('late', '2026-10-28T19:10:00', 'PT20M');
    expect(printHourRange(working, [early, late], [day])).toEqual({ startMinutes: 6 * 60, endMinutes: 20 * 60, restricted: true });
  });

  it('keeps the configured hours when every event is inside them', () => {
    expect(printHourRange(working, [event('lunch', '2026-10-28T12:00:00', 'PT1H')], [day])).toEqual(working);
  });

  it('does not widen for an event that fills the whole day (drawn in the all-day row)', () => {
    expect(printHourRange(working, [event('trip', '2026-10-27T12:00:00', 'P2D')], [day])).toEqual(working);
  });
});

describe('groupEventsByDay', () => {
  it('lists a multi-day event on each of its days, in time order, within the range', () => {
    const conference = event('conference', '2026-10-27T00:00:00', 'P3D', true);
    const standup = event('standup', '2026-10-28T09:00:00', 'PT15M');
    const breakfast = event('breakfast', '2026-10-28T07:30:00', 'PT30M');
    const days = groupEventsByDay([standup, conference, breakfast], { start: new Date(2026, 9, 28), end: new Date(2026, 9, 31) });
    expect(days.map((d) => [d.dateKey, d.events.map((e) => e.id)])).toEqual([
      ['2026-10-28', ['conference', 'breakfast', 'standup']],
      ['2026-10-29', ['conference']],
    ]);
  });
});

describe('formatPrintTimeZone', () => {
  it('names the zone in the user\'s language with its id', () => {
    expect(formatPrintTimeZone('Europe/Berlin', 'en', new Date(2026, 9, 28))).toBe('Central European Time (Europe/Berlin)');
    expect(formatPrintTimeZone('Europe/Berlin', 'de', new Date(2026, 9, 28))).toBe('Mitteleuropäische Zeit (Europe/Berlin)');
  });

  it('falls back to the id for a zone Intl does not know', () => {
    expect(formatPrintTimeZone('Mars/Olympus', 'en')).toBe('Mars/Olympus');
  });
});

// Keep the packed segments the month print gets in line with the screen's.
describe('month print input', () => {
  it('uses the same lanes as the month view', () => {
    const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 26 + i));
    const segments = buildWeekSegments([event('a', '2026-10-27T00:00:00', 'P2D', true), event('b', '2026-10-27T10:00:00', 'PT1H')], week);
    expect(segments.map((s) => [s.event.id, s.startIndex, s.span, s.row])).toEqual([['a', 1, 2, 0], ['b', 1, 1, 1]]);
  });
});
