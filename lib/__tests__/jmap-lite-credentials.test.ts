import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

/**
 * #1396: in the Lite bundle served by Stalwart, JMAP requests share the page's
 * origin, so a 401 with Stalwart's `WWW-Authenticate: Basic` challenge made
 * Safari show its login dialog unless credentials are omitted. The regular
 * build must keep sending cookies (cookie-gated proxies in front of JMAP).
 */

const session = {
  capabilities: { 'urn:ietf:params:jmap:core': {} },
  accounts: { 'acct-1': { name: 'test', isPersonal: true, accountCapabilities: {} } },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
  apiUrl: 'https://mail.example.com/jmap/api',
  downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
  uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
  eventSourceUrl: 'https://mail.example.com/jmap/eventsource?types={types}&closeafter={closeafter}&ping={ping}',
};

function json(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : null, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Client = typeof import('../jmap/client').JMAPClient;

// The build target is read once at import, so each mode needs a fresh module.
// A cold import of the client takes a few seconds, hence the hook timeout.
const IMPORT_TIMEOUT = 30_000;
const clients: Partial<Record<'lite' | 'regular', Client>> = {};

async function loadClient(liteTarget: 'stalwart' | null): Promise<Client> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BULWARK_LITE', liteTarget ? '1' : '');
  vi.stubEnv('NEXT_PUBLIC_LITE_TARGET', liteTarget ?? '');
  const { JMAPClient } = await import('../jmap/client');
  vi.unstubAllEnvs();
  return JMAPClient;
}

describe('JMAP request credentials mode', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    clients.lite = await loadClient('stalwart');
    clients.regular = await loadClient(null);
  }, IMPORT_TIMEOUT);

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) =>
      Promise.reject(new Error(`Unmocked fetch: ${String(url)}`)));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('omits credentials on the session fetch, the request and its refresh retry in Lite on Stalwart', async () => {
    const JMAPClient = clients.lite!;
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    fetchSpy.mockResolvedValueOnce(json(200, session));
    const client = JMAPClient.withBearer('https://mail.example.com', 'expired', 'user@test.com', refresh);
    await client.connect();

    fetchSpy
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(200, { methodResponses: [['Core/echo', {}, '0']] }));
    await client.ping();
    client.disconnect();

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init as RequestInit).credentials).toBe('omit');
    }
  });

  it('keeps an explicit credentials mode chosen by the caller', async () => {
    const JMAPClient = clients.lite!;
    fetchSpy.mockResolvedValueOnce(json(200, session));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token', 'user@test.com');
    await client.connect();

    fetchSpy.mockResolvedValueOnce(json(200, {}));
    // authenticatedFetch is private; reach it the way the class's own callers do.
    await (client as unknown as {
      authenticatedFetch(url: string, init: RequestInit): Promise<Response>;
    }).authenticatedFetch('https://mail.example.com/jmap/api', { credentials: 'include' });
    client.disconnect();

    expect((fetchSpy.mock.calls[1][1] as RequestInit).credentials).toBe('include');
  });

  it('leaves the browser default in the regular build', async () => {
    const JMAPClient = clients.regular!;
    fetchSpy.mockResolvedValueOnce(json(200, session));
    const client = JMAPClient.withBearer('https://mail.example.com', 'token', 'user@test.com');
    await client.connect();
    client.disconnect();

    expect((fetchSpy.mock.calls[0][1] as RequestInit).credentials).toBeUndefined();
  });
});
