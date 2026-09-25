import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addDays, addHours, addMinutes, startOfDay } from 'date-fns';
import {
  saveOccurrenceEdit,
  seriesUpdatesFromOccurrence,
  type EventEditorState,
  type OccurrenceEditActions,
} from '@/lib/recurrence-scope-edit';
import { expandRecurringEvents } from '@/lib/recurrence-expansion';
import { getEventEndDate, getEventStartDate } from '@/lib/calendar-utils';
import { AUTO_TIME_ZONE } from '@/lib/timezone';
import { useSettingsStore } from '@/stores/settings-store';
import type { CalendarEvent, CalendarParticipant } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// "All occurrences" from the editor opened on one occurrence: the editor's
// dates and participants are that occurrence's. Written to the series as
// they were, a rename from the third occurrence moved the series' start to
// it (the first two occurrences gone) and gave every occurrence the third
// one's answers - here userb's "declined" for that day only.

type Version = '0.16' | '1.0';
const ORGANIZER = 'userc@example.org';
const ATTENDEE = 'userb@example.org';

// Participants as each version stores them: 0.16.23 drops an attendee's
// roles, 1.0 keeps them.
function participant(version: Version, address: string, owner: boolean, status: string): CalendarParticipant {
  return {
    '@type': 'Participant', calendarAddress: `mailto:${address}`, email: address,
    ...(owner ? { roles: { owner: true } } : version === '1.0' ? { roles: { attendee: true } } : {}),
    participationStatus: status, scheduleAgent: 'server', expectReply: !owner, kind: 'individual',
  } as unknown as CalendarParticipant;
}

const statusOf = (participants: CalendarEvent['participants'] | undefined, address: string) =>
  Object.values(participants ?? {}).find((p) => p.calendarAddress === `mailto:${address}`)?.participationStatus;

// Weekly on Mondays from 5 October, 10:00 in Berlin, five times. userb
// accepted the series and declined 19 October alone: 1.0 returns that
// override as a PatchObject, 0.16 as the whole participants map.
function series(version: Version): CalendarEvent {
  const participants = {
    org: participant(version, ORGANIZER, true, 'accepted'),
    b: participant(version, ATTENDEE, false, 'accepted'),
  };
  return {
    id: 'b', uid: 'weekly@example.org', '@type': 'Event', title: 'Planning', description: '',
    start: '2026-10-05T10:00:00', duration: 'PT1H', timeZone: 'Europe/Berlin', showWithoutTime: false,
    utcStart: '2026-10-05T08:00:00Z', utcEnd: '2026-10-05T09:00:00Z',
    calendarIds: { cal: true }, organizerCalendarAddress: `mailto:${ORGANIZER}`, participants,
    recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'weekly', count: 5 }],
    recurrenceOverrides: version === '1.0'
      ? { '2026-10-19T10:00:00': { 'participants/b/participationStatus': 'declined' } }
      : { '2026-10-19T10:00:00': { participants: { ...participants, b: participant(version, ATTENDEE, false, 'declined') } } },
    excludedRecurrenceRules: null, alerts: null,
  } as unknown as CalendarEvent;
}

// 19 October as the server expands it (0.16.20 on, and 1.0): a synthetic id
// naming its base event, hydrated from it.
function serverOccurrence(version: Version): CalendarEvent {
  const base = series(version);
  return {
    ...base,
    id: 'maaaaac', baseEventId: 'b',
    start: '2026-10-19T10:00:00', utcStart: '2026-10-19T08:00:00Z', utcEnd: '2026-10-19T09:00:00Z',
    recurrenceId: '2026-10-19T10:00:00', recurrenceIdTimeZone: 'Europe/Berlin',
    participants: { ...base.participants, b: participant(version, ATTENDEE, false, 'declined') },
  } as CalendarEvent;
}

// 19 October as the browser expands it (0.16 before 0.16.20).
function browserOccurrence(): CalendarEvent {
  const occurrences = expandRecurringEvents([series('0.16')], '2026-10-01T00:00:00', '2026-11-30T00:00:00');
  return occurrences.find((o) => o.recurrenceId === '2026-10-19T10:00:00')!;
}

const occurrences: Array<[string, Version, () => CalendarEvent]> = [
  ['1.0', '1.0', () => serverOccurrence('1.0')],
  ['0.16.20+', '0.16', () => serverOccurrence('0.16')],
  ['0.16 before 0.16.20', '0.16', browserOccurrence],
];

/** What the editor had, opened on `occurrence` and saved as it came unless changed. */
function editorOn(occurrence: CalendarEvent, change: Partial<EventEditorState> = {}): EventEditorState {
  const attendees = [{ name: '', email: ATTENDEE }];
  return {
    initialAttendees: attendees,
    attendees,
    when: { allDay: !!occurrence.showWithoutTime, start: getEventStartDate(occurrence), end: getEventEndDate(occurrence) },
    ...change,
  };
}

/** What the editor writes for `occurrence` (event-modal handleSave) with `change`. */
function editorUpdates(occurrence: CalendarEvent, change: Partial<CalendarEvent> = {}): Partial<CalendarEvent> {
  return {
    title: occurrence.title, description: '', start: occurrence.start, duration: occurrence.duration,
    timeZone: occurrence.timeZone, showWithoutTime: false, calendarIds: { cal: true },
    recurrenceRules: occurrence.recurrenceRules, recurrenceId: occurrence.recurrenceId,
    // The occurrence's participants, rebuilt with its answers.
    participants: occurrence.participants,
    ...change,
  };
}

const context = { userEmail: ORGANIZER, userEmails: [ORGANIZER] };

beforeEach(() => useSettingsStore.setState({ timeZone: 'Europe/Berlin' }));
afterEach(() => useSettingsStore.setState({ timeZone: AUTO_TIME_ZONE }));

describe.each(occurrences)('changing every occurrence from one of them on Stalwart %s', (_label, version, make) => {
  it('renames the series and keeps when it happens and its answers', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version), editorUpdates(occurrence, { title: 'Planning, room 2' }), editorOn(occurrence), context,
    );

    expect(updates.title).toBe('Planning, room 2');
    for (const key of ['start', 'duration', 'timeZone', 'showWithoutTime', 'recurrenceId', 'participants', 'organizerCalendarAddress']) {
      expect(updates).not.toHaveProperty(key);
    }
  });

  it('moves the series from its own start by as much as the occurrence moved, and asks again', () => {
    const occurrence = make();
    const start = getEventStartDate(occurrence);
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version),
      editorUpdates(occurrence, { start: '2026-10-19T11:30:00' }),
      editorOn(occurrence, { when: { allDay: false, start: addMinutes(start, 90), end: addMinutes(getEventEndDate(occurrence), 90) } }),
      context,
    );

    expect(updates.start).toBe('2026-10-05T11:30:00');
    expect(updates).not.toHaveProperty('duration');
    expect(updates).not.toHaveProperty('timeZone');
    // Asked again as the series' organizer: the series' answer, not the
    // occurrence's "declined", goes back to needs-action.
    expect(statusOf(updates.participants, ORGANIZER)).toBe('accepted');
    expect(statusOf(updates.participants, ATTENDEE)).toBe('needs-action');
  });

  it('moves the series to another weekday by the days the occurrence moved', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version), editorUpdates(occurrence),
      editorOn(occurrence, { when: { allDay: false, start: addDays(getEventStartDate(occurrence), 1), end: addDays(getEventEndDate(occurrence), 1) } }),
      context,
    );

    expect(updates.start).toBe('2026-10-06T10:00:00');
  });

  it('changes only the length when only the end moved', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version), editorUpdates(occurrence, { duration: 'PT1H30M' }),
      editorOn(occurrence, { when: { allDay: false, start: getEventStartDate(occurrence), end: addMinutes(getEventEndDate(occurrence), 30) } }),
      context,
    );

    expect(updates.duration).toBe('PT1H30M');
    expect(updates).not.toHaveProperty('start');
    expect(statusOf(updates.participants, ATTENDEE)).toBe('needs-action');
  });

  it('turns the series all-day on its own first day', () => {
    const occurrence = make();
    const day = startOfDay(getEventStartDate(occurrence));
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version),
      editorUpdates(occurrence, { start: '2026-10-19T00:00:00', duration: 'P1D', timeZone: null, showWithoutTime: true }),
      editorOn(occurrence, { when: { allDay: true, start: day, end: day } }),
      context,
    );

    expect(updates).toMatchObject({ start: '2026-10-05T00:00:00', duration: 'P1D', timeZone: null, showWithoutTime: true });
  });

  it('adds the attendee the user added to the series\' own participants', () => {
    const occurrence = make();
    const attendees = [{ name: '', email: ATTENDEE }, { name: 'Anna', email: 'usera@example.org' }];
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version), editorUpdates(occurrence), editorOn(occurrence, { attendees }), context,
    );

    const participants = updates.participants as Record<string, CalendarParticipant>;
    // The series' ids and answers: userb accepted the series.
    expect(participants.org.calendarAddress).toBe(`mailto:${ORGANIZER}`);
    expect(participants.b.participationStatus).toBe('accepted');
    expect(statusOf(participants, 'usera@example.org')).toBe('needs-action');
    expect(Object.keys(participants)).toHaveLength(3);
    expect(updates).not.toHaveProperty('organizerCalendarAddress');
  });

  it('removes the attendee the user removed, and the participants with the last one', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version), editorUpdates(occurrence, { participants: null }), editorOn(occurrence, { attendees: [] }), context,
    );

    expect(updates.participants).toBeNull();
    expect(updates.organizerCalendarAddress).toBeNull();
  });
});

describe('changing every occurrence of a series in another time zone', () => {
  it('moves the series on its own wall clock, whatever zone the user sees it in', () => {
    useSettingsStore.setState({ timeZone: 'Asia/Tokyo' });
    // 08:00 in New York is 21:00 in Tokyo; the user moves it to 22:00.
    const base = {
      ...series('1.0'), start: '2026-10-05T08:00:00', timeZone: 'America/New_York',
      utcStart: '2026-10-05T12:00:00Z', utcEnd: '2026-10-05T13:00:00Z',
    } as CalendarEvent;
    const occurrence = {
      ...base, id: 'maaaaac', baseEventId: 'b', start: '2026-10-19T08:00:00',
      utcStart: '2026-10-19T12:00:00Z', utcEnd: '2026-10-19T13:00:00Z', recurrenceId: '2026-10-19T08:00:00',
    } as CalendarEvent;
    const start = getEventStartDate(occurrence);

    const updates = seriesUpdatesFromOccurrence(
      occurrence, base,
      editorUpdates(occurrence, { start: '2026-10-19T22:00:00', timeZone: 'Asia/Tokyo' }),
      editorOn(occurrence, { when: { allDay: false, start: addHours(start, 1), end: addHours(getEventEndDate(occurrence), 1) } }),
      context,
    );

    expect(updates.start).toBe('2026-10-05T09:00:00');
    expect(updates).not.toHaveProperty('timeZone');
  });
});

describe('saveOccurrenceEdit for every occurrence', () => {
  function actions(master: CalendarEvent | null) {
    return {
      client: {} as IJMAPClient,
      updateEvent: vi.fn().mockResolvedValue(undefined),
      createEvent: vi.fn().mockResolvedValue(null),
      findMasterEvent: vi.fn().mockResolvedValue(master),
    } satisfies OccurrenceEditActions;
  }

  it('writes the series\' own change to its base event on Stalwart 1.0', async () => {
    const occurrence = serverOccurrence('1.0');
    const deps = actions(series('1.0'));

    const saved = await saveOccurrenceEdit('all', {
      event: occurrence,
      updates: editorUpdates(occurrence, { title: 'Planning, room 2' }),
      editor: editorOn(occurrence),
      sendScheduling: true,
      userEmails: [ORGANIZER],
    }, deps);

    expect(saved).toBe(true);
    expect(deps.findMasterEvent).toHaveBeenCalledWith(occurrence);
    expect(deps.updateEvent).toHaveBeenCalledWith(
      deps.client, 'b',
      { title: 'Planning, room 2', description: '', calendarIds: { cal: true }, recurrenceRules: occurrence.recurrenceRules },
      true,
    );
  });

  it('reports a series it cannot find', async () => {
    const occurrence = serverOccurrence('1.0');
    const deps = actions(null);

    const saved = await saveOccurrenceEdit('all', {
      event: occurrence, updates: editorUpdates(occurrence), editor: editorOn(occurrence), userEmails: [ORGANIZER],
    }, deps);

    expect(saved).toBe(false);
    expect(deps.updateEvent).not.toHaveBeenCalled();
  });
});
