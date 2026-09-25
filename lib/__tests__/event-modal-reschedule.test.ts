import { describe, it, expect } from 'vitest';
import { changesWhen } from '@/lib/recurrence-scope-edit';
import type { CalendarEvent } from '@/lib/jmap/types';

// Whether the event editor's dates change when an event happens - what makes
// an organizer's save ask the attendees again. The editor writes the event
// in the user's zone; that alone is no change.

// 08:00-09:00 in New York (UTC-4 in October), as the server returns it.
const timed = {
  id: 'e1', start: '2026-10-12T08:00:00', duration: 'PT1H', timeZone: 'America/New_York', showWithoutTime: false,
  utcStart: '2026-10-12T12:00:00Z', utcEnd: '2026-10-12T13:00:00Z',
} as CalendarEvent;

const allDay = {
  id: 'e2', start: '2026-10-12T00:00:00', duration: 'P2D', timeZone: null, showWithoutTime: true,
} as unknown as CalendarEvent;

const at = (iso: string) => new Date(iso);
const day = (date: string) => new Date(`${date}T00:00:00`);

describe('changesWhen', () => {
  it('is no change at the same instants, whatever zone the form is in', () => {
    expect(changesWhen(timed, { allDay: false, start: at('2026-10-12T12:00:00Z'), end: at('2026-10-12T13:00:00Z') })).toBe(false);
  });

  it('ignores the seconds the form cannot show', () => {
    const withSeconds = { ...timed, utcStart: '2026-10-12T12:00:30Z', utcEnd: '2026-10-12T13:00:30Z' };
    expect(changesWhen(withSeconds, { allDay: false, start: at('2026-10-12T12:00:00Z'), end: at('2026-10-12T13:00:00Z') })).toBe(false);
  });

  it('is a change when the start or the end moves', () => {
    expect(changesWhen(timed, { allDay: false, start: at('2026-10-12T13:00:00Z'), end: at('2026-10-12T14:00:00Z') })).toBe(true);
    expect(changesWhen(timed, { allDay: false, start: at('2026-10-12T12:00:00Z'), end: at('2026-10-12T13:30:00Z') })).toBe(true);
  });

  it('is a change when the event turns all-day or timed', () => {
    expect(changesWhen(timed, { allDay: true, start: day('2026-10-12'), end: day('2026-10-12') })).toBe(true);
    expect(changesWhen(allDay, { allDay: false, start: day('2026-10-12'), end: day('2026-10-13') })).toBe(true);
  });

  it('compares the first and last day of an all-day event', () => {
    expect(changesWhen(allDay, { allDay: true, start: day('2026-10-12'), end: day('2026-10-13') })).toBe(false);
    expect(changesWhen(allDay, { allDay: true, start: day('2026-10-12'), end: day('2026-10-14') })).toBe(true);
    expect(changesWhen(allDay, { allDay: true, start: day('2026-10-13'), end: day('2026-10-14') })).toBe(true);
  });
});
