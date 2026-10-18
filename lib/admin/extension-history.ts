/**
 * Previously installed versions of admin plugins and themes, kept so an
 * update that turns out broken can be undone without the directory.
 *
 * Before `savePlugin`/`saveTheme` overwrites an installed extension with a
 * different version (or different bytes of the same version), the files that
 * are about to be replaced are copied here:
 *
 *   <config>/plugins/history/<id>/<version>/entry.json   the registry entry
 *   <config>/plugins/history/<id>/<version>/bundle.js    the code
 *   <config>/themes/history/<id>/<version>/entry.json
 *   <config>/themes/history/<id>/<version>/theme.css
 *   <config>/themes/history/<id>/<version>/skin.css      when the theme had one
 *
 * `KEEP` entries are kept per extension, oldest first out. Uninstalling an
 * extension removes its history: a later install under the same id starts
 * clean, like its config and policy do (extension-cleanup.ts).
 *
 * A rollback is an ordinary save of the snapshot through `savePlugin` or
 * `saveTheme`, so it is signed and hashed like any install, the version being
 * replaced is snapshotted in turn (a rollback can be rolled back), and the
 * current enabled/forced flags are kept. The snapshot's hash is checked
 * before it is restored: a history file edited on disk is refused rather
 * than installed for every user.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { getConfigDir } from './paths';
import type { ServerPlugin, ServerTheme } from './plugin-registry';

export type ExtensionKind = 'plugin' | 'theme';

/** How many previous versions are kept per extension. */
export const KEEP = 5;

export interface HistoryEntry {
  version: string;
  /** When this version was replaced, not when it was installed. */
  savedAt: string;
  /** SHA-256 of the bundle (plugins) or css + skin (themes). */
  contentHash: string;
  source?: ServerPlugin['source'];
}

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

function historyRoot(kind: ExtensionKind, id: string): string {
  if (!SAFE_ID_RE.test(id)) throw new Error('Invalid extension id');
  return path.join(getConfigDir(), kind === 'plugin' ? 'plugins' : 'themes', 'history', id);
}

/**
 * A version becomes one directory name. Published versions are `1.2.3` or
 * `1.2.3-beta.1`; anything else (an uploaded theme can call itself what it
 * likes) is reduced to that alphabet. The exact string lives in entry.json.
 */
function dirNameFor(version: string): string {
  const safe = version.replace(/[^0-9A-Za-z.-]/g, '_').replace(/^\.+/, '_').slice(0, 64);
  return safe || '_';
}

function hashOf(parts: Array<string | null | undefined>): string {
  const h = createHash('sha256');
  parts.forEach((p, i) => {
    if (i > 0) h.update('\0');
    h.update(p ?? '');
  });
  return h.digest('hex');
}

interface StoredEntry extends HistoryEntry {
  kind: ExtensionKind;
  entry: ServerPlugin | ServerTheme;
}

async function readEntry(dir: string): Promise<StoredEntry | null> {
  try {
    const raw = JSON.parse(await readFile(path.join(dir, 'entry.json'), 'utf-8')) as StoredEntry;
    if (!raw || typeof raw.version !== 'string' || typeof raw.savedAt !== 'string' || !raw.entry) return null;
    return raw;
  } catch {
    return null;
  }
}

async function readAll(kind: ExtensionKind, id: string): Promise<Array<StoredEntry & { dir: string }>> {
  const root = historyRoot(kind, id);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const out: Array<StoredEntry & { dir: string }> = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const entry = await readEntry(dir);
    if (entry) out.push({ ...entry, dir });
  }
  // Newest replacement first.
  out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  return out;
}

async function prune(kind: ExtensionKind, id: string): Promise<void> {
  const all = await readAll(kind, id);
  for (const stale of all.slice(KEEP)) {
    await rm(stale.dir, { recursive: true, force: true });
  }
}

/** The versions kept for an extension, most recently replaced first. */
export async function listHistory(kind: ExtensionKind, id: string): Promise<HistoryEntry[]> {
  if (!SAFE_ID_RE.test(id)) return [];
  return (await readAll(kind, id)).map(({ version, savedAt, contentHash, source }) => ({
    version,
    savedAt,
    contentHash,
    ...(source ? { source } : {}),
  }));
}

/**
 * Keep the plugin that is about to be overwritten. Called by the registry
 * inside its write lock, with the entry and code currently installed.
 */
export async function snapshotPlugin(current: ServerPlugin, code: string): Promise<void> {
  const dir = path.join(historyRoot('plugin', current.id), dirNameFor(current.version));
  await mkdir(dir, { recursive: true });
  const stored: StoredEntry = {
    kind: 'plugin',
    version: current.version,
    savedAt: new Date().toISOString(),
    contentHash: hashOf([code]),
    ...(current.source ? { source: current.source } : {}),
    entry: current,
  };
  await writeFile(path.join(dir, 'bundle.js'), code, 'utf-8');
  await writeFile(path.join(dir, 'entry.json'), JSON.stringify(stored, null, 2), 'utf-8');
  await prune('plugin', current.id);
}

/** Same for a theme: its registry entry, CSS and skin. */
export async function snapshotTheme(current: ServerTheme, css: string, skin: string | null): Promise<void> {
  const dir = path.join(historyRoot('theme', current.id), dirNameFor(current.version));
  await mkdir(dir, { recursive: true });
  const stored: StoredEntry = {
    kind: 'theme',
    version: current.version,
    savedAt: new Date().toISOString(),
    contentHash: hashOf([css, skin]),
    ...(current.source ? { source: current.source } : {}),
    entry: current,
  };
  await writeFile(path.join(dir, 'theme.css'), css, 'utf-8');
  if (skin !== null) await writeFile(path.join(dir, 'skin.css'), skin, 'utf-8');
  else await rm(path.join(dir, 'skin.css'), { force: true });
  await writeFile(path.join(dir, 'entry.json'), JSON.stringify(stored, null, 2), 'utf-8');
  await prune('theme', current.id);
}

/**
 * Drop the kept copy of one version. The registry calls this for the version
 * being installed: the live copy is the authoritative one now, and a
 * rollback should not offer what is already installed. (A re-install of the
 * same version with other bytes keeps the old bytes: the registry snapshots
 * after forgetting.)
 */
export async function forgetVersion(kind: ExtensionKind, id: string, version: string): Promise<void> {
  if (!SAFE_ID_RE.test(id)) return;
  for (const kept of await readAll(kind, id)) {
    if (kept.version === version) await rm(kept.dir, { recursive: true, force: true });
  }
}

/** Forget every kept version of an extension (on uninstall). */
export async function purgeHistory(kind: ExtensionKind, id: string): Promise<void> {
  if (!SAFE_ID_RE.test(id)) return;
  try {
    await rm(historyRoot(kind, id), { recursive: true, force: true });
  } catch (err) {
    logger.warn('[extension-history] could not remove history', { kind, id, error: err instanceof Error ? err.message : String(err) });
  }
}

export class HistoryError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = 'HistoryError';
  }
}

async function find(kind: ExtensionKind, id: string, version: string) {
  const match = (await readAll(kind, id)).find((e) => e.version === version);
  if (!match) throw new HistoryError(`No kept copy of ${id} ${version} on this server`, 404);
  return match;
}

export interface RestoredPlugin { kind: 'plugin'; entry: ServerPlugin; code: string }
export interface RestoredTheme { kind: 'theme'; entry: ServerTheme; css: string; skin: string | null }

/**
 * Read a kept version back, checking it is the one that was saved. The
 * caller installs it through the registry so it is signed and hashed like a
 * fresh install; `enabled`/`forceEnabled` are taken from what is installed
 * now, since a rollback is about the code, not about who sees it.
 */
export type Restored<K extends ExtensionKind> = K extends 'plugin' ? RestoredPlugin : RestoredTheme;

export async function readHistoryEntry<K extends ExtensionKind>(kind: K, id: string, version: string): Promise<Restored<K>> {
  const stored = await find(kind, id, version);
  const damaged = () => new HistoryError(`The kept copy of ${id} ${version} does not match what was saved; it was not restored`, 409);
  if (kind === 'plugin') {
    const code = await readFile(path.join(stored.dir, 'bundle.js'), 'utf-8').catch(() => null);
    if (code === null || hashOf([code]) !== stored.contentHash) throw damaged();
    const restored: RestoredPlugin = { kind: 'plugin', entry: stored.entry as ServerPlugin, code };
    return restored as Restored<K>;
  }
  const css = await readFile(path.join(stored.dir, 'theme.css'), 'utf-8').catch(() => null);
  const skin = await readFile(path.join(stored.dir, 'skin.css'), 'utf-8').catch(() => null);
  if (css === null || hashOf([css, skin]) !== stored.contentHash) throw damaged();
  const restored: RestoredTheme = { kind: 'theme', entry: stored.entry as ServerTheme, css, skin };
  return restored as Restored<K>;
}
