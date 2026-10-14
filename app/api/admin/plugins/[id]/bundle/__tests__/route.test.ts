/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

let signedIn = false;
vi.mock('@/lib/auth/instance-details', () => ({ canSeeInstanceDetails: vi.fn(async () => signedIn) }));
vi.mock('@/lib/admin/plugin-dev', () => ({ getDevPlugin: vi.fn(async () => null), readDevBundle: vi.fn() }));
vi.mock('@/lib/admin/plugin-registry', () => ({
  getPlugin: vi.fn(async () => ({ id: 'demo', enabled: true, bundleHash: 'h' })),
  getPluginBundle: vi.fn(async () => 'module.exports = {}'),
  getPluginSignature: vi.fn(async () => 'sig'),
}));
vi.mock('@/lib/admin/plugin-signing', () => ({ signBytes: vi.fn(async () => 'sig') }));

import { GET } from '../route';

function get() {
  return GET(new NextRequest('http://localhost/api/admin/plugins/demo/bundle'), { params: Promise.resolve({ id: 'demo' }) });
}

beforeEach(() => { signedIn = false; });

describe('GET plugin bundle', () => {
  it('does not hand plugin code to someone who is not signed in', async () => {
    expect((await get()).status).toBe(401);
  });

  it('serves it to a signed-in user with its signature', async () => {
    signedIn = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-bundle-signature')).toBe('sig');
  });
});
