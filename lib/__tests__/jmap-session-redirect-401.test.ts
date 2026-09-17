import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

const WELL_KNOWN = 'https://mail.example.com/.well-known/jmap';
const SESSION_URL = 'https://proxy/jmap/session';

function makeSession() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {} },
    accounts: { 'acct-1': { name: 'test', isPersonal: true, accountCapabilities: {} } },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
    username: 'test@example.com',
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
  };
}

function response(status: number, body: unknown, extra?: { redirected?: boolean; url?: string }): Response {
  const res = new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  Object.defineProperty(res, 'redirected', { value: extra?.redirected ?? false });
  Object.defineProperty(res, 'url', { value: extra?.url ?? '' });
  return res;
}

describe('JMAP session fetch when a redirect drops the Authorization header (#892)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('re-fetches the redirected session URL with credentials after a 401', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === WELL_KNOWN) {
        // The proxy rejected the header-less redirected request.
        return response(401, { title: 'Unauthorized' }, { redirected: true, url: SESSION_URL });
      }
      if (url === SESSION_URL) {
        return response(200, makeSession());
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const client = new JMAPClient('https://mail.example.com', 'test@example.com', 'secret');
    await expect(client.connect()).resolves.toBeUndefined();

    const sessionCall = fetchSpy.mock.calls.find(([input]: unknown[]) => String(input) === SESSION_URL);
    expect(sessionCall).toBeDefined();
    const headers = (sessionCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('still fails when the direct request is rejected as well', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === WELL_KNOWN) {
        return response(401, { title: 'Unauthorized' }, { redirected: true, url: SESSION_URL });
      }
      return response(401, { title: 'Unauthorized' });
    });

    const client = new JMAPClient('https://mail.example.com', 'test@example.com', 'wrong');
    await expect(client.connect()).rejects.toThrow(/Invalid username or password/);
  });

  it('does not retry a plain 401 that was not redirected', async () => {
    fetchSpy.mockImplementation(async () => response(401, { title: 'Unauthorized' }));

    const client = new JMAPClient('https://mail.example.com', 'test@example.com', 'wrong');
    await expect(client.connect()).rejects.toThrow(/Invalid username or password/);
    expect(fetchSpy.mock.calls.every(([input]: unknown[]) => String(input) === WELL_KNOWN)).toBe(true);
  });
});
