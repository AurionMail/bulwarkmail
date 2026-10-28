import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import { setNoThirdPartyTraffic } from '../third-party-mode';

// #903: the host API's own locks, behind the loader that already refuses
// plugins declaring network access: api.http.fetch and the WKD key lookup
// reach nothing outside while third-party traffic is off.

vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'net', name: 'Net', version: '1.0.0', author: '', description: '', type: 'hook',
    permissions: [], entrypoint: 'index.js', enabled: true, status: 'running', settings: {},
    ...overrides,
  };
}

const fetchSpy = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setNoThirdPartyTraffic(false);
});

describe('api.http.fetch', () => {
  const fetcher = plugin({ permissions: ['http:fetch'], grantedPermissions: ['http:fetch'], httpOrigins: ['https://api.vendor.example'] });

  it('is refused with no third-party traffic, even for a plugin that got started', async () => {
    setNoThirdPartyTraffic(true);
    await expect(dispatchApiCall(fetcher, 'http.fetch', ['https://api.vendor.example/x'])).rejects.toThrow(/Outside requests are off/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reaches the declared origin with the mode off', async () => {
    await dispatchApiCall(fetcher, 'http.fetch', ['https://api.vendor.example/x']).catch(() => undefined);
    expect(String((fetchSpy.mock.calls[0] as unknown[] | undefined)?.[0])).toMatch(/^https:\/\/api\.vendor\.example\/x/);
  });
});

describe('api.crypto.getPublicKeyFromWKD', () => {
  const pgp = plugin({ permissions: ['crypto:full'], grantedPermissions: ['crypto:full'] });

  it('asks nobody with no third-party traffic', async () => {
    setNoThirdPartyTraffic(true);
    expect(await dispatchApiCall(pgp, 'crypto.getPublicKeyFromWKD', ['joe@vendor.example'], { privileged: true })).toMatchObject({ status: 'ERROR' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks the recipient\'s domain with the mode off', async () => {
    fetchSpy.mockImplementationOnce(async () => new Response('', { status: 404 }));
    await dispatchApiCall(pgp, 'crypto.getPublicKeyFromWKD', ['joe@vendor.example'], { privileged: true });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/openpgpkey\.vendor\.example\//);
  });
});
