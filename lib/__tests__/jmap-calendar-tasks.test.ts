import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import type { CalendarTask } from '../jmap/types';
import { jmapErrorType } from '../jmap/jmap-error';

function makeSession() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:calendars': {} },
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

type Call = { method: string; args: Record<string, unknown> };

describe('JMAPClient task operations (#958)', () => {
  let client: JMAPClient;
  let sentCalls: Call[];

  beforeEach(() => {
    sentCalls = [];
    client = new JMAPClient('https://mail.example.com', 'test', 'pass');
    // Simulate active session
    (client as unknown as { session: unknown; accountId: string; apiUrl: string }).session = makeSession();
    (client as unknown as { accountId: string }).accountId = 'acct-1';
    (client as unknown as { apiUrl: string }).apiUrl = 'https://mail.example.com/jmap/api';
    (client as unknown as { accounts: Record<string, unknown> }).accounts = makeSession().accounts;

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) || '{}');
      const calls = (body.methodCalls || []) as [string, Record<string, unknown>, string][];
      const methodResponses: [string, Record<string, unknown>, string][] = [];

      for (const [method, args, tag] of calls) {
        sentCalls.push({ method, args });

        if (method === 'CalendarEvent/set') {
          const update = args.update as Record<string, unknown> | undefined;
          const create = args.create as Record<string, unknown> | undefined;
          const updated: Record<string, unknown> = {};
          const created: Record<string, unknown> = {};

          if (update) {
            for (const id of Object.keys(update)) {
              updated[id] = { id };
            }
          }
          if (create) {
            for (const id of Object.keys(create)) {
              created[id] = { id: 'created-id-123' };
            }
          }

          methodResponses.push(['CalendarEvent/set', { updated, created, notUpdated: {}, notCreated: {} }, tag]);
        } else if (method === 'CalendarEvent/get') {
          methodResponses.push([
            'CalendarEvent/get',
            {
              list: [
                {
                  id: 'created-id-123',
                  '@type': 'Task',
                  uid: 'uid-123',
                  title: 'Task Title',
                  progress: 'needs-action',
                  calendarIds: { 'cal-1': true },
                },
              ],
              notFound: [],
            },
            tag,
          ]);
        }
      }

      return jsonResponse({ methodResponses });
    }));
  });

  it('updateCalendarTask strips progressUpdated before sending CalendarEvent/set (#958)', async () => {
    const updates: Partial<CalendarTask> & { progressUpdated?: string | null } = {
      progress: 'completed',
      progressUpdated: '2026-09-06T12:00:00Z',
    };

    await client.updateCalendarTask('task-123', updates as Partial<CalendarTask>);

    const setCall = sentCalls.find((c) => c.method === 'CalendarEvent/set');
    expect(setCall).toBeDefined();

    const updatePayload = (setCall?.args.update as Record<string, Record<string, unknown>>)?.['task-123'];
    expect(updatePayload).toBeDefined();
    expect(updatePayload.progress).toBe('completed');
    expect(updatePayload).not.toHaveProperty('progressUpdated');
  });

  it('createCalendarTask strips progressUpdated before sending CalendarEvent/set', async () => {
    const task: Partial<CalendarTask> & { progressUpdated?: string | null } = {
      title: 'New Task',
      progress: 'needs-action',
      progressUpdated: '2026-09-06T12:00:00Z',
    };

    await client.createCalendarTask(task as Partial<CalendarTask>);

    const setCall = sentCalls.find((c) => c.method === 'CalendarEvent/set');
    expect(setCall).toBeDefined();

    const createPayload = (setCall?.args.create as Record<string, Record<string, unknown>>)?.['new-task'];
    expect(createPayload).toBeDefined();
    expect(createPayload['@type']).toBe('Task');
    expect(createPayload.title).toBe('New Task');
    expect(createPayload).not.toHaveProperty('progressUpdated');
  });

  it('createCalendarTask reads the task back without utcStart/utcEnd', async () => {
    await client.createCalendarTask({ title: 'New Task' });

    const getCall = sentCalls.find((c) => c.method === 'CalendarEvent/get');
    expect(getCall?.args.properties).toEqual(expect.arrayContaining(['due', 'progress', 'recurrenceOverrides']));
    expect(getCall?.args.properties).not.toContain('utcStart');
    expect(getCall?.args.properties).not.toContain('utcEnd');
  });

  it('createCalendarTask returns the created task when Stalwart 1.0 refuses the read-back, without creating it twice', async () => {
    const answer = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse((init?.body as string) || '{}');
      if (body.methodCalls?.[0]?.[0] === 'CalendarEvent/get') {
        sentCalls.push({ method: 'CalendarEvent/get', args: body.methodCalls[0][1] });
        return jsonResponse({ methodResponses: [['error', {
          type: 'invalidArguments',
          description: 'recurrenceOverrides cannot be requested together with utcStart or utcEnd',
        }, '0']] });
      }
      return answer(url, init);
    });

    const created = await client.createCalendarTask({ title: 'New Task', due: '2026-09-30T00:00:00', calendarIds: { 'cal-1': true } });

    expect(created).toMatchObject({ id: 'created-id-123', '@type': 'Task', title: 'New Task', due: '2026-09-30T00:00:00' });
    expect(sentCalls.filter((c) => c.method === 'CalendarEvent/set')).toHaveLength(1);
  });

  it('getCalendarTasks fails instead of returning no tasks when the server refuses the query', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => jsonResponse({
      methodResponses: [['error', { type: 'serverFail', description: 'Store unavailable' }, '0']],
    }));

    await expect(client.getCalendarTasks()).rejects.toThrow(/Store unavailable/);
  });

  it('createCalendarTask fails with the error type when the server refuses the whole call', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => jsonResponse({
      methodResponses: [['error', { type: 'invalidArguments', description: 'Invalid calendar id' }, '0']],
    }));

    const error = await client.createCalendarTask({ title: 'New Task' }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Invalid calendar id');
    expect(jmapErrorType(error)).toBe('invalidArguments');
  });
});
