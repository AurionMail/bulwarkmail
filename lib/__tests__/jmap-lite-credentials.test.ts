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

/**
 * XMLHttpRequest has no credentials mode, so the upload-with-progress path
 * can't omit them: records the Authorization header each upload went out with.
 */
const xhrAuthHeaders: string[] = [];
class FakeXHR {
  status = 0;
  responseText = '';
  responseType = '';
  upload: { onprogress: ((ev: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private headers: Record<string, string> = {};
  open() {}
  abort() {}
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    xhrAuthHeaders.push(this.headers.Authorization);
    queueMicrotask(() => {
      this.status = 201;
      this.responseText = JSON.stringify({ blobId: 'blob-1', size: 3, type: 'text/plain' });
      this.onload?.();
    });
  }
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

  describe('uploads with progress', () => {
    const file = () => new File(['abc'], 'a.txt', { type: 'text/plain' });

    beforeEach(() => {
      xhrAuthHeaders.length = 0;
      vi.stubGlobal('XMLHttpRequest', FakeXHR);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('refreshes an access token that may have expired before the XHR goes out in Lite on Stalwart', async () => {
      const JMAPClient = clients.lite!;
      const refresh = vi.fn().mockResolvedValue('fresh-token');
      fetchSpy.mockResolvedValueOnce(json(200, session));
      const client = JMAPClient.withBearer('https://mail.example.com', 'expired', 'user@test.com', refresh);
      await client.connect();

      // Woken from sleep: nothing has confirmed the token for a while.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 10 * 60_000);
      fetchSpy
        .mockResolvedValueOnce(json(401))
        .mockResolvedValueOnce(json(200, { methodResponses: [['Core/echo', {}, '0']] }));
      await client.uploadBlob(file(), { onProgress: () => {} });
      client.disconnect();

      expect(refresh).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect((fetchSpy.mock.calls[1][1] as RequestInit).credentials).toBe('omit');
      expect(xhrAuthHeaders).toEqual(['Bearer fresh-token']);
    });

    it('sends the XHR straight away when a request just confirmed the token', async () => {
      const JMAPClient = clients.lite!;
      fetchSpy.mockResolvedValueOnce(json(200, session));
      const client = JMAPClient.withBearer('https://mail.example.com', 'token', 'user@test.com', vi.fn());
      await client.connect();

      await client.uploadBlob(file(), { onProgress: () => {} });
      client.disconnect();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(xhrAuthHeaders).toEqual(['Bearer token']);
    });

    it('sends the XHR straight away in the regular build', async () => {
      const JMAPClient = clients.regular!;
      fetchSpy.mockResolvedValueOnce(json(200, session));
      const client = JMAPClient.withBearer('https://mail.example.com', 'token', 'user@test.com', vi.fn());
      await client.connect();

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 10 * 60_000);
      await client.uploadBlob(file(), { onProgress: () => {} });
      client.disconnect();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(xhrAuthHeaders).toEqual(['Bearer token']);
    });
  });
});
