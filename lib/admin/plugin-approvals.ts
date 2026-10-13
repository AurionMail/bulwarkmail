// Server-side admin plugin-approval store.
//
// Closes the "C4" audit finding: previously a plugin's `adminApproved` flag
// was client-only, so a malicious user could enable a plugin past the policy
// gate via DevTools. The server now tracks per-(pluginId, bundleHash) status
// and the `enablePlugin` flow consults it before letting a non-managed plugin
// run.
//
// Each entry has one of three states: 'pending' (user installed, waiting for
// admin), 'approved' (admin signed off), 'denied' (admin refused - kept so we
// don't keep asking).

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { ensureConfigDir, getConfigPath, assertWritable } from './paths';

export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface ApprovalEntry {
  pluginId: string;
  bundleHash: string;
  status: ApprovalStatus;
  /** Snapshot of the manifest at request time. */
  manifest: {
    name?: string;
    version?: string;
    author?: string;
    description?: string;
    permissions?: string[];
    httpOrigins?: string[];
    apiPostPaths?: string[];
  };
  requestedBy: string;     // JMAP username who triggered the request
  requestedAt: string;     // ISO 8601
  decidedBy?: string;      // admin username (set on approve/deny)
  decidedAt?: string;
}

interface ApprovalsFile {
  entries: ApprovalEntry[];
}

const APPROVALS_FILE = 'plugin-approvals.json';
const MAX_ENTRIES = 500; // hard cap so a misbehaving client can't grow the file unboundedly

let cached: ApprovalsFile | null = null;
let loadPromise: Promise<void> | null = null;

async function loadFromDisk(): Promise<ApprovalsFile> {
  await ensureConfigDir();
  const path = getConfigPath(APPROVALS_FILE);
  if (!existsSync(path)) return { entries: [] };
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter(isWellFormed) };
  } catch (err) {
    logger.warn('[plugin-approvals] failed to read file', { error: err instanceof Error ? err.message : String(err) });
    return { entries: [] };
  }
}

async function ensureLoaded(): Promise<void> {
  if (cached !== null) return;
  if (!loadPromise) {
    loadPromise = (async () => { cached = await loadFromDisk(); })();
  }
  await loadPromise;
}

async function flushToDisk(): Promise<void> {
  if (!cached) return;
  await ensureConfigDir();
  assertWritable('plugin-approvals.flushToDisk');
  const path = getConfigPath(APPROVALS_FILE);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(cached, null, 2), 'utf-8');
  await rename(tmp, path);
}

function isWellFormed(value: unknown): value is ApprovalEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.pluginId === 'string' &&
    typeof v.bundleHash === 'string' &&
    (v.status === 'pending' || v.status === 'approved' || v.status === 'denied') &&
    typeof v.requestedBy === 'string' &&
    typeof v.requestedAt === 'string' &&
    typeof v.manifest === 'object' && v.manifest !== null
  );
}

function findEntry(file: ApprovalsFile, pluginId: string, bundleHash: string): ApprovalEntry | undefined {
  return file.entries.find(e => e.pluginId === pluginId && e.bundleHash === bundleHash);
}

// ─── Public API ──────────────────────────────────────────────

export async function listApprovals(): Promise<ApprovalEntry[]> {
  await ensureLoaded();
  return [...cached!.entries];
}

export async function getApprovalStatus(pluginId: string, bundleHash: string): Promise<{ status: ApprovalStatus | 'not-requested'; decidedAt?: string }> {
  await ensureLoaded();
  const entry = findEntry(cached!, pluginId, bundleHash);
  if (!entry) return { status: 'not-requested' };
  return { status: entry.status, decidedAt: entry.decidedAt };
}

export async function requestApproval(
  pluginId: string,
  bundleHash: string,
  manifest: ApprovalEntry['manifest'],
  requestedBy: string,
): Promise<ApprovalEntry> {
  if (!pluginId || !bundleHash) throw new Error('pluginId and bundleHash required');
  await ensureLoaded();
  const file = cached!;
  const existing = findEntry(file, pluginId, bundleHash);
  if (existing) return existing;
  if (file.entries.length >= MAX_ENTRIES) {
    // Drop the oldest pending entry so a new request can land. Approved/denied
    // entries are preserved.
    const oldestPendingIdx = file.entries.findIndex(e => e.status === 'pending');
    if (oldestPendingIdx >= 0) file.entries.splice(oldestPendingIdx, 1);
    else throw new Error('plugin-approvals file is full');
  }
  const entry: ApprovalEntry = {
    pluginId,
    bundleHash,
    status: 'pending',
    manifest,
    requestedBy,
    requestedAt: new Date().toISOString(),
  };
  file.entries.push(entry);
  await flushToDisk();
  return entry;
}

export async function decideApproval(
  pluginId: string,
  bundleHash: string,
  decision: 'approved' | 'denied',
  decidedBy: string,
): Promise<ApprovalEntry> {
  await ensureLoaded();
  const file = cached!;
  const entry = findEntry(file, pluginId, bundleHash);
  if (!entry) throw new Error('approval entry not found');
  entry.status = decision;
  entry.decidedAt = new Date().toISOString();
  entry.decidedBy = decidedBy;
  await flushToDisk();
  return entry;
}

export async function revokeApproval(pluginId: string, bundleHash: string): Promise<void> {
  await ensureLoaded();
  const file = cached!;
  const idx = file.entries.findIndex(e => e.pluginId === pluginId && e.bundleHash === bundleHash);
  if (idx < 0) return;
  file.entries.splice(idx, 1);
  await flushToDisk();
}
