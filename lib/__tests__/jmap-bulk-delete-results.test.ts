import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient, RequestTimeoutError } from '../jmap/client';
import { jmapErrorFailedIds, jmapErrorProperties, jmapErrorType } from '../jmap/jmap-error';

const refused = { type: 'invalidProperties', properties: ['id'], description: 'Synthetic refusal' };
const response = (result: object) => new Response(JSON.stringify({ methodResponses: [['Email/set', result, '0']] }));
function setup(replies: Array<Response | Error>, size = 2) {
  const client = JMAPClient.withBearer('https://delete.example.invalid', 'synthetic-delete', 'test@example.invalid');
  Object.assign(client, { accountId: 'owner', apiUrl: 'https://delete.example.invalid/jmap',
    capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: size } } });
  const requests: string[][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://delete.example.invalid/jmap');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-delete');
    const [[method, args]] = JSON.parse(String(init.body)).methodCalls;
    expect(method).toBe('Email/set'); expect(args.accountId).toBe('owner');
    requests.push(args.destroy);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('Unexpected synthetic request');
    return reply;
  }));
  return { client, requests };
}
afterEach(() => vi.unstubAllGlobals());

describe('bulk permanent deletion confirmations', () => {
  it('keeps Promise<void> success and request limits when every ID is confirmed', async () => {
    const { client, requests } = setup([response({ destroyed: ['a', 'b'] }), response({ destroyed: ['c'] })]);
    await expect(client.batchDeleteEmails(['a', 'b', 'c'])).resolves.toBeUndefined();
    expect(requests).toEqual([['a', 'b'], ['c']]);
  });

  it('throws typed partial progress and preserves SetError metadata and cause', async () => {
    const { client } = setup([response({ destroyed: ['a'], notDestroyed: { b: refused } })]);
    const error = await client.batchDeleteEmails(['a', 'b']).catch(e => e);
    expect(error).toMatchObject({ name: 'IncompleteDeleteError', destroyedIds: ['a'], notDestroyed: { b: refused }, unknownIds: [], unattemptedIds: [] });
    expect(jmapErrorType(error)).toBe('invalidProperties'); expect(jmapErrorProperties(error)).toEqual(['id']);
    expect(jmapErrorFailedIds(error)).toEqual(['b']); expect(error.cause).toBeInstanceOf(Error);
  });

  it.each([{}, { destroyed: [] }, { destroyed: ['a'] }])('does not infer success from missing rejection maps: %j', async result => {
    const { client } = setup([response(result)]);
    const error = await client.batchDeleteEmails(['a', 'b']).catch(e => e);
    const destroyed = (result as { destroyed?: string[] }).destroyed ?? [];
    expect(error).toMatchObject({ name: 'IncompleteDeleteError', destroyedIds: destroyed,
      unknownIds: destroyed.length ? ['b'] : ['a', 'b'], unattemptedIds: [] });
  });

  it('ignores confirmations from an unexpected method response', async () => {
    const { client } = setup([new Response(JSON.stringify({ methodResponses: [['Email/get', { destroyed: ['a'] }, '0']] }))]);
    await expect(client.batchDeleteEmails(['a'])).rejects.toMatchObject({ destroyedIds: [], unknownIds: ['a'] });
  });

  it('retains earlier confirmations and stops after an incomplete response', async () => {
    const { client, requests } = setup([response({ destroyed: ['a', 'b'] }), response({ destroyed: ['d'], notDestroyed: { c: refused } })]);
    await expect(client.batchDeleteEmails(['a', 'b', 'c', 'd', 'e'])).rejects.toMatchObject({
      destroyedIds: ['a', 'b', 'd'], notDestroyed: { c: refused }, unknownIds: [], unattemptedIds: ['e'],
    });
    expect(requests).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('preserves method refusal details separately from a missing confirmation', async () => {
    const reply = new Response(JSON.stringify({ methodResponses: [['error', { type: 'accountReadOnly', description: 'Read only' }, '0']] }));
    const { client } = setup([response({ destroyed: ['a', 'b'] }), reply]);
    const error = await client.batchDeleteEmails(['a', 'b', 'c', 'd', 'e']).catch(e => e);
    expect(error).toMatchObject({ destroyedIds: ['a', 'b'], notDestroyed: { c: { type: 'accountReadOnly' }, d: { type: 'accountReadOnly' } }, unknownIds: [], unattemptedIds: ['e'] });
    expect(jmapErrorType(error)).toBe('accountReadOnly');
  });

  it('keeps the lost-response batch unknown, later IDs unattempted, and the transport cause', async () => {
    const cause = new RequestTimeoutError(30_000);
    const { client, requests } = setup([response({ destroyed: ['a', 'b'] }), cause]);
    const error = await client.batchDeleteEmails(['a', 'b', 'c', 'd', 'e']).catch(e => e);
    expect(error).toMatchObject({ destroyedIds: ['a', 'b'], notDestroyed: {}, unknownIds: ['c', 'd'], unattemptedIds: ['e'], cause });
    expect(requests).toHaveLength(2);
  });
});
