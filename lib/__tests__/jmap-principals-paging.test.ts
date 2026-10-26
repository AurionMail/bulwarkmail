import { describe, it, expect, vi, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

type Call = [string, Record<string, unknown>, string];
type MethodResponse = [string, Record<string, unknown>, string];

const PROPERTIES = ['id', 'type', 'name', 'description', 'email'];

function makeClient() {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, {
    accountId: 'me',
    capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInGet: 500 }, 'urn:ietf:params:jmap:principals': {} },
  });
  vi.spyOn(client as unknown as { supportsPrincipals: () => boolean }, 'supportsPrincipals').mockReturnValue(true);
  return client;
}

function answer(client: JMAPClient, handler: (calls: Call[]) => MethodResponse[]) {
  const requests: Call[][] = [];
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (calls: Call[]) => {
      requests.push(calls);
      return { methodResponses: handler(calls) };
    });
  return requests;
}

// Stalwart 1.0 with directory queries off (the default): the query is refused
// before any filter runs, and the chained get cannot resolve its reference.
const DIRECTORY_OFF: MethodResponse[] = [
  ['error', { type: 'forbidden', description: 'The administrator has disabled directory queries.' }, '0'],
  ['error', { type: 'invalidResultReference', description: 'Result reference to 0#Principal/query not found.' }, '1'],
];

// A role without the principal permissions, on 0.16 and 1.0 alike: the
// dispatcher refuses before the handler runs.
const NOT_AUTHORIZED: MethodResponse[] = [
  ['error', { type: 'forbidden', description: 'You are not authorized to perform this action' }, '0'],
  ['error', { type: 'invalidResultReference', description: 'Result reference to 0#Principal/query not found.' }, '1'],
];

describe('getPrincipals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pages the directory instead of asking Principal/get for every id at once', async () => {
    const ids = Array.from({ length: 1203 }, (_, i) => `p${i}`);
    const client = makeClient();
    const queries: Record<string, unknown>[] = [];
    answer(client, (calls) => {
      const args = calls[0][1];
      queries.push(args);
      const page = ids.slice(args.position as number, (args.position as number) + (args.limit as number));
      return [
        ['Principal/query', { ids: page }, '0'],
        ['Principal/get', { list: page.map((id) => ({ id, name: id })) }, '1'],
      ];
    });

    const principals = await client.getPrincipals();
    expect(principals).toHaveLength(1203);
    expect(queries.map((q) => [q.position, q.limit])).toEqual([[0, 500], [500, 500], [1000, 500]]);
  });

  function forbiddenClient() {
    const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(client, {
      accountId: 'me',
      capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInGet: 500 }, 'urn:ietf:params:jmap:principals': {} },
    });
    vi.spyOn(client as unknown as { supportsPrincipals: () => boolean }, 'supportsPrincipals').mockReturnValue(true);
    vi.spyOn(client as unknown as { request: () => Promise<unknown> }, 'request').mockResolvedValue({
      methodResponses: [
        ['error', { type: 'forbidden', description: 'Directory queries are disabled' }, '0'],
        ['error', { type: 'forbidden' }, '1'],
      ],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    return client;
  }

  it('reports a refused directory query when asked to', async () => {
    await expect(forbiddenClient().getPrincipals(undefined, { throwOnError: true }))
      .rejects.toMatchObject({ name: 'PrincipalsRequestError', type: 'forbidden' });
  });

  it('still answers an empty list to callers that did not ask', async () => {
    await expect(forbiddenClient().getPrincipals()).resolves.toEqual([]);
  });
});

describe('listPrincipals', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks only for the properties it reads and reports a complete listing on Stalwart 0.16', async () => {
    const client = makeClient();
    const requests = answer(client, () => [
      ['Principal/query', { ids: ['a', 'b'] }, '0'],
      ['Principal/get', { list: [
        { id: 'a', type: 'individual', name: 'anna@example.com', description: 'Anna', email: 'anna@example.com' },
        { id: 'b', type: 'group', name: 'sales@example.com', description: 'Sales', email: 'sales@example.com' },
      ], notFound: [] }, '1'],
    ]);

    const listing = await client.listPrincipals();

    expect(listing.status).toBe('ok');
    expect(listing.principals.map((p) => [p.id, p.accountId])).toEqual([['a', 'me'], ['b', 'me']]);
    expect(requests[0][1]).toEqual(['Principal/get', {
      accountId: 'me',
      '#ids': { resultOf: '0', name: 'Principal/query', path: '/ids' },
      properties: PROPERTIES,
    }, '1']);
  });

  it('falls back to the principals the user knows when Stalwart 1.0 has directory queries off', async () => {
    const client = makeClient();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const requests = answer(client, (calls) => {
      if (calls[0][0] === 'Principal/query') return DIRECTORY_OFF;
      // Principal/get without ids: own account, a group and someone who shared.
      return [['Principal/get', { accountId: 'me', state: 'n', list: [
        { id: 'me', type: 'individual', name: 'me@example.com', description: 'Me', email: 'me@example.com' },
        { id: 'grp', type: 'group', name: 'sales@example.com', description: 'Sales', email: 'sales@example.com' },
        { id: 'jane', type: 'individual', name: 'jane@example.com', description: 'Jane', email: 'jane@example.com' },
      ], notFound: [] }, '0']];
    });

    const listing = await client.listPrincipals();

    expect(listing.status).toBe('restricted');
    expect(listing.directoryQueriesOff).toBe(true);
    expect(listing.principals.map((p) => p.id)).toEqual(['me', 'grp', 'jane']);
    expect(listing.principals.every((p) => p.accountId === 'me')).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual([['Principal/get', { accountId: 'me', ids: null, properties: PROPERTIES }, '0']]);
    // The refusal is expected on a default 1.0 install, not an error.
    expect(errors).not.toHaveBeenCalled();
  });

  it('is restricted and empty when the role may not read principals either (0.16 and 1.0)', async () => {
    const client = makeClient();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer(client, (calls) => (calls[0][0] === 'Principal/query'
      ? NOT_AUTHORIZED
      : [['error', { type: 'forbidden', description: 'You are not authorized to perform this action' }, '0']]));

    expect(await client.listPrincipals()).toEqual({ principals: [], status: 'restricted' });
  });

  it('does not blame the directory setting when a 0.16 role may get principals but not query them', async () => {
    // 0.16's Principal/get without ids returns every principal (get.rs), and
    // its directory setting has no effect over JMAP.
    const client = makeClient();
    answer(client, (calls) => (calls[0][0] === 'Principal/query'
      ? NOT_AUTHORIZED
      : [['Principal/get', { accountId: 'me', state: 'n', list: [
        { id: 'me', type: 'individual', name: 'me@example.com', description: null, email: 'me@example.com' },
        { id: 'a', type: 'individual', name: 'anna@example.com', description: null, email: 'anna@example.com' },
        { id: 'b', type: 'individual', name: 'bob@example.com', description: null, email: 'bob@example.com' },
      ], notFound: [] }, '0']]));

    const listing = await client.listPrincipals();

    expect(listing.status).toBe('restricted');
    expect(listing.directoryQueriesOff).toBeUndefined();
    expect(listing.principals.map((p) => p.id)).toEqual(['me', 'a', 'b']);
  });

  it('keeps the pages already fetched when a later page fails', async () => {
    const client = makeClient();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstPage = Array.from({ length: 500 }, (_, i) => `p${i}`);
    answer(client, (calls) => (calls[0][1].position === 0
      ? [
        ['Principal/query', { ids: firstPage }, '0'],
        ['Principal/get', { list: firstPage.map((id) => ({ id, name: id })) }, '1'],
      ]
      : [
        ['error', { type: 'serverUnavailable', description: 'This server is temporarily unavailable.' }, '0'],
        ['error', { type: 'invalidResultReference', description: 'Result reference to 0#Principal/query not found.' }, '1'],
      ]));

    const listing = await client.listPrincipals();

    expect(listing.status).toBe('error');
    expect(listing.principals).toHaveLength(500);
  });

  it('reports an HTTP 500 as a failed listing, not an empty directory', async () => {
    const session = {
      capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:principals': {} },
      accounts: { me: { name: 'me@example.com', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:principals': { currentUserPrincipalId: 'me' } } } },
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'me' },
      apiUrl: 'https://jmap.example.com/jmap/',
      downloadUrl: 'https://jmap.example.com/jmap/download/{accountId}/{blobId}/{name}',
      uploadUrl: 'https://jmap.example.com/jmap/upload/{accountId}/',
      eventSourceUrl: '',
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new JMAPClient('https://jmap.example.com', 'me@example.com', 'pass');
    await client.connect();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockImplementation(async () => new Response('Internal Server Error', { status: 500 }));

    expect(await client.listPrincipals()).toEqual({ principals: [], status: 'error' });
    expect(await client.getPrincipals()).toEqual([]);
    client.disconnect();
  });
});
