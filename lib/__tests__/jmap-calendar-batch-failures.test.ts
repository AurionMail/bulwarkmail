import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// #434: batchDeleteCalendarEvents ignored a method-level error and dropped the
// notDestroyed details, so "Clear events" reported "0 events cleared" with no
// error. The same for batchCreateCalendarEvents' notCreated on import.

function makeSession() {
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:calendars': {},
    },
    accounts: {
      'acct-1': {
        name: 'test',
        isPersonal: true,
        accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} },
      },
    },
    primaryAccounts: {
      'urn:ietf:params:jmap:mail': 'acct-1',
      'urn:ietf:params:jmap:calendars': 'acct-1',
    },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('calendar batch failures surface (#434)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  async function connectedClient(): Promise<JMAPClient> {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token123', 'user@test.com');
    await client.connect();
    fetchSpy.mockReset();
    return client;
  }

  it('batchDeleteCalendarEvents rejects with the server reason when nothing was destroyed', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        methodResponses: [
          ['CalendarEvent/set', {
            destroyed: null,
            notDestroyed: { ev1: { type: 'forbidden', description: 'You do not own this calendar' } },
          }, '0'],
        ],
      }),
    );

    await expect(client.batchDeleteCalendarEvents(['ev1'])).rejects.toThrow(/You do not own this calendar/);
  });

  it('batchDeleteCalendarEvents rejects on a method-level error', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        methodResponses: [['error', { type: 'accountNotFound', description: 'Account not found' }, '0']],
      }),
    );

    await expect(client.batchDeleteCalendarEvents(['ev1'])).rejects.toThrow(/Account not found/);
  });

  it('batchDeleteCalendarEvents returns the notDestroyed map for partial failures', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        methodResponses: [
          ['CalendarEvent/set', {
            destroyed: ['ev1'],
            notDestroyed: { ev2: { type: 'notFound', description: 'Gone' } },
          }, '0'],
        ],
      }),
    );

    const result = await client.batchDeleteCalendarEvents(['ev1', 'ev2']);
    expect(result.destroyed).toEqual(['ev1']);
    expect(result.notDestroyed).toEqual({ ev2: { type: 'notFound', description: 'Gone' } });
  });

  it('batchCreateCalendarEvents rejects on a method-level error and reports notCreated otherwise', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        methodResponses: [['error', { type: 'invalidArguments', description: 'Unknown calendar' }, '0']],
      }),
    );
    await expect(client.batchCreateCalendarEvents([{ title: 'A' }])).rejects.toThrow(/Unknown calendar/);

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        methodResponses: [
          ['CalendarEvent/set', {
            created: null,
            notCreated: { 'new-0': { type: 'invalidProperties', description: 'Missing start' } },
          }, '0'],
        ],
      }),
    );
    const result = await client.batchCreateCalendarEvents([{ title: 'A' }]);
    expect(result.created).toEqual([]);
    expect(result.failed).toEqual(['new-0']);
    expect(result.notCreated['new-0']).toMatchObject({ description: 'Missing start' });
  });
});
