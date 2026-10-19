/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Two guards in front of a marketplace install: the version must be a
// version string (it goes into a URL, the registry and the history directory
// name, and a non-string broke the next update), and an "update" must not
// quietly install a release older than the one installed, which is what a
// directory that lists an old, vulnerable release as the latest would get.

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: async () => ({ payload: { role: 'admin' } }),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/audit', () => ({ auditLog: async () => {} }));
vi.mock('@/lib/admin/csp-frame-origins', () => ({ invalidateFrameOriginsCache: () => {} }));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: { ensureLoaded: async () => {}, get: () => undefined },
}));
const installed: Record<string, { version: string } | null> = {};
vi.mock('@/lib/admin/plugin-registry', () => ({
  getPlugin: async (id: string) => installed[`plugin:${id}`] ?? null,
  getTheme: async (id: string) => installed[`theme:${id}`] ?? null,
  getPluginRegistry: async () => ({ plugins: [] }),
  getThemeRegistry: async () => ({ themes: [] }),
  savePlugin: vi.fn(),
  saveTheme: vi.fn(),
  themeCSSResolver: async () => () => null,
}));

import { POST } from '../marketplace/route';

const fetchMock = vi.fn(async () => new Response('nope', { status: 502 }));

function install(body: unknown) {
  return POST(new NextRequest('http://localhost/api/admin/marketplace', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  }));
}

beforeEach(() => {
  for (const key of Object.keys(installed)) delete installed[key];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('marketplace install guards', () => {
  it('refuses a version that is not a version string, before touching the directory', async () => {
    for (const version of [{}, ['1.0.0'], 'x'.repeat(100), '1.0', 'latest', '../1.0.0']) {
      const res = await install({ slug: 'jitsi-meet', version, type: 'plugin' });
      expect(res.status, JSON.stringify(version)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to install a release older than the installed one unless asked to', async () => {
    installed['plugin:jitsi-meet'] = { version: '2.1.0' };
    const older = await install({ slug: 'jitsi-meet', version: '2.0.9', type: 'plugin' });
    expect(older.status).toBe(409);
    const refused = await older.json();
    expect(refused.error).toMatch(/older than the installed 2\.1\.0/);
    expect(refused.downgrade).toEqual({ installedVersion: '2.1.0' });
    expect(fetchMock).not.toHaveBeenCalled();

    installed['theme:nord'] = { version: '1.5.0' };
    expect((await install({ slug: 'nord', version: '1.4.0', type: 'theme' })).status).toBe(409);

    // The deliberate way back goes through with `force` (the admin UI asks
    // first, as it does for a withdrawn version)...
    const back = await install({ slug: 'jitsi-meet', version: '2.0.9', type: 'plugin', force: true });
    expect(back.status).not.toBe(409);
    expect(fetchMock).toHaveBeenCalled(); // the guard let it reach the (stubbed) directory
    // ...and a newer release, or the same one, was never a downgrade.
    expect((await install({ slug: 'jitsi-meet', version: '2.1.0', type: 'plugin' })).status).not.toBe(409);
    expect((await install({ slug: 'jitsi-meet', version: '2.2.0-beta.1', type: 'plugin' })).status).not.toBe(409);
  });
});
