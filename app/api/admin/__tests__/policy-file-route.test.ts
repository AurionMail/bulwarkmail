// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// The whole user policy goes out and comes back as one policy.json. An
// import is previewed first and goes through the same sanitising as the
// file on disk.

const audit = vi.hoisted(() => [] as Array<{ action: string; detail: Record<string, unknown> }>);
vi.mock('@/lib/admin/session', () => ({
  requireAdminAuth: async () => ({ payload: { role: 'admin' } }),
  getClientIP: () => '127.0.0.1',
}));
vi.mock('@/lib/admin/audit', () => ({
  auditLog: async (action: string, detail: Record<string, unknown>) => { audit.push({ action, detail }); },
}));

import { GET, POST } from '@/app/api/admin/policy/file/route';
import { configManager } from '@/lib/admin/config-manager';

let dir: string;
const url = (query = '') => `https://mail.example/api/admin/policy/file${query}`;
const post = (body: string, query = '') => POST(new NextRequest(url(query), { method: 'POST', body }));
const stored = async () => JSON.parse(await readFile(path.join(dir, 'policy.json'), 'utf-8'));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bw-policy-file-'));
  process.env.ADMIN_CONFIG_DIR = dir;
  audit.length = 0;
  await writeFile(path.join(dir, 'policy.json'), JSON.stringify({
    restrictions: { density: { locked: true } },
    organisation: { session: { idleMinutes: 30 } },
    scopes: [{ id: 'team', label: 'Team', match: { groups: ['team@example.org'] }, policy: {} }],
  }));
  await configManager.reload();
});

afterEach(async () => {
  delete process.env.ADMIN_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('policy file', () => {
  it('exports the stored policy as a dated download and logs it', async () => {
    const res = await GET(new NextRequest(url()));
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="bulwark-policy-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = JSON.parse(await res.text());
    expect(body.scopes.map((s: { id: string }) => s.id)).toEqual(['team']);
    expect(body.organisation.session.idleMinutes).toBe(30);
    expect(audit.map((a) => a.action)).toEqual(['policy.export']);
  });

  it('previews an import without writing anything', async () => {
    const file = JSON.stringify({
      restrictions: {},
      organisation: { session: { idleMinutes: 10 }, signature: { html: '<p>{name}</p>' } },
      scopes: [{ id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: {} }],
    });
    const res = await post(file, '?preview=1');
    const { summary } = await res.json();
    expect(summary.scopes).toEqual({ added: ['Two (two)'], changed: [], removed: ['Team (team)'] });
    expect(summary.restrictions.removed).toEqual(['density']);
    expect(summary.organisation.changed.sort()).toEqual(['session', 'signature']);
    expect((await stored()).organisation.session.idleMinutes).toBe(30);
    expect(audit).toEqual([]);
  });

  it('imports the sanitised policy and logs it', async () => {
    const res = await post(JSON.stringify({
      organisation: { session: { idleMinutes: 'soon' } },
      scopes: [{ id: 'Bad id!' }, { id: 'two', label: 'Two', match: { domains: ['org-two.test'] }, policy: {} }],
    }));
    expect(res.status).toBe(200);
    const policy = await stored();
    expect(policy.scopes.map((s: { id: string }) => s.id)).toEqual(['two']);
    expect(policy.organisation.session.idleMinutes).toBe(0);
    expect(configManager.getPolicy().scopes?.map((s) => s.id)).toEqual(['two']);
    expect(audit.map((a) => a.action)).toEqual(['policy.import']);
  });

  it('refuses what isn\'t a policy object', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post('[1,2]')).status).toBe(400);
    expect((await stored()).scopes).toHaveLength(1);
  });
});
