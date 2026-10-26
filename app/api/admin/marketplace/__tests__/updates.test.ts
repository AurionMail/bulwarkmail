/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: vi.fn(async () => ({ session: { sub: 'admin' } })),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn((key: string) => (key === 'extensionDirectoryUrl' ? 'https://extensions.test' : key === 'extensionDirectoryChannel' ? 'beta' : undefined)),
  },
}));
vi.mock('@/lib/admin/plugin-registry', () => ({
  getPluginRegistry: vi.fn(async () => ({
    plugins: [
      { id: 'quick-reply', name: 'Quick Reply', version: '1.2.0', enabled: true, source: { kind: 'marketplace', slug: 'quick-reply', directoryUrl: 'https://extensions.test' } },
      { id: 'house-plugin', name: 'House', version: '0.1.0', enabled: true, source: { kind: 'upload' } },
      // Installed before the source was recorded: still asked about.
      { id: 'old-install', name: 'Old', version: '3.0.0', enabled: false },
    ],
  })),
  getThemeRegistry: vi.fn(async () => ({
    themes: [{ id: 'night', name: 'Night', version: '2.0.0', enabled: true, source: { kind: 'marketplace', slug: 'night', directoryUrl: 'https://extensions.test' } }],
  })),
}));
vi.mock('@/lib/admin/extension-history', () => ({ listHistory: vi.fn(async () => []) }));

import { GET } from '../updates/route';

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/admin/marketplace/updates', () => {
  it('asks the directory about the marketplace installs only, on the configured channel', async () => {
    let posted: { url: string; body: unknown } | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      posted = { url: String(url), body: JSON.parse(String(init.body)) };
      return Response.json({
        data: {
          updates: [{ slug: 'quick-reply', currentVersion: '1.2.0', version: '1.3.0', channel: 'stable', changelog: 'faster' }],
          yanked: [{ slug: 'night', version: '2.0.0', reason: 'contrast', at: '2026-10-01T00:00:00.000Z' }],
          deprecated: [], suspended: [], advisories: [], unknown: ['old-install'],
        },
      });
    }));

    const res = await GET(new NextRequest('http://localhost/api/admin/marketplace/updates'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(posted!.url).toBe('https://extensions.test/api/v2/updates');
    expect(posted!.body).toEqual({
      channel: 'beta',
      installed: [
        { slug: 'quick-reply', version: '1.2.0' },
        { slug: 'old-install', version: '3.0.0' },
        { slug: 'night', version: '2.0.0' },
      ],
    });
    expect(body.updates).toHaveLength(1);
    expect(body.yanked[0]).toMatchObject({ slug: 'night' });
    expect(body.unknown).toEqual(['old-install']);
    // Every install is listed, uploads included, for the "Installed" view.
    expect(body.installed.map((e: { id: string; kind: string }) => `${e.kind}:${e.id}`)).toEqual([
      'plugin:quick-reply', 'plugin:house-plugin', 'plugin:old-install', 'theme:night',
    ]);
    expect(body.error).toBeNull();
  });

  it('still lists the installs when the directory is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const res = await GET(new NextRequest('http://localhost/api/admin/marketplace/updates'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installed).toHaveLength(4);
    expect(body.updates).toEqual([]);
    expect(body.error).toMatch(/directory/i);
  });
});
