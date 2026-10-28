import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';

// Blob/copy (RFC 8620 §6.3): Save to Files puts an attachment of a shared
// mailbox into the user's own Files account without a download.

function createClient(): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user', 'pass');
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/jmap/',
    accountId: 'a',
    session: {
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a' },
      accounts: { a: { name: 'me', isPersonal: true, accountCapabilities: {} }, b: { name: 'team', isPersonal: false, accountCapabilities: {} } },
    },
  });
  return client;
}

function answer(result: object) {
  const calls: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)).methodCalls[0]);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(JSON.stringify({ methodResponses: [['Blob/copy', result, 'bc0']] })),
      json: () => Promise.resolve({ methodResponses: [['Blob/copy', result, 'bc0']] }),
    } as Response;
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('copyBlobs', () => {
  it('asks the server to copy the blob into the other account and returns its new id', async () => {
    const calls = answer({ fromAccountId: 'b', accountId: 'a', copied: { Gteam1: 'Gmine1' }, notCopied: null });
    const copied = await createClient().copyBlobs('b', ['Gteam1'], 'a');
    expect(calls).toEqual([['Blob/copy', { fromAccountId: 'b', accountId: 'a', blobIds: ['Gteam1'] }, 'bc0']]);
    expect(copied).toEqual({ Gteam1: 'Gmine1' });
  });

  it('fails when the server did not copy it', async () => {
    answer({ fromAccountId: 'b', accountId: 'a', copied: null, notCopied: { Gteam1: { type: 'blobNotFound' } } });
    await expect(createClient().copyBlobs('b', ['Gteam1'], 'a')).rejects.toThrow('blobNotFound');
  });

  it('copies nothing within one account', async () => {
    const calls = answer({});
    expect(await createClient().copyBlobs('a', ['G1'], 'a')).toEqual({ G1: 'G1' });
    expect(calls).toEqual([]);
  });
});
