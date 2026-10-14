// Per-user store of the credentials users connected for plugins. One
// encrypted file per mail account; the secrets never leave the server again
// except as an auth header on a request the proxy forwards to the
// credential's own origin.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { decryptPayload, encryptPayload } from '@/lib/auth/crypto';
import type { CredentialInject } from './credentials';

export interface VaultUser {
  username: string;
  serverUrl: string;
}

export interface StoredCredential {
  origin: string;
  inject: CredentialInject;
  label: string;
  username?: string;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

/** What the browser may see about a stored credential: never the secret. */
export interface CredentialSummary {
  pluginId: string;
  credentialId: string;
  label: string;
  origin: string;
  username?: string;
  connected: boolean;
  updatedAt: string;
}

type VaultData = Record<string, Record<string, StoredCredential>>;

/** Cap on credentials per user, across all plugins. */
export const MAX_USER_CREDENTIALS = 64;

function vaultDir(): string {
  return process.env.PLUGIN_SECRETS_DIR
    || path.join(process.env.SETTINGS_DATA_DIR || path.join(process.cwd(), 'data', 'settings'), '..', 'plugin-secrets');
}

export function userKey(user: VaultUser): string {
  return createHash('sha256').update(`${user.username}:${user.serverUrl}`).digest('hex');
}

function vaultPath(user: VaultUser): string {
  const dir = path.resolve(vaultDir());
  const file = path.resolve(dir, `${userKey(user)}.enc`);
  if (!file.startsWith(dir + path.sep)) throw new Error('Invalid vault path');
  return file;
}

async function load(user: VaultUser): Promise<VaultData> {
  let raw: string;
  try {
    raw = await readFile(vaultPath(user), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const payload = decryptPayload(raw, 'plugin-secrets');
  // Bound to this user: a file copied over from another account's name
  // decrypts, but carries the other account's key and is ignored.
  if (!payload || payload.u !== userKey(user)) return {};
  const data = payload.d;
  return data && typeof data === 'object' ? (data as VaultData) : {};
}

async function save(user: VaultUser, data: VaultData): Promise<void> {
  const file = vaultPath(user);
  if (Object.keys(data).length === 0) {
    try { await unlink(file); } catch { /* nothing stored */ }
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, encryptPayload({ u: userKey(user), d: data }, 'plugin-secrets'), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, file);
}

// Writes for one user run one after another, so two saves can't drop each
// other's changes.
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(user: VaultUser, task: () => Promise<T>): Promise<T> {
  const key = userKey(user);
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

export async function getUserCredential(user: VaultUser, pluginId: string, credentialId: string): Promise<StoredCredential | null> {
  const data = await load(user);
  return data[pluginId]?.[credentialId] ?? null;
}

export async function listUserCredentials(user: VaultUser, pluginId?: string): Promise<CredentialSummary[]> {
  const data = await load(user);
  const out: CredentialSummary[] = [];
  for (const [pid, creds] of Object.entries(data)) {
    if (pluginId && pid !== pluginId) continue;
    for (const [cid, c] of Object.entries(creds)) {
      out.push({
        pluginId: pid, credentialId: cid, label: c.label, origin: c.origin,
        ...(c.username ? { username: c.username } : {}),
        connected: !!c.secret || c.inject.type === 'none',
        updatedAt: c.updatedAt,
      });
    }
  }
  return out;
}

export class VaultFullError extends Error {
  constructor() {
    super(`At most ${MAX_USER_CREDENTIALS} plugin credentials per account`);
  }
}

/**
 * Save a credential. Changing the origin of a saved one drops its secret, so
 * a secret is only ever sent where the user first approved it.
 */
export function putUserCredential(
  user: VaultUser,
  pluginId: string,
  credentialId: string,
  input: { origin: string; inject: CredentialInject; label: string; username?: string; secret?: string },
): Promise<void> {
  return serialize(user, async () => {
    const data = await load(user);
    const existing = data[pluginId]?.[credentialId];
    const count = Object.values(data).reduce((n, c) => n + Object.keys(c).length, 0);
    if (!existing && count >= MAX_USER_CREDENTIALS) throw new VaultFullError();
    const now = new Date().toISOString();
    const keepSecret = existing && existing.origin === input.origin ? existing.secret : undefined;
    data[pluginId] = {
      ...(data[pluginId] ?? {}),
      [credentialId]: {
        origin: input.origin,
        inject: input.inject,
        label: input.label,
        ...(input.username ? { username: input.username } : {}),
        ...((input.secret ?? keepSecret) ? { secret: input.secret ?? keepSecret } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
    };
    await save(user, data);
  });
}

/** Store a secret captured from a response for an existing credential. */
export function setUserCredentialSecret(
  user: VaultUser,
  pluginId: string,
  credentialId: string,
  secret: string,
  username?: string,
): Promise<boolean> {
  return serialize(user, async () => {
    const data = await load(user);
    const existing = data[pluginId]?.[credentialId];
    if (!existing) return false;
    data[pluginId][credentialId] = {
      ...existing,
      secret,
      ...(username ? { username } : {}),
      updatedAt: new Date().toISOString(),
    };
    await save(user, data);
    return true;
  });
}

/** Remove one credential, or all of a plugin's when credentialId is omitted. */
export function deleteUserCredentials(user: VaultUser, pluginId: string, credentialId?: string): Promise<void> {
  return serialize(user, async () => {
    const data = await load(user);
    if (!data[pluginId]) return;
    if (credentialId) {
      delete data[pluginId][credentialId];
      if (Object.keys(data[pluginId]).length === 0) delete data[pluginId];
    } else {
      delete data[pluginId];
    }
    await save(user, data);
  });
}
