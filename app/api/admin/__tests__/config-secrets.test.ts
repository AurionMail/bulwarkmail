/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// GET /api/admin/config hides the session secret and the OAuth client secrets
// behind `hasValue` so a stolen admin session cannot lift them in one
// request. The same secrets leaked through two other doors: every PATCH wrote
// old and new values verbatim into the audit log, which GET /api/admin/audit
// hands back, and the per-server client secrets in `jmapServers` were returned
// in full. A PATCH could also replace the session secret itself, making the
// caller the holder of the key behind every session cookie.

const configDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'bulwark-config-secrets-'));
  process.env.ADMIN_CONFIG_DIR = dir;
  process.env.ADMIN_STATE_DIR = join(dir, 'state');
  delete process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET_FILE;
  return dir;
});

vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: async () => ({ payload: { role: 'admin' } }),
  getClientIP: () => '127.0.0.1',
}));

import { GET as getConfig, PATCH as patchConfig, DELETE as deleteConfig } from '../config/route';
import { GET as getAudit } from '../audit/route';
import { configManager } from '@/lib/admin/config-manager';
import { getSessionSecret } from '@/lib/auth/session-secret';
import { parseJmapServers } from '@/lib/admin/jmap-servers';

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  });
}

async function auditText(): Promise<string> {
  const res = await getAudit(req('/api/admin/audit?limit=200', 'GET'));
  expect(res.status).toBe(200);
  return JSON.stringify(await res.json());
}

function auditFileText(): string {
  return readFileSync(path.join(configDir, 'state', 'audit.log'), 'utf-8');
}

const SERVER = {
  id: 'bridge',
  label: 'Bridge',
  url: 'https://bridge.example.com',
  oauth: { clientId: 'bulwark', clientSecret: 'per-server-s3cret', issuerUrl: 'https://idp.example.com' },
};

beforeAll(async () => {
  await configManager.ensureLoaded();
});

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe('admin config secrets stay on the server', () => {
  it('does not write the OAuth client secret into the audit log or return it from the audit API', async () => {
    const res = await patchConfig(req('/api/admin/config', 'PATCH', { oauthClientSecret: 'global-s3cret-1' }));
    expect(res.status).toBe(200);
    await patchConfig(req('/api/admin/config', 'PATCH', { oauthClientSecret: 'global-s3cret-2' }));
    const revert = await deleteConfig(req('/api/admin/config', 'DELETE', { key: 'oauthClientSecret' }));
    expect(revert.status).toBe(200);

    const text = await auditText();
    expect(text).not.toContain('global-s3cret');
    expect(text).toContain('[redacted]');
    expect(auditFileText()).not.toContain('global-s3cret');
  });

  it('does not return per-server client secrets from GET /api/admin/config or the audit API, but keeps them on save', async () => {
    expect((await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: [SERVER] }))).status).toBe(200);

    const shown = await (await getConfig(req('/api/admin/config', 'GET'))).json();
    expect(JSON.stringify(shown)).not.toContain('per-server-s3cret');
    expect(shown.jmapServers.value[0].oauth).toEqual({
      clientId: 'bulwark',
      issuerUrl: 'https://idp.example.com',
      hasClientSecret: true,
    });
    expect(await auditText()).not.toContain('per-server-s3cret');
    expect(auditFileText()).not.toContain('per-server-s3cret');

    // The dashboard sends the entry back as it was shown: the stored secret survives.
    const resent = shown.jmapServers.value;
    resent[0].label = 'Bridge (renamed)';
    expect((await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: resent }))).status).toBe(200);
    let stored = parseJmapServers(configManager.get('jmapServers'));
    expect(stored[0]!.label).toBe('Bridge (renamed)');
    expect(stored[0]!.oauth!.clientSecret).toBe('per-server-s3cret');
    expect(stored[0]!.oauth).not.toHaveProperty('hasClientSecret');

    // A typed secret replaces it; an explicit empty one clears it.
    await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: [{ ...SERVER, oauth: { ...SERVER.oauth, clientSecret: 'new-s3cret' } }] }));
    stored = parseJmapServers(configManager.get('jmapServers'));
    expect(stored[0]!.oauth!.clientSecret).toBe('new-s3cret');
    await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: [{ ...SERVER, oauth: { clientId: 'bulwark', clientSecret: '' } }] }));
    stored = parseJmapServers(configManager.get('jmapServers'));
    expect(stored[0]!.oauth).toEqual({ clientId: 'bulwark' });

    // Dropping the OAuth block drops the secret with it.
    await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: [SERVER] }));
    await patchConfig(req('/api/admin/config', 'PATCH', { jmapServers: [{ id: 'bridge', label: 'Bridge', url: SERVER.url }] }));
    stored = parseJmapServers(configManager.get('jmapServers'));
    expect(stored[0]!.oauth).toBeUndefined();
  });

  it('refuses to change the session secret from the dashboard', async () => {
    const before = getSessionSecret();
    const res = await patchConfig(req('/api/admin/config', 'PATCH', { sessionSecret: 'x'.repeat(48) }));
    expect(res.status).toBe(400);
    expect(getSessionSecret()).toBe(before);
    expect(configManager.get('sessionSecret', '')).toBe('');
    expect(await auditText()).not.toContain('x'.repeat(48));
  });

  it('redacts entries an older version wrote with the secret in clear', async () => {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      path.join(configDir, 'state', 'audit.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        action: 'config.update',
        detail: { changes: [{ key: 'sessionSecret', old: 'legacy-old-secret', new: 'legacy-new-secret' }] },
        ip: '127.0.0.1',
      }) + '\n',
    );
    const text = await auditText();
    expect(text).not.toContain('legacy-old-secret');
    expect(text).not.toContain('legacy-new-secret');
  });
});
