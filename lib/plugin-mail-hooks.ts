// Shared pieces for firing the mail plugin hooks (organize, folders, sync)
// from the email store: the plain views plugins receive, and the rules that
// decide which hooks a move fires.

import { emailHooks } from './plugin-hooks';
import type { Mailbox } from './jmap/types';
import type { IJMAPClient } from './jmap/client-interface';
import type { MailboxView, QuotaView } from './plugin-types';

export function mailboxToView(mailbox: Mailbox): MailboxView {
  return {
    id: mailbox.id,
    name: mailbox.name,
    role: mailbox.role ?? null,
    totalEmails: mailbox.totalEmails ?? 0,
    unreadEmails: mailbox.unreadEmails ?? 0,
    parentId: mailbox.parentId ?? null,
  };
}

export function quotaToView(quota: { used: number; total: number }): QuotaView {
  return {
    used: quota.used,
    total: quota.total,
    percentUsed: quota.total > 0 ? Math.round((quota.used / quota.total) * 1000) / 10 : 0,
  };
}

/** Bare email ids of a key-based selection (`scope:id` or `id`), each once. */
export function idsFromSelectionKeys(keys: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const key of keys) ids.add(key.slice(key.lastIndexOf(':') + 1));
  return [...ids];
}

/** Keywords a `{ keyword: on/off }` change puts on and takes off. */
export function keywordChangeLists(changes: Record<string, boolean>): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const [keyword, on] of Object.entries(changes)) (on ? added : removed).push(keyword);
  return { added, removed };
}

/**
 * Whether a folder is the Archive folder or one of its sub-folders: a year or
 * month archive files messages under the Archive folder, and those
 * sub-folders carry no role of their own.
 */
export function isArchiveFolder(mailboxId: string | null | undefined, mailboxes: Mailbox[]): boolean {
  if (!mailboxId) return false;
  const find = (id: string) => mailboxes.find((mb) => mb.id === id) ?? mailboxes.find((mb) => mb.originalId === id);
  const seen = new Set<string>();
  let current = find(mailboxId);
  while (current && !seen.has(current.id)) {
    if (current.role === 'archive') return true;
    seen.add(current.id);
    current = current.parentId ? find(current.parentId) : undefined;
  }
  return false;
}

export interface EmailMove {
  emailIds: string[];
  fromMailboxId: string | null;
  toMailboxId: string;
}

/**
 * Ask plugins before messages are moved. A move into the archive also asks
 * onBeforeEmailArchive. Returns false when a plugin stopped it.
 */
export async function allowEmailMove(move: EmailMove, mailboxes: Mailbox[]): Promise<boolean> {
  if (move.emailIds.length === 0) return true;
  if (emailHooks.onBeforeEmailMove.size > 0
    && !(await emailHooks.onBeforeEmailMove.intercept({ ...move, emailIds: [...move.emailIds] }))) {
    return false;
  }
  if (emailHooks.onBeforeEmailArchive.size > 0
    && isArchiveFolder(move.toMailboxId, mailboxes)
    && !isArchiveFolder(move.fromMailboxId, mailboxes)
    && !(await emailHooks.onBeforeEmailArchive.intercept({ emailIds: [...move.emailIds] }))) {
    return false;
  }
  return true;
}

/**
 * Tell plugins messages were moved; a move into the archive is also an
 * archive, a move out of it an unarchive.
 */
export function emitEmailMove(move: EmailMove, mailboxes: Mailbox[]): void {
  if (move.emailIds.length === 0) return;
  void emailHooks.onAfterEmailMove.emit({ ...move, emailIds: [...move.emailIds] });
  const toArchive = isArchiveFolder(move.toMailboxId, mailboxes);
  const fromArchive = isArchiveFolder(move.fromMailboxId, mailboxes);
  if (toArchive && !fromArchive) {
    void emailHooks.onEmailArchive.emit({ emailIds: [...move.emailIds] });
  } else if (fromArchive && !toArchive) {
    void emailHooks.onEmailUnarchive.emit({ emailIds: [...move.emailIds], toMailboxId: move.toMailboxId });
  }
}

/**
 * Create a folder straight through a client (the Archive folder and its
 * year/month folders, a quick rule's new folder), asking and telling plugins
 * like the store's createMailbox does. Resolves null when a plugin said no.
 * `parentId` is the server's id of the parent, as the client takes it.
 */
export async function createMailboxWithHooks(
  client: IJMAPClient,
  name: string,
  parentId?: string,
  accountId?: string,
  options?: { role?: string },
): Promise<Mailbox | null> {
  if (emailHooks.onBeforeMailboxCreate.size > 0
    && !(await emailHooks.onBeforeMailboxCreate.intercept({ name, parentId: parentId ?? null }))) {
    return null;
  }
  const created = await client.createMailbox(name, parentId, accountId, options);
  void emailHooks.onMailboxCreate.emit({ mailboxId: created?.id ?? null, name, parentId: parentId ?? null });
  return created;
}
