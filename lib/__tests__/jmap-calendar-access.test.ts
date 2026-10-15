import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// The calendar fan-out probes shared accounts on suspicion (Stalwart does not
// always advertise calendar capability on group accounts), so a shared account
// without any calendar access answers every probe with an access rejection.
// That rejection must be remembered and the account skipped afterwards -
// before, every calendar interaction re-probed it and logged a console error.

function makeSession() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:calendars': {} },
    accounts: {
      'acct-1': { name: 'test', isPersonal: true, accountCapabilities: {} },
      // Shared account without calendar access: probed because it is
      // non-personal, rejected by the server.
      'ev': { name: 'shared', isPersonal: false, accountCapabilities: {} },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('calendar fan-out to shared accounts without access', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession()));
    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();

    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const [method, args] = body.methodCalls?.[0] ?? [];
      if (args?.accountId === 'ev') {
        return jsonResponse({
          methodResponses: [
            ['error', { type: 'accountNotFound', description: 'You do not have access to account ev' }, '0'],
          ],
        });
      }
      if (method === 'CalendarEvent/query') {
        return jsonResponse({ methodResponses: [['CalendarEvent/query', { ids: [] }, '0']] });
      }
      return jsonResponse({ methodResponses: [['Calendar/get', { list: [] }, '0']] });
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    client.disconnect();
    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  function callsForAccount(accountId: string): unknown[][] {
    return fetchSpy.mock.calls.filter((call: unknown[]) => {
      const body = (call[1] as RequestInit | undefined)?.body;
      return typeof body === 'string' && body.includes(`"accountId":"${accountId}"`);
    });
  }

  it('probes a no-access shared account once, then skips it without console noise', async () => {
    await client.queryAllCalendarEvents({});
    await client.queryAllCalendarEvents({});

    expect(callsForAccount('ev')).toHaveLength(1);
    // The primary account keeps being queried normally.
    expect(callsForAccount('acct-1')).toHaveLength(2);
    // An expected rejection is not an error worth red console output.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('getAllCalendars skips an account already known to be inaccessible', async () => {
    await client.queryAllCalendarEvents({});
    fetchSpy.mockClear();

    await client.getAllCalendars();

    expect(callsForAccount('ev')).toHaveLength(0);
    expect(callsForAccount('acct-1')).toHaveLength(1);
  });
});
