import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JMAPClient } from '../jmap/client';
import { jmapErrorType } from '../jmap/jmap-error';
import {
  OVERRIDES_WITH_UTC_ERROR,
  asksForOverridesWithUtc,
  connectCalendarClient,
  installStalwartCalendarMock,
  stalwartCalendarSession,
  type StalwartCalendarMock,
  type StalwartVersion,
} from './helpers/stalwart-calendar';

// Stalwart 1.0 fails a CalendarEvent/get that asks for recurrenceOverrides
// together with utcStart or utcEnd - the whole call, before any id is read.
// Every get the client sends must keep them apart; the reads that need the
// overrides get them from a second call in the same request. 0.16 accepts
// either, so the split must not change what callers get back there.

const RANGE = { after: '2026-09-01T00:00:00', before: '2026-09-30T23:59:59' };

const SERIES = {
  id: 'b', '@type': 'Event', uid: 'series@example.com', title: 'Daily standup', baseEventId: 'b',
  start: '2026-09-07T10:00:00', duration: 'PT1H', timeZone: 'Europe/Berlin',
  utcStart: '2026-09-07T08:00:00Z', utcEnd: '2026-09-07T09:00:00Z', showWithoutTime: false,
  recurrenceRule: { frequency: 'daily', count: 5 },
  recurrenceOverrides: { '2026-09-10T10:00:00': { excluded: true } },
  calendarIds: { cal: true },
};
const SINGLE = {
  id: 'd', '@type': 'Event', uid: 'single@example.com', title: 'One off', baseEventId: 'd',
  start: '2026-09-08T09:00:00', duration: 'PT30M', timeZone: 'Europe/Berlin',
  utcStart: '2026-09-08T07:00:00Z', utcEnd: '2026-09-08T07:30:00Z', showWithoutTime: false,
  calendarIds: { cal: true },
};
const TASK = {
  id: 't', '@type': 'Task', uid: 'task@example.com', title: 'Pay rent', due: '2026-09-10T00:00:00',
  progress: 'needs-action', calendarIds: { cal: true },
};
const OCCURRENCES = {
  maaaaab: {
    ...SERIES, id: 'maaaaab', baseEventId: 'b', recurrenceRule: null, recurrenceOverrides: null,
    start: '2026-09-08T10:00:00', utcStart: '2026-09-08T08:00:00Z', utcEnd: '2026-09-08T09:00:00Z',
    recurrenceId: '2026-09-08T10:00:00', recurrenceIdTimeZone: 'Europe/Berlin',
  },
  eaaaaad: { ...SINGLE, id: 'eaaaaad', baseEventId: 'd' },
};

describe.each<StalwartVersion>(['0.16', '1.0'])('calendar reads on Stalwart %s', (version) => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let server: StalwartCalendarMock;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession(version));
    server = installStalwartCalendarMock(fetchSpy, {
      version,
      objects: { b: SERIES, d: SINGLE, t: TASK },
      occurrences: OCCURRENCES,
    });
  });

  afterEach(() => {
    // The invariant: no get ever asks for both.
    expect(server.gets().filter((call) => asksForOverridesWithUtc(call.args))).toEqual([]);
    client.disconnect();
    fetchSpy.mockRestore();
  });

  it(`loads a server-expanded range with the series context of its occurrences on Stalwart ${version}`, async () => {
    const events = await client.queryCalendarEvents(RANGE);

    expect(events.map((e) => e.id)).toEqual(['maaaaab', 'eaaaaad']);
    const occurrence = events[0];
    expect(occurrence.recurrenceRules).toEqual([{ frequency: 'daily', count: 5 }]);
    expect(occurrence.recurrenceOverrides).toEqual({ '2026-09-10T10:00:00': { excluded: true } });
    expect(occurrence.utcStart).toBe('2026-09-08T08:00:00Z');
    // Expanded occurrences never ask for overrides; the hydration get has no utc*.
    const [instanceGet, hydrationGet] = server.gets();
    expect(instanceGet.args.properties).toContain('utcStart');
    expect(instanceGet.args.properties).not.toContain('recurrenceOverrides');
    expect(hydrationGet.args.properties).toContain('recurrenceOverrides');
    expect(hydrationGet.args.properties).not.toContain('utcStart');
  });

  it(`reads a series with its overrides from a second get in the same request on Stalwart ${version}`, async () => {
    const [series] = await client.queryCalendarEvents({ uid: 'series@example.com' });

    expect(series.id).toBe('b');
    expect(series.utcStart).toBe('2026-09-07T08:00:00Z');
    expect(series.recurrenceOverrides).toEqual({ '2026-09-10T10:00:00': { excluded: true } });
    const gets = server.gets();
    expect(gets).toHaveLength(2);
    expect(gets[0].request).toBe(gets[1].request);
    expect(gets[1].args).toMatchObject({ ids: ['b'], properties: ['id', 'recurrenceOverrides'] });
  });

  it(`reads one event with its overrides, and null for an unknown id, on Stalwart ${version}`, async () => {
    const event = await client.getCalendarEvent('b');
    expect(event?.title).toBe('Daily standup');
    expect(event?.utcEnd).toBe('2026-09-07T09:00:00Z');
    expect(event?.recurrenceOverrides).toEqual({ '2026-09-10T10:00:00': { excluded: true } });
    expect(event?.recurrenceRules).toEqual([{ frequency: 'daily', count: 5 }]);

    await expect(client.getCalendarEvent('gone')).resolves.toBeNull();
  });

  it(`lists every event by uid and calendar, without tasks, on Stalwart ${version}`, async () => {
    const events = await client.getCalendarEvents();

    expect(events.map((e) => [e.id, e.uid, e.calendarIds])).toEqual([
      ['b', 'series@example.com', { cal: true }],
      ['d', 'single@example.com', { cal: true }],
    ]);
    expect(server.gets()[0].args.properties).toEqual(['id', '@type', 'uid', 'calendarIds', 'due', 'progress', 'percentComplete']);
  });

  it(`loads tasks on Stalwart ${version}`, async () => {
    const tasks = await client.getCalendarTasks();

    expect(tasks.map((t) => [t.id, t.title, t.due])).toEqual([['t', 'Pay rent', '2026-09-10T00:00:00']]);
    expect(server.gets()[0].args.properties).not.toContain('utcStart');
  });

  it(`reads created events and tasks back on Stalwart ${version}`, async () => {
    const created = await client.createCalendarEvent({
      title: 'Lunch', start: '2026-09-09T12:00:00', duration: 'PT1H', calendarIds: { cal: true },
    });
    expect(created).toMatchObject({ id: 'created-1', title: 'Lunch' });

    const batch = await client.batchCreateCalendarEvents([
      { title: 'A', start: '2026-09-11T10:00:00', calendarIds: { cal: true } },
      { title: 'B', start: '2026-09-12T10:00:00', calendarIds: { cal: true } },
    ]);
    expect(batch.created.map((e) => e.title)).toEqual(['A', 'B']);

    const task = await client.createCalendarTask({ title: 'File taxes', calendarIds: { cal: true } });
    expect(task).toMatchObject({ id: 'created-4', title: 'File taxes', '@type': 'Task' });
  });

  it(`scans calendars for tasks-only ones on Stalwart ${version}`, async () => {
    const calendars = await client.getAllCalendars();
    expect(calendars.map((c) => [c.id, c.isTasksOnly])).toEqual([['cal', false]]);
  });
});

describe('a refused CalendarEvent/get', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;

  // What every get looked like to the client before the split: Stalwart 1.0
  // refusing the whole call.
  const refuseGets = { answer: (call: { method: string }) =>
    call.method === 'CalendarEvent/get' ? ['error', { ...OVERRIDES_WITH_UTC_ERROR }] as [string, Record<string, unknown>] : undefined };

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession('1.0'));
  });

  afterEach(() => {
    client.disconnect();
    fetchSpy.mockRestore();
  });

  it('fails the read instead of returning an empty list on Stalwart 1.0', async () => {
    installStalwartCalendarMock(fetchSpy, {
      version: '1.0', objects: { b: SERIES, t: TASK }, occurrences: OCCURRENCES, ...refuseGets,
    });

    for (const read of [
      () => client.queryCalendarEvents(RANGE),
      () => client.queryAllCalendarEvents(RANGE),
      () => client.getCalendarEvent('b'),
      () => client.getCalendarEvents(),
      () => client.getCalendarTasks(),
    ]) {
      const error = await read().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(jmapErrorType(error)).toBe('invalidArguments');
      expect((error as Error).message).toContain('recurrenceOverrides cannot be requested together with utcStart or utcEnd');
    }
  });

  it('still returns what was created when the read-back fails on Stalwart 1.0', async () => {
    const server = installStalwartCalendarMock(fetchSpy, { version: '1.0', ...refuseGets });

    const event = await client.createCalendarEvent({
      title: 'Lunch', start: '2026-09-09T12:00:00', duration: 'PT1H', calendarIds: { cal: true },
      recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'weekly' }] as never,
    }, true);
    expect(event).toMatchObject({ id: 'created-1', title: 'Lunch', start: '2026-09-09T12:00:00' });
    expect(event.recurrenceRules).toEqual([{ '@type': 'RecurrenceRule', frequency: 'weekly' }]);

    const task = await client.createCalendarTask({ title: 'File taxes', calendarIds: { cal: true } });
    expect(task).toMatchObject({ id: 'created-2', title: 'File taxes', '@type': 'Task' });

    const batch = await client.batchCreateCalendarEvents([{ title: 'A', start: '2026-09-11T10:00:00', calendarIds: { cal: true } }]);
    expect(batch.created).toMatchObject([{ id: 'created-3', title: 'A' }]);

    // Each create went out once; nothing was retried or queried afterwards.
    expect(server.calls.filter((c) => c.method === 'CalendarEvent/set')).toHaveLength(3);
    expect(server.queries()).toHaveLength(0);
  });

  it('still returns what was created when the read-back fails in transit on Stalwart 0.16', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = installStalwartCalendarMock(fetchSpy, { version: '0.16' });
    const answering = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(init?.body).includes('"CalendarEvent/get"')) return new Response('Service Unavailable', { status: 503 });
      return answering(url, init);
    });

    const event = await client.createCalendarEvent({ title: 'Lunch', start: '2026-09-09T12:00:00', calendarIds: { cal: true } });
    expect(event).toMatchObject({ id: 'created-1', title: 'Lunch' });
    expect(server.calls.filter((c) => c.method === 'CalendarEvent/set')).toHaveLength(1);
    consoleError.mockRestore();
  });
});
