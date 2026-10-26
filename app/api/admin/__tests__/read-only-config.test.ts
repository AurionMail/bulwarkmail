/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

// Writes from the admin panel must answer 409 with the read-only message
// instead of a bare 500, and must not change anything on the way (#1249).

// Hoisted so the dirs are set before any admin module loads.
const configDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'bulwark-readonly-'));
  process.env.ADMIN_CONFIG_DIR = dir;
  process.env.ADMIN_STATE_DIR = join(dir, 'state');
  return dir;
});

let readOnly = false;

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: async () => ({ payload: { role: 'admin' } }),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/audit', () => ({ auditLog: async () => {} }));
vi.mock('@/lib/admin/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin/paths')>();
  return {
    ...actual,
    isConfigReadOnly: () => readOnly,
    assertWritable: (operation: string) => {
      if (readOnly) throw new actual.ConfigReadOnlyError(operation);
    },
  };
});

import { PATCH as patchConfig, DELETE as deleteConfig } from '../config/route';
import { PUT as putPolicy } from '../policy/route';
import { DELETE as deleteBranding } from '../branding/route';
import { POST as changePassword } from '../change-password/route';
import { POST as decidePluginApproval } from '../plugin-approvals/route';
import { setInitialAdminPassword, verifyAdminPassword } from '@/lib/admin/password';
import { requestApproval, listApprovals } from '@/lib/admin/plugin-approvals';
import { configManager } from '@/lib/admin/config-manager';

function req(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function expectReadOnly(res: Response) {
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/configuration is read-only/);
}

beforeAll(async () => {
  await setInitialAdminPassword('old-password-123');
  await requestApproval('demo-plugin', 'abcdef0123456789', { name: 'Demo', version: '1.0.0' } as never, 'user@example.org');
  await configManager.ensureLoaded();
});

beforeEach(() => {
  readOnly = true;
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe('admin writes on a read-only config (#1249)', () => {
  it('PATCH /api/admin/config answers 409 with the reason', async () => {
    await expectReadOnly(await patchConfig(req('/api/admin/config', 'PATCH', { appName: 'Changed' })));
    expect(configManager.get('appName')).not.toBe('Changed');
  });

  it('DELETE /api/admin/config answers 409 with the reason', async () => {
    await expectReadOnly(await deleteConfig(req('/api/admin/config', 'DELETE', { key: 'appName' })));
  });

  it('PUT /api/admin/policy answers 409 with the reason', async () => {
    await expectReadOnly(await putPolicy(req('/api/admin/policy', 'PUT', { restrictions: {} })));
  });

  it('DELETE /api/admin/branding refuses before deleting the file', async () => {
    const dir = path.join(configDir, 'branding');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'faviconUrl.png');
    writeFileSync(file, 'png');

    await expectReadOnly(await deleteBranding(req('/api/admin/branding', 'DELETE', { slot: 'faviconUrl' })));
    expect(existsSync(file)).toBe(true);
  });

  it('POST /api/admin/change-password refuses and keeps the old password', async () => {
    await expectReadOnly(await changePassword(req('/api/admin/change-password', 'POST', {
      currentPassword: 'old-password-123',
      newPassword: 'new-password-456',
    })));
    expect(await verifyAdminPassword('old-password-123')).toBe(true);
    expect(await verifyAdminPassword('new-password-456')).toBe(false);
  });

  it('POST /api/admin/plugin-approvals refuses and leaves the request pending', async () => {
    await expectReadOnly(await decidePluginApproval(req('/api/admin/plugin-approvals', 'POST', {
      pluginId: 'demo-plugin',
      bundleHash: 'abcdef0123456789',
      decision: 'approved',
    })));
    expect((await listApprovals()).map(e => e.status)).toEqual(['pending']);
  });

  it('still saves when the config is writable', async () => {
    readOnly = false;
    const res = await patchConfig(req('/api/admin/config', 'PATCH', { appName: 'Writable' }));
    expect(res.status).toBe(200);
    expect(configManager.get('appName')).toBe('Writable');
  });
});
