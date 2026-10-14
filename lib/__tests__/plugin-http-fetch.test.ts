import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { dispatchApiCall, MAX_PLUGIN_FETCH_BYTES } from '../plugin-sandbox/host-api';

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'p1',
    name: 'Test plugin',
    version: '1.0.0',
    author: 'test',
    description: '',
    type: 'hook',
    permissions: ['http:fetch'],
    grantedPermissions: ['http:fetch'],
    httpOrigins: ['https://api.example.com'],
    entrypoint: 'index.js',
    enabled: true,
    status: 'running',
    settings: {},
    ...overrides,
  };
}

/** A fetch Response whose final URL is `url`, as after following redirects. */
function responseAt(url: string, body: BodyInit = '{"ok":true}', init: ResponseInit = {}): Response {
  const res = new Response(body, { status: 200, ...init });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http.fetch', () => {
  it('returns the response when it stays on an allowlisted origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseAt('https://api.example.com/v1/items')));

    const result = await dispatchApiCall(plugin(), 'http.fetch', ['https://api.example.com/v1/items']) as { status: number; bodyText: string };

    expect(result.status).toBe(200);
    expect(result.bodyText).toBe('{"ok":true}');
  });

  it('refuses a response that a redirect moved off the allowlist', async () => {
    // The request carries the webmail origin, so a server that trusts that
    // origin in CORS would answer it; the plugin must not get to read it.
    vi.stubGlobal('fetch', vi.fn(async () => responseAt('https://mail.example.org/jmap/session', '{"secret":1}')));

    await expect(dispatchApiCall(plugin(), 'http.fetch', ['https://api.example.com/redirect']))
      .rejects.toThrow(/redirected to https:\/\/mail\.example\.org/);
  });

  it('refuses a body larger than the cap', async () => {
    const big = new Uint8Array(MAX_PLUGIN_FETCH_BYTES + 1);
    vi.stubGlobal('fetch', vi.fn(async () => responseAt('https://api.example.com/big', big)));

    await expect(dispatchApiCall(plugin(), 'http.fetch', ['https://api.example.com/big']))
      .rejects.toThrow(/larger than/);
  });

  it('still refuses an origin that is not in the allowlist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(dispatchApiCall(plugin(), 'http.fetch', ['https://evil.example/']))
      .rejects.toThrow(/not in plugin httpOrigins/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
