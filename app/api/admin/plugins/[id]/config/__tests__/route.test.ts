/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let admin = true;
vi.mock('@/lib/admin/session', async () => {
  const { NextResponse } = await import('next/server');
  return { requireAdminAuth: async () => (admin ? { ok: true } : { error: NextResponse.json({}, { status: 401 }) }) };
});
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: async () => ({ username: 'alice@example.org' }) }));
vi.mock('@/lib/admin/plugin-registry', () => ({
  getPlugin: async () => ({ id: 'paperless', configSchema: { serverUrl: { type: 'string' }, apiToken: { type: 'secret' } } }),
}));
vi.mock('@/lib/admin/plugin-dev', () => ({ getDevPlugin: async () => null }));
vi.mock('@/lib/admin/plugin-config', () => ({
  getPluginConfig: async () => ({ serverUrl: 'https://paperless.example.org', apiToken: 'secret-token' }),
  setPluginConfig: vi.fn(), deletePluginConfigKey: vi.fn(),
}));

import { GET } from '../route';

function get(query = '') {
  return GET(new NextRequest(`http://localhost/api/admin/plugins/paperless/config${query}`), { params: Promise.resolve({ id: 'paperless' }) });
}

beforeEach(() => { admin = true; });

describe('GET plugin config', () => {
  it('gives an admin every field', async () => {
    expect(await (await get()).json()).toEqual({ serverUrl: 'https://paperless.example.org', apiToken: 'secret-token' });
  });

  it('never gives secrets with ?public=1, even to an admin (what plugins use)', async () => {
    expect(await (await get('?public=1')).json()).toEqual({ serverUrl: 'https://paperless.example.org' });
  });

  it('gives a user only the fields that aren\'t secrets', async () => {
    admin = false;
    expect(await (await get()).json()).toEqual({ serverUrl: 'https://paperless.example.org' });
  });
});
