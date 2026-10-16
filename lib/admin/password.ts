import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { logger } from '@/lib/logger';
import {
  ensureConfigDir,
  ensureStateDir,
  getConfigPath,
  getStatePath,
  assertWritable,
} from './paths';
import type { AdminConfigData, AdminStateData } from './types';
import { readFileEnv } from '../read-file-env';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // 2^14
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SALT_LENGTH = 32;

const ADMIN_CONFIG_FILE = 'admin.json';
const ADMIN_STATE_FILE = 'admin-state.json';

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(SALT_LENGTH);
    scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION }, (err, derivedKey) => {
      if (err) return reject(err);
      // Format: $scrypt$N=16384,r=8,p=1$<salt_base64>$<hash_base64>
      const params = `N=${SCRYPT_COST},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELIZATION}`;
      resolve(`$scrypt$${params}$${salt.toString('base64')}$${derivedKey.toString('base64')}`);
    });
  });
}

function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (stored.startsWith('$scrypt$')) {
      const parts = stored.split('$');
      if (parts.length !== 5) return resolve(false);
      const paramStr = parts[2];
      const salt = Buffer.from(parts[3], 'base64');
      const storedHash = Buffer.from(parts[4], 'base64');

      const params: Record<string, number> = {};
      for (const p of paramStr.split(',')) {
        const [k, v] = p.split('=');
        params[k] = parseInt(v, 10);
      }

      scrypt(password, salt, storedHash.length, { N: params.N, r: params.r, p: params.p }, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(timingSafeEqual(derivedKey, storedHash));
      });
    } else {
      resolve(false);
    }
  });
}

function isHashed(value: string): boolean {
  return value.startsWith('$scrypt$') || value.startsWith('$2a$') || value.startsWith('$2b$');
}

// ─── Disk I/O ───────────────────────────────────────────────────────────────

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.warn('Failed to read admin file', {
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function readConfigData(): Promise<AdminConfigData | null> {
  return readJson<AdminConfigData>(getConfigPath(ADMIN_CONFIG_FILE));
}

async function readStateData(): Promise<AdminStateData | null> {
  return readJson<AdminStateData>(getStatePath(ADMIN_STATE_FILE));
}

async function writeConfigData(data: AdminConfigData): Promise<void> {
  assertWritable('save admin password');
  await ensureConfigDir();
  const target = getConfigPath(ADMIN_CONFIG_FILE);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, target);
}

async function writeStateData(data: AdminStateData): Promise<void> {
  await ensureStateDir();
  const target = getStatePath(ADMIN_STATE_FILE);
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, target);
}

// ─── Cache & init ───────────────────────────────────────────────────────────

let cachedConfig: AdminConfigData | null = null;
let cachedState: AdminStateData | null = null;
let initialized = false;

function freshState(): AdminStateData {
  const now = new Date().toISOString();
  return { createdAt: now, lastLogin: null, passwordChangedAt: now };
}

/**
 * Initialize admin password on startup.
 * - If admin.json exists, use it (state file may or may not exist; created on first need).
 * - Otherwise, if ADMIN_PASSWORD env var is set, hash and persist it.
 * - Otherwise, admin dashboard stays disabled.
 */
export async function initAdminPassword(): Promise<boolean> {
  if (initialized) return cachedConfig !== null;

  const existingConfig = await readConfigData();
  if (existingConfig) {
    cachedConfig = existingConfig;
    cachedState = (await readStateData()) ?? freshState();
    if (!(await readStateData())) {
      // No state file yet (fresh install or migration); create it.
      try {
        await writeStateData(cachedState);
      } catch {
        /* state dir may not be writable yet during early boot probes */
      }
    }
    initialized = true;
    logger.info('Admin dashboard enabled (password loaded from admin.json)');
    return true;
  }

  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envPassword) {
    initialized = true;
    logger.info('Admin dashboard disabled (no ADMIN_PASSWORD set)');
    return false;
  }

  const hash = isHashed(envPassword) ? envPassword : await hashPassword(envPassword);
  cachedConfig = { passwordHash: hash, passwordHashFile: undefined };
  cachedState = freshState();
  await writeConfigData(cachedConfig);
  await writeStateData(cachedState);
  initialized = true;
  if (isHashed(envPassword)) {
    logger.info('Admin password hash saved to admin.json from environment variable');
  } else {
    logger.warn('Admin password hashed and saved to admin.json. You may now remove ADMIN_PASSWORD from .env');
  }
  return true;
}

/**
 * Verify a password against the stored admin hash.
 */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!cachedConfig) cachedConfig = await readConfigData();
  if (!cachedConfig) return false;
  if (cachedConfig.passwordHash) {
    return verifyPassword(password, cachedConfig.passwordHash);
  } else if (cachedConfig.passwordHashFile) {
    let passwordHash = readFileEnv(cachedConfig.passwordHashFile);
    if (passwordHash) {
      return verifyPassword(password, passwordHash);
    }
  }
  logger.error('The admin password hash could neither be retrieved from passwordHash nor from passwordHashFile in admin.json');
  return false;
}

/**
 * Change the admin password. Returns true on success.
 */
export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<boolean> {
  const valid = await verifyAdminPassword(currentPassword);
  if (!valid) return false;

  // Write first, then swap the cache: a refused write (read-only config)
  // must not leave the new password active until the next restart.
  const hash = await hashPassword(newPassword);
  const next: AdminConfigData = { passwordHash: hash, passwordHashFile: undefined };
  await writeConfigData(next);
  cachedConfig = next;

  cachedState = {
    ...(cachedState ?? freshState()),
    passwordChangedAt: new Date().toISOString(),
  };
  await writeStateData(cachedState);
  return true;
}

/**
 * Set the admin password without verifying a current one. Used by the setup
 * wizard during initial bootstrap.
 *
 * Refuses to overwrite an existing password unless `allowOverwrite` is true.
 * The wizard's finish route passes `allowOverwrite: true` so a half-completed
 * setup (admin.json left behind by an ADMIN_PASSWORD env var or an aborted
 * earlier wizard run, while setupComplete is still false) can be recovered
 * by simply running the wizard again. Safe because the finish route is
 * already gated by the one-time setup token.
 */
export async function setInitialAdminPassword(
  newPassword: string,
  options: { allowOverwrite?: boolean } = {},
): Promise<boolean> {
  const existing = await readConfigData();
  if (existing && !options.allowOverwrite) return false;
  const hash = await hashPassword(newPassword);
  cachedConfig = { passwordHash: hash, passwordHashFile: undefined };
  cachedState = freshState();
  await writeConfigData(cachedConfig);
  await writeStateData(cachedState);
  initialized = true;
  return true;
}

/**
 * Update the last login timestamp.
 */
export async function updateLastLogin(): Promise<void> {
  if (!cachedConfig) return;
  cachedState = {
    ...(cachedState ?? freshState()),
    lastLogin: new Date().toISOString(),
  };
  try {
    await writeStateData(cachedState);
  } catch (error) {
    logger.warn('Failed to update admin last-login state', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Check if admin dashboard is enabled (has a password configured).
 */
export function isAdminEnabled(): boolean {
  return cachedConfig !== null;
}

/**
 * Get admin metadata (without the hash).
 */
export function getAdminMeta(): AdminStateData | null {
  if (!cachedConfig) return null;
  return cachedState ?? freshState();
}
