import { describe, it, expect, vi, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

const MAIL = 'urn:ietf:params:jmap:mail';
const SIEVE = 'urn:ietf:params:jmap:sieve';
const CALENDARS = 'urn:ietf:params:jmap:calendars';
const CONTACTS = 'urn:ietf:params:jmap:contacts';
const FILENODE = 'urn:ietf:params:jmap:filenode';

type Account = { name: string; isPersonal?: boolean; accountCapabilities?: Record<string, unknown> };

function mockFetchResponse(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function connect(serverCaps: string[], accounts: Record<string, Account>): Promise<JMAPClient> {
  const capabilities: Record<string, unknown> = { 'urn:ietf:params:jmap:core': {} };
  for (const cap of serverCaps) capabilities[cap] = {};
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(mockFetchResponse(200, {
    capabilities,
    accounts,
    primaryAccounts: { [MAIL]: 'me' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  }));
  const client = new JMAPClient('https://mail.example.com', 'me@example.com', 'pass');
  await client.connect();
  fetchSpy.mockReset();
  return client;
}

function capsOf(client: JMAPClient, id: string) {
  return client.getSharedAccounts().find((a) => a.id === id)?.capabilities;
}

describe('shared-account capabilities (#1239)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers only mail for a shared account on a mail-only server', async () => {
    const client = await connect([MAIL, 'urn:ietf:params:jmap:submission'], {
      me: { name: 'me', isPersonal: true, accountCapabilities: { [MAIL]: {} } },
      team: { name: 'team', isPersonal: false, accountCapabilities: { [MAIL]: {} } },
    });
    expect(capsOf(client, 'team')).toEqual({
      mail: true, sieve: false, calendars: false, contacts: false, filenode: false,
    });
    expect(client.supportsFiles('team')).toBe(false);
  });

  it('trusts a non-empty accountCapabilities over the server-wide capability', async () => {
    const client = await connect([MAIL, SIEVE, CALENDARS, CONTACTS, FILENODE], {
      me: { name: 'me', isPersonal: true, accountCapabilities: { [MAIL]: {}, [SIEVE]: {} } },
      managed: { name: 'managed', isPersonal: false, accountCapabilities: { [MAIL]: {}, [SIEVE]: {} } },
      readonly: { name: 'readonly', isPersonal: false, accountCapabilities: { [MAIL]: {} } },
    });
    expect(capsOf(client, 'managed')?.sieve).toBe(true);
    expect(capsOf(client, 'readonly')).toEqual({
      mail: true, sieve: false, calendars: false, contacts: false, filenode: false,
    });
    expect(client.getSieveAccounts().map((a) => a.id)).toEqual(['me', 'managed']);
    expect(client.supportsContacts('readonly')).toBe(false);
    expect(client.supportsCalendars('readonly')).toBe(false);
    expect(client.supportsFiles('readonly')).toBe(false);
  });

  it('falls back to the server capability for a shared account that lists none', async () => {
    const client = await connect([MAIL, CONTACTS], {
      me: { name: 'me', isPersonal: true, accountCapabilities: { [MAIL]: {}, [CONTACTS]: {} } },
      group: { name: 'group', isPersonal: false, accountCapabilities: {} },
    });
    expect(capsOf(client, 'group')).toEqual({
      mail: true, sieve: false, calendars: false, contacts: true, filenode: false,
    });
  });

  it('does not treat a missing isPersonal as shared', async () => {
    const client = await connect([MAIL, CONTACTS], {
      me: { name: 'me', isPersonal: true, accountCapabilities: { [MAIL]: {} } },
      other: { name: 'other' },
    });
    expect(client.getSharedAccounts().map((a) => a.id)).toEqual(['me']);
    expect(client.supportsContacts('other')).toBe(false);
  });

  it('does not send AddressBook/get to a shared account without contacts', async () => {
    const client = await connect([MAIL, CONTACTS], {
      me: { name: 'me', isPersonal: true, accountCapabilities: { [MAIL]: {}, [CONTACTS]: {} } },
      team: { name: 'team', isPersonal: false, accountCapabilities: { [MAIL]: {} } },
    });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      mockFetchResponse(200, { methodResponses: [['AddressBook/get', { list: [] }, '0']] }),
    );
    await client.getAllAddressBooks();
    const accountIds = spy.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string).methodCalls[0][1].accountId,
    );
    expect(accountIds).toEqual(['me']);
  });
});
