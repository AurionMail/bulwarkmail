// Mock Stalwart calendar servers for JMAPClient tests. What differs between
// the versions, as far as these tests go:
// - 1.0 refuses a CalendarEvent/get that asks for `recurrenceOverrides`
//   together with `utcStart`/`utcEnd` (jmap/src/calendar_event/get.rs,
//   ProjectionRequest::new), before reading any id;
// - 1.0 refuses a CalendarEvent/get or /query whose `timeZone` its time zone
//   database lacks (jmap-proto/src/object/calendar_event.rs,
//   resolved_time_zone); 0.16 reads it as UTC;
// - 0.16 answers any property list.
// Both advertise `maxExpandedQueryDuration` in the account's calendars
// capability (0.16 hardcodes 365 days and never enforces it).
import { vi } from 'vitest';
import type { JMAPClient } from '@/lib/jmap/client';
import { SYNTHETIC_ID_PROBE } from '@/lib/recurrence-instances';

export type StalwartVersion = '0.16' | '1.0';

/** Stalwart 1.0's answer to a CalendarEvent/get that asks for both. */
export const OVERRIDES_WITH_UTC_ERROR = {
  type: 'invalidArguments',
  description: 'recurrenceOverrides cannot be requested together with utcStart or utcEnd',
} as const;

/** True for a CalendarEvent/get Stalwart 1.0 refuses outright. */
export function asksForOverridesWithUtc(args: Record<string, unknown>): boolean {
  const properties = args.properties;
  if (!Array.isArray(properties)) return false;
  return properties.includes('recurrenceOverrides')
    && (properties.includes('utcStart') || properties.includes('utcEnd'));
}

export interface RecordedCall {
  method: string;
  args: Record<string, unknown>;
  callId: string;
  /** Index of the HTTP request the call was part of. */
  request: number;
}

export type MethodAnswer = [string, Record<string, unknown>];

export interface StalwartCalendarMockOptions {
  version: StalwartVersion;
  /** Stored events and tasks, by id. */
  objects?: Record<string, Record<string, unknown>>;
  /** What CalendarEvent/query?expandRecurrences=true hands out, by synthetic id. */
  occurrences?: Record<string, Record<string, unknown>>;
  /** Whether CalendarEvent/set accepts synthetic ids (the probe answers notFound). Default true. */
  syntheticIds?: boolean;
  /** Answer a call yourself; return undefined for the default answer. */
  answer?: (call: RecordedCall) => MethodAnswer | undefined;
  /** The time zones the server's database has; 1.0 refuses any other (all known when unset). */
  knownTimeZones?: string[];
}

/** Stalwart 1.0's answer to a calendar get or query naming a zone it does not know. */
export function invalidTimeZone(timeZone: string): MethodAnswer {
  return ['error', { type: 'invalidArguments', description: `Invalid timeZone ${JSON.stringify(timeZone)}` }];
}

export interface StalwartCalendarMock {
  calls: RecordedCall[];
  /** Every CalendarEvent/get sent so far. */
  gets(): RecordedCall[];
  queries(): RecordedCall[];
  objects: Record<string, Record<string, unknown>>;
}

/** A session like Stalwart's, with the calendars capability on the account. */
export function stalwartCalendarSession(
  version: StalwartVersion,
  options: { maxExpandedQueryDuration?: string | null; maxCallsInRequest?: number; accounts?: Record<string, unknown> } = {},
) {
  const calendarCapability: Record<string, unknown> = {
    maxCalendarsPerEvent: version === '1.0' ? 10 : null,
    minDateTime: '0001-01-01T00:00:00Z',
    maxDateTime: '9999-12-31T23:59:59Z',
    maxParticipantsPerEvent: 20,
    mayCreateCalendar: true,
  };
  const duration = options.maxExpandedQueryDuration === undefined ? 'P365D' : options.maxExpandedQueryDuration;
  if (duration !== null) calendarCapability.maxExpandedQueryDuration = duration;
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': { maxCallsInRequest: options.maxCallsInRequest ?? 16, maxObjectsInGet: 500, maxObjectsInSet: 500 },
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-1': {
        name: 'user@example.com',
        isPersonal: true,
        accountCapabilities: { 'urn:ietf:params:jmap:calendars': calendarCapability },
      },
      ...options.accounts,
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1', 'urn:ietf:params:jmap:calendars': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function project(object: Record<string, unknown>, properties: unknown): Record<string, unknown> {
  if (!Array.isArray(properties)) return { ...object };
  const out: Record<string, unknown> = { id: object.id };
  for (const key of properties as string[]) {
    if (key in object) out[key] = object[key];
  }
  return out;
}

/**
 * Point `fetchSpy` (a spy on globalThis.fetch) at a mock Stalwart calendar
 * server. Every method call is recorded, including the request it came in.
 */
export function installStalwartCalendarMock(
  fetchSpy: ReturnType<typeof vi.spyOn>,
  options: StalwartCalendarMockOptions,
): StalwartCalendarMock {
  const calls: RecordedCall[] = [];
  const objects = { ...options.objects };
  const occurrences = { ...options.occurrences };
  let requests = 0;
  let created = 0;

  const defaultAnswer = (call: RecordedCall): MethodAnswer => {
    const { method, args } = call;
    if (method === 'Calendar/get') {
      return ['Calendar/get', { accountId: args.accountId, list: [{ id: 'cal', name: 'Personal', isDefault: true }], notFound: [] }];
    }
    if (method === 'CalendarEvent/query') {
      const filter = (args.filter ?? {}) as Record<string, unknown>;
      let ids = args.expandRecurrences ? Object.keys(occurrences) : Object.keys(objects);
      if (typeof filter.uid === 'string') ids = ids.filter((id) => objects[id]?.uid === filter.uid);
      const position = (args.position as number | undefined) ?? 0;
      const limit = (args.limit as number | undefined) ?? ids.length;
      return ['CalendarEvent/query', { accountId: args.accountId, ids: ids.slice(position, position + limit), position }];
    }
    if (method === 'CalendarEvent/get') {
      if (options.version === '1.0' && asksForOverridesWithUtc(args)) return ['error', { ...OVERRIDES_WITH_UTC_ERROR }];
      const list: Record<string, unknown>[] = [];
      const notFound: string[] = [];
      for (const id of (args.ids as string[] | null) ?? Object.keys(objects)) {
        const occurrence = occurrences[id];
        const object = occurrence ?? objects[id];
        if (!object) {
          notFound.push(id);
          continue;
        }
        const projected = project(object, args.properties);
        // 1.0 answers recurrenceOverrides: null for a synthetic id.
        if (occurrence && Array.isArray(args.properties) && (args.properties as string[]).includes('recurrenceOverrides')) {
          projected.recurrenceOverrides = null;
        }
        list.push(projected);
      }
      return ['CalendarEvent/get', { accountId: args.accountId, list, notFound }];
    }
    if (method === 'CalendarEvent/set') {
      const update = args.update as Record<string, Record<string, unknown>> | undefined;
      if (update && SYNTHETIC_ID_PROBE in update) {
        const failure = options.syntheticIds === false
          ? { type: 'invalidProperties', description: 'Updating synthetic ids is not yet supported.', properties: ['id'] }
          : { type: 'notFound' };
        return ['CalendarEvent/set', { notUpdated: { [SYNTHETIC_ID_PROBE]: failure } }];
      }
      const result: Record<string, unknown> = {};
      const create = args.create as Record<string, Record<string, unknown>> | undefined;
      if (create) {
        const createdMap: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(create)) {
          const id = `created-${++created}`;
          objects[id] = { ...value, id };
          createdMap[key] = { id };
        }
        result.created = createdMap;
      }
      if (update) {
        for (const [id, patch] of Object.entries(update)) objects[id] = { ...objects[id], ...patch };
        result.updated = Object.fromEntries(Object.keys(update).map((id) => [id, null]));
      }
      return ['CalendarEvent/set', result];
    }
    return ['error', { type: 'unknownMethod' }];
  };

  fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const request = requests++;
    const methodResponses: unknown[] = [];
    for (const [method, args, callId] of body.methodCalls ?? []) {
      const call: RecordedCall = { method, args, callId, request };
      calls.push(call);
      const timeZone = args?.timeZone;
      const refusesTimeZone = options.version === '1.0' && typeof timeZone === 'string'
        && !!options.knownTimeZones && !options.knownTimeZones.includes(timeZone)
        && (method === 'CalendarEvent/get' || method === 'CalendarEvent/query');
      const answer = refusesTimeZone ? invalidTimeZone(timeZone) : options.answer?.(call) ?? defaultAnswer(call);
      methodResponses.push([...answer, callId]);
    }
    return jsonResponse({ methodResponses });
  });

  return {
    calls,
    gets: () => calls.filter((c) => c.method === 'CalendarEvent/get'),
    queries: () => calls.filter((c) => c.method === 'CalendarEvent/query'),
    objects,
  };
}

/** Stalwart 1.0's refusal of an expanded range longer than maxExpandedQueryDuration. */
export const EXPAND_DURATION_TOO_LARGE = {
  type: 'expandDurationTooLarge',
  description: "The time span between 'after' and 'before' exceeds maxExpandedQueryDuration",
} as const;

/** Both versions' refusal of a query that expands to more occurrences than allowed. */
export function tooManyOccurrences(version: StalwartVersion) {
  const description = 'The number of expanded recurrences exceeds the server limit';
  return version === '1.0'
    ? { type: 'cannotCalculateOccurrences', description }
    : { type: 'invalidArguments', description };
}

/** An occurrence of the series `seriesId`: a LocalDateTime start and a length in seconds. */
export interface RangeOccurrence {
  id: string;
  start: string;
  seconds: number;
}

/** A LocalDateTime read as seconds (the mock has no time zones). */
export function localSeconds(value: string): number {
  return Date.parse(`${value}Z`) / 1000;
}

/** Occurrence objects for `objects`/`occurrences` of installStalwartCalendarMock. */
export function occurrenceObjects(seriesId: string, occurrences: RangeOccurrence[]) {
  return Object.fromEntries(occurrences.map((o) => [o.id, {
    id: o.id, '@type': 'Event', baseEventId: seriesId, uid: `${seriesId}@example.com`, title: 'Standup',
    start: o.start, duration: `PT${o.seconds}S`, recurrenceId: o.start, calendarIds: { cal: true },
  }]));
}

type FilterNode = Record<string, unknown> & { operator?: string; conditions?: FilterNode[] };

/** Stalwart 1.0's refusal of an expanded query whose filter is more than one FilterCondition. */
export const NOT_A_SINGLE_CONDITION = {
  type: 'invalidArguments',
  description: 'The filter must be a single FilterCondition when expanding recurrences',
} as const;

/**
 * Whether Stalwart 1.0 expands recurrences for `filter`: no OR or NOT, and at
 * most one AND - a condition of two keys counts as an AND of its own
 * (jmap-proto/src/method/query.rs; calendar_event/query.rs).
 */
export function isSingleFilterCondition(filter: FilterNode): boolean {
  let ands = 0;
  const walk = (node: FilterNode): boolean => {
    if (node.operator) {
      if (node.operator !== 'AND') return false;
      ands++;
      return (node.conditions ?? []).every(walk);
    }
    if (Object.keys(node).length > 1) ands++;
    return true;
  };
  return walk(filter) && ands <= 1;
}

/** The after/before of a filter: keys of its own, or conditions anywhere in it. */
export function boundsOf(filter: FilterNode): { after?: string; before?: string } {
  const bounds: { after?: string; before?: string } = {};
  const walk = (node: FilterNode) => {
    if (typeof node.after === 'string') bounds.after = node.after;
    if (typeof node.before === 'string') bounds.before = node.before;
    for (const condition of node.conditions ?? []) walk(condition);
  };
  walk(filter);
  return bounds;
}

/**
 * Answers CalendarEvent/query the way Stalwart expands a range: occurrences
 * that overlap (after, before) strictly, sorted by start when asked, paged.
 * 1.0 refuses a span over `maxSpanSeconds` (0.16 never checks it) and a
 * filter that is more than a single FilterCondition, and both refuse a
 * query that expands to more than `maxInstances` occurrences. A query
 * without expansion finds the series itself.
 */
export function expandingQueryAnswer(
  version: StalwartVersion,
  options: { seriesId: string; occurrences: RangeOccurrence[]; maxSpanSeconds?: number; maxInstances?: number },
) {
  return (call: RecordedCall): MethodAnswer | undefined => {
    if (call.method !== 'CalendarEvent/query') return undefined;
    const { args } = call;
    if (!args.expandRecurrences) return ['CalendarEvent/query', { ids: [options.seriesId], position: 0 }];
    const filter = args.filter as FilterNode;
    if (version === '1.0' && !isSingleFilterCondition(filter)) return ['error', { ...NOT_A_SINGLE_CONDITION }];
    const bounds = boundsOf(filter);
    const after = localSeconds(bounds.after ?? '');
    const before = localSeconds(bounds.before ?? '');
    if (version === '1.0' && before - after > (options.maxSpanSeconds ?? 365 * 86_400)) {
      return ['error', { ...EXPAND_DURATION_TOO_LARGE }];
    }
    let hits = options.occurrences.filter((o) => {
      const start = localSeconds(o.start);
      return start < before && start + o.seconds > after;
    });
    if (hits.length > (options.maxInstances ?? 3000)) return ['error', tooManyOccurrences(version)];
    const [sort] = (args.sort as Array<{ property: string; isAscending?: boolean }> | undefined) ?? [];
    if (sort?.property === 'start') {
      hits = [...hits].sort((a, b) => localSeconds(a.start) - localSeconds(b.start));
      if (sort.isAscending === false) hits.reverse();
    }
    const position = (args.position as number | undefined) ?? 0;
    const limit = (args.limit as number | undefined) ?? hits.length;
    return ['CalendarEvent/query', { ids: hits.slice(position, position + limit).map((o) => o.id), position }];
  };
}

/** A JMAPClient connected to `session` through `fetchSpy`. */
export async function connectCalendarClient(
  fetchSpy: ReturnType<typeof vi.spyOn>,
  session: ReturnType<typeof stalwartCalendarSession>,
): Promise<JMAPClient> {
  // Loaded here so tests that only need the mock data (the agenda route)
  // do not pull in the whole client.
  const { JMAPClient } = await import('@/lib/jmap/client');
  fetchSpy.mockResolvedValueOnce(jsonResponse(session));
  const client = new JMAPClient('https://mail.example.com', 'user@example.com', 'pass123');
  await client.connect();
  fetchSpy.mockReset();
  return client;
}
