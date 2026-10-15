import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// An empty config dir so no developer admin override supplies a secret.
process.env.ADMIN_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), 'bw-secret-config-'));

const { ensureSessionSecret, getSessionSecret, hasSessionSecret } = await import('@/lib/auth/session-secret');

describe('ensureSessionSecret', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'bw-secret-state-'));
    vi.stubEnv('ADMIN_STATE_DIR', stateDir);
    vi.stubEnv('SESSION_SECRET', undefined);
    vi.stubEnv('SESSION_SECRET_FILE', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('generates a secret on first start when none is configured', async () => {
    expect(hasSessionSecret()).toBe(false);

    expect(await ensureSessionSecret()).toBe(true);

    const secret = getSessionSecret();
    expect(Buffer.from(secret, 'base64')).toHaveLength(32);
    expect(readFileSync(path.join(stateDir, '.session-secret'), 'utf-8')).toBe(secret);
  });

  it('keeps the generated secret across restarts', async () => {
    await ensureSessionSecret();
    const first = getSessionSecret();

    expect(await ensureSessionSecret()).toBe(false);
    expect(getSessionSecret()).toBe(first);
  });

  it('writes nothing when SESSION_SECRET is set', async () => {
    vi.stubEnv('SESSION_SECRET', 'from-env');

    expect(await ensureSessionSecret()).toBe(false);
    expect(existsSync(path.join(stateDir, '.session-secret'))).toBe(false);
    expect(getSessionSecret()).toBe('from-env');
  });
});
