import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// Tasks-only calendars are hidden from the event calendar UI. Stalwart exposes
// no supported-component set, so getCalendars() inspects each calendar's
// objects. The scan must respect the server's request limits and must never
// hide a calendar that holds an event, however far down that event sits.

const MAX_CALLS = 16;
const MAX_GET = 500;

function makeSession() {
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': { maxCallsInRequest: MAX_CALLS, maxObjectsInGet: MAX_GET },
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-1': { name: 'test', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1', 'urn:ietf:params:jmap:calendars': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Obj = { id: string; '@type': 'Event' | 'Task'; calendarIds: Record<string, boolean> };

describe('getCalendars tasks-only detection', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let calendars: Record<string, Obj[]>;

  function fill(calId: string, kinds: Array<'Event' | 'Task'>) {
    calendars[calId] = kinds.map((type, i) => ({ id: `${calId}-${i}`, '@type': type, calendarIds: { [calId]: true } }));
  }

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));
    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();
    calendars = {};

    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const calls = body.methodCalls as [string, Record<string, unknown>, string][];
      if (calls.length > MAX_CALLS) {
        return jsonResponse({ type: 'urn:ietf:params:jmap:error:limit', limit: 'maxCallsInRequest', status: 400 }, 400);
      }
      const all = Object.values(calendars).flat();
      const methodResponses = calls.map(([method, args, tag]) => {
        if (method === 'Calendar/get') {
          return ['Calendar/get', { list: Object.keys(calendars).map((id) => ({ id, name: id })) }, tag];
        }
        if (method === 'CalendarEvent/query') {
          const calId = (args.filter as { inCalendar?: string } | undefined)?.inCalendar;
          const matching = calId ? calendars[calId] ?? [] : all;
          const position = (args.position as number | undefined) ?? 0;
          const limit = (args.limit as number | undefined) ?? matching.length;
          return ['CalendarEvent/query', { ids: matching.slice(position, position + limit).map((o) => o.id) }, tag];
        }
        if (method === 'CalendarEvent/get') {
          const ids = args.ids as string[];
          if (ids.length > MAX_GET) return ['error', { type: 'requestTooLarge' }, tag];
          return ['CalendarEvent/get', { list: all.filter((o) => ids.includes(o.id)) }, tag];
        }
        return ['error', { type: 'unknownMethod' }, tag];
      });
      return jsonResponse({ methodResponses });
    });
  });

  afterEach(() => {
    client.disconnect();
    fetchSpy.mockRestore();
  });

  async function tasksOnlyIds() {
    const result = await client.getCalendars();
    return result.filter((c) => c.isTasksOnly).map((c) => c.id).sort();
  }

  it('marks a calendar with only tasks and keeps event and empty calendars visible', async () => {
    fill('events', ['Event', 'Task']);
    fill('todos', ['Task', 'Task']);
    fill('empty', []);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });

  it('detects a task list when another calendar holds thousands of events', async () => {
    fill('archive', Array(5100).fill('Event'));
    fill('todos', ['Task', 'Task']);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });

  it('does not hide a calendar whose first event sits past the first page', async () => {
    fill('mixed', [...Array(250).fill('Task'), 'Event']);
    fill('todos', ['Task']);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });

  it('still detects a task list longer than one page', async () => {
    fill('todos', Array(450).fill('Task'));
    fill('events', ['Event']);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });

  it('stays within maxCallsInRequest when the account has many calendars', async () => {
    for (let i = 0; i < 20; i++) fill(`cal-${String(i).padStart(2, '0')}`, ['Event']);
    fill('todos', ['Task']);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });

  it('stays within maxObjectsInGet when several calendars return full pages', async () => {
    fill('a', Array(300).fill('Event'));
    fill('b', Array(300).fill('Event'));
    fill('c', Array(300).fill('Event'));
    fill('todos', ['Task']);
    expect(await tasksOnlyIds()).toEqual(['todos']);
  });
});
