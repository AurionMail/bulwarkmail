import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// Blob/get (RFC 9404) as Stalwart 1.0 answers it (jmap/src/blob/get.rs): the
// id always comes back, `size` is the whole blob, and ids it can't read go
// to notFound. A vCard export of a large address book fetches its photos
// this way instead of one download each.

const MiB = 1024 * 1024;
const BLOB = 'urn:ietf:params:jmap:blob';

function makeSession(options: { blob?: boolean; maxObjectsInGet?: number } = {}) {
  const { blob = true, maxObjectsInGet = 500 } = options;
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': { maxObjectsInGet, maxCallsInRequest: 16, maxConcurrentRequests: 4 },
      ...(blob ? { [BLOB]: {} } : {}),
    },
    accounts: {
      a: {
        name: 'user@test.com',
        isPersonal: true,
        accountCapabilities: blob
          ? { [BLOB]: { supportedTypeNames: ['Email', 'Thread', 'SieveScript', 'CalendarEvent', 'ContactCard'] } }
          : {},
      },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a' },
    apiUrl: 'https://mail.example.com/jmap/',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Call = [string, { accountId: string; ids: string[]; properties: string[] }, string];

describe('JMAPClient.getBlobsAsBase64', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function connectedClient(options?: Parameters<typeof makeSession>[0]): Promise<JMAPClient> {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makeSession(options)));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token123', 'user@test.com');
    await client.connect();
    fetchSpy.mockReset();
    return client;
  }

  /** A 1.0 server holding `blobs` (id -> size); records every request. */
  function serve(blobs: Record<string, number>, refuse?: (call: Call, index: number) => Response | undefined) {
    const requests: Array<{ using: string[]; call: Call }> = [];
    fetchSpy.mockImplementation((async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const call = body.methodCalls[0] as Call;
      requests.push({ using: body.using, call });
      const refused = refuse?.(call, requests.length - 1);
      if (refused) return refused;
      const [, args, callId] = call;
      const found = args.ids.filter((id) => id in blobs);
      return jsonResponse({
        methodResponses: [['Blob/get', {
          accountId: args.accountId,
          list: found.map((id) => args.properties.includes('size')
            ? { size: blobs[id], id }
            : { 'data:asBase64': btoa(id), id }),
          notFound: args.ids.filter((id) => !(id in blobs)),
        }, callId]],
      });
    }) as never);
    return requests;
  }

  it('fetches the photos of a card with one Blob/get on Stalwart 1.0', async () => {
    const client = await connectedClient();
    const requests = serve({ dbcPhoto: 40_000, dbcLogo: 2_000 });

    const batch = await client.getBlobsAsBase64(['dbcPhoto', 'dbcLogo', 'dbcPhoto'], 'shared-1');

    expect(requests).toHaveLength(1);
    expect(requests[0].using).toEqual(['urn:ietf:params:jmap:core', BLOB]);
    expect(requests[0].call[0]).toBe('Blob/get');
    expect(requests[0].call[1]).toEqual({ accountId: 'shared-1', ids: ['dbcPhoto', 'dbcLogo'], properties: ['data:asBase64'] });
    expect(batch).toEqual({ data: new Map([['dbcPhoto', btoa('dbcPhoto')], ['dbcLogo', btoa('dbcLogo')]]), failed: [] });
  });

  it('asks for the sizes first and fetches the data in requests of about 4 MiB', async () => {
    const client = await connectedClient();
    const requests = serve({ a: 3 * MiB, b: 2 * MiB, c: 2 * MiB, d: 5 * MiB, e: 1024 });

    const batch = await client.getBlobsAsBase64(['a', 'b', 'gone', 'c', 'd', 'e']);

    expect(requests.map(({ call }) => [call[1].properties, call[1].ids])).toEqual([
      [['size'], ['a', 'b', 'gone', 'c', 'd', 'e']],
      // A blob larger than the budget goes alone; what the server doesn't have is not asked for again.
      [['data:asBase64'], ['a']],
      [['data:asBase64'], ['b', 'c']],
      [['data:asBase64'], ['d']],
      [['data:asBase64'], ['e']],
    ]);
    expect(requests.every(({ call }) => call[1].accountId === 'a')).toBe(true);
    expect([...batch!.data.keys()]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(batch!.failed).toEqual([]);
  });

  it('keeps every request within maxObjectsInGet', async () => {
    const client = await connectedClient({ maxObjectsInGet: 2 });
    const requests = serve({ a: 10, b: 10, c: 10 });

    const batch = await client.getBlobsAsBase64(['a', 'b', 'c']);

    expect(requests.map(({ call }) => [call[1].properties[0], call[1].ids])).toEqual([
      ['size', ['a', 'b']],
      ['size', ['c']],
      ['data:asBase64', ['a', 'b']],
      ['data:asBase64', ['c']],
    ]);
    expect(batch!.data.size).toBe(3);
  });

  it('asks nothing when the session does not advertise the blob capability', async () => {
    const client = await connectedClient({ blob: false });

    expect(await client.getBlobsAsBase64(['a'])).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists the blobs a refused request left unfetched, keeping what came before', async () => {
    const client = await connectedClient();
    serve({ a: 3 * MiB, b: 3 * MiB, c: 3 * MiB }, (_call, index) => (index === 2
      ? jsonResponse({ methodResponses: [['error', { type: 'forbidden', description: 'You are not authorized to perform this action' }, '0']] })
      : undefined));

    const batch = await client.getBlobsAsBase64(['a', 'b', 'c']);

    expect([...batch!.data.keys()]).toEqual(['a']);
    expect(batch!.failed).toEqual(['b', 'c']);
  });

  it('lists every blob as unfetched when the sizes cannot be read', async () => {
    const client = await connectedClient();
    serve({ a: 10, b: 10, c: 10 }, () => jsonResponse({ type: 'about:blank', status: 500 }, 500));

    const batch = await client.getBlobsAsBase64(['a', 'b', 'c']);

    expect(batch).toEqual({ data: new Map(), failed: ['a', 'b', 'c'] });
  });
});
