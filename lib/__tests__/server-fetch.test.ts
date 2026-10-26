import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn(),
  },
}));

vi.mock('@/lib/security/url-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/url-guard')>();
  return {
    ...actual,
    fetchPublicUrl: vi.fn(),
  };
});

import { configManager } from '@/lib/admin/config-manager';
import { fetchPublicUrl } from '@/lib/security/url-guard';
import { fetchJmapServer, isTrustedJmapServerUrl } from '@/lib/stalwart/server-fetch';

const mockGet = configManager.get as unknown as Mock;
const guardedFetch = fetchPublicUrl as unknown as Mock;
let plainFetch: Mock;

function configure(values: Record<string, unknown>) {
  mockGet.mockImplementation((key: string, fallback?: unknown) => (key in values ? values[key] : fallback));
}

function response(status: number, headers: Record<string, string> = {}, body: string | null = null) {
  return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
}

beforeEach(() => {
  plainFetch = vi.fn(async () => response(200, {}, 'plain'));
  vi.stubGlobal('fetch', plainFetch);
  guardedFetch.mockReset();
  mockGet.mockReset();
  configure({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isTrustedJmapServerUrl', () => {
  it('trusts the global jmapServerUrl regardless of trailing slash or host case', async () => {
    configure({ jmapServerUrl: 'https://Mail.Example.com/' });
    expect(await isTrustedJmapServerUrl('https://mail.example.com')).toBe(true);
  });

  it('trusts entries of the jmapServers list', async () => {
    configure({
      jmapServers: [{ id: 'corp', label: 'Corp', url: 'http://10.0.0.5:8080', domains: ['corp.example'] }],
    });
    expect(await isTrustedJmapServerUrl('http://10.0.0.5:8080')).toBe(true);
  });

  it('does not trust a URL that matches no configured server', async () => {
    configure({ jmapServerUrl: 'https://mail.example.com' });
    expect(await isTrustedJmapServerUrl('https://evil.example')).toBe(false);
  });
});

describe('fetchJmapServer', () => {
  it('uses the plain fetch for trusted servers', async () => {
    const res = await fetchJmapServer('http://10.0.0.5/jmap/', { method: 'POST', body: '{}' }, true);
    expect(res.status).toBe(200);
    expect(plainFetch).toHaveBeenCalledTimes(1);
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it('gives every request a deadline unless the caller brought one', async () => {
    // A slow or silent server (with custom endpoints on, one the user chose)
    // used to be able to hold the connection open for as long as it liked.
    await fetchJmapServer('http://10.0.0.5/jmap/', { method: 'POST', body: '{}' }, true);
    expect(plainFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    guardedFetch.mockResolvedValueOnce(response(200, {}, 'guarded'));
    await fetchJmapServer('https://custom.example/jmap/', { method: 'GET' }, false);
    expect(guardedFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    const own = new AbortController().signal;
    await fetchJmapServer('http://10.0.0.5/jmap/', { method: 'GET', signal: own }, true);
    expect(plainFetch.mock.calls[1][1].signal).toBe(own);
  });

  it('routes untrusted servers through fetchPublicUrl', async () => {
    guardedFetch.mockResolvedValueOnce(response(200, {}, 'guarded'));
    const res = await fetchJmapServer(
      'https://custom.example/jmap/',
      { method: 'POST', body: '{}', headers: { Authorization: 'Basic abc' } },
      false,
    );
    expect(await res.text()).toBe('guarded');
    expect(plainFetch).not.toHaveBeenCalled();
    const [url, init] = guardedFetch.mock.calls[0];
    expect(url).toBe('https://custom.example/jmap/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Basic abc' });
  });

  it('returns the 3xx untouched when redirect is manual', async () => {
    guardedFetch.mockResolvedValueOnce(response(301, { location: 'https://custom.example/jmap' }));
    const res = await fetchJmapServer('https://custom.example/jmap/', { redirect: 'manual' }, false);
    expect(res.status).toBe(301);
    expect(guardedFetch).toHaveBeenCalledTimes(1);
  });

  it('follows same-origin redirects, keeping Authorization', async () => {
    guardedFetch
      .mockResolvedValueOnce(response(308, { location: '/jmap/' }))
      .mockResolvedValueOnce(response(200, {}, 'ok'));
    const res = await fetchJmapServer(
      'https://custom.example/jmap',
      { method: 'POST', body: '{}', headers: { Authorization: 'Basic abc' }, redirect: 'follow' },
      false,
    );
    expect(res.status).toBe(200);
    const [url, init] = guardedFetch.mock.calls[1];
    expect(url).toBe('https://custom.example/jmap/');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Basic abc');
  });

  it('drops Authorization on a cross-origin redirect and downgrades 302 POST to GET', async () => {
    guardedFetch
      .mockResolvedValueOnce(response(302, { location: 'https://other.example/x' }))
      .mockResolvedValueOnce(response(200, {}, 'ok'));
    await fetchJmapServer(
      'https://custom.example/jmap/',
      { method: 'POST', body: '{}', headers: { Authorization: 'Basic abc', 'Content-Type': 'application/json' } },
      false,
    );
    const [url, init] = guardedFetch.mock.calls[1];
    expect(url).toBe('https://other.example/x');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['content-type']).toBeUndefined();
  });

  it('gives up after too many redirects', async () => {
    guardedFetch.mockResolvedValue(response(302, { location: '/loop' }));
    await expect(fetchJmapServer('https://custom.example/loop', {}, false)).rejects.toThrow(/Too many redirects/);
  });

  it('propagates DisallowedUrlError from the guard', async () => {
    const { DisallowedUrlError } = await import('@/lib/security/url-guard');
    guardedFetch.mockRejectedValueOnce(new DisallowedUrlError('http://custom.example/'));
    await expect(fetchJmapServer('http://custom.example/', {}, false)).rejects.toBeInstanceOf(DisallowedUrlError);
  });
});
