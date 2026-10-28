// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configManager } from '../config-manager';

let dir: string;

async function load(policy: Record<string, unknown>) {
  await writeFile(path.join(dir, 'policy.json'), JSON.stringify(policy), 'utf-8');
  await configManager.reload();
  return configManager.getPolicy();
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bw-org-policy-'));
  process.env.ADMIN_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.ADMIN_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('policy.json organisation settings', () => {
  it('moves a locked sessionTimeout to the organisation idle timeout', async () => {
    const policy = await load({ features: {}, restrictions: { sessionTimeout: { locked: true, value: 30 }, density: { locked: true } } });
    expect(policy.organisation?.session.idleMinutes).toBe(30);
    expect(policy.restrictions).toEqual({ density: { locked: true } });
  });

  it('keeps an idle timeout already set and drops the old key', async () => {
    const policy = await load({
      restrictions: { sessionTimeout: { locked: true, value: 30 } },
      organisation: { session: { idleMinutes: 5 } },
    });
    expect(policy.organisation?.session.idleMinutes).toBe(5);
    expect(policy.restrictions.sessionTimeout).toBeUndefined();
  });

  it('sanitises hand-written scopes and organisation settings on load', async () => {
    const policy = await load({
      organisation: { externalMail: { senderLabel: 'on' } },
      scopes: [{ id: 'ok', label: 'OK', match: { domains: ['example.org'] }, policy: {} }, { id: 'Bad Id' }],
    });
    expect(policy.organisation?.externalMail.senderLabel).toBe(false);
    expect(policy.scopes?.map((s) => s.id)).toEqual(['ok']);
  });
});
