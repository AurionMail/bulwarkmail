import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapErrorType } from '../jmap/jmap-error';
import { ACCOUNT, ARCHIVED_FILE, LICENSE_REFUSAL, archivedEmail } from '../recovery/__tests__/fixtures';

type Call = [string, Record<string, unknown>, string];
type Body = { using: string[]; methodCalls: Call[] };

function client(core: Record<string, number> = {}, stalwart = true) {
  const c = new JMAPClient('https://jmap.example.com', 'user', 'pass');
  const accounts = {
    [ACCOUNT]: {
      name: 'org-alice@example.org', isPersonal: true,
      accountCapabilities: stalwart ? { 'urn:ietf:params:jmap:mail': {}, 'urn:stalwart:jmap': {} } : { 'urn:ietf:params:jmap:mail': {} },
    },
  };
  Object.assign(c, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: ACCOUNT,
    capabilities: { 'urn:ietf:params:jmap:core': { maxCallsInRequest: 16, maxObjectsInGet: 500, maxObjectsInSet: 500, ...core } },
    accounts,
    session: { accounts },
  });
  return c;
}

function respondWith(handler: (body: Body) => unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string) as Body;
    const response = handler(body);
    return { ok: true, status: 200, text: async () => JSON.stringify(response), json: async () => response } as Response;
  });
}

const bodies = (spy: ReturnType<typeof respondWith>) => spy.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Body);

afterEach(() => vi.restoreAllMocks());

describe('JMAPClient archived items', () => {
  it('advertises them only on Stalwart', () => {
    expect(client().advertisesArchivedItems()).toBe(true);
    expect(client({}, false).advertisesArchivedItems()).toBe(false);
  });

  it('asks x:ArchivedItem/query alone, with the Stalwart capability', async () => {
    const spy = respondWith(() => ({ methodResponses: [['x:ArchivedItem/query', { ids: ['a', 'b'], total: 2 }, 'q']] }));
    await expect(client().queryArchivedItemIds()).resolves.toEqual(['a', 'b']);
    const [body] = bodies(spy);
    expect(body.methodCalls).toEqual([['x:ArchivedItem/query', { accountId: ACCOUNT }, 'q']]);
    expect(body.using).toEqual(['urn:ietf:params:jmap:core', 'urn:stalwart:jmap']);
  });

  it('throws the refusal with its type when the server has no license', async () => {
    respondWith(() => ({ methodResponses: [['error', LICENSE_REFUSAL, 'q']] }));
    const error = await client().queryArchivedItemIds().catch((e: unknown) => e);
    expect(jmapErrorType(error)).toBe('forbidden');
  });

  it('reads the items in gets of at most maxObjectsInGet, keeping only messages', async () => {
    const spy = respondWith((body) => {
      const [method, args, id] = body.methodCalls[0];
      if (method === 'x:ArchivedItem/query') return { methodResponses: [['x:ArchivedItem/query', { ids: ['a', 'b', 'f1'] }, id]] };
      return {
        methodResponses: body.methodCalls.map(([, a, callId]) => [
          'x:ArchivedItem/get',
          { accountId: args.accountId, list: (a.ids as string[]).map((i) => (i === 'f1' ? ARCHIVED_FILE : archivedEmail(i))), notFound: [] },
          callId,
        ]),
      };
    });
    const items = await client({ maxObjectsInGet: 2 }).listArchivedEmails();
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
    const sent = bodies(spy);
    expect(sent).toHaveLength(2);
    expect(sent[1].methodCalls).toEqual([
      ['x:ArchivedItem/get', { accountId: ACCOUNT, ids: ['a', 'b'] }, 'g0'],
      ['x:ArchivedItem/get', { accountId: ACCOUNT, ids: ['f1'] }, 'g1'],
    ]);
  });

  it('sends no get when the archive is empty', async () => {
    const spy = respondWith(() => ({ methodResponses: [['x:ArchivedItem/query', { ids: [] }, 'q']] }));
    await expect(client().listArchivedEmails()).resolves.toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('restores with requestRestore and reports a partial failure per item', async () => {
    const spy = respondWith((body) => ({
      methodResponses: body.methodCalls.map(([, args, id]) => {
        const ids = Object.keys(args.update as object);
        return ['x:ArchivedItem/set', {
          updated: Object.fromEntries(ids.filter((i) => i !== 'b').map((i) => [i, null])),
          notUpdated: ids.includes('b') ? { b: { type: 'notFound' } } : {},
        }, id];
      }),
    }));
    const results = await client().restoreArchivedItems(['a', 'b']);
    expect(results).toEqual([{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'notFound' }]);
    expect(bodies(spy)[0].methodCalls).toEqual([
      ['x:ArchivedItem/set', { accountId: ACCOUNT, update: { a: { status: 'requestRestore' }, b: { status: 'requestRestore' } } }, 'r0'],
    ]);
  });

  it('fails every item of a request that fails instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const results = await client().restoreArchivedItems(['a']);
    expect(results).toEqual([{ id: 'a', ok: false, error: expect.any(String) }]);
  });
});
