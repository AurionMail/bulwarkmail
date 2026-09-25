import { describe, it, expect, vi, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapErrorType } from '../jmap/jmap-error';
import { AUTO_TIME_ZONE, toLocalDateTime } from '../timezone';
import { useSettingsStore } from '@/stores/settings-store';
import {
  connectCalendarClient,
  expandingQueryAnswer,
  installStalwartCalendarMock,
  localSeconds,
  occurrenceObjects,
  stalwartCalendarSession,
  tooManyOccurrences,
  type RangeOccurrence,
  type StalwartCalendarMock,
  type StalwartVersion,
} from './helpers/stalwart-calendar';

type Call = [string, Record<string, unknown>, string];

function clientAnswering(answer: (args: Record<string, unknown>) => [string, Record<string, unknown>]) {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, { accountId: 'a1', capabilities: {}, session: { accounts: {}, primaryAccounts: {} } });
  const queries: Record<string, unknown>[] = [];
  vi.spyOn(client as unknown as { supportsSyntheticCalendarIds: () => Promise<boolean> }, 'supportsSyntheticCalendarIds')
    .mockResolvedValue(true);
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (calls: Call[]) => ({
      methodResponses: calls.map(([method, args, id]) => {
        if (method === 'CalendarEvent/query') {
          queries.push(args);
          return [...answer(args), id];
        }
        const ids = (args.ids as string[]) ?? [];
        return ['CalendarEvent/get', {
          list: ids.map((eid) => ({ id: eid, '@type': 'Event', start: '2026-09-22T10:00:00', duration: 'PT1H', calendarIds: { c: true } })),
        }, id];
      }),
    }));
  return { client, queries };
}

describe('toLocalDateTime', () => {
  it('turns UTC and offset times into the wall clock of the zone', () => {
    expect(toLocalDateTime('2026-09-22T00:10:00Z', 'Europe/Berlin')).toBe('2026-09-22T02:10:00');
    expect(toLocalDateTime('2026-09-22T00:10:00.000Z', 'Europe/Berlin')).toBe('2026-09-22T02:10:00');
    expect(toLocalDateTime('2026-09-22T02:10:00+02:00')).toBe('2026-09-22T00:10:00');
  });

  it('leaves LocalDateTime values alone', () => {
    expect(toLocalDateTime('2026-09-22T02:10:00', 'Europe/Berlin')).toBe('2026-09-22T02:10:00');
  });
});

describe('queryCalendarEvents range handling', () => {
  it('sends UTC bounds as wall clock in the request time zone', async () => {
    const { client, queries } = clientAnswering(() => ['CalendarEvent/query', { ids: [] }]);
    await client.queryCalendarEvents({ after: '2026-09-22T00:10:00Z', before: '2026-09-22T00:20:00Z' });
    const filter = queries[0].filter as { after: string; before: string };
    const tz = queries[0].timeZone as string | undefined;
    expect(filter.after).toBe(toLocalDateTime('2026-09-22T00:10:00Z', tz));
    expect(filter.after.endsWith('Z')).toBe(false);
  });

  it.each<[StalwartVersion]>([['0.16'], ['1.0']])(
    'falls back to series when even a week expands to too many occurrences on Stalwart %s',
    async (version) => {
      const { client, queries } = clientAnswering((args) => args.expandRecurrences
        ? ['error', tooManyOccurrences(version)]
        : ['CalendarEvent/query', { ids: ['s1'] }]);
      const events = await client.queryCalendarEvents({ after: '2026-09-01T00:00:00', before: '2026-09-30T23:59:59' });

      // 30 days, halved to 15, 7.5 and 3.75: a chunk of a week or less that
      // is still refused gives up on server expansion for the whole range.
      const expanded = queries.filter((q) => q.expandRecurrences);
      const days = expanded.map((q) => {
        const filter = q.filter as { after: string; before: string };
        return (localSeconds(filter.before) - localSeconds(filter.after)) / 86_400;
      });
      const levels = [30, 15, 15, 7.5, 7.5, 7.5, 7.5, ...Array(8).fill(3.75)];
      expect(days).toHaveLength(levels.length);
      days.forEach((span, i) => expect(span).toBeCloseTo(levels[i], 0));
      expect(queries).toHaveLength(expanded.length + 1);
      expect(queries.at(-1)).toMatchObject({ filter: { after: '2026-09-01T00:00:00', before: '2026-09-30T23:59:59' } });
      expect(queries.at(-1)!.expandRecurrences).toBeUndefined();
      expect(events.map((e) => e.id)).toEqual(['s1']);
    },
  );

  it('fails the range when Stalwart 1.0 refuses the query, instead of returning no events', async () => {
    const { client } = clientAnswering(() => ['error', { type: 'invalidArguments', description: 'The filter must be a single FilterCondition when expanding recurrences' }]);
    const error = await client.queryCalendarEvents({ after: '2026-09-01T00:00:00', before: '2026-09-30T23:59:59' })
      .then(() => null, (e: unknown) => e);
    expect(jmapErrorType(error)).toBe('invalidArguments');
    expect((error as Error).message).toContain('single FilterCondition');
  });

  it('pages through more than one page of ids', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => `e${i}`);
    const { client, queries } = clientAnswering((args) => {
      const position = args.position as number;
      return ['CalendarEvent/query', { ids: all.slice(position, position + (args.limit as number)) }];
    });
    const events = await client.queryCalendarEvents({ after: '2026-09-01T00:00:00', before: '2026-10-01T00:00:00' });
    expect(queries.map((q) => q.position)).toEqual([0, 1000]);
    expect(events).toHaveLength(1500);
  });

  it('keeps an explicit limit to one page', async () => {
    const { client, queries } = clientAnswering(() => ['CalendarEvent/query', { ids: ['a', 'b'] }]);
    await client.queryCalendarEvents({ after: '2026-09-01T00:00:00', before: '2026-10-01T00:00:00' }, undefined, 2);
    expect(queries).toHaveLength(1);
    expect(queries[0].limit).toBe(2);
  });
});

// An expanded range may span at most maxExpandedQueryDuration (the account's
// calendars capability, an iCalendar duration). 1.0 enforces it with
// expandDurationTooLarge; every 0.16 advertises 365 days and never checks.
// A longer range goes out in chunks a day shorter than the limit, sharing a
// second at each border.
describe('expanded ranges longer than maxExpandedQueryDuration', () => {
  const DAY = 86_400;
  // 777 days, the longest window the month view scrolls to.
  const WINDOW = { after: '2025-01-01T00:00:00', before: '2027-02-16T23:59:59' };
  const occurrences: RangeOccurrence[] = [
    { id: 'o-first', start: '2025-01-02T09:00:00', seconds: 3600 },
    // Across the first border (2025-12-31T00:00:00): found by both chunks.
    { id: 'o-across', start: '2025-12-30T23:30:00', seconds: 3600 },
    // Zero-length, exactly on that border: only the overlap finds it.
    { id: 'o-border', start: '2025-12-31T00:00:00', seconds: 0 },
    { id: 'o-middle', start: '2026-07-01T09:00:00', seconds: 3600 },
    { id: 'o-late', start: '2027-02-10T09:00:00', seconds: 3600 },
    // Outside the window.
    { id: 'o-after', start: '2027-02-17T09:00:00', seconds: 3600 },
  ];
  const IN_WINDOW = ['o-first', 'o-across', 'o-border', 'o-middle', 'o-late'];
  const SERIES = {
    id: 'series', '@type': 'Event', uid: 'series@example.com', title: 'Standup', baseEventId: 'series',
    start: '2025-01-02T09:00:00', duration: 'PT1H', recurrenceRule: { frequency: 'daily' },
    recurrenceOverrides: null, calendarIds: { cal: true },
  };

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let server: StalwartCalendarMock;

  async function connect(
    version: StalwartVersion,
    options: {
      maxExpandedQueryDuration?: string | null;
      maxSpanSeconds?: number;
      maxInstances?: number;
      maxCallsInRequest?: number;
    } = {},
  ) {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession(version, options));
    server = installStalwartCalendarMock(fetchSpy, {
      version,
      objects: { series: SERIES },
      occurrences: occurrenceObjects('series', occurrences),
      answer: expandingQueryAnswer(version, { seriesId: 'series', occurrences, ...options }),
    });
  }

  const expandedQueries = () => server.queries().filter((q) => q.args.expandRecurrences);
  const bounds = () => expandedQueries().map((q) => {
    const filter = q.args.filter as { after: string; before: string };
    return [filter.after, filter.before];
  });

  afterEach(() => {
    client.disconnect();
    fetchSpy.mockRestore();
  });

  describe.each(['P365D', 'P52W1D', 'PT8760H'])('with maxExpandedQueryDuration %s', (duration) => {
    it(`splits a 777-day window into three chunks sent in one request on Stalwart 1.0`, async () => {
      await connect('1.0', { maxExpandedQueryDuration: duration });

      const events = await client.queryCalendarEvents(WINDOW);

      expect(bounds()).toEqual([
        ['2025-01-01T00:00:00', '2025-12-31T00:00:00'],
        ['2025-12-30T23:59:59', '2026-12-29T23:59:59'],
        ['2026-12-29T23:59:58', '2027-02-16T23:59:59'],
      ]);
      for (const [after, before] of bounds()) {
        expect(localSeconds(before) - localSeconds(after)).toBeLessThanOrEqual(364 * DAY);
      }
      expect(new Set(expandedQueries().map((q) => q.request)).size).toBe(1);
      // Each occurrence once, the border ones included.
      expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
    });
  });

  it('gets the same occurrences from 0.16, which advertises the limit but does not enforce it', async () => {
    await connect('0.16');
    const events = await client.queryCalendarEvents(WINDOW);

    expect(bounds()).toHaveLength(3);
    expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
    // The occurrences are hydrated from their series, once.
    expect(events.find((e) => e.id === 'o-middle')?.recurrenceRules).toEqual([{ frequency: 'daily' }]);
    expect(server.gets().filter((g) => (g.args.ids as string[]).includes('series'))).toHaveLength(1);
  });

  it('halves a chunk the server finds too long on Stalwart 1.0', async () => {
    // The server enforces less than it advertises.
    await connect('1.0', { maxSpanSeconds: 200 * DAY });

    const events = await client.queryCalendarEvents(WINDOW);

    const spans = bounds().map(([after, before]) => (localSeconds(before) - localSeconds(after)) / DAY);
    // The two 364-day chunks are refused and halved; the 49-day one is not.
    expect(spans.filter((days) => days > 200)).toHaveLength(2);
    expect(spans.filter((days) => days <= 200)).toHaveLength(5);
    expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
  });

  it('splits when refused even without the capability on Stalwart 1.0', async () => {
    await connect('1.0', { maxExpandedQueryDuration: null });

    const events = await client.queryCalendarEvents(WINDOW);

    // One query for the whole window, refused; its halves (388.5 days),
    // refused; their halves.
    expect(bounds()[0]).toEqual([WINDOW.after, WINDOW.before]);
    expect(bounds()).toHaveLength(1 + 2 + 4);
    expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
  });

  it.each<[StalwartVersion]>([['0.16'], ['1.0']])(
    'halves chunks that expand to too many occurrences on Stalwart %s',
    async (version) => {
      // Only a chunk holding at most two occurrences is answered.
      await connect(version, { maxInstances: 2 });

      const events = await client.queryCalendarEvents(WINDOW);

      expect(expandedQueries().length).toBeGreaterThan(3);
      expect(server.queries().every((q) => q.args.expandRecurrences)).toBe(true);
      expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
    },
  );

  it.each<[StalwartVersion]>([['0.16'], ['1.0']])(
    'expands the whole range on the client when a week is still too much on Stalwart %s',
    async (version) => {
      await connect(version, { maxInstances: 0 });

      const events = await client.queryCalendarEvents(WINDOW);

      // One query for the series over the whole window; none of the
      // occurrences found by chunks before giving up are mixed in.
      const plain = server.queries().filter((q) => !q.args.expandRecurrences);
      expect(plain).toHaveLength(1);
      expect(plain[0].args.filter).toMatchObject(WINDOW);
      expect(events.map((e) => e.id)).toEqual(['series']);
      expect(events[0].recurrenceRules).toEqual([{ frequency: 'daily' }]);
    },
  );

  it('sends as many chunks per request as maxCallsInRequest allows', async () => {
    await connect('1.0', { maxCallsInRequest: 2 });

    await client.queryCalendarEvents(WINDOW);

    expect(expandedQueries().map((q) => q.request)).toEqual([
      expandedQueries()[0].request, expandedQueries()[0].request, expandedQueries()[0].request + 1,
    ]);
  });

  it('reads the chunks in start order, a few per request, and keeps what fits the limit (contact activity) on Stalwart 1.0', async () => {
    await connect('1.0');

    const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: true }], 2);

    // One request asks all three chunks; the first fills the limit, and
    // what the others returned is dropped.
    expect(bounds()).toEqual([
      ['2025-01-01T00:00:00', '2025-12-31T00:00:00'],
      ['2025-12-30T23:59:59', '2026-12-29T23:59:59'],
      ['2026-12-29T23:59:58', '2027-02-16T23:59:59'],
    ]);
    expect(new Set(expandedQueries().map((q) => q.request)).size).toBe(1);
    expect(events.map((e) => e.id).sort()).toEqual(['o-across', 'o-first']);
  });

  it('asks the next few chunks only when the first ones fall short of the limit on Stalwart 1.0', async () => {
    // Chunks of 99 days: eight for the window, four per request.
    await connect('1.0', { maxExpandedQueryDuration: 'P100D' });

    const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: true }], 2);

    expect(expandedQueries()).toHaveLength(4);
    expect(new Set(expandedQueries().map((q) => q.request)).size).toBe(1);
    expect(events.map((e) => e.id).sort()).toEqual(['o-across', 'o-first']);
  });

  it('reads the latest chunk first for a descending sort (search) on Stalwart 1.0', async () => {
    await connect('1.0');

    const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: false }], 2);

    // The last chunk holds one; the middle one supplies the second.
    expect(bounds()).toEqual([
      ['2026-12-29T23:59:58', '2027-02-16T23:59:59'],
      ['2025-12-30T23:59:59', '2026-12-29T23:59:59'],
      ['2025-01-01T00:00:00', '2025-12-31T00:00:00'],
    ]);
    expect(new Set(expandedQueries().map((q) => q.request)).size).toBe(1);
    expect(events.map((e) => e.id).sort()).toEqual(['o-late', 'o-middle']);
  });

  it('pages on within a chunk when an occurrence both chunks share fills the page on Stalwart 1.0', async () => {
    // One chunk per request, so the paging is what the requests show.
    await connect('1.0', { maxCallsInRequest: 1 });

    // First chunk: o-first, o-across. Second chunk (by start): o-across,
    // o-border, o-middle - the shared one comes back again and is skipped.
    const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: true }], 3);

    expect(expandedQueries().map((q) => [q.args.position, q.args.limit])).toEqual([[0, 3], [0, 1], [1, 1]]);
    expect(events.map((e) => e.id).sort()).toEqual(['o-across', 'o-border', 'o-first']);
  });

  it('loads the contact activity look-ahead (365 days of UTC bounds, by start, limited) on Stalwart 1.0', async () => {
    await connect('1.0');
    const now = new Date('2026-03-01T12:00:00Z');

    const events = await client.queryAllCalendarEvents(
      { after: now.toISOString(), before: new Date(now.getTime() + 365 * DAY * 1000).toISOString() },
      [{ property: 'start', isAscending: true }],
      500,
    );

    expect(bounds()).toHaveLength(2);
    expect(events.map((e) => e.id).sort()).toEqual(['o-after', 'o-late', 'o-middle']);
  });

  it('stops between requests when the caller aborts on Stalwart 1.0', async () => {
    await connect('1.0', { maxCallsInRequest: 1 });
    const controller = new AbortController();
    const answering = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await answering(url, init);
      if (String(init?.body).includes('"expandRecurrences":true')) controller.abort();
      return response;
    });

    const error = await client.queryCalendarEvents(WINDOW, undefined, undefined, undefined, { signal: controller.signal })
      .then(() => null, (e: unknown) => e);

    expect((error as Error).name).toBe('AbortError');
    expect(expandedQueries()).toHaveLength(1);
  });

  it('asks for two chunks for a 365-day look-ahead on Stalwart 1.0', async () => {
    await connect('1.0');

    await client.queryCalendarEvents({ after: '2026-01-01T00:00:00', before: '2027-01-01T00:00:00' });

    expect(bounds()).toEqual([
      ['2026-01-01T00:00:00', '2026-12-31T00:00:00'],
      ['2026-12-30T23:59:59', '2027-01-01T00:00:00'],
    ]);
  });

  // Global search sends a query of several text parts as a flat AND of
  // single-key conditions, the range among them. 1.0 expands recurrences for
  // that shape (one AND), not for one where a condition holds both bounds.
  it.each<[StalwartVersion]>([['0.16'], ['1.0']])(
    'expands and chunks a range given as conditions of an AND on Stalwart %s',
    async (version) => {
      await connect(version);

      const events = await client.queryCalendarEvents({
        operator: 'AND',
        conditions: [{ after: WINDOW.after }, { before: WINDOW.before }, { text: 'budget' }, { text: 'review' }],
      });

      expect(expandedQueries()).toHaveLength(3);
      for (const query of expandedQueries()) {
        const filter = query.args.filter as { operator: string; conditions: Array<Record<string, unknown>> };
        expect(filter.operator).toBe('AND');
        expect(filter.conditions.slice(2)).toEqual([{ text: 'budget' }, { text: 'review' }]);
        expect(filter.conditions.every((condition) => Object.keys(condition).length === 1)).toBe(true);
      }
      expect(expandedQueries().map((q) => (q.args.filter as { conditions: unknown[] }).conditions.slice(0, 2))).toEqual([
        [{ after: '2025-01-01T00:00:00' }, { before: '2025-12-31T00:00:00' }],
        [{ after: '2025-12-30T23:59:59' }, { before: '2026-12-29T23:59:59' }],
        [{ after: '2026-12-29T23:59:58' }, { before: '2027-02-16T23:59:59' }],
      ]);
      expect(events.map((e) => e.id).sort()).toEqual([...IN_WINDOW].sort());
    },
  );

  it('reports a refusal it cannot split as a failure on Stalwart 1.0', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession('1.0'));
    server = installStalwartCalendarMock(fetchSpy, {
      version: '1.0',
      answer: (call) => call.method === 'CalendarEvent/query'
        ? ['error', { type: 'invalidArguments', description: 'The filter must be a single FilterCondition when expanding recurrences' }]
        : undefined,
    });

    await expect(client.queryCalendarEvents(WINDOW)).rejects.toThrow(/single FilterCondition/);
    expect(server.queries()).toHaveLength(3);
  });

  // 1.0 expands recurrences only for one AND of single conditions; an OR,
  // a NOT or a condition of several keys next to the bounds is refused.
  it.each<[string, Record<string, unknown>]>([
    ['an OR', { operator: 'OR', conditions: [{ text: 'budget' }, { text: 'review' }] }],
    ['a condition of two keys', { title: 'budget', description: 'review' }],
  ])('sends an AND holding %s as it is, not expanded, on Stalwart 1.0', async (_label, other) => {
    await connect('1.0');
    const filter = { operator: 'AND' as const, conditions: [{ after: WINDOW.after }, { before: WINDOW.before }, other] };

    await client.queryCalendarEvents(filter);

    expect(expandedQueries()).toHaveLength(0);
    expect(server.queries().map((q) => q.args.filter)).toEqual([filter]);
  });
});

// With a limit, the chunks of a long range go out a few per request in the
// sort order. When one of them needs another query - it was refused and is
// halved, or it filled its page with an occurrence found before - the chunks
// after it in that request are asked again after it, and what they returned
// is dropped: the result keeps the sort order.
describe('limited reads of several chunks per request', () => {
  // Chunks of 99 days from 2025-01-01, four per request.
  const WINDOW = { after: '2025-01-01T00:00:00', before: '2027-02-16T23:59:59' };
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let server: StalwartCalendarMock;

  async function connect(version: StalwartVersion, occurrences: RangeOccurrence[], maxInstances?: number) {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession(version, { maxExpandedQueryDuration: 'P100D' }));
    server = installStalwartCalendarMock(fetchSpy, {
      version,
      objects: {
        series: {
          id: 'series', '@type': 'Event', uid: 'series@example.com', title: 'Standup', baseEventId: 'series',
          start: '2025-01-02T09:00:00', duration: 'PT1H', recurrenceRule: { frequency: 'daily' },
          recurrenceOverrides: null, calendarIds: { cal: true },
        },
      },
      occurrences: occurrenceObjects('series', occurrences),
      answer: expandingQueryAnswer(version, { seriesId: 'series', occurrences, maxInstances }),
    });
  }

  afterEach(() => {
    client.disconnect();
    fetchSpy.mockRestore();
  });

  const byRequest = () => {
    const requests = new Map<number, Array<{ after: string; before: string; position: unknown }>>();
    for (const q of server.queries().filter((query) => query.args.expandRecurrences)) {
      const filter = q.args.filter as { after: string; before: string };
      requests.set(q.request, [...(requests.get(q.request) ?? []), { after: filter.after, before: filter.before, position: q.args.position }]);
    }
    return [...requests.values()];
  };

  it('asks again after a chunk that filled its page with an occurrence found before on Stalwart 1.0', async () => {
    await connect('1.0', [
      { id: 'o-a', start: '2025-01-02T09:00:00', seconds: 3600 },
      // Across the border of the fourth and fifth chunk: both find it.
      { id: 'o-b', start: '2026-01-31T23:30:00', seconds: 3600 },
      { id: 'o-c', start: '2026-03-01T09:00:00', seconds: 3600 },
      { id: 'o-d', start: '2026-04-01T09:00:00', seconds: 3600 },
    ]);

    const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: true }], 3);

    const [first, second, third] = byRequest();
    expect(first).toHaveLength(4);
    // The fifth chunk's page of one is o-b again: it is asked on from
    // there, with the three chunks after it.
    expect(second).toHaveLength(4);
    expect(third).toHaveLength(4);
    expect(third[0]).toEqual({ ...second[0], position: 1 });
    expect(third.slice(1)).toEqual(second.slice(1));
    expect(events.map((e) => e.id)).toEqual(['o-a', 'o-b', 'o-c']);
  });

  it.each<[StalwartVersion]>([['0.16'], ['1.0']])(
    'asks the rest of a request again after the halves of a refused chunk on Stalwart %s',
    async (version) => {
      // The first chunk expands to three occurrences, one more than allowed.
      await connect(version, [
        { id: 'o-jan', start: '2025-01-02T09:00:00', seconds: 3600 },
        { id: 'o-feb', start: '2025-02-02T09:00:00', seconds: 3600 },
        { id: 'o-mar', start: '2025-03-02T09:00:00', seconds: 3600 },
        { id: 'o-may', start: '2025-05-01T09:00:00', seconds: 3600 },
      ], 2);

      const events = await client.queryCalendarEvents(WINDOW, [{ property: 'start', isAscending: true }], 4);

      const [first, second] = byRequest();
      expect(first).toHaveLength(4);
      // The halves of the first chunk, then the second and third chunks again.
      expect(second).toHaveLength(4);
      expect(second[0].after).toBe(first[0].after);
      expect(second[1].before).toBe(first[0].before);
      expect(second.slice(2)).toEqual(first.slice(1, 3));
      expect(byRequest()).toHaveLength(2);
      expect(events.map((e) => e.id)).toEqual(['o-jan', 'o-feb', 'o-mar', 'o-may']);
    },
  );
});

// Stalwart 1.0 fails every CalendarEvent get and query whose `timeZone` its
// time zone database lacks, with invalidArguments "Invalid timeZone \"X\"";
// 0.16 reads such a zone as UTC. The session's first calendar list checks the
// user's zone on the way. Once refused, the zone is replaced by UTC, range
// bounds included, with one console warning.
describe('a time zone the server does not know', () => {
  // UTC+9 all year, so the expected bounds do not depend on DST.
  const ZONE = 'Asia/Tokyo';
  const GRID = { after: '2026-09-01T00:00:00', before: '2026-09-30T23:59:59' };
  const GRID_IN_UTC = { after: '2026-08-31T15:00:00', before: '2026-09-30T14:59:59' };
  const SERIES = {
    id: 'b', '@type': 'Event', uid: 'series@example.com', title: 'Standup', baseEventId: 'b',
    start: '2026-09-07T10:00:00', duration: 'PT1H', recurrenceRule: { frequency: 'daily' },
    recurrenceOverrides: null, calendarIds: { cal: true },
  };
  const TASK = { id: 't', '@type': 'Task', uid: 'task@example.com', title: 'Pay rent', due: '2026-09-10T00:00:00', calendarIds: { cal: true } };
  const OCCURRENCE = {
    ...SERIES, id: 'maaaaab', recurrenceRule: null, start: '2026-09-08T10:00:00', recurrenceId: '2026-09-08T10:00:00',
  };

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let server: StalwartCalendarMock;

  async function connect(version: StalwartVersion) {
    useSettingsStore.setState({ timeZone: ZONE });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    client = await connectCalendarClient(fetchSpy, stalwartCalendarSession(version));
    server = installStalwartCalendarMock(fetchSpy, {
      version,
      objects: { b: SERIES, t: TASK },
      occurrences: { maaaaab: OCCURRENCE },
      knownTimeZones: ['UTC', 'Europe/Berlin'],
    });
  }

  afterEach(() => {
    useSettingsStore.setState({ timeZone: AUTO_TIME_ZONE });
    client.disconnect();
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  const zones = () => server.calls
    .filter((c) => c.method === 'CalendarEvent/get' || c.method === 'CalendarEvent/query')
    .map((c) => c.args.timeZone);

  it('checks the zone with the first calendar list and asks in UTC from then on on Stalwart 1.0', async () => {
    await connect('1.0');

    await client.getAllCalendars();
    const events = await client.queryCalendarEvents(GRID);

    // The check rode along with Calendar/get: a get of no events.
    const probe = server.calls.find((c) => c.method === 'CalendarEvent/get' && (c.args.ids as string[]).length === 0)!;
    expect(probe.request).toBe(server.calls.find((c) => c.method === 'Calendar/get')!.request);
    expect(probe.args).toMatchObject({ properties: ['id'], timeZone: ZONE });
    // Everything after it asks in UTC, with the grid's wall-clock bounds moved along.
    expect(zones()).toEqual([ZONE, ...zones().slice(1).map(() => 'UTC')]);
    const query = server.queries().find((q) => q.args.expandRecurrences)!;
    expect(query.args.filter).toEqual(GRID_IN_UTC);
    expect(events.map((e) => e.id)).toEqual(['maaaaab']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(ZONE);
  });

  it('asks once more in UTC when a read comes before any check on Stalwart 1.0', async () => {
    await connect('1.0');

    const events = await client.queryCalendarEvents(GRID);

    const [refused, ...rest] = server.queries();
    expect(refused.args).toMatchObject({ timeZone: ZONE, filter: GRID });
    expect(rest.map((q) => [q.args.timeZone, q.args.filter])).toEqual([['UTC', GRID_IN_UTC]]);
    expect(events.map((e) => e.id)).toEqual(['maaaaab']);

    // Later reads go out in UTC straight away.
    server.calls.length = 0;
    await expect(client.getCalendarEvent('b')).resolves.toMatchObject({ title: 'Standup' });
    await expect(client.getCalendarTasks()).resolves.toMatchObject([{ id: 't' }]);
    await expect(client.getCalendarEvents()).resolves.toMatchObject([{ id: 'b' }]);
    expect(new Set(zones())).toEqual(new Set(['UTC']));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('moves UTC bounds (search, reminders) to the UTC wall clock after a refusal on Stalwart 1.0', async () => {
    await connect('1.0');

    await client.queryCalendarEvents({ after: '2026-09-01T00:00:00Z', before: '2026-09-02T00:00:00Z' });

    expect(server.queries().map((q) => [q.args.timeZone, q.args.filter])).toEqual([
      [ZONE, { after: '2026-09-01T09:00:00', before: '2026-09-02T09:00:00' }],
      ['UTC', { after: '2026-09-01T00:00:00', before: '2026-09-02T00:00:00' }],
    ]);
  });

  it('keeps the user’s zone on 0.16, which reads an unknown zone as UTC without complaint', async () => {
    await connect('0.16');

    await client.getAllCalendars();
    const events = await client.queryCalendarEvents(GRID);
    await client.getCalendarTasks();

    expect(new Set(zones())).toEqual(new Set([ZONE]));
    expect(server.queries().find((q) => q.args.expandRecurrences)!.args.filter).toEqual(GRID);
    expect(events.map((e) => e.id)).toEqual(['maaaaab']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends a zone typed in another letter case as Intl spells it on Stalwart 1.0', async () => {
    await connect('1.0');
    useSettingsStore.setState({ timeZone: 'europe/berlin' });

    await client.getAllCalendars();
    await client.queryCalendarEvents(GRID);

    expect(zones().every((zone) => zone === 'Europe/Berlin')).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends a zone Stalwart 1.0 knows as it is', async () => {
    await connect('1.0');
    useSettingsStore.setState({ timeZone: 'Europe/Berlin' });

    await client.getAllCalendars();
    await client.queryCalendarEvents(GRID);

    expect(new Set(zones())).toEqual(new Set(['Europe/Berlin']));
    expect(server.queries().find((q) => q.args.expandRecurrences)!.args.filter).toEqual(GRID);
    expect(warn).not.toHaveBeenCalled();
  });
});
