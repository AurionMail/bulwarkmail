import { appendFile, stat, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/lib/logger';
import { ensureStateDir, getStatePath } from './paths';
import { SENSITIVE_CONFIG_KEYS, type AuditEntry } from './types';

const REDACTED = '[redacted]';

/**
 * A config value as it may appear in the audit log. The dashboard hides the
 * session secret and the OAuth client secrets behind `hasValue` flags so a
 * stolen admin session cannot read them, so the log of a change must not
 * hand them out either (and must not keep them on disk past a rotation).
 */
export function redactConfigValueForAudit(key: string, value: unknown): unknown {
  if (SENSITIVE_CONFIG_KEYS.has(key)) {
    return typeof value === 'string' && value.length > 0 ? REDACTED : value;
  }
  if (key === 'jmapServers' && Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const e = entry as Record<string, unknown>;
      if (!e.oauth || typeof e.oauth !== 'object') return entry;
      const o = e.oauth as Record<string, unknown>;
      if (typeof o.clientSecret !== 'string' || o.clientSecret.length === 0) return entry;
      return { ...e, oauth: { ...o, clientSecret: REDACTED } };
    });
  }
  return value;
}

/**
 * Apply {@link redactConfigValueForAudit} to the detail of a config change,
 * whatever shape wrote it. Entries written before the redaction existed are
 * cleaned on the way out as well.
 */
export function redactAuditDetail(action: string, detail: Record<string, unknown>): Record<string, unknown> {
  if (action === 'config.update' && Array.isArray(detail.changes)) {
    return {
      ...detail,
      changes: detail.changes.map((change) => {
        if (!change || typeof change !== 'object') return change;
        const c = change as Record<string, unknown>;
        if (typeof c.key !== 'string') return change;
        return {
          ...c,
          ...('old' in c ? { old: redactConfigValueForAudit(c.key, c.old) } : {}),
          ...('new' in c ? { new: redactConfigValueForAudit(c.key, c.new) } : {}),
        };
      }),
    };
  }
  if (action === 'config.revert' && typeof detail.key === 'string' && 'oldValue' in detail) {
    return { ...detail, oldValue: redactConfigValueForAudit(detail.key, detail.oldValue) };
  }
  return detail;
}

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 3;
const AUDIT_LOG_FILE = 'audit.log';

function getAuditLogPath(): string {
  return getStatePath(AUDIT_LOG_FILE);
}

/**
 * Append an audit entry to the admin audit log. Stored under the state dir
 * so it remains writable when the config dir is mounted read-only.
 */
export async function auditLog(action: string, detail: Record<string, unknown>, ip: string): Promise<void> {
  await ensureStateDir();

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    action,
    detail: redactAuditDetail(action, detail),
    ip,
  };

  const logPath = getAuditLogPath();
  try {
    await appendFile(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    await rotateIfNeeded(logPath);
  } catch (error) {
    logger.error('Failed to write audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function rotateIfNeeded(logPath: string): Promise<void> {
  try {
    const stats = await stat(logPath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate: audit.log.3 → deleted, audit.log.2 → .3, audit.log.1 → .2, audit.log → .1
    for (let i = MAX_ROTATIONS; i >= 1; i--) {
      const from = i === 1 ? logPath : `${logPath}.${i - 1}`;
      const to = `${logPath}.${i}`;
      if (existsSync(from)) {
        try { await rename(from, to); } catch { /* target may exist on overwrite */ }
      }
    }
  } catch {
    // stat failed, probably file doesn't exist yet
  }
}

/**
 * Read audit log entries, newest first. Supports pagination.
 */
export async function readAuditLog(page: number = 1, limit: number = 50, actionFilter?: string): Promise<{ entries: AuditEntry[]; total: number }> {
  const logPath = getAuditLogPath();
  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let entries: AuditEntry[] = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter((e): e is AuditEntry => e !== null && typeof e === 'object')
      .map((e) => (e.detail && typeof e.detail === 'object' ? { ...e, detail: redactAuditDetail(e.action, e.detail) } : e));

    if (actionFilter) {
      entries = entries.filter(e => e.action === actionFilter);
    }

    const total = entries.length;
    entries.reverse();
    const start = (page - 1) * limit;
    return { entries: entries.slice(start, start + limit), total };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [], total: 0 };
    }
    logger.warn('Failed to read audit log', { error: error instanceof Error ? error.message : 'Unknown error' });
    return { entries: [], total: 0 };
  }
}
