/**
 * "Recover deleted items": messages Stalwart keeps after they were deleted
 * for good (an emptied Trash, an expunge, Trash cleaned up after its
 * retention). Stalwart Enterprise only, and only when the admin sets
 * `archiveDeletedItemsFor` (DataRetention). Nothing here could be tried on a
 * server yet (no test server has a license): the shapes come from the
 * Stalwart source, 0.16.23 and 1.0 alike.
 *
 * - x:ArchivedItem/query, /get, /set: crates/jmap/src/registry/mapping/archived_item.rs.
 *   A user without the Impersonate permission only ever sees the items of
 *   the account the call names (`with_account`, `is_account_filtered`); an
 *   admin's query has no such filter, so the client keeps only the items of
 *   the account it asked for.
 * - The object: crates/registry/src/schema/structs.rs, `ArchivedItem` (tagged
 *   by `@type`) and `ArchivedEmail` (from, subject, receivedAt, size,
 *   accountId, archivedAt, archivedUntil, blobId). No folder is kept.
 * - Archived when the message is deleted for good:
 *   crates/services/src/index_queue/index.rs (1.0) and
 *   crates/services/src/task_manager/index.rs (0.16). `from` is
 *   "Name <address>", the address or the name; `receivedAt` is the message's
 *   Date header; `archivedAt` is when it was deleted for good.
 * - Restoring: x:ArchivedItem/set update `{ status: "requestRestore" }`
 *   removes the item and schedules a RestoreArchivedItem task, which puts
 *   the message back in the Inbox, unread and without keywords
 *   (crates/services/src/task_manager/tasks/restore_item.rs). Only emails
 *   are restored; other types end as "Not implemented".
 * - Permissions: users and groups get sysArchivedItemGet/Query/Update by
 *   default (crates/common/src/auth/permissions.rs); without a license every
 *   call answers `forbidden` (crates/jmap/src/registry/mod.rs,
 *   `assert_enterprise_object`).
 */

import { jmapErrorType } from '@/lib/jmap/jmap-error';

export const STALWART_CAPABILITY = 'urn:stalwart:jmap';
export const ARCHIVED_ITEM_USING = ['urn:ietf:params:jmap:core', STALWART_CAPABILITY];

/** One deleted message the server still keeps. */
export interface ArchivedEmail {
  id: string;
  /** Sender as the server stored it: a name, an address, or both. */
  fromName: string;
  fromEmail: string;
  subject: string;
  /** The message's own date (Date header), ISO. Null when the server had none. */
  receivedAt: string | null;
  /** When it was deleted for good, ISO. */
  archivedAt: string;
  /** Until when the server keeps it, ISO. */
  archivedUntil: string | null;
  size: number;
  /** The JMAP account it belongs to, when the server said. */
  accountId: string | null;
}

export interface RestoreResult {
  id: string;
  ok: boolean;
  /** The server's reason when it refused this one, or the error of the whole call. */
  error?: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** "Name <address>", "address" or "Name", as the server builds it. */
export function parseArchivedFrom(from: string): { name: string; email: string } {
  const value = from.trim();
  const angle = /^(.*?)\s*<([^<>\s]+)>$/.exec(value);
  if (angle) return { name: angle[1].replace(/^"(.*)"$/, '$1').trim(), email: angle[2] };
  if (/^[^\s@]+@[^\s@]+$/.test(value)) return { name: '', email: value };
  return { name: value, email: '' };
}

/**
 * The deleted messages in an x:ArchivedItem/get list. Other kinds (files,
 * events, contacts, scripts) are left out: the server can't restore them.
 * With `accountId`, items of other accounts are left out too.
 */
export function parseArchivedItems(list: unknown, accountId?: string): ArchivedEmail[] {
  if (!Array.isArray(list)) return [];
  const out: ArchivedEmail[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item['@type'] !== 'Email') continue;
    const id = str(item.id);
    const archivedAt = isoOrNull(item.archivedAt);
    if (!id || !archivedAt) continue;
    const owner = str(item.accountId) || null;
    if (accountId && owner && owner !== accountId) continue;
    const from = parseArchivedFrom(str(item.from));
    out.push({
      id,
      fromName: from.name,
      fromEmail: from.email,
      subject: str(item.subject),
      receivedAt: isoOrNull(item.receivedAt),
      archivedAt,
      archivedUntil: isoOrNull(item.archivedUntil),
      size: typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
      accountId: owner,
    });
  }
  return out;
}

/**
 * What the user sees: items deleted within the last `days` (0 = all the
 * server keeps), without those the server no longer keeps, newest first.
 */
export function visibleArchivedItems(items: ArchivedEmail[], days: number, now: number = Date.now()): ArchivedEmail[] {
  const since = days > 0 ? now - days * 24 * 60 * 60 * 1000 : -Infinity;
  return items
    .filter((item) => {
      const deleted = Date.parse(item.archivedAt);
      if (deleted < since) return false;
      return !item.archivedUntil || Date.parse(item.archivedUntil) > now;
    })
    .sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt) || (a.id < b.id ? 1 : -1));
}

/**
 * The calls that restore `ids`, split at maxObjectsInSet. The narrowest
 * change a user may make: only `status` (and `archivedUntil`) are writable.
 */
export function buildRestoreCalls(ids: string[], accountId: string, maxObjectsInSet: number): Array<[string, Record<string, unknown>, string]> {
  const step = Math.max(1, Math.floor(maxObjectsInSet));
  const calls: Array<[string, Record<string, unknown>, string]> = [];
  for (let i = 0; i < ids.length; i += step) {
    const update = Object.fromEntries(ids.slice(i, i + step).map((id) => [id, { status: 'requestRestore' }]));
    calls.push(['x:ArchivedItem/set', { accountId, update }, `r${calls.length}`]);
  }
  return calls;
}

/** Each id of a restore call: updated, refused with the reason, or failed with the call. */
export function readRestoreResults(
  calls: Array<[string, Record<string, unknown>, string]>,
  responses: Array<[string, Record<string, unknown>, string]>,
): RestoreResult[] {
  const byCallId = new Map(responses.map((r) => [r[2], r]));
  const results: RestoreResult[] = [];
  for (const [, args, callId] of calls) {
    const ids = Object.keys(args.update as Record<string, unknown>);
    const [method, result] = byCallId.get(callId) ?? [];
    if (method !== 'x:ArchivedItem/set' || !result) {
      const reason = method === 'error' ? str(result?.description) || str(result?.type) || 'error' : 'No answer';
      results.push(...ids.map((id) => ({ id, ok: false, error: reason })));
      continue;
    }
    const updated = (result.updated ?? {}) as Record<string, unknown>;
    const notUpdated = (result.notUpdated ?? {}) as Record<string, { type?: string; description?: string } | undefined>;
    for (const id of ids) {
      if (id in updated) results.push({ id, ok: true });
      else {
        const refused = notUpdated[id];
        results.push({ id, ok: false, error: refused?.description || refused?.type || 'notUpdated' });
      }
    }
  }
  return results;
}

/**
 * How a failed archive call counts for detection: `unsupported` when the
 * server says no (no Enterprise license: `forbidden`; not Stalwart or too
 * old: `unknownMethod`, `unknownCapability`), `error` for anything else
 * (offline, a server error), which is asked again sooner.
 */
export function classifyArchiveError(error: unknown): 'unsupported' | 'error' {
  const type = jmapErrorType(error);
  if (type === 'forbidden' || type === 'unknownMethod' || type === 'unknownCapability' || type === 'accountNotFound') return 'unsupported';
  const message = error instanceof Error ? error.message : String(error);
  if (/unknownCapability|unknownMethod/.test(message)) return 'unsupported';
  return 'error';
}
