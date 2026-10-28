import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCalendarEventSearch } from '../use-calendar-event-search';
import type { CalendarEvent } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/timezone')>()),
  displayNow: () => new Date(2026, 9, 28, 12, 0),
}));

function makeEvent(id: string, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id, uid: id, '@type': 'Event', title, start, duration: 'PT1H', showWithoutTime: false,
    calendarIds: { 'cal-1': true }, ...extra,
  } as unknown as CalendarEvent;
}

function clientWith(query: () => Promise<CalendarEvent[]>) {
  const queryAllCalendarEvents = vi.fn(query);
  return { client: { queryAllCalendarEvents } as unknown as IJMAPClient, queryAllCalendarEvents };
}

const loaded = [
  makeEvent('standup-1', 'Standup', '2026-10-27T09:00:00', { uid: 'standup' }),
  makeEvent('standup-2', 'Standup', '2026-10-29T09:00:00', { uid: 'standup' }),
  makeEvent('standup-3', 'Standup', '2026-10-30T09:00:00', { uid: 'standup' }),
  makeEvent('review', 'Design review', '2026-10-20T14:00:00', {
    participants: { p: { '@type': 'Participant', name: 'Grizzelda Pentworth', email: 'griz@example.net' } } as never,
  }),
];

describe('useCalendarEventSearch (CAL-16)', () => {
  it('answers from the loaded events at once, participants included, one row per series', async () => {
    const { client } = clientWith(() => new Promise(() => {}));
    const { result } = renderHook(() => useCalendarEventSearch('griz', client, loaded));
    expect(result.current?.past.map((e) => e.id)).toEqual(['review']);
    expect(result.current?.searching).toBe(true);

    const series = renderHook(() => useCalendarEventSearch('standup', client, loaded));
    // The next occurrence to come, not every loaded one
    expect(series.result.current?.upcoming.map((e) => e.id)).toEqual(['standup-2']);
    expect(series.result.current?.past).toEqual([]);
  });

  it('adds what the server finds outside the loaded weeks, upcoming soonest first and past latest first', async () => {
    const { client, queryAllCalendarEvents } = clientWith(async () => [
      makeEvent('old', 'Standup retro', '2025-03-01T10:00:00'),
      makeEvent('older', 'Standup kickoff', '2024-01-10T10:00:00'),
      makeEvent('later', 'Standup offsite', '2027-02-01T10:00:00'),
      // the series the loaded weeks already show
      makeEvent('standup-master', 'Standup', '2026-01-05T09:00:00', { uid: 'standup' }),
    ]);
    const { result } = renderHook(() => useCalendarEventSearch('standup', client, loaded));
    await waitFor(() => expect(result.current?.searching).toBe(false));
    expect(queryAllCalendarEvents).toHaveBeenCalledWith(
      { text: 'standup' }, [{ property: 'start', isAscending: false }], 100, expect.anything(),
    );
    expect(result.current?.upcoming.map((e) => e.id)).toEqual(['standup-2', 'later']);
    expect(result.current?.past.map((e) => e.id)).toEqual(['old', 'older']);
  });

  it('keeps the loaded matches when the server can not search', async () => {
    const { client } = clientWith(async () => { throw new Error('unsupportedFilter'); });
    const { result } = renderHook(() => useCalendarEventSearch('review', client, loaded));
    await waitFor(() => expect(result.current?.searching).toBe(false));
    expect(result.current?.past.map((e) => e.id)).toEqual(['review']);
  });

  it('does nothing for an empty query', () => {
    const { client, queryAllCalendarEvents } = clientWith(async () => []);
    const { result } = renderHook(() => useCalendarEventSearch('   ', client, loaded));
    expect(result.current).toBeNull();
    expect(queryAllCalendarEvents).not.toHaveBeenCalled();
  });
});
