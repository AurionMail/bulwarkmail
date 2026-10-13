/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: vi.fn(async () => ({ session: { sub: 'admin' } })),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/audit', () => ({ auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn(() => 'https://extensions.test'),
  },
}));

const registry = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/admin/plugin-registry', () => ({
  savePlugin: vi.fn(async (p: Record<string, unknown>) => { registry.set(p.id as string, p); }),
  saveTheme: vi.fn(async () => {}),
  getPlugin: vi.fn(async (id: string) => registry.get(id) ?? null),
  getTheme: vi.fn(async () => null),
  getPluginRegistry: vi.fn(async () => ({ plugins: [...registry.values()] })),
  getThemeRegistry: vi.fn(async () => ({ themes: [] })),
}));
vi.mock('@/lib/admin/csp-frame-origins', async (orig) => ({
  ...(await orig<typeof import('@/lib/admin/csp-frame-origins')>()),
  invalidateFrameOriginsCache: vi.fn(),
}));

import { POST } from '../route';

async function bundle(manifest: Record<string, unknown>, code = 'module.exports = {};'): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('index.js', code);
  const buf = await zip.generateAsync({ type: 'uint8array' });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function install(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/admin/marketplace', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }));
}

const MANIFEST = {
  name: 'Pretty Dates', version: '1.0.0', author: 'x', description: 'd',
  type: 'hook', permissions: ['email:read'], entrypoint: 'index.js',
};

beforeEach(() => {
  registry.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/admin/marketplace', () => {
  it('installs a plugin under its directory slug', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await bundle({ ...MANIFEST, id: 'pretty-dates' }))));

    const res = await install({ slug: 'pretty-dates', version: '1.0.0', type: 'plugin' });

    expect(res.status).toBe(200);
    expect(registry.has('pretty-dates')).toBe(true);
  });

  it('refuses a bundle whose manifest id differs from the slug', async () => {
    // Otherwise a directory entry can overwrite another installed plugin,
    // inheriting its enabled and force-enabled state, while the admin UI
    // (which keys install status by slug) still shows "not installed".
    registry.set('pgp-plugin', { id: 'pgp-plugin', forceEnabled: true, version: '2.0.0' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await bundle({ ...MANIFEST, id: 'pgp-plugin' }))));

    const res = await install({ slug: 'pretty-dates', version: '1.0.0', type: 'plugin' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not match/);
    expect(registry.get('pgp-plugin')?.version).toBe('2.0.0');
  });
});
