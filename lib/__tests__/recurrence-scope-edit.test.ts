import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addDays, addHours, addMinutes, startOfDay } from 'date-fns';
import {
  deleteOccurrence,
  followingSeriesData,
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
// Someone userc shares the calendar with, read & write; not invited.
const SHAREE = 'usera@example.org';

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

  it('asks the attendees again when the series gets another rule', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, series(version),
      editorUpdates(occurrence, { recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 5 } as never] }),
      editorOn(occurrence, { ruleChanged: true }), context,
    );

    expect(updates).not.toHaveProperty('start');
    expect(statusOf(updates.participants, ATTENDEE)).toBe('needs-action');
  });

  it('moves an attendee\'s own copy of the series and leaves its participants alone', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, { ...series(version), isOrigin: false }, editorUpdates(occurrence, { participants: undefined }),
      editorOn(occurrence, { when: { allDay: false, start: addHours(getEventStartDate(occurrence), 1), end: addHours(getEventEndDate(occurrence), 1) } }),
      { userEmail: ATTENDEE, userEmails: [ATTENDEE] },
    );

    expect(updates.start).toBe('2026-10-05T11:00:00');
    expect(updates).not.toHaveProperty('participants');
  });

  // The series in userc's calendar, shared with usera read & write: Stalwart
  // sends usera's change from userc (isOrigin: true).
  it('asks again when the user moves the owner\'s series in a calendar shared with them', () => {
    const occurrence = make();
    const updates = seriesUpdatesFromOccurrence(
      occurrence, { ...series(version), isOrigin: true, isShared: true, accountId: 'f' }, editorUpdates(occurrence),
      editorOn(occurrence, { when: { allDay: false, start: addHours(getEventStartDate(occurrence), 1), end: addHours(getEventEndDate(occurrence), 1) } }),
      { userEmail: SHAREE, userEmails: [SHAREE] },
    );

    expect(updates.start).toBe('2026-10-05T11:00:00');
    expect(statusOf(updates.participants, ORGANIZER)).toBe('accepted');
    expect(statusOf(updates.participants, ATTENDEE)).toBe('needs-action');
    expect(statusOf(updates.participants, SHAREE)).toBeUndefined();
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

function actions(master: CalendarEvent | null) {
  return {
    client: {} as IJMAPClient,
    updateEvent: vi.fn().mockResolvedValue(undefined),
    createEvent: vi.fn().mockResolvedValue(null),
    findMasterEvent: vi.fn().mockResolvedValue(master),
  } satisfies OccurrenceEditActions;
}

describe('saveOccurrenceEdit for every occurrence', () => {

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


// "This and the following occurrences" ends the series before the
// occurrence and makes a new series of the rest. The new series kept the
// answers, and Stalwart invites to a new event only attendees without one:
// everyone who had answered lost the following occurrences without a word.
// The series was also ended without telling anyone, so the attendees kept
// every occurrence of it.
describe.each(occurrences)('saving this and the following occurrences on Stalwart %s', (_label, version, make) => {
  const truncated = [{ '@type': 'RecurrenceRule', frequency: 'weekly', count: null, until: '2026-10-19T09:59:59' }];

  it('tells the attendees the series ends there, and asks all of them to the new one', async () => {
    const occurrence = make();
    const deps = actions(series(version));

    const saved = await saveOccurrenceEdit('this_and_future', {
      event: occurrence, updates: editorUpdates(occurrence, { title: 'Planning, room 2' }), editor: editorOn(occurrence),
      sendScheduling: true, userEmails: [ORGANIZER],
    }, deps);

    expect(saved).toBe(true);
    expect(deps.updateEvent).toHaveBeenCalledTimes(1);
    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'b', { recurrenceRules: truncated }, true);
    const [, created, send] = deps.createEvent.mock.calls[0];
    expect(send).toBe(true);
    expect(created).toMatchObject({ title: 'Planning, room 2', start: '2026-10-19T10:00:00', recurrenceRules: series(version).recurrenceRules });
    for (const key of ['id', 'uid', 'recurrenceId']) expect(created).not.toHaveProperty(key);
    expect(statusOf(created.participants, ORGANIZER)).toBe('accepted');
    expect(statusOf(created.participants, ATTENDEE)).toBe('needs-action');
  });

  it('puts the series back, telling the attendees again, when the new one cannot be created', async () => {
    const occurrence = make();
    const deps = actions(series(version));
    deps.createEvent.mockRejectedValue(new Error('An event cannot have more than 20 participants.'));

    await expect(saveOccurrenceEdit('this_and_future', {
      event: occurrence, updates: editorUpdates(occurrence), editor: editorOn(occurrence), sendScheduling: true, userEmails: [ORGANIZER],
    }, deps)).rejects.toThrow('more than 20');

    expect(deps.updateEvent).toHaveBeenLastCalledWith(deps.client, 'b', { recurrenceRules: series(version).recurrenceRules }, true);
  });

  it('ends an attendee\'s own copy quietly', async () => {
    const occurrence = make();
    const deps = actions({ ...series(version), isOrigin: false });

    await saveOccurrenceEdit('this_and_future', {
      event: occurrence, updates: editorUpdates(occurrence), editor: editorOn(occurrence), sendScheduling: true, userEmails: [ATTENDEE],
    }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'b', { recurrenceRules: truncated }, undefined);
  });

  // The series in userc's calendar, shared with usera read & write: the
  // split ended it without a word, and the rest had no attendees - the
  // editor wrote none for someone it took for an attendee.
  it('tells the attendees and asks them to the new series when the user splits the owner\'s series in a shared calendar', async () => {
    const occurrence = make();
    const deps = actions({ ...series(version), isOrigin: true, isShared: true, accountId: 'f' });

    await saveOccurrenceEdit('this_and_future', {
      event: occurrence, updates: editorUpdates(occurrence, { title: 'Planning, room 2' }), editor: editorOn(occurrence),
      sendScheduling: true, userEmails: [SHAREE],
    }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'b', { recurrenceRules: truncated }, true);
    const [, created, send] = deps.createEvent.mock.calls[0];
    expect(send).toBe(true);
    expect(statusOf(created.participants, ORGANIZER)).toBe('accepted');
    expect(statusOf(created.participants, ATTENDEE)).toBe('needs-action');
  });
});

describe('the new series from this and the following occurrences', () => {
  it('starts at the occurrence and leaves the old series\' identity behind', () => {
    const occurrence = serverOccurrence('1.0');
    const data = followingSeriesData(occurrence, series('1.0'), { title: 'Moved on', recurrenceId: occurrence.recurrenceId }, null);

    expect(data).toMatchObject({ title: 'Moved on', start: '2026-10-19T10:00:00', recurrenceRules: null, timeZone: 'Europe/Berlin' });
    expect(data).not.toHaveProperty('recurrenceId');
    // Without participants in the change there are none to ask.
    expect(data).not.toHaveProperty('participants');
  });
});

// A first change to one occurrence goes out in two steps when the user
// organizes the event (see the calendar store's updateEvent).
describe.each(occurrences)('saving one occurrence on Stalwart %s', (_label, version, make) => {
  it('tells the store the user organizes the event', async () => {
    const occurrence = make();
    const deps = actions(series(version));
    const updates = editorUpdates(occurrence, { title: 'Planning, room 2' });

    await saveOccurrenceEdit('this', { event: occurrence, updates, sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, occurrence.id, updates, true, { asOrganizer: true });
  });

  it('and that an attendee does not', async () => {
    const occurrence = make();
    const deps = actions(series(version));
    const updates = editorUpdates(occurrence, { title: 'My note' });

    await saveOccurrenceEdit('this', { event: occurrence, updates, sendScheduling: false, userEmails: [ATTENDEE] }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, occurrence.id, updates, false, { asOrganizer: false });
  });
});


// A series the calendar has not expanded - one just created, one opened from
// a link - shows as the series itself, once, at its first occurrence. "This
// occurrence" of it went to the series: the editor's data rewrote every
// occurrence (live on 1.0 and 0.16.23, the request an update of the series'
// id with its title, start and rule), and deleting it deleted the series.
describe.each<[string, Version]>([['1.0', '1.0'], ['0.16', '0.16']])('the series itself standing for its first occurrence on Stalwart %s', (_label, version) => {
  // As CalendarEvent/get returns the base event: on 1.0 (and 0.16.20 on) it
  // names itself as its base event.
  const base = (overrides: Partial<CalendarEvent> = {}) => ({
    ...series(version), ...(version === '1.0' ? { baseEventId: 'b' } : {}), recurrenceOverrides: null, ...overrides,
  }) as CalendarEvent;
  function seriesActions(master: CalendarEvent | null) {
    return { ...actions(master), deleteEvent: vi.fn().mockResolvedValue(undefined) };
  }

  it('changes only the first occurrence for "this occurrence"', async () => {
    const master = base();
    const deps = seriesActions(master);

    const saved = await saveOccurrenceEdit('this', {
      event: master, updates: editorUpdates(master, { title: 'Kick-off', recurrenceId: undefined }), sendScheduling: true, userEmails: [ORGANIZER],
    }, deps);

    expect(saved).toBe(true);
    const [, id, patch, send] = deps.updateEvent.mock.calls[0];
    expect([id, send]).toEqual(['b', true]);
    // The whole map, as the series has no overrides yet; nothing of the series changes.
    expect(Object.keys(patch)).toEqual(['recurrenceOverrides']);
    expect(patch.recurrenceOverrides['2026-10-05T10:00:00']).toMatchObject({ start: '2026-10-05T10:00:00', title: 'Kick-off' });
  });

  it('adds the override to those the series has', async () => {
    const master = base({ recurrenceOverrides: series(version).recurrenceOverrides });
    const deps = seriesActions(master);

    await saveOccurrenceEdit('this', {
      event: master, updates: editorUpdates(master, { title: 'Kick-off', recurrenceId: undefined }), sendScheduling: true, userEmails: [ORGANIZER],
    }, deps);

    expect(Object.keys(deps.updateEvent.mock.calls[0][2])).toEqual(['recurrenceOverrides/2026-10-05T10:00:00']);
  });

  it('changes the whole series for "this and following" from its first occurrence', async () => {
    const master = base();
    const deps = seriesActions(master);

    await saveOccurrenceEdit('this_and_future', {
      event: master, updates: editorUpdates(master, { title: 'Kick-off', recurrenceId: undefined }), editor: editorOn(master),
      sendScheduling: true, userEmails: [ORGANIZER],
    }, deps);

    // Not ended before its first occurrence, no new series: the series itself changes.
    expect(deps.createEvent).not.toHaveBeenCalled();
    expect(deps.updateEvent).toHaveBeenCalledTimes(1);
    const [, id, patch] = deps.updateEvent.mock.calls[0];
    expect(id).toBe('b');
    expect(patch).toMatchObject({ title: 'Kick-off', recurrenceRules: master.recurrenceRules });
  });

  it('excludes the first occurrence for "delete this occurrence"', async () => {
    const master = base();
    const deps = seriesActions(master);

    const deleted = await deleteOccurrence('this', { event: master, sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deleted).toBe(true);
    expect(deps.deleteEvent).not.toHaveBeenCalled();
    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'b', {
      recurrenceOverrides: { '2026-10-05T10:00:00': { excluded: true } },
    }, true);
  });

  it('deletes the whole series for "delete this and following" from its first occurrence', async () => {
    const master = base();
    const deps = seriesActions(master);

    await deleteOccurrence('this_and_future', { event: master, sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deps.deleteEvent).toHaveBeenCalledWith(deps.client, 'b', true);
    expect(deps.updateEvent).not.toHaveBeenCalled();
  });

  it('refuses rather than touch a series it cannot find', async () => {
    const deps = seriesActions(null);

    expect(await saveOccurrenceEdit('this', { event: base(), updates: { title: 'x' }, userEmails: [ORGANIZER] }, deps)).toBe(false);
    expect(await deleteOccurrence('this', { event: base(), userEmails: [ORGANIZER] }, deps)).toBe(false);
    expect(deps.updateEvent).not.toHaveBeenCalled();
    expect(deps.deleteEvent).not.toHaveBeenCalled();
  });
});

describe.each(occurrences)('deleting part of a series from one occurrence on Stalwart %s', (_label, version, make) => {
  function deleteActions() {
    return { ...actions(series(version)), deleteEvent: vi.fn().mockResolvedValue(undefined) };
  }

  it('deletes that occurrence alone through the store', async () => {
    const occurrence = make();
    const deps = deleteActions();

    await deleteOccurrence('this', { event: occurrence, sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deps.deleteEvent).toHaveBeenCalledWith(deps.client, occurrence.id, true);
  });

  it('ends the series before it, telling the attendees', async () => {
    const occurrence = make();
    const deps = deleteActions();

    await deleteOccurrence('this_and_future', { event: occurrence, sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'b', {
      recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'weekly', count: null, until: '2026-10-19T09:59:59' }],
    }, true);
    expect(deps.deleteEvent).not.toHaveBeenCalled();
  });

  it('deletes the series for every occurrence', async () => {
    const deps = deleteActions();

    await deleteOccurrence('all', { event: make(), sendScheduling: true, userEmails: [ORGANIZER] }, deps);

    expect(deps.deleteEvent).toHaveBeenCalledWith(deps.client, 'b', true);
  });
});

// An invitation to one occurrence alone: the server keeps it as an event of
// its own, with a recurrence id and no series to find.
describe('one occurrence the server keeps as its own event', () => {
  const lone = () => ({
    ...serverOccurrence('1.0'), id: 'lone', baseEventId: undefined, recurrenceRules: null, recurrenceOverrides: null,
  }) as unknown as CalendarEvent;

  it('is itself what changes, and what is deleted', async () => {
    const deps = { ...actions(null), deleteEvent: vi.fn().mockResolvedValue(undefined) };

    await saveOccurrenceEdit('this', { event: lone(), updates: { title: 'Mine' }, userEmails: [ATTENDEE] }, deps);
    await deleteOccurrence('this', { event: lone(), userEmails: [ATTENDEE] }, deps);

    expect(deps.updateEvent).toHaveBeenCalledWith(deps.client, 'lone', { title: 'Mine' }, undefined);
    expect(deps.deleteEvent).toHaveBeenCalledWith(deps.client, 'lone', undefined);
  });
});
