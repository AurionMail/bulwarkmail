import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient, RequestTimeoutError } from '../jmap/client';
import { jmapErrorFailedIds } from '../jmap/jmap-error';

// #956: Email/set failures were swallowed by the delete/move helpers because
// request() only rejects on HTTP errors. Method-level errors and per-id
// notUpdated/notDestroyed entries must reject so the store keeps the rows.

function makeSession() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {} },
    accounts: { 'acct-1': { name: 'test', isPersonal: true, accountCapabilities: {} } },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
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

const notUpdated = () =>
  jsonResponse({
    methodResponses: [
      ['Email/set', { updated: null, notUpdated: { e1: { type: 'invalidProperties', description: 'Mailbox does not exist' } } }, '0'],
    ],
  });
const notDestroyed = () =>
  jsonResponse({
    methodResponses: [
      ['Email/set', { destroyed: null, notDestroyed: { e1: { type: 'forbidden', description: 'No permission' } } }, '0'],
    ],
  });
const methodError = () =>
  jsonResponse({
    methodResponses: [['error', { type: 'accountNotFound', description: 'Account not found' }, '0']],
  });
const success = () =>
  jsonResponse({
    methodResponses: [['Email/set', { updated: { e1: null }, destroyed: ['e1'] }, '0']],
  });

describe('JMAPClient Email/set failure surfacing (#956)', () => {
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

  it('deleteEmail rejects on notDestroyed', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(notDestroyed());
    await expect(client.deleteEmail('e1')).rejects.toThrow(/No permission/);
  });

  it('moveToTrash rejects on notUpdated', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(notUpdated());
    await expect(client.moveToTrash('e1', 'trash')).rejects.toThrow(/Mailbox does not exist/);
  });

  it('batchDeleteEmails rejects on notDestroyed', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(notDestroyed());
    await expect(client.batchDeleteEmails(['e1', 'e2'])).rejects.toThrow(/No permission/);
  });

  it('batchMoveEmails rejects on notUpdated', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(notUpdated());
    await expect(client.batchMoveEmails(['e1', 'e2'], 'archive')).rejects.toThrow(/Mailbox does not exist/);
  });

  it('rejects on a method-level error response', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(methodError());
    await expect(client.batchMoveEmails(['e1'], 'archive')).rejects.toThrow(/Account not found/);
  });

  // Stalwart takes up to maxObjectsInSet ids per Email/set (500 by default
  // on 0.16 and 1.0); a larger move goes out in batches.
  describe('a move sent in batches', () => {
    async function clientWithBatchesOf(size: number): Promise<JMAPClient> {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ...makeSession(), capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: size } } }));
      const client = JMAPClient.withBearer('https://mail.example.com', 'token123', 'user@test.com');
      await client.connect();
      fetchSpy.mockReset();
      return client;
    }
    const moved = (ids: string[], refused: Record<string, unknown> = {}) => jsonResponse({
      methodResponses: [['Email/set', {
        updated: Object.fromEntries(ids.filter((id) => !(id in refused)).map((id) => [id, null])),
        ...(Object.keys(refused).length ? { notUpdated: refused } : {}),
      }, '0']],
    });

    it('moves the batches after a refused one and names only what was left where it was', async () => {
      const client = await clientWithBatchesOf(2);
      fetchSpy
        .mockResolvedValueOnce(moved(['e1', 'e2']))
        .mockResolvedValueOnce(moved(['e3', 'e4'], { e3: { type: 'forbidden', description: 'No permission' } }))
        .mockResolvedValueOnce(moved(['e5']));

      const error = await client.batchMoveEmails(['e1', 'e2', 'e3', 'e4', 'e5'], 'archive').catch((e: unknown) => e);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(error).toBeInstanceOf(Error);
      expect(jmapErrorFailedIds(error)).toEqual(['e3']);
    });

    it('names every message from the batch whose answer never came on', async () => {
      const client = await clientWithBatchesOf(2);
      fetchSpy
        .mockResolvedValueOnce(moved(['e1', 'e2']))
        .mockRejectedValueOnce(new RequestTimeoutError(30_000));

      const error = await client.batchMoveEmails(['e1', 'e2', 'e3', 'e4', 'e5'], 'archive').catch((e: unknown) => e);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(error).toBeInstanceOf(RequestTimeoutError);
      expect(jmapErrorFailedIds(error)).toEqual(['e3', 'e4', 'e5']);
    });
  });

  it('still resolves when the server accepted the change', async () => {
    const client = await connectedClient();
    fetchSpy.mockResolvedValueOnce(success());
    await expect(client.deleteEmail('e1')).resolves.toBeUndefined();
    fetchSpy.mockResolvedValueOnce(success());
    await expect(client.batchMoveEmails(['e1'], 'archive')).resolves.toBeUndefined();
  });
});
