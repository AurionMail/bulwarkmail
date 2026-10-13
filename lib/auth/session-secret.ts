import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { configManager } from '@/lib/admin/config-manager';
import { ensureStateDir, getStatePath } from '@/lib/admin/paths';
import { readFileEnv } from '@/lib/read-file-env';

/** Written on first start when no secret is configured (see ensureSessionSecret). */
const GENERATED_SECRET_FILE = '.session-secret';

/**
 * Resolve the session secret from any of the supported sources, in priority
 * order:
 *   1. SESSION_SECRET env var
 *   2. SESSION_SECRET_FILE-pointed file
 *   3. Admin override in config.json (set by the setup wizard)
 *   4. The secret generated on first start, in the admin state dir
 *
 * Returns an empty string when nothing is configured. Callers must treat
 * empty as "feature disabled" rather than crashing.
 *
 * The configManager fallback exists so the web installer can persist the
 * secret without touching .env files. It only takes effect if the env vars
 * aren't set, so existing deployments aren't affected.
 */
export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;

  const fromFile = readFileEnv(process.env.SESSION_SECRET_FILE);
  if (fromFile) return fromFile;

  const fromAdmin = configManager.get<string>('sessionSecret', '');
  if (fromAdmin) return fromAdmin;

  const fromAdminFile = readFileEnv(
    configManager.get<string>('sessionSecretFile', ''),
  );
  if (fromAdminFile) return fromAdminFile;

  return readFileEnv(getStatePath(GENERATED_SECRET_FILE)) || "";
}

export function hasSessionSecret(): boolean {
  return getSessionSecret().length > 0;
}

/**
 * Generate a session secret when none is configured, so remember me and
 * settings sync work on installs that skip the setup wizard (JMAP_SERVER_URL
 * set in the environment). It lives in the state dir, which is always
 * writable and a volume in docker-compose.yml; without a persistent volume a
 * restart issues a new one and signs everyone out.
 *
 * Returns true when this call wrote a new secret.
 */
export async function ensureSessionSecret(): Promise<boolean> {
  if (hasSessionSecret()) return false;
  await ensureStateDir();
  try {
    // 'wx' so two processes starting at once can't overwrite each other's.
    await writeFile(getStatePath(GENERATED_SECRET_FILE), randomBytes(32).toString('base64'), {
      flag: 'wx',
      mode: 0o600,
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
