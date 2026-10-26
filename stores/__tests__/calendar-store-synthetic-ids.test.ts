import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCalendarStore, resolveMutationTarget } from '../calendar-store';
import { setClientLookup } from '../client-registry';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { CalendarEvent } from '@/lib/jmap/types';
import { jmapError, jmapErrorType, jmapSetError } from '@/lib/jmap/jmap-error';

// Occurrences produced by server-side recurrence expansion carry synthetic
// ids (lib/recurrence-instances.ts). The store writes "this occurrence only"
// changes through that id, resolves whole-series operations (RSVP) and
// non-recurring events to the base event, falls back to a recurrence
// override on the base event when the server predates synthetic-id writes,
// and reloads the visible range afterwards because the ids reshuffle.

const UNSUPPORTED = 'Updating synthetic ids is not yet supported.';
const UNSUPPORTED_DESTROY = 'Deleting synthetic ids is not yet supported.';

function occurrence(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'maaaaab',
    originalId: 'maaaaab',
    baseEventId: 'b',
    uid: 'series@example.com',
    title: 'Daily standup',
    start: '2026-09-08T10:00:00',
    duration: 'PT1H',
    timeZone: 'Europe/Berlin',
    utcStart: '2026-09-08T08:00:00Z',
    utcEnd: '2026-09-08T09:00:00Z',
    showWithoutTime: false,
    recurrenceId: '2026-09-08T10:00:00',
    recurrenceIdTimeZone: 'Europe/Berlin',
    recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 5 }] as unknown as CalendarEvent['recurrenceRules'],
    recurrenceOverrides: { '2026-09-09T10:00:00': { start: '2026-09-09T14:00:00', title: 'Moved' } },
    excludedRecurrenceRules: null,
    calendarIds: { f: true },
    participants: {
      p1: { '@type': 'Participant', name: 'Me', email: 'me@example.com', participationStatus: 'needs-action' },
    } as unknown as CalendarEvent['participants'],
    ...overrides,
  } as CalendarEvent;
}

function fakeClient(overrides: Partial<Record<keyof IJMAPClient, unknown>> = {}): IJMAPClient & {
  updateCalendarEvent: ReturnType<typeof vi.fn>;
  deleteCalendarEvent: ReturnType<typeof vi.fn>;
  queryAllCalendarEvents: ReturnType<typeof vi.fn>;
} {
  return {
    updateCalendarEvent: vi.fn().mockResolvedValue(undefined),
    deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
    queryAllCalendarEvents: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as never;
}

const RANGE = ['2026-09-01T00:00:00', '2026-09-30T00:00:00'] as const;

beforeEach(() => {
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({ events: [], calendars: [], error: null });
});

describe('resolveMutationTarget', () => {
  it('addresses an occurrence of a series by its synthetic id', () => {
    const target = resolveMutationTarget([occurrence()], 'maaaaab', 'occurrence');
    expect(target).toMatchObject({ realId: 'maaaaab', isOccurrence: true });
  });

  it('addresses a whole-series operation and a non-recurring occurrence by the base id', () => {
    expect(resolveMutationTarget([occurrence()], 'maaaaab', 'series')).toMatchObject({ realId: 'b', isOccurrence: false });
    const single = occurrence({ id: 'eaaaaad', originalId: 'eaaaaad', baseEventId: 'd', recurrenceId: null, recurrenceRules: null });
    expect(resolveMutationTarget([single], 'eaaaaad', 'occurrence')).toMatchObject({ realId: 'd', isOccurrence: false });
  });

  it('routes a base event that is only in view through its occurrences with that account', () => {
    const shared = occurrence({ id: 'acct2:maaaaab', originalId: 'maaaaab', accountId: 'acct2', isShared: true });
    expect(resolveMutationTarget([shared], 'acct2:b', 'occurrence')).toEqual({
      realId: 'b', targetAccountId: 'acct2', localAccountId: undefined, isOccurrence: false,
    });
    const aggregated = occurrence({ id: 'A@h::maaaaab', originalId: 'maaaaab', localAccountId: 'A@h' });
    expect(resolveMutationTarget([aggregated], 'A@h::b', 'occurrence')).toMatchObject({ realId: 'b', localAccountId: 'A@h' });
  });

  it('leaves events without synthetic ids exactly as before', () => {
    const legacy = occurrence({ id: 'x', originalId: 'x', baseEventId: 'x', recurrenceId: null });
    expect(resolveMutationTarget([legacy], 'x', 'occurrence')).toMatchObject({ realId: 'x', isOccurrence: false });
    const clientExpanded = occurrence({ id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined });
    expect(resolveMutationTarget([clientExpanded], 'b:2026-09-08T10:00:00', 'occurrence')).toMatchObject({ realId: 'b', isOccurrence: false });
    expect(resolveMutationTarget([], 'unknown', 'occurrence')).toEqual({ realId: 'unknown', isOccurrence: false });
  });
});

describe('updateEvent on an expanded occurrence', () => {
  it('patches the occurrence through its synthetic id, minus per-event keys', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', {
      title: 'Renamed', start: '2026-09-08T11:00:00', calendarIds: { g: true },
    });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    // The occurrence has no override yet: its details (here the participants) go along.
    // The start was read in the occurrence's zone, so that zone goes along too.
    expect(client.updateCalendarEvent).toHaveBeenCalledWith(
      'maaaaab', { title: 'Renamed', start: '2026-09-08T11:00:00', timeZone: 'Europe/Berlin', participants: occurrence().participants },
      undefined, undefined, undefined,
    );
    const stored = useCalendarStore.getState().events[0];
    expect(stored.title).toBe('Renamed');
    expect(stored.utcStart).toBe('2026-09-08T09:00:00.000Z');
  });

  it('falls back to a recurrence override on the base event when the server rejects synthetic ids', async () => {
    const client = fakeClient();
    client.updateCalendarEvent.mockRejectedValueOnce(new Error(UNSUPPORTED));
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Renamed' }, true);

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(2);
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(
      1, 'maaaaab', { title: 'Renamed', participants: occurrence().participants }, true, undefined, undefined,
    );
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(2, 'b', {
      'recurrenceOverrides/2026-09-08T10:00:00': {
        start: '2026-09-08T10:00:00', duration: 'PT1H', title: 'Renamed', participants: occurrence().participants,
      },
    }, true, undefined);
    expect(useCalendarStore.getState().events[0].title).toBe('Renamed');

    // The rejection is remembered: the next change skips the doomed attempt.
    client.updateCalendarEvent.mockClear();
    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Again' });
    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent.mock.calls[0][0]).toBe('b');
  });

  it('rethrows other failures without falling back', async () => {
    const client = fakeClient();
    client.updateCalendarEvent.mockRejectedValueOnce(new Error('This property cannot be modified on a single occurrence.'));
    useCalendarStore.setState({ events: [occurrence()] });

    await expect(useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'x' })).rejects.toThrow('single occurrence');
    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    // The caller reports it, translated; a store error would toast it again.
    expect(useCalendarStore.getState().error).toBeNull();
  });

  it('targets the base event for the single occurrence of a non-recurring event', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence({ id: 'eaaaaad', originalId: 'eaaaaad', baseEventId: 'd', recurrenceId: null, recurrenceRules: null })] });

    await useCalendarStore.getState().updateEvent(client, 'eaaaaad', { title: 'One off, renamed' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('d', { title: 'One off, renamed' }, undefined, undefined);
  });

  it('routes a base event addressed through an occurrence to that occurrence’s account', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence({ id: 'acct2:maaaaab', originalId: 'maaaaab', accountId: 'acct2', isShared: true })] });

    await useCalendarStore.getState().updateEvent(client, 'acct2:b', { title: 'Whole series' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series' }, undefined, 'acct2');
  });

  it('reloads the visible range silently after the change, since synthetic ids reshuffle', async () => {
    const client = fakeClient();
    client.queryAllCalendarEvents.mockResolvedValue([occurrence()]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(1);
    const loadingStates: boolean[] = [];
    const unsubscribe = useCalendarStore.subscribe((s) => loadingStates.push(s.isLoadingEvents));

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Renamed' });
    unsubscribe();

    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(2);
    expect(client.queryAllCalendarEvents).toHaveBeenLastCalledWith({ after: RANGE[0], before: RANGE[1] });
    expect(loadingStates.every((v) => v === false)).toBe(true);
  });

  it('also reloads after a change to a base event whose occurrences are in view', async () => {
    const client = fakeClient();
    client.queryAllCalendarEvents.mockResolvedValue([occurrence()]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);

    await useCalendarStore.getState().updateEvent(client, 'b', { title: 'Whole series' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series' }, undefined, undefined);
    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(2);
  });

  // A change of every occurrence that raises their SEQUENCE sends it (see
  // withRaisedSequences in lib/recurrence-scope-edit.ts).
  it('keeps the sequence of a change to the whole series when asked to', async () => {
    const client = fakeClient();
    client.queryAllCalendarEvents.mockResolvedValue([occurrence()]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);

    await useCalendarStore.getState().updateEvent(client, 'b', { title: 'Whole series', sequence: 3 }, true, { keepSequence: true });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series', sequence: 3 }, true, undefined, { keepSequence: true });
  });

  it('does not reload after changing an ordinary event', async () => {
    const client = fakeClient();
    const plain = occurrence({ id: 'x', originalId: 'x', baseEventId: 'x', recurrenceId: null, recurrenceRules: null });
    client.queryAllCalendarEvents.mockResolvedValue([plain]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);

    await useCalendarStore.getState().updateEvent(client, 'x', { title: 'Renamed' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('x', { title: 'Renamed' }, undefined, undefined);
    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(1);
  });
});

// The raise of a change to every occurrence is built on the series as the
// server holds it right before the write (fromCurrent, see
// withRaisedSequences): a copy read earlier may be older. The read goes
// where the write goes.
describe.each<['0.16' | '1.0']>([['0.16'], ['1.0']])('a change built on the series read right before it on Stalwart %s', (version) => {
  // The series as the server holds it: 0.16 copies the SEQUENCE into an
  // override, 1.0 leaves it out of the PatchObject while it is the series'.
  const current = (sequence: number) => ({
    ...occurrence(), id: 'b', originalId: 'b', recurrenceId: null, recurrenceIdTimeZone: null, sequence,
    recurrenceOverrides: { '2026-09-09T10:00:00': version === '1.0' ? { title: 'Moved' } : { title: 'Moved', sequence } },
  }) as CalendarEvent;
  const raise = (event: CalendarEvent) => ({ title: 'Whole series', sequence: (event.sequence ?? 0) + 1 });

  it('reads the base event in the account the write goes to', async () => {
    const client = fakeClient({ getCalendarEvent: vi.fn().mockResolvedValue(current(4)) });
    useCalendarStore.setState({ events: [occurrence({ id: 'acct2:maaaaab', originalId: 'maaaaab', accountId: 'acct2', isShared: true })] });
    const fromCurrent = vi.fn(raise);

    await useCalendarStore.getState().updateEvent(client, 'acct2:b', { title: 'Whole series', sequence: 3 }, true, { keepSequence: true, fromCurrent });

    expect(client.getCalendarEvent).toHaveBeenCalledWith('b', 'acct2');
    expect(fromCurrent).toHaveBeenCalledWith(current(4));
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series', sequence: 5 }, true, 'acct2', { keepSequence: true });
  });

  it('reads it through the login of the account the series is in', async () => {
    const other = fakeClient({ getCalendarEvent: vi.fn().mockResolvedValue(current(7)) });
    const active = fakeClient({ getCalendarEvent: vi.fn() });
    setClientLookup((localAccountId) => (localAccountId === 'B@h' ? other : undefined));
    useCalendarStore.setState({ events: [occurrence({ id: 'B@h::maaaaab', originalId: 'maaaaab', localAccountId: 'B@h' })] });

    try {
      await useCalendarStore.getState().updateEvent(active, 'B@h::b', { title: 'Whole series', sequence: 3 }, true, {
        keepSequence: true, fromCurrent: raise,
      });
    } finally {
      setClientLookup(() => undefined);
    }

    expect(active.getCalendarEvent).not.toHaveBeenCalled();
    expect(active.updateCalendarEvent).not.toHaveBeenCalled();
    expect(other.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series', sequence: 8 }, true, undefined, { keepSequence: true });
  });

  it('sends the change as it was given when there is no base event to read', async () => {
    const client = fakeClient({ getCalendarEvent: vi.fn().mockResolvedValue(null) });
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'b', { title: 'Whole series', sequence: 3 }, true, {
      keepSequence: true, fromCurrent: () => ({ title: 'Not this' }),
    });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', { title: 'Whole series', sequence: 3 }, true, undefined, { keepSequence: true });
  });

  it('writes one occurrence without reading the series', async () => {
    const client = fakeClient({ getCalendarEvent: vi.fn() });
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Renamed' }, undefined, { fromCurrent: () => ({ title: 'Not this' }) });

    expect(client.getCalendarEvent).not.toHaveBeenCalled();
    expect(client.updateCalendarEvent.mock.calls[0][1]).toMatchObject({ title: 'Renamed' });
  });
});

describe('a new start for an expanded instance (#1119)', () => {
  // Stalwart expands an event whose own start is UTC (every one-off event
  // in a Google Calendar export) in the request's zone, so the instance
  // reads 17:30 Europe/Berlin while the base event is 15:30 Etc/UTC.
  const imported = (overrides: Partial<CalendarEvent> = {}) => occurrence({
    id: 'eaaaaad', originalId: 'eaaaaad', baseEventId: 'd', recurrenceId: null, recurrenceIdTimeZone: null,
    recurrenceRules: null, recurrenceOverrides: null, participants: undefined,
    start: '2026-10-02T17:30:00', timeZone: 'Europe/Berlin', utcStart: '2026-10-02T15:30:00Z', utcEnd: '2026-10-02T16:30:00Z',
    ...overrides,
  });

  it('writes it to the base event with the zone it was read in', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [imported()] });

    await useCalendarStore.getState().updateEvent(client, 'eaaaaad', { start: '2026-10-01T17:30:00' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith(
      'd', { start: '2026-10-01T17:30:00', timeZone: 'Europe/Berlin' }, undefined, undefined,
    );
    expect(useCalendarStore.getState().events[0].utcStart).toBe('2026-10-01T15:30:00.000Z');
  });

  it('keeps a zone the caller chose', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [imported()] });

    await useCalendarStore.getState().updateEvent(client, 'eaaaaad', { start: '2026-10-01T15:30:00', timeZone: 'Etc/UTC' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith(
      'd', { start: '2026-10-01T15:30:00', timeZone: 'Etc/UTC' }, undefined, undefined,
    );
  });

  it('leaves an all-day start floating and changes without a start alone', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [imported({ start: '2026-10-02T00:00:00', duration: 'P1D', showWithoutTime: true })] });

    await useCalendarStore.getState().updateEvent(client, 'eaaaaad', { start: '2026-10-01T00:00:00' });
    await useCalendarStore.getState().updateEvent(client, 'eaaaaad', { title: 'Renamed' });

    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(1, 'd', { start: '2026-10-01T00:00:00' }, undefined, undefined);
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(2, 'd', { title: 'Renamed' }, undefined, undefined);
  });

  it('leaves events without synthetic ids alone', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [imported({ id: 'd', originalId: 'd', baseEventId: undefined, timeZone: 'Etc/UTC' })] });

    await useCalendarStore.getState().updateEvent(client, 'd', { start: '2026-10-01T15:30:00' });

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('d', { start: '2026-10-01T15:30:00' }, undefined, undefined);
  });
});

describe('deleteEvent on an expanded occurrence', () => {
  it('destroys the occurrence through its synthetic id and drops it from the store', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence()], selectedEventId: 'maaaaab' });

    await useCalendarStore.getState().deleteEvent(client, 'maaaaab', true);

    expect(client.deleteCalendarEvent).toHaveBeenCalledWith('maaaaab', true, undefined);
    expect(client.updateCalendarEvent).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events).toEqual([]);
    expect(useCalendarStore.getState().selectedEventId).toBeNull();
  });

  it('excludes the occurrence on the base event when the server rejects synthetic ids', async () => {
    const client = fakeClient();
    client.deleteCalendarEvent.mockRejectedValueOnce(new Error(UNSUPPORTED_DESTROY));
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().deleteEvent(client, 'maaaaab');

    expect(client.updateCalendarEvent).toHaveBeenCalledWith(
      'b', { 'recurrenceOverrides/2026-09-08T10:00:00': { excluded: true } }, undefined, undefined,
    );
    expect(useCalendarStore.getState().events).toEqual([]);
  });

  it('deletes the base event for the single occurrence of a non-recurring event', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence({ id: 'eaaaaad', originalId: 'eaaaaad', baseEventId: 'd', recurrenceId: null, recurrenceRules: null })] });

    await useCalendarStore.getState().deleteEvent(client, 'eaaaaad');

    expect(client.deleteCalendarEvent).toHaveBeenCalledWith('d', undefined, undefined);
  });
});

describe('an occurrence expanded in the browser (older servers)', () => {
  // Client-side expansion: `<master id>:<recurrenceId>`, no baseEventId,
  // the master's rules and overrides copied onto the occurrence.
  const browserOccurrence = (overrides: Partial<CalendarEvent> = {}) => occurrence({
    id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined, recurrenceOverrides: null, ...overrides,
  });

  it('writes a drag as an override on the base event, not as a new start for the series', async () => {
    const client = fakeClient();
    const occ = browserOccurrence();
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().updateEvent(client, occ.id, { start: '2026-09-08T12:00:00' });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', {
      recurrenceOverrides: {
        '2026-09-08T10:00:00': {
          start: '2026-09-08T12:00:00',
          duration: 'PT1H',
          title: 'Daily standup',
          participants: occ.participants,
        },
      },
    }, undefined, undefined);
  });

  it('patches the override entry when the series already has overrides', async () => {
    const client = fakeClient();
    const occ = browserOccurrence({ recurrenceOverrides: { '2026-09-09T10:00:00': { title: 'Moved' } } });
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().updateEvent(client, occ.id, { description: 'Bring slides' });

    expect(Object.keys(client.updateCalendarEvent.mock.calls[0][1])).toEqual(['recurrenceOverrides/2026-09-08T10:00:00']);
  });

  it('deletes one occurrence by excluding it, never the whole series', async () => {
    const client = fakeClient();
    const occ = browserOccurrence();
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().deleteEvent(client, occ.id, true);

    expect(client.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', {
      recurrenceOverrides: { '2026-09-08T10:00:00': { excluded: true } },
    }, true, undefined);
  });
});

describe('rsvpEvent on an expanded occurrence', () => {
  it('answers for the whole series on the base event', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence()] });

    await useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p1', 'accepted');

    expect(client.updateCalendarEvent).toHaveBeenCalledWith(
      'b', { 'participants/p1/participationStatus': 'accepted' }, true, undefined,
    );
    expect(useCalendarStore.getState().events[0].participants?.p1.participationStatus).toBe('accepted');
  });

  it('answers one occurrence through its synthetic id with the whole participants map', async () => {
    const client = fakeClient();
    const occ = occurrence({ sequence: 2 });
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p1', 'declined', undefined, 'occurrence');

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    // The occurrence has no override yet, so its details are copied into it,
    // and the series sequence is sent along.
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('maaaaab', {
      title: 'Daily standup',
      sequence: 2,
      participants: { p1: { ...occ.participants!.p1, participationStatus: 'declined' } },
    }, true, undefined, { keepSequence: true });
    expect(useCalendarStore.getState().events[0].participants?.p1.participationStatus).toBe('declined');
  });

  it('answers one occurrence as a recurrence override when the server rejects synthetic ids', async () => {
    const client = fakeClient();
    client.updateCalendarEvent.mockRejectedValueOnce(new Error(UNSUPPORTED));
    const occ = occurrence();
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p1', 'tentative', undefined, 'occurrence');

    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(2, 'b', {
      'recurrenceOverrides/2026-09-08T10:00:00': {
        start: '2026-09-08T10:00:00',
        duration: 'PT1H',
        title: 'Daily standup',
        participants: { p1: { ...occ.participants!.p1, participationStatus: 'tentative' } },
      },
    }, true, undefined);
  });

  it('answers one occurrence expanded in the browser on its base event', async () => {
    const client = fakeClient();
    // Client-side expansion: `<master id>:<recurrenceId>`, no baseEventId,
    // the master's overrides copied onto the occurrence.
    const occ = occurrence({ id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined, recurrenceOverrides: null });
    useCalendarStore.setState({ events: [occ] });

    await useCalendarStore.getState().rsvpEvent(client, occ.id, 'p1', 'declined', undefined, 'occurrence');

    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', {
      recurrenceOverrides: {
        '2026-09-08T10:00:00': {
          start: '2026-09-08T10:00:00',
          duration: 'PT1H',
          title: 'Daily standup',
          participants: { p1: { ...occ.participants!.p1, participationStatus: 'declined' } },
        },
      },
    }, true, undefined);
  });

  it('refuses to answer an occurrence the participant is not on', async () => {
    const client = fakeClient();
    useCalendarStore.setState({ events: [occurrence()] });

    await expect(
      useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p2', 'declined', undefined, 'occurrence'),
    ).rejects.toThrow();
    expect(client.updateCalendarEvent).not.toHaveBeenCalled();
  });
});

describe('a range that fails to load', () => {
  // What an unfixed client got from Stalwart 1.0 for every range.
  const refused = () => jmapError(
    'CalendarEvent/get failed: recurrenceOverrides cannot be requested together with utcStart or utcEnd',
    { type: 'invalidArguments' },
  );
  const NEXT = ['2026-10-01T00:00:00', '2026-10-31T23:59:59'] as const;

  it('keeps the events on screen and reports the failure on Stalwart 1.0', async () => {
    const client = fakeClient();
    client.queryAllCalendarEvents.mockResolvedValueOnce([occurrence()]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);

    client.queryAllCalendarEvents.mockRejectedValueOnce(refused());
    await useCalendarStore.getState().fetchEvents(client, NEXT[0], NEXT[1]);

    const state = useCalendarStore.getState();
    expect(state.events.map((e) => e.id)).toEqual(['maaaaab']);
    expect(state.eventsLoadError).toBe(true);
    expect(state.isLoadingEvents).toBe(false);
    // The range asked for, so a push or a refresh reloads that one.
    expect(state.dateRange).toEqual({ start: NEXT[0], end: NEXT[1] });

    client.queryAllCalendarEvents.mockResolvedValueOnce([]);
    await useCalendarStore.getState().fetchEvents(client, NEXT[0], NEXT[1]);
    expect(useCalendarStore.getState().eventsLoadError).toBe(false);
    expect(useCalendarStore.getState().events).toEqual([]);
  });

  it('keeps reporting the failure through other actions and reloads the range asked for on Stalwart 1.0', async () => {
    const client = fakeClient({ getAllCalendarsWithFailures: vi.fn().mockResolvedValue({ calendars: [], failedAccountIds: [] }) });
    client.queryAllCalendarEvents.mockResolvedValueOnce([occurrence()]);
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    // From here on every range load fails.
    client.queryAllCalendarEvents.mockRejectedValue(refused());
    await useCalendarStore.getState().fetchEvents(client, NEXT[0], NEXT[1]);

    // A change, and the calendar list reloading, reset `error`.
    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Renamed' });
    await useCalendarStore.getState().fetchCalendars(client);
    expect(useCalendarStore.getState().error).toBeNull();
    expect(useCalendarStore.getState().eventsLoadError).toBe(true);

    // What a push does: reload the store's range - the one that failed.
    const { dateRange } = useCalendarStore.getState();
    await useCalendarStore.getState().fetchEvents(client, dateRange!.start, dateRange!.end);
    expect(client.queryAllCalendarEvents).toHaveBeenLastCalledWith({ after: NEXT[0], before: NEXT[1] });
    expect(useCalendarStore.getState().eventsLoadError).toBe(true);
  });

  it('keeps the events of an account that fails when loading every account', async () => {
    const first = fakeClient();
    first.queryAllCalendarEvents.mockResolvedValue([occurrence({ title: 'First' })]);
    const second = fakeClient();
    second.queryAllCalendarEvents
      .mockResolvedValueOnce([occurrence({ title: 'Second, loaded before' })])
      .mockRejectedValueOnce(refused());
    const accounts = [{ localAccountId: 'A@h', client: first }, { localAccountId: 'B@h', client: second }];

    await useCalendarStore.getState().fetchAllAccountsEvents(accounts, RANGE[0], RANGE[1]);
    await useCalendarStore.getState().fetchAllAccountsEvents(accounts, NEXT[0], NEXT[1]);

    const state = useCalendarStore.getState();
    expect(state.events.map((e) => [e.id, e.title])).toEqual([
      ['A@h::maaaaab', 'First'],
      ['B@h::maaaaab', 'Second, loaded before'],
    ]);
    expect(state.eventsLoadError).toBe(true);
    expect(state.dateRange).toEqual({ start: NEXT[0], end: NEXT[1] });
  });
});

// Stalwart 1.0 checks what one occurrence carries (jmap/src/calendar_event/
// validate.rs). Through a synthetic id, a series property must repeat the
// base event's value; inside an override written on the base event it is
// refused whatever its value. 0.16.20-0.16.23 drop such keys silently, and
// older 0.16 store them on the override.
describe('editing one occurrence', () => {
  const SERIES_PROPERTIES = [
    '@type', 'method', 'organizerCalendarAddress', 'privacy', 'prodId', 'recurrenceId',
    'recurrenceIdTimeZone', 'sentBy', 'uid', 'recurrenceOverrides', 'recurrenceRule',
  ];
  // The stored series: no CLASS (privacy), as Apple Calendar and Thunderbird write it.
  const BASE: Record<string, unknown> = { id: 'b', uid: 'series@example.com', organizerCalendarAddress: 'mailto:org@example.com' };

  const seriesKeysIn = (entry: unknown) => Object.keys((entry ?? {}) as object)
    .filter((key) => SERIES_PROPERTIES.includes(key.split('/')[0]));

  /** updateCalendarEvent of a Stalwart 1.0 server holding BASE. */
  function stalwart10Update() {
    return vi.fn(async (id: string, patch: Record<string, unknown>) => {
      if (id !== BASE.id) {
        for (const key of seriesKeysIn(patch)) {
          if (JSON.stringify(patch[key] ?? null) !== JSON.stringify(BASE[key] ?? null)) {
            throw jmapError('This property cannot be modified on a single occurrence.', { type: 'invalidProperties', properties: [key] });
          }
        }
        return;
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key.split('/')[0] !== 'recurrenceOverrides') continue;
        const entries = key === 'recurrenceOverrides' ? Object.values(value as object) : [value];
        const [refused] = entries.flatMap(seriesKeysIn);
        if (refused) {
          throw jmapError(`${refused} cannot be set inside recurrenceOverrides.`, {
            type: 'invalidProperties', properties: ['recurrenceOverrides'],
          });
        }
      }
    });
  }

  it('sends one occurrence nothing of the series through its synthetic id on Stalwart 1.0', async () => {
    const client = fakeClient({ updateCalendarEvent: stalwart10Update() });
    useCalendarStore.setState({ events: [occurrence({ organizerCalendarAddress: 'mailto:org@example.com' })] });

    // What the event modal sent before: privacy "public" (the series has
    // none) and the organizer spelled differently.
    await useCalendarStore.getState().updateEvent(client, 'maaaaab', {
      title: 'Renamed', privacy: 'public', organizerCalendarAddress: 'mailto:ORG@example.com', calendarIds: { f: true },
    });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    const [id, patch] = client.updateCalendarEvent.mock.calls[0];
    expect(id).toBe('maaaaab');
    expect(Object.keys(patch).sort()).toEqual(['participants', 'title']);
    expect(useCalendarStore.getState().error).toBeNull();
  });

  it('answers one occurrence without the organizer through its synthetic id on Stalwart 1.0', async () => {
    const client = fakeClient({ updateCalendarEvent: stalwart10Update() });
    useCalendarStore.setState({ events: [occurrence({ organizerCalendarAddress: 'mailto:org@example.com', sequence: 1 })] });

    await useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p1', 'declined', undefined, 'occurrence');

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent.mock.calls[0][1]).not.toHaveProperty('organizerCalendarAddress');
  });

  it('writes an override on the base event once more without series keys when Stalwart 1.0 refuses them, and remembers', async () => {
    const client = fakeClient({ updateCalendarEvent: stalwart10Update() });
    // Expanded in the browser (the client-side fallback): the change becomes
    // an override on the base event "b", carrying privacy and the organizer.
    const browserOccurrence = occurrence({
      id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined, recurrenceOverrides: null,
      privacy: 'private', organizerCalendarAddress: 'mailto:org@example.com',
    });
    useCalendarStore.setState({ events: [browserOccurrence] });

    await useCalendarStore.getState().updateEvent(client, browserOccurrence.id, { title: 'Moved' });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(2);
    const [first, second] = client.updateCalendarEvent.mock.calls.map((call) => call[1].recurrenceOverrides['2026-09-08T10:00:00']);
    expect(first).toMatchObject({ privacy: 'private', organizerCalendarAddress: 'mailto:org@example.com' });
    expect(second).toEqual({ start: '2026-09-08T10:00:00', duration: 'PT1H', title: 'Moved', participants: browserOccurrence.participants });
    expect(useCalendarStore.getState().error).toBeNull();

    // The next override goes out without them straight away.
    client.updateCalendarEvent.mockClear();
    await useCalendarStore.getState().rsvpEvent(client, browserOccurrence.id, 'p1', 'accepted', undefined, 'occurrence');
    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(seriesKeysIn(client.updateCalendarEvent.mock.calls[0][1].recurrenceOverrides['2026-09-08T10:00:00'])).toEqual([]);
  });

  it('keeps the override payload on 0.16: privacy and the organizer, in one write', async () => {
    const client = fakeClient();
    const browserOccurrence = occurrence({
      id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined, recurrenceOverrides: null,
      privacy: 'private', organizerCalendarAddress: 'mailto:org@example.com', sequence: 2,
    });
    useCalendarStore.setState({ events: [browserOccurrence] });

    await useCalendarStore.getState().rsvpEvent(client, browserOccurrence.id, 'p1', 'tentative', undefined, 'occurrence');

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('b', {
      recurrenceOverrides: {
        '2026-09-08T10:00:00': {
          start: '2026-09-08T10:00:00',
          duration: 'PT1H',
          title: 'Daily standup',
          privacy: 'private',
          sequence: 2,
          organizerCalendarAddress: 'mailto:org@example.com',
          participants: { p1: { ...browserOccurrence.participants!.p1, participationStatus: 'tentative' } },
        },
      },
    }, true, undefined);
  });

  it('keeps the 0.16.19 fallback payload for a server that rejects synthetic ids', async () => {
    const client = fakeClient();
    client.updateCalendarEvent.mockRejectedValueOnce(new Error(UNSUPPORTED));
    useCalendarStore.setState({ events: [occurrence({ organizerCalendarAddress: 'mailto:org@example.com' })] });

    await useCalendarStore.getState().rsvpEvent(client, 'maaaaab', 'p1', 'accepted', undefined, 'occurrence');

    // The synthetic attempt leaves the organizer out, the override has it.
    expect(client.updateCalendarEvent.mock.calls[0][1]).not.toHaveProperty('organizerCalendarAddress');
    expect(client.updateCalendarEvent.mock.calls[1][1]['recurrenceOverrides/2026-09-08T10:00:00'])
      .toMatchObject({ organizerCalendarAddress: 'mailto:org@example.com' });
  });
});

// Stalwart 1.0 refuses an event with more participants than
// maxParticipantsPerEvent; the calendar names that limit to the user.
describe('an event over the participant limit', () => {
  const refusal = () => jmapSetError('An event cannot have more than 20 participants.', {
    type: 'invalidProperties', properties: ['participants'],
  });

  it('passes Stalwart 1.0’s refusal of a new event on to the caller', async () => {
    const client = fakeClient({ createCalendarEvent: vi.fn().mockRejectedValue(refusal()) });
    await expect(useCalendarStore.getState().createEvent(client, { title: 'All hands' })).rejects.toThrow(/more than 20/);
    // The caller says it, translated; a store error would toast it twice.
    expect(useCalendarStore.getState().error).toBeNull();
  });

  it('still answers null for any other failure to create', async () => {
    const client = fakeClient({ createCalendarEvent: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(useCalendarStore.getState().createEvent(client, { title: 'All hands' })).resolves.toBeNull();
    expect(useCalendarStore.getState().error).toBe('Failed to create event');
  });
});

// Stalwart 1.0 shows a calendar's default alerts in place of an event's own
// while the event uses them, for its occurrences too, and refuses
// useDefaultAlerts on a single occurrence. An alert changed on one occurrence
// was stored and never shown ("Event updated", the default still there). The
// series now stops using the defaults first, keeping the alerts it shows as
// its own; then the occurrence's alerts go out. 0.16.23 stores and shows the
// occurrence's alerts either way.
describe.each<['0.16' | '1.0']>([['0.16'], ['1.0']])('changing the alerts of one occurrence of a series on default alerts on Stalwart %s', (version) => {
  const alert = (offset: string) => ({
    '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset, relativeTo: 'start' }, action: 'display',
  }) as unknown as NonNullable<CalendarEvent['alerts']>[string];
  // What the series shows: the calendar's default under its id on 1.0, the
  // copy 0.16 made of it when the series was created.
  const shown: Record<string, ReturnType<typeof alert>> = version === '1.0'
    ? { 'default-15': alert('-PT15M') }
    : { a1: alert('-PT15M') };
  // What the editor sends (buildAlertsPatch): the changed alert under an id
  // of its own, and the defaults off.
  const EDIT = { alerts: { alert1: alert('-PT1H') }, useDefaultAlerts: false } as Partial<CalendarEvent>;

  function onDefaults(extra: Partial<Record<keyof IJMAPClient, unknown>> = {}) {
    return fakeClient({
      getCalendarEvent: vi.fn().mockResolvedValue({ id: 'b', useDefaultAlerts: true, alerts: shown }),
      ...extra,
    });
  }

  it('turns the defaults off for the series, keeping its alerts, then writes the occurrence', async () => {
    const client = onDefaults();
    useCalendarStore.setState({ events: [occurrence({ useDefaultAlerts: true, alerts: shown })] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', EDIT);

    expect(client.getCalendarEvent).toHaveBeenCalledWith('b', undefined);
    const [first, second] = client.updateCalendarEvent.mock.calls;
    expect(first).toEqual(['b', { useDefaultAlerts: false, alerts: { alert1: alert('-PT15M') } }, false, undefined]);
    expect(second[0]).toBe('maaaaab');
    expect(second[1]).toMatchObject({ alerts: { alert1: alert('-PT1H') } });
    // Refused on one occurrence by 1.0; the series carries it now.
    expect(second[1]).not.toHaveProperty('useDefaultAlerts');
  });

  it('leaves a series that no longer uses the defaults alone', async () => {
    const client = onDefaults({
      getCalendarEvent: vi.fn().mockResolvedValue({ id: 'b', useDefaultAlerts: false, alerts: { alert1: alert('-PT15M') } }),
    });
    useCalendarStore.setState({ events: [occurrence({ useDefaultAlerts: true, alerts: shown })] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', EDIT);

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent.mock.calls[0][0]).toBe('maaaaab');
  });

  it('asks nothing about the series for any other change of the occurrence', async () => {
    const client = onDefaults();
    useCalendarStore.setState({ events: [occurrence({ useDefaultAlerts: true, alerts: shown })] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', { title: 'Renamed' });

    expect(client.getCalendarEvent).not.toHaveBeenCalled();
    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
  });
});

it('turns the defaults off before writing the override of an occurrence the browser expanded (0.16 before 0.16.20)', async () => {
  const alert = { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT15M', relativeTo: 'start' }, action: 'display' };
  const client = fakeClient({
    getCalendarEvent: vi.fn().mockResolvedValue({ id: 'b', useDefaultAlerts: true, alerts: { a1: alert } }),
  });
  const expanded = occurrence({
    id: 'b:2026-09-08T10:00:00', originalId: 'b', baseEventId: undefined, useDefaultAlerts: true,
    alerts: { a1: alert } as unknown as CalendarEvent['alerts'],
  });
  useCalendarStore.setState({ events: [expanded] });

  await useCalendarStore.getState().updateEvent(client, 'b:2026-09-08T10:00:00', {
    alerts: { alert1: { ...alert, trigger: { ...alert.trigger, offset: '-PT1H' } } } as unknown as CalendarEvent['alerts'],
    useDefaultAlerts: false,
  });

  const [first, second] = client.updateCalendarEvent.mock.calls;
  expect(first).toEqual(['b', { useDefaultAlerts: false, alerts: { alert1: alert } }, false, undefined]);
  expect(second[0]).toBe('b');
  expect(Object.keys(second[1])).toEqual(['recurrenceOverrides/2026-09-08T10:00:00']);
});

// Two range loads out at once - the view moved on - finish in either order;
// the store keeps the latest one's events, range and failure flag.
describe('range loads that finish out of order', () => {
  const NEXT = ['2026-10-01T00:00:00', '2026-10-31T23:59:59'] as const;
  const later = () => {
    let settle!: { resolve: (v: CalendarEvent[]) => void; reject: (e: unknown) => void };
    const promise = new Promise<CalendarEvent[]>((resolve, reject) => { settle = { resolve, reject }; });
    return { promise, ...settle };
  };

  it('drops an earlier load that fails after the latest one succeeded on Stalwart 1.0', async () => {
    const client = fakeClient();
    const first = later();
    client.queryAllCalendarEvents.mockReturnValueOnce(first.promise).mockResolvedValueOnce([occurrence({ title: 'October' })]);

    const loading = useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    await useCalendarStore.getState().fetchEvents(client, NEXT[0], NEXT[1]);
    first.reject(new Error('Store unavailable'));
    await loading;

    const state = useCalendarStore.getState();
    expect(state.dateRange).toEqual({ start: NEXT[0], end: NEXT[1] });
    expect(state.eventsLoadError).toBe(false);
    expect(state.events.map((e) => e.title)).toEqual(['October']);
  });

  it('drops an earlier load that succeeds after the latest one failed on Stalwart 1.0', async () => {
    const client = fakeClient();
    const first = later();
    client.queryAllCalendarEvents.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('Store unavailable'));

    const loading = useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    await useCalendarStore.getState().fetchEvents(client, NEXT[0], NEXT[1]);
    first.resolve([occurrence({ title: 'September' })]);
    await loading;

    const state = useCalendarStore.getState();
    expect(state.dateRange).toEqual({ start: NEXT[0], end: NEXT[1] });
    expect(state.eventsLoadError).toBe(true);
    expect(state.events).toEqual([]);
  });

  it('drops a load of every account that finishes after a later one', async () => {
    const client = fakeClient();
    const first = later();
    client.queryAllCalendarEvents.mockReturnValueOnce(first.promise).mockResolvedValueOnce([occurrence({ title: 'October' })]);
    const accounts = [{ localAccountId: 'A@h', client }];

    const loading = useCalendarStore.getState().fetchAllAccountsEvents(accounts, RANGE[0], RANGE[1]);
    await useCalendarStore.getState().fetchAllAccountsEvents(accounts, NEXT[0], NEXT[1]);
    first.resolve([occurrence({ title: 'September' })]);
    await loading;

    expect(useCalendarStore.getState().dateRange).toEqual({ start: NEXT[0], end: NEXT[1] });
    expect(useCalendarStore.getState().events.map((e) => e.title)).toEqual(['October']);
  });

  it('drops a load for the account the user left', async () => {
    const client = fakeClient();
    const first = later();
    client.queryAllCalendarEvents.mockReturnValueOnce(first.promise);

    const loading = useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    useCalendarStore.getState().clearState();
    first.resolve([occurrence()]);
    await loading;

    expect(useCalendarStore.getState().events).toEqual([]);
    expect(useCalendarStore.getState().dateRange).toBeNull();
  });
});

// An invitation answered or added from the mail view is imported first.
// When Stalwart refuses it, the banner has to say why - the participant
// limit on 1.0 above all.
describe('importEvents and the server refusing an event', () => {
  const LIMIT = {
    type: 'invalidProperties', description: 'An event cannot have more than 20 participants.', properties: ['participants'],
  };

  function refusing() {
    return fakeClient({
      getCalendarEvents: vi.fn().mockResolvedValue([]),
      batchCreateCalendarEvents: vi.fn().mockResolvedValue({ created: [], failed: ['e0'], notCreated: { e0: LIMIT } }),
    });
  }

  it('rejects with the refusal when asked to and nothing was imported, on Stalwart 1.0', async () => {
    useCalendarStore.setState({ calendars: [{ id: 'cal', name: 'Personal' } as never] });

    const error = await useCalendarStore.getState()
      .importEvents(refusing(), [{ uid: 'u1', title: 'All hands', start: '2026-10-12T10:00:00' }], 'cal', { throwIfNoneImported: true })
      .then(() => null, (e: unknown) => e);

    expect(jmapErrorType(error)).toBe('invalidProperties');
    expect((error as Error).message).toBe(LIMIT.description);
    expect(useCalendarStore.getState().error).toBeNull();
  });

  it('still counts for the import dialog, and keeps its error for it', async () => {
    useCalendarStore.setState({ calendars: [{ id: 'cal', name: 'Personal' } as never] });

    const count = await useCalendarStore.getState()
      .importEvents(refusing(), [{ uid: 'u1', title: 'All hands', start: '2026-10-12T10:00:00' }], 'cal');

    expect(count).toBe(0);
    expect(useCalendarStore.getState().error).toBe(`1 event(s) could not be imported: ${LIMIT.description}`);
  });
});


// Stalwart sends an occurrence that gets its own override, like a new event,
// only to attendees who have not answered, and a change to an existing
// override to everyone who has not declined (groupware scheduling,
// send_invite_messages / send_update_messages; 0.16.6 to 0.16.23 and 1.0
// alike). A first change that kept the answers reached none of the
// attendees who had accepted. The occurrence now gets its override as it is
// first, without messages, and the change goes out as a change of it.
describe('a first change to one occurrence of a meeting the user organizes', () => {
  const RID = '2026-09-08T10:00:00';
  const meeting = {
    org: { '@type': 'Participant', calendarAddress: 'mailto:org@example.com', email: 'org@example.com', roles: { owner: true }, participationStatus: 'accepted' },
    bob: { '@type': 'Participant', calendarAddress: 'mailto:bob@example.org', email: 'bob@example.org', roles: { attendee: true }, participationStatus: 'accepted' },
  } as unknown as NonNullable<CalendarEvent['participants']>;
  const serverOccurrence = (overrides: Partial<CalendarEvent> = {}) => occurrence({
    organizerCalendarAddress: 'mailto:org@example.com', participants: meeting, sequence: 1, ...overrides,
  });
  // What the server expands once the occurrence has its override.
  const overridden = (id: string) => serverOccurrence({
    id, originalId: id,
    recurrenceOverrides: { ...occurrence().recurrenceOverrides, [RID]: { title: 'Daily standup' } },
  });
  const CHANGE = { title: 'Standup in room 2', participants: meeting } as Partial<CalendarEvent>;

  it('overrides the occurrence quietly, then changes it with messages on Stalwart 1.0', async () => {
    const client = fakeClient({ queryCalendarEvents: vi.fn().mockResolvedValue([overridden('maaaaab')]) });
    useCalendarStore.setState({ events: [serverOccurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', CHANGE, true, { asOrganizer: true });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(2);
    // As the occurrence is, the answers as they are, no messages.
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(
      1, 'maaaaab', { title: 'Daily standup', participants: meeting, sequence: 1 }, false, undefined, { keepSequence: true },
    );
    expect(client.queryCalendarEvents).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'series@example.com' }), undefined, undefined, undefined,
    );
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(
      2, 'maaaaab', { title: 'Standup in room 2', participants: meeting }, true, undefined, undefined,
    );
  });

  it('changes the occurrence under the id 0.16.20 gives it once it has an override', async () => {
    const client = fakeClient({ queryCalendarEvents: vi.fn().mockResolvedValue([
      serverOccurrence({ id: 'maaaaaa', originalId: 'maaaaaa', recurrenceId: '2026-09-07T10:00:00' }),
      overridden('maaaaaf'),
    ]) });
    useCalendarStore.setState({ events: [serverOccurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', CHANGE, true, { asOrganizer: true });

    expect(client.updateCalendarEvent.mock.calls.map((call) => [call[0], call[2]])).toEqual([['maaaaab', false], ['maaaaaf', true]]);
  });

  it('overrides an occurrence expanded in the browser on its base event, then changes that override (0.16 before 0.16.20)', async () => {
    const browserOccurrence = serverOccurrence({ id: `b:${RID}`, originalId: 'b', baseEventId: undefined, privacy: 'public' });
    const firstEntry = {
      start: RID, duration: 'PT1H', title: 'Daily standup', participants: meeting, sequence: 1,
      privacy: 'public', organizerCalendarAddress: 'mailto:org@example.com',
    };
    const client = fakeClient({
      getCalendarEvent: vi.fn().mockResolvedValue({
        id: 'b', uid: 'series@example.com',
        recurrenceOverrides: { ...occurrence().recurrenceOverrides, [RID]: firstEntry },
      }),
    });
    useCalendarStore.setState({ events: [browserOccurrence] });

    await useCalendarStore.getState().updateEvent(client, browserOccurrence.id, CHANGE, true, { asOrganizer: true });

    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(1, 'b', { [`recurrenceOverrides/${RID}`]: firstEntry }, false, undefined);
    expect(client.getCalendarEvent).toHaveBeenCalledWith('b', undefined);
    expect(client.updateCalendarEvent).toHaveBeenNthCalledWith(2, 'b', {
      [`recurrenceOverrides/${RID}`]: { ...firstEntry, title: 'Standup in room 2' },
    }, true, undefined);
  });

  it('writes both steps without series keys once Stalwart 1.0 refused them inside an override', async () => {
    const refusing = vi.fn(async (_id: string, patch: Record<string, unknown>, _send?: boolean) => {
      const entry = patch[`recurrenceOverrides/${RID}`] as Record<string, unknown> | undefined;
      if (entry && ('privacy' in entry || 'organizerCalendarAddress' in entry)) {
        throw jmapError('privacy cannot be set inside recurrenceOverrides.', {
          type: 'invalidProperties', properties: ['recurrenceOverrides'],
        });
      }
    });
    // Expanded in the browser on 1.0: the fallback for a range that would
    // expand past the server's limits.
    const browserOccurrence = serverOccurrence({ id: `b:${RID}`, originalId: 'b', baseEventId: undefined, privacy: 'public' });
    const client = fakeClient({
      updateCalendarEvent: refusing,
      getCalendarEvent: vi.fn().mockResolvedValue({
        id: 'b', uid: 'series@example.com',
        recurrenceOverrides: { ...occurrence().recurrenceOverrides, [RID]: { title: 'Daily standup' } },
      }),
    });
    useCalendarStore.setState({ events: [browserOccurrence] });

    await useCalendarStore.getState().updateEvent(client, browserOccurrence.id, CHANGE, true, { asOrganizer: true });

    const sent = refusing.mock.calls.map((call) => [call[1][`recurrenceOverrides/${RID}`] as Record<string, unknown>, call[2]]);
    expect(sent).toHaveLength(3);
    expect(sent[1]).toEqual([{ start: RID, duration: 'PT1H', title: 'Daily standup', participants: meeting, sequence: 1 }, false]);
    expect(sent[2][0]).not.toHaveProperty('organizerCalendarAddress');
    expect(sent[2]).toEqual([expect.objectContaining({ title: 'Standup in room 2' }), true]);
  });

  it.each<[string, Partial<CalendarEvent>, boolean | undefined, { asOrganizer?: boolean } | undefined]>([
    ['an attendee\'s change', CHANGE, true, { asOrganizer: false }],
    ['a change without messages', CHANGE, false, { asOrganizer: true }],
    ['a move that asks everyone again', {
      start: '2026-09-08T11:00:00',
      participants: { ...meeting, bob: { ...meeting.bob, participationStatus: 'needs-action' } },
    }, true, { asOrganizer: true }],
  ])('writes %s in one go', async (_label, change, send, options) => {
    const client = fakeClient({ queryCalendarEvents: vi.fn() });
    useCalendarStore.setState({ events: [serverOccurrence()] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', change, send, options);

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.queryCalendarEvents).not.toHaveBeenCalled();
  });

  it('writes a change to an occurrence that already has its override in one go', async () => {
    const client = fakeClient({ queryCalendarEvents: vi.fn() });
    useCalendarStore.setState({ events: [overridden('maaaaab')] });

    await useCalendarStore.getState().updateEvent(client, 'maaaaab', CHANGE, true, { asOrganizer: true });

    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(client.updateCalendarEvent).toHaveBeenCalledWith('maaaaab', CHANGE, true, undefined, undefined);
  });

  it('reports a failed change after the quiet override', async () => {
    const client = fakeClient({ queryCalendarEvents: vi.fn().mockResolvedValue([overridden('maaaaab')]) });
    client.updateCalendarEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(jmapError('An event cannot have more than 20 participants.', { type: 'invalidProperties' }));
    useCalendarStore.setState({ events: [serverOccurrence()] });

    await expect(useCalendarStore.getState().updateEvent(client, 'maaaaab', CHANGE, true, { asOrganizer: true }))
      .rejects.toThrow('more than 20');
    expect(client.updateCalendarEvent).toHaveBeenCalledTimes(2);
  });
});


// The grid shows a series as the occurrences the range load expands - on the
// server, or in the browser. A series just created was the series itself,
// once, at its first occurrence, until the page was reloaded (live on 1.0
// and 0.16.23): the later ones did not appear, and "this occurrence" of the
// first went to the series.
describe('a series created or changed', () => {
  const series = (overrides: Partial<CalendarEvent> = {}) => occurrence({
    id: 'b', originalId: 'b', baseEventId: 'b', recurrenceId: null, recurrenceOverrides: null, ...overrides,
  });

  it('reloads the visible range after a series is created', async () => {
    const client = fakeClient({ createCalendarEvent: vi.fn().mockResolvedValue(series()) });
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    client.queryAllCalendarEvents.mockResolvedValue([occurrence(), occurrence({ id: 'maaaaac', originalId: 'maaaaac', recurrenceId: '2026-09-09T10:00:00' })]);

    await useCalendarStore.getState().createEvent(client, { title: 'Daily standup', recurrenceRules: series().recurrenceRules });

    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(2);
    expect(useCalendarStore.getState().events.map((e) => e.id)).toEqual(['maaaaab', 'maaaaac']);
  });

  it('does not reload after a single event is created', async () => {
    const client = fakeClient({ createCalendarEvent: vi.fn().mockResolvedValue(series({ recurrenceRules: null })) });
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);

    await useCalendarStore.getState().createEvent(client, { title: 'Once' });

    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(1);
  });

  it('reloads after a change to a series the grid shows as itself, or one that makes an event a series', async () => {
    const client = fakeClient();
    await useCalendarStore.getState().fetchEvents(client, RANGE[0], RANGE[1]);
    useCalendarStore.setState({ events: [series(), series({ id: 'x', originalId: 'x', baseEventId: 'x', recurrenceRules: null })] });

    await useCalendarStore.getState().updateEvent(client, 'b', { title: 'Renamed' });
    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(2);

    useCalendarStore.setState({ events: [series({ id: 'x', originalId: 'x', baseEventId: 'x', recurrenceRules: null })] });
    await useCalendarStore.getState().updateEvent(client, 'x', { recurrenceRules: series().recurrenceRules });
    expect(client.queryAllCalendarEvents).toHaveBeenCalledTimes(3);
  });
});
