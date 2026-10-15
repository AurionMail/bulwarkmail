import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// A folder page brings its conversation sizes along: Thread/get rides on the
// list request through a wildcard back-reference (/list/*/threadId), so the
// list does not need a second round trip (and a second render) for them.

type MethodCall = [string, Record<string, unknown>, string];

const session = {
  capabilities: { 'urn:ietf:params:jmap:core': {} },
  accounts: { 'acct-1': { name: 'test', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } } },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
  apiUrl: 'https://mail.example.com/jmap/api',
  downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
  uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
  eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const page = [
  { id: 'e1', threadId: 't1', keywords: {}, receivedAt: '2026-01-02T00:00:00Z', mailboxIds: {}, size: 1, hasAttachment: false },
  { id: 'e2', threadId: 't2', keywords: {}, receivedAt: '2026-01-01T00:00:00Z', mailboxIds: {}, size: 1, hasAttachment: false },
];

describe('JMAPClient.getEmails thread counts', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const sent: MethodCall[][] = [];

  beforeEach(() => {
    sent.length = 0;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  async function client(threadAnswer: unknown) {
    fetchSpy.mockResolvedValueOnce(json(session));
    const c = JMAPClient.withBearer('https://mail.example.com', 'token', 'user@test.com');
    await c.connect();
    fetchSpy.mockReset();
    fetchSpy.mockImplementation((async (_url: string, init: RequestInit) => {
      const calls = JSON.parse(init.body as string).methodCalls as MethodCall[];
      sent.push(calls);
      if (calls[0][2] === 'asc') {
        return json({ methodResponses: [['Email/query', { ids: [] }, 'asc'], ['Email/query', { ids: [] }, 'desc'], ['Email/get', { list: [] }, 'get']] });
      }
      return json({ methodResponses: [['Email/query', { ids: ['e1', 'e2'], total: 2 }, '0'], ['Email/get', { state: 's1', list: page }, '1'], threadAnswer] });
    }) as never);
    return c;
  }

  it('asks for the threads of the page in the same request and returns their sizes', async () => {
    const c = await client(['Thread/get', { list: [{ id: 't1', emailIds: ['e1', 'x', 'y'] }, { id: 't2', emailIds: ['e2'] }] }, '2']);

    const result = await c.getEmails('inbox', undefined, 50, 0);

    const list = sent.find((calls) => calls[0][2] === '0')!;
    expect(list[2]).toEqual(['Thread/get', {
      accountId: 'acct-1',
      '#ids': { resultOf: '1', name: 'Email/get', path: '/list/*/threadId' },
    }, '2']);
    expect(result.threadCounts).toEqual({ t1: 3, t2: 1 });
  });

  it('returns no counts when the server could not answer the chained call', async () => {
    const c = await client(['error', { type: 'invalidResultReference' }, '2']);
    const result = await c.getEmails('inbox', undefined, 50, 0);
    expect(result.emails.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(result.threadCounts).toBeUndefined();
  });
});
