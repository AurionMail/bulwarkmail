import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import type { SortLevel } from '../message-list-order';

// Configurable message-list ordering (#718) maps onto Email/query sort
// comparators. Stalwart 0.16.8 reads `isAscending` on hasKeyword the other
// way round from RFC 8621, so the client probes the server once per account
// and flips the keyword comparators accordingly - instead of showing users the
// inverse of what they picked.

type MethodCall = [string, Record<string, unknown>, string];

const UNREAD_FIRST: SortLevel[] = [{ criterion: 'unread', direction: 'desc' }];

function makeSession(mailCaps: Record<string, unknown> = {}, accountCaps: Record<string, unknown> = {}) {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {} },
    accounts: { 'acct-1': { name: 'test', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:mail': mailCaps, ...accountCaps } } },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const seenEmail = { id: 'read-1', keywords: { $seen: true }, receivedAt: '2026-01-02T00:00:00Z', mailboxIds: {}, threadId: 't', size: 1, hasAttachment: false };
const unseenEmail = { id: 'unread-1', keywords: {}, receivedAt: '2026-01-01T00:00:00Z', mailboxIds: {}, threadId: 't', size: 1, hasAttachment: false };

/**
 * Answers the polarity probe (call ids asc/desc/get) per `server`, and every
 * folder query (call ids 0/1) with a fixed page, optionally refusing keyword
 * comparators with unsupportedSort.
 */
function replyFor(server: 'rfc' | 'inverted' | 'homogeneous', opts: { refuseKeywordSort?: boolean } = {}) {
  return (methodCalls: MethodCall[]) => {
    if (methodCalls[0][2] === 'asc') {
      const ascFirst = server === 'inverted' ? seenEmail : unseenEmail;
      const descFirst = server === 'homogeneous' ? ascFirst : (server === 'inverted' ? unseenEmail : seenEmail);
      return {
        methodResponses: [
          ['Email/query', { ids: [ascFirst.id] }, 'asc'],
          ['Email/query', { ids: [descFirst.id] }, 'desc'],
          ['Email/get', { list: [{ id: ascFirst.id, keywords: ascFirst.keywords }] }, 'get'],
        ],
      };
    }
    const sort = methodCalls[0][1].sort as Array<{ property: string }>;
    if (opts.refuseKeywordSort && sort.some(s => s.property === 'hasKeyword')) {
      return { methodResponses: [['error', { type: 'unsupportedSort' }, '0'], ['error', { type: 'invalidResultReference' }, '1']] };
    }
    return {
      methodResponses: [
        ['Email/query', { ids: [seenEmail.id, unseenEmail.id], total: 2 }, '0'],
        ['Email/get', { list: [seenEmail, unseenEmail] }, '1'],
      ],
    };
  };
}

describe('JMAPClient list ordering', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function connectedClient(mailCaps?: Record<string, unknown>, accountCaps?: Record<string, unknown>): Promise<JMAPClient> {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession(mailCaps, accountCaps)));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token123', 'user@test.com');
    await client.connect();
    fetchSpy.mockReset();
    return client;
  }

  function recordRequests(reply: (methodCalls: MethodCall[]) => unknown) {
    const sent: MethodCall[][] = [];
    fetchSpy.mockImplementation((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body.methodCalls);
      return jsonResponse(reply(body.methodCalls));
    }) as never);
    return sent;
  }

  const folderQueries = (sent: MethodCall[][]) => sent.filter(calls => calls[0][2] === '0').map(calls => calls[0][1].sort);
  const probes = (sent: MethodCall[][]) => sent.filter(calls => calls[0][2] === 'asc');

  it('sends the RFC polarity to a server that follows RFC 8621', async () => {
    const client = await connectedClient();
    const sent = recordRequests(replyFor('rfc'));

    await client.getEmails('inbox', undefined, 50, 0, undefined, true, undefined, UNREAD_FIRST);

    expect(probes(sent)).toHaveLength(1);
    expect(folderQueries(sent)).toEqual([[
      { property: 'hasKeyword', keyword: '$pinned', isAscending: false },
      { property: 'hasKeyword', keyword: '$seen', isAscending: true },
      { property: 'receivedAt', isAscending: false },
    ]]);
  });

  it('flips the keyword comparators for a server with inverted polarity (Stalwart 0.16.8)', async () => {
    const client = await connectedClient();
    const sent = recordRequests(replyFor('inverted'));

    const { emails } = await client.getEmails('inbox', undefined, 50, 0, undefined, true, undefined, UNREAD_FIRST);
    await client.getEmails('inbox', undefined, 50, 50, undefined, true, undefined, UNREAD_FIRST);

    // One probe per account and session, not per page.
    expect(probes(sent)).toHaveLength(1);
    expect(folderQueries(sent)).toEqual([
      [
        { property: 'hasKeyword', keyword: '$pinned', isAscending: true },
        { property: 'hasKeyword', keyword: '$seen', isAscending: false },
        { property: 'receivedAt', isAscending: false },
      ],
      [
        { property: 'hasKeyword', keyword: '$pinned', isAscending: true },
        { property: 'hasKeyword', keyword: '$seen', isAscending: false },
        { property: 'receivedAt', isAscending: false },
      ],
    ]);
    // The within-page safety sort mirrors the requested order.
    expect(emails.map(e => e.id)).toEqual(['unread-1', 'read-1']);
  });

  it('falls back to the RFC polarity when every message is in the same read state', async () => {
    const client = await connectedClient();
    const sent = recordRequests(replyFor('homogeneous'));

    await client.getEmails('inbox', undefined, 50, 0, undefined, true, undefined, UNREAD_FIRST);

    expect(folderQueries(sent)[0]).toEqual([
      { property: 'hasKeyword', keyword: '$pinned', isAscending: false },
      { property: 'hasKeyword', keyword: '$seen', isAscending: true },
      { property: 'receivedAt', isAscending: false },
    ]);
  });

  it('skips the probe and the comparators when the order needs no keyword sort', async () => {
    const client = await connectedClient();
    const sent = recordRequests(replyFor('rfc'));

    await client.getEmails('inbox', undefined, 50, 0, undefined, false, undefined, [{ criterion: 'size', direction: 'desc' }]);

    expect(probes(sent)).toHaveLength(0);
    expect(folderQueries(sent)).toEqual([[
      { property: 'size', isAscending: false },
      { property: 'receivedAt', isAscending: false },
    ]]);
  });

  it('keeps the server order when sorting by date sent (#1219)', async () => {
    const client = await connectedClient();
    // Sent first, delivered last: received order and sent order disagree.
    const delayed = { id: 'delayed', keywords: {}, sentAt: '2026-01-01T00:00:00Z', receivedAt: '2026-01-05T00:00:00Z', mailboxIds: {}, threadId: 't1', size: 1, hasAttachment: false };
    const prompt = { id: 'prompt', keywords: {}, sentAt: '2026-01-03T00:00:00Z', receivedAt: '2026-01-03T00:00:00Z', mailboxIds: {}, threadId: 't2', size: 1, hasAttachment: false };
    const sent = recordRequests((methodCalls) => {
      // Like a real server, answer only the properties the client asked for.
      const properties = methodCalls[1][1].properties as string[];
      const pick = (email: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(email).filter(([key]) => properties.includes(key)));
      return {
        methodResponses: [
          ['Email/query', { ids: [prompt.id, delayed.id], total: 2 }, '0'],
          ['Email/get', { list: [pick(prompt), pick(delayed)] }, '1'],
        ],
      };
    });

    const { emails } = await client.getEmails('inbox', undefined, 50, 0, undefined, false, undefined, [{ criterion: 'sentAt', direction: 'desc' }]);

    expect(folderQueries(sent)).toEqual([[
      { property: 'sentAt', isAscending: false },
      { property: 'receivedAt', isAscending: false },
    ]]);
    expect(emails.map(e => e.id)).toEqual(['prompt', 'delayed']);
  });

  it('omits keyword comparators when the server advertises sort options without hasKeyword', async () => {
    const client = await connectedClient({ emailQuerySortOptions: ['receivedAt', 'size'] });
    const sent = recordRequests(replyFor('rfc'));

    expect(client.getEmailQuerySortOptions()).toEqual(['receivedAt', 'size']);
    const { emails } = await client.getEmails('inbox', undefined, 50, 0, undefined, true, undefined, UNREAD_FIRST);

    expect(probes(sent)).toHaveLength(0);
    expect(folderQueries(sent)).toEqual([[{ property: 'receivedAt', isAscending: false }]]);
    expect(emails).toHaveLength(2);
  });

  it('retries without keyword comparators after an unsupportedSort refusal and remembers it', async () => {
    const client = await connectedClient();
    const sent = recordRequests(replyFor('rfc', { refuseKeywordSort: true }));

    const { emails } = await client.getEmails('inbox', undefined, 50, 0, undefined, true, undefined, UNREAD_FIRST);
    await client.getEmails('inbox', undefined, 50, 50, undefined, true, undefined, UNREAD_FIRST);

    expect(emails).toHaveLength(2);
    expect(folderQueries(sent)).toEqual([
      [
        { property: 'hasKeyword', keyword: '$pinned', isAscending: false },
        { property: 'hasKeyword', keyword: '$seen', isAscending: true },
        { property: 'receivedAt', isAscending: false },
      ],
      [{ property: 'receivedAt', isAscending: false }],
      [{ property: 'receivedAt', isAscending: false }],
    ]);
  });

  describe('sender and subject orders', () => {
    // Every Stalwart 1.0 account lists principals:owner in its
    // accountCapabilities (api/session.rs jmap_account); 0.16 lists it nowhere.
    const STALWART_1_0 = {
      'urn:ietf:params:jmap:principals:owner': { accountIdForPrincipal: 'acct-1', principalId: 'acct-1' },
    };
    const message = (id: string, name: string, address: string, subject: string, receivedAt = '2026-01-01T00:00:00Z') => ({
      id, threadId: `t-${id}`, keywords: { $seen: true }, receivedAt, mailboxIds: {}, size: 1, hasAttachment: false,
      from: address ? [{ name, email: address }] : [], subject,
    });
    type Message = ReturnType<typeof message>;
    const zoe = message('zoe', 'Zoe', 'zoe@example.org', 'Zebra report', '2026-01-01T00:00:00Z');
    const emile = message('emile', 'Émile', 'emile@example.org', 'Éclair', '2026-01-02T00:00:00Z');
    const nobody = message('nobody', '', '', '', '2026-01-03T00:00:00Z');
    // The senders and subjects of a live check against both servers.
    const adam = message('adam', 'Adam', 'adam@x.test', 'Banana split');
    const bea = message('bea', 'bea', 'bea@x.test', 'aardvark');
    const carla = message('carla', 'Carla', 'carla@x.test', 'Mango');
    const dave = message('dave', 'dave', 'dave@x.test', 'apple pie');
    const eve = message('eve', 'Eve', 'eve@x.test', 'Re: cherry tart');
    const zed = message('zed', 'zed', 'zed@x.test', 'Zebra report');

    /** A folder query answered in `queryOrder`, with Email/get listing the objects in `getOrder`. */
    function replyInOrder(queryOrder: Message[], getOrder: Message[] = [...queryOrder].reverse()) {
      return (methodCalls: MethodCall[]) => ({
        methodResponses: [
          ['Email/query', { ids: queryOrder.map((e) => e.id), total: queryOrder.length }, methodCalls[0][2]],
          ['Email/get', { list: getOrder }, methodCalls[1][2]],
        ],
      });
    }
    const listed = async (client: JMAPClient, order: SortLevel[]) =>
      (await client.getEmails('inbox', undefined, 50, 0, undefined, false, undefined, order)).emails.map((e) => e.id);

    it('keeps the sender order of Stalwart 1.0: lowercased byte order, the empty sender last', async () => {
      // 1.0 ranks lowercased "name address" keys by bytes, so "zoe ..." sorts
      // before "émile ...". A client re-sort (localeCompare) would swap them.
      const client = await connectedClient({}, STALWART_1_0);
      const sent = recordRequests(replyInOrder([zoe, emile, nobody], [nobody, emile, zoe]));

      expect(await listed(client, [{ criterion: 'from', direction: 'asc' }])).toEqual(['zoe', 'emile', 'nobody']);
      expect(folderQueries(sent)).toEqual([[
        { property: 'from', isAscending: true },
        { property: 'receivedAt', isAscending: false },
      ]]);
    });

    it('keeps the subject order of Stalwart 1.0 behind another level', async () => {
      const client = await connectedClient({}, STALWART_1_0);
      recordRequests(replyInOrder([zed, emile, nobody]));

      expect(await listed(client, [
        { criterion: 'size', direction: 'desc' },
        { criterion: 'subject', direction: 'asc' },
      ])).toEqual(['zed', 'emile', 'nobody']);
    });

    it('re-sorts a sender page of Stalwart 0.16 case-insensitively, the empty sender last', async () => {
      // 0.16 compares the raw bytes: capitals first, "Eve" before "bea".
      const client = await connectedClient();
      recordRequests(replyInOrder([adam, carla, eve, bea, dave, zed, nobody]));

      expect(await listed(client, [{ criterion: 'from', direction: 'asc' }]))
        .toEqual(['adam', 'bea', 'carla', 'dave', 'eve', 'zed', 'nobody']);
    });

    it('re-sorts a subject page of Stalwart 0.16 on the thread name, the empty subject last', async () => {
      // 0.16 sorts the thread name ("cherry tart" for "Re: cherry tart") by raw
      // bytes; both versions put a message without a subject last, descending too.
      const client = await connectedClient();
      recordRequests(replyInOrder([adam, carla, zed, bea, dave, eve, nobody]));

      expect(await listed(client, [{ criterion: 'subject', direction: 'asc' }]))
        .toEqual(['bea', 'dave', 'adam', 'eve', 'carla', 'zed', 'nobody']);

      recordRequests(replyInOrder([eve, dave, bea, zed, carla, adam, nobody]));
      expect(await listed(client, [{ criterion: 'subject', direction: 'desc' }]))
        .toEqual(['zed', 'carla', 'eve', 'adam', 'dave', 'bea', 'nobody']);
    });

    it('still re-sorts a page ordered without text levels, on 0.16 and 1.0', async () => {
      // The safety net for servers that ignore the sort stays for everything else.
      for (const accountCaps of [{}, STALWART_1_0]) {
        const client = await connectedClient({}, accountCaps);
        recordRequests(replyInOrder([zoe, emile, nobody], [zoe, emile, nobody]));

        expect(await listed(client, [{ criterion: 'receivedAt', direction: 'desc' }])).toEqual(['nobody', 'emile', 'zoe']);
      }
    });
  });
});
