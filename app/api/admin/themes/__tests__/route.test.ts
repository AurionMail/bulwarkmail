/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: vi.fn(async () => ({ session: { sub: 'admin' } })),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/audit', () => ({ auditLog: vi.fn(async () => {}) }));

let policy: Record<string, unknown>;
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn(async () => {}),
    get: vi.fn(),
    getPolicy: vi.fn(() => policy),
    setPolicy: vi.fn(async (p: Record<string, unknown>) => { policy = p; }),
  },
}));
vi.mock('@/lib/admin/plugin-registry', () => ({
  deleteTheme: vi.fn(async () => true),
  saveTheme: vi.fn(),
  getTheme: vi.fn(async () => null),
  getThemeRegistry: vi.fn(async () => ({ themes: [] })),
}));

import { DELETE } from '../route';

function del(id: string) {
  return DELETE(new NextRequest('http://localhost/api/admin/themes', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
    headers: { 'content-type': 'application/json' },
  }));
}

beforeEach(() => {
  policy = { forceEnabledThemes: ['corp', 'other'], forceEnabledPlugins: [] };
});

describe('DELETE /api/admin/themes', () => {
  it('stops forcing a theme once it is deleted', async () => {
    const res = await del('corp');

    expect(res.status).toBe(200);
    expect(policy.forceEnabledThemes).toEqual(['other']);
  });
});
