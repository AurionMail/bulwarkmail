import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  verifySignature: vi.fn(),
}));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock('../plugin-sandbox/bundle-signing', () => ({
  verifySignature: (...args: unknown[]) => mocks.verifySignature(...args),
}));

import { downloadManagedBundle, bundleUrl } from '../plugin-sandbox/bundle-fetch';

function response(code: string, opts: { ok?: boolean; status?: number; signature?: string } = {}) {
  const { ok = true, status = 200, signature } = opts;
  return {
    ok,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-bundle-signature' ? signature ?? null : null) },
    text: async () => code,
  };
}

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.verifySignature.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('bundleUrl', () => {
  it('targets the public bundle endpoint and busts caches per hash', () => {
    expect(bundleUrl('my-plugin', 'abc123')).toBe('/api/admin/plugins/my-plugin/bundle?v=abc123');
    expect(bundleUrl('my-plugin')).toBe('/api/admin/plugins/my-plugin/bundle');
    expect(bundleUrl('my-plugin', null)).toBe('/api/admin/plugins/my-plugin/bundle');
  });
});

describe('downloadManagedBundle', () => {
  it('returns a bundle whose signature verifies', async () => {
    mocks.apiFetch.mockResolvedValue(response('code', { signature: 'sig' }));
    mocks.verifySignature.mockResolvedValue(true);
    await expect(downloadManagedBundle('my-plugin', 'abc')).resolves.toBe('code');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/admin/plugins/my-plugin/bundle?v=abc');
    expect(mocks.verifySignature).toHaveBeenCalledWith('code', 'sig');
  });

  it('refuses a bundle whose signature does not verify', async () => {
    mocks.apiFetch.mockResolvedValue(response('code', { signature: 'sig' }));
    mocks.verifySignature.mockResolvedValue(false);
    await expect(downloadManagedBundle('my-plugin')).rejects.toThrow(/signature verification failed/);
  });

  it('allows an unsigned bundle (older server / signing disabled) with a warning', async () => {
    mocks.apiFetch.mockResolvedValue(response('code'));
    await expect(downloadManagedBundle('my-plugin')).resolves.toBe('code');
    expect(mocks.verifySignature).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports an HTTP failure with the status', async () => {
    mocks.apiFetch.mockResolvedValue(response('', { ok: false, status: 404 }));
    await expect(downloadManagedBundle('my-plugin')).rejects.toThrow(/HTTP 404/);
  });

  it('reports a network failure', async () => {
    mocks.apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(downloadManagedBundle('my-plugin')).rejects.toThrow(/Could not download.*Failed to fetch/);
  });

  it('refuses an empty body instead of caching it', async () => {
    mocks.apiFetch.mockResolvedValue(response('', { signature: 'sig' }));
    await expect(downloadManagedBundle('my-plugin')).rejects.toThrow(/empty bundle/);
    expect(mocks.verifySignature).not.toHaveBeenCalled();
  });
});
