/**
 * Delegates (Settings > Sharing): give one person access to mail, calendars
 * and contacts in one step, list who has access to what, and take it away
 * everywhere. Pure functions over the user's shareable items
 * (JMAPClient.getShareTargets); JMAPClient.applyShareChanges sends what they
 * build.
 *
 * Stalwart has no "send as" or "send on behalf" for a person's own account,
 * so delegates get no submission right; the dialog says so.
 */

import type { ShareChange, ShareChangeResult, ShareTarget } from '@/lib/jmap/share-batch';
import { accessLevelOf, accessRights, type AccessLevel, type ShareKind } from '@/lib/jmap/share-rights';

export type MailScope = 'all' | 'inbox' | 'none';
export type CollectionScope = 'default' | 'all' | 'none';

/** What a delegate gets: which folders, calendars and address books. */
export interface DelegateScope {
  mail: MailScope;
  calendars: CollectionScope;
  addressBooks: CollectionScope;
}

export const DEFAULT_DELEGATE_SCOPE: DelegateScope = { mail: 'all', calendars: 'default', addressBooks: 'default' };

export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write'];

// Bulwark's own list of senders whose images load (stores/contact-store.ts,
// TRUSTED_SENDERS_BOOK_NAME). It is an address book on the server, but not
// one a delegate needs.
const TRUSTED_SENDERS_BOOK_NAME = 'Trusted Senders';

function ofKind(targets: ShareTarget[], kind: ShareKind): ShareTarget[] {
  return targets.filter((t) => t.kind === kind);
}

function defaultOf(collections: ShareTarget[]): ShareTarget[] {
  const flagged = collections.find((c) => c.isDefault);
  return flagged ? [flagged] : collections.slice(0, 1);
}

function delegableAddressBooks(targets: ShareTarget[]): ShareTarget[] {
  return ofKind(targets, 'addressBook').filter((b) => b.name !== TRUSTED_SENDERS_BOOK_NAME || b.isDefault);
}

/** The items a scope covers. Files are never part of it. */
export function selectTargets(targets: ShareTarget[], scope: DelegateScope): ShareTarget[] {
  const mailboxes = ofKind(targets, 'mailbox');
  const mail = scope.mail === 'all'
    ? mailboxes
    : scope.mail === 'inbox' ? mailboxes.filter((m) => m.role?.toLowerCase() === 'inbox') : [];
  const calendars = ofKind(targets, 'calendar');
  const books = delegableAddressBooks(targets);
  const pick = (list: ShareTarget[], s: CollectionScope) => (s === 'all' ? list : s === 'default' ? defaultOf(list) : []);
  return [...mail, ...pick(calendars, scope.calendars), ...pick(books, scope.addressBooks)];
}

function change(target: ShareTarget, principalId: string, rights: ShareChange['rights']): ShareChange {
  return { kind: target.kind, accountId: target.accountId, id: target.id, name: target.name, principalId, rights };
}

/**
 * The changes that give `principalId` `level` access to what `scope` covers.
 * With `replace` (the "Change" of someone who already has access), the
 * folders, calendars and address books outside the scope lose their access;
 * shared files stay as they are, since the dialog doesn't offer them.
 */
export function buildGrantChanges(
  targets: ShareTarget[],
  principalId: string,
  scope: DelegateScope,
  level: AccessLevel,
  options: { replace?: boolean } = {},
): ShareChange[] {
  const selected = selectTargets(targets, scope);
  const chosen = new Set(selected.map((t) => `${t.kind}:${t.id}`));
  const changes = selected.map((t) => change(t, principalId, accessRights(t.kind, level)));
  if (options.replace) {
    for (const t of targets) {
      if (t.kind === 'file' || chosen.has(`${t.kind}:${t.id}`)) continue;
      if (principalId in t.shareWith) changes.push(change(t, principalId, null));
    }
  }
  return changes;
}

/** The changes that take every grant of `principalId` away, files included. */
export function buildRevokeChanges(targets: ShareTarget[], principalId: string): ShareChange[] {
  return targets.filter((t) => principalId in t.shareWith).map((t) => change(t, principalId, null));
}

export interface DelegateItem {
  kind: ShareKind;
  id: string;
  name: string;
  /** null: shared without read access (calendar free/busy only). */
  level: AccessLevel | null;
}

export interface DelegateSummary {
  principalId: string;
  /** "mixed" when some items are read only and others writable; null when nothing is readable. */
  level: AccessLevel | 'mixed' | null;
  mail: { shared: number; total: number; inbox: boolean };
  calendars: { shared: number; total: number };
  addressBooks: { shared: number; total: number };
  files: number;
  items: DelegateItem[];
}

/**
 * Everyone who has access to something of the user's, one entry per person
 * or group, in the order they first appear. `excludeIds` leaves out the
 * user's own principal, should a server list it.
 */
export function summarizeDelegates(targets: ShareTarget[], excludeIds: string[] = []): DelegateSummary[] {
  const exclude = new Set(excludeIds);
  const byPrincipal = new Map<string, DelegateItem[]>();
  for (const target of targets) {
    for (const [principalId, rights] of Object.entries(target.shareWith)) {
      if (exclude.has(principalId) || !rights) continue;
      const items = byPrincipal.get(principalId) ?? [];
      items.push({ kind: target.kind, id: target.id, name: target.name, level: accessLevelOf(target.kind, rights) });
      byPrincipal.set(principalId, items);
    }
  }

  const totals = {
    mailbox: ofKind(targets, 'mailbox').length,
    calendar: ofKind(targets, 'calendar').length,
    addressBook: delegableAddressBooks(targets).length,
  };
  const inboxIds = new Set(ofKind(targets, 'mailbox').filter((m) => m.role?.toLowerCase() === 'inbox').map((m) => m.id));

  return [...byPrincipal.entries()].map(([principalId, items]) => {
    const count = (kind: ShareKind) => items.filter((i) => i.kind === kind).length;
    const levels = new Set(items.map((i) => i.level).filter((l): l is AccessLevel => l !== null));
    return {
      principalId,
      level: levels.size === 0 ? null : levels.size > 1 ? 'mixed' : [...levels][0],
      mail: { shared: count('mailbox'), total: totals.mailbox, inbox: items.some((i) => i.kind === 'mailbox' && inboxIds.has(i.id)) },
      calendars: { shared: count('calendar'), total: totals.calendar },
      addressBooks: { shared: count('addressBook'), total: totals.addressBook },
      files: count('file'),
      items,
    };
  });
}

/** The dialog's starting point for "Change": what the person has now. */
export function scopeOfSummary(summary: DelegateSummary, targets: ShareTarget[]): { scope: DelegateScope; level: AccessLevel } {
  const sharedIds = new Set(summary.items.map((i) => `${i.kind}:${i.id}`));
  const collection = (kind: 'calendar' | 'addressBook', shared: number, total: number): CollectionScope => {
    if (shared === 0) return 'none';
    if (shared === total && total > 1) return 'all';
    const list = kind === 'addressBook' ? delegableAddressBooks(targets) : ofKind(targets, kind);
    const def = defaultOf(list)[0];
    return def && sharedIds.has(`${kind}:${def.id}`) ? 'default' : 'all';
  };
  const { mail } = summary;
  return {
    scope: {
      mail: mail.shared === 0 ? 'none' : mail.shared === mail.total ? 'all' : 'inbox',
      calendars: collection('calendar', summary.calendars.shared, summary.calendars.total),
      addressBooks: collection('addressBook', summary.addressBooks.shared, summary.addressBooks.total),
    },
    // Files aren't in the dialog, so their rights don't decide its level.
    level: summary.items.some((i) => i.kind !== 'file' && i.level === 'write') ? 'write' : 'read',
  };
}

/**
 * The levels the admin allows (`delegationRights.allowedValues`). Values
 * other than "read" and "write" are ignored; a list with neither leaves
 * read only, the safe end.
 */
export function allowedLevels(allowedValues: unknown[] | null): AccessLevel[] {
  if (!allowedValues) return [...ACCESS_LEVELS];
  const allowed = ACCESS_LEVELS.filter((level) => allowedValues.includes(level));
  return allowed.length > 0 ? allowed : ['read'];
}

/** Whether a scope gives access to anything at all. */
export function scopeIsEmpty(scope: DelegateScope): boolean {
  return scope.mail === 'none' && scope.calendars === 'none' && scope.addressBooks === 'none';
}

/** The changes that failed, for the report and for "Try again". */
export function failedChanges(results: ShareChangeResult[]): ShareChangeResult[] {
  return results.filter((r) => !r.ok);
}
