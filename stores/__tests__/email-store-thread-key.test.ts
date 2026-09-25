import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { threadKeyFor } from '@/lib/thread-utils';
import { jmapError } from '@/lib/jmap/jmap-error';
import { CROSS_ALL } from '@/lib/jmap/types';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

/**
 * #1012: JMAP thread ids are only unique within their account - Stalwart hands
 * out per-account counters such as "b" - so in the cross-account views two
 * accounts routinely list a thread "b" that has nothing in common. Thread state
 * has to be keyed by the account-scoped thread key, and thread fetches routed
 * to the account that owns the thread.
 */

const makeMailbox = (overrides: Partial<Mailbox> = {}): Mailbox => ({
  id: 'inbox',
  name: 'Inbox',
  role: 'inbox',
  sortOrder: 0,
  totalEmails: 0,
  unreadEmails: 0,
  totalThreads: 0,
  unreadThreads: 0,
  myRights: {
    mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true,
    maySetKeywords: true, mayCreateChild: true, mayRename: true, mayDelete: true, maySubmit: true,
  },
  isSubscribed: true,
  isShared: false,
  ...overrides,
});

type Login = 'a' | 'b';

// Both accounts have a thread "b"; only the source stamps tell them apart.
const inAccount = (login: Login, id: string, overrides: Partial<Email> = {}): Email =>
  ({
    id,
    threadId: 'b',
    mailboxIds: { inbox: true },
    keywords: {},
    size: 1,
    receivedAt: '2026-09-10T10:00:00Z',
    from: [{ email: `${login}@example.com` }],
    subject: id,
    preview: '',
    hasAttachment: false,
    accountId: `login-${login}`,
    accountLabel: `${login}@example.com`,
    sourceClientAccountId: `login-${login}`,
    sourceAccountId: `acct-${login}`,
    ...overrides,
  }) as unknown as Email;

function makeClient(login: Login, threadSize: number) {
  return {
    getAccountId: () => `acct-${login}`,
    getThreads: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, emailIds: Array.from({ length: threadSize }, (_, i) => `${login}-${id}-${i}`) })),
    ),
    batchMarkAsRead: vi.fn(async () => {}),
    getThreadEmails: vi.fn(async (threadId: string) => [
      inAccount(login, `${login}-full-1`, { threadId, sourceClientAccountId: undefined, sourceAccountId: undefined }),
      inAccount(login, `${login}-full-2`, { threadId, sourceClientAccountId: undefined, sourceAccountId: undefined }),
    ]),
  } as unknown as IJMAPClient & {
    getThreads: ReturnType<typeof vi.fn>;
    getThreadEmails: ReturnType<typeof vi.fn>;
    batchMarkAsRead: ReturnType<typeof vi.fn>;
  };
}

describe('thread identity across accounts (#1012)', () => {
  let clientA: ReturnType<typeof makeClient>;
  let clientB: ReturnType<typeof makeClient>;
  const a1 = inAccount('a', 'a1');
  const b1 = inAccount('b', 'b1');

  beforeEach(() => {
    clientA = makeClient('a', 3);
    clientB = makeClient('b', 1);
    useAuthStore.setState({
      activeAccountId: 'login-a',
      getClientForAccount: (id: string) =>
        (id === 'login-a' ? clientA : id === 'login-b' ? clientB : undefined) as never,
    } as never);
    useEmailStore.setState({
      isUnifiedView: true,
      unifiedRole: null,
      crossView: 'all',
      selectedMailbox: CROSS_ALL,
      viewingAccountId: null,
      mailboxes: [makeMailbox()],
      accountMailboxes: { 'acct-a': [makeMailbox()], 'acct-b': [makeMailbox()] },
      emails: [a1, b1],
      expandedThreadIds: new Set(),
      threadEmailsCache: new Map(),
      threadEmailCounts: new Map(),
      isLoadingThread: null,
      processingReadStatus: new Set(),
    });
  });

  it('asks each account for its own threads and files the counts under the scoped key', async () => {
    await useEmailStore.getState().fetchThreadEmailCounts(clientA);

    expect(clientA.getThreads).toHaveBeenCalledWith(['b'], 'acct-a');
    expect(clientB.getThreads).toHaveBeenCalledWith(['b'], 'acct-b');
    const counts = useEmailStore.getState().threadEmailCounts;
    expect(counts.get(threadKeyFor(a1))).toBe(3);
    expect(counts.get(threadKeyFor(b1))).toBe(1);
    // The bare id must not be a key any more: it could only ever hold one
    // account's answer.
    expect(counts.has('b')).toBe(false);
  });

  it('fetches a thread from the account that owns it and caches it under the scoped key', async () => {
    const emails = await useEmailStore.getState().fetchThreadEmails(clientA, threadKeyFor(b1));

    expect(clientB.getThreadEmails).toHaveBeenCalledWith('b', 'acct-b');
    expect(clientA.getThreadEmails).not.toHaveBeenCalled();
    expect(emails.map((e) => e.id)).toEqual(['b-full-1', 'b-full-2']);
    // Re-stamped with the owning account so later actions route correctly.
    expect(emails.every((e) => e.sourceAccountId === 'acct-b' && e.sourceClientAccountId === 'login-b')).toBe(true);

    const cache = useEmailStore.getState().threadEmailsCache;
    expect(cache.has(threadKeyFor(b1))).toBe(true);
    expect(cache.has(threadKeyFor(a1))).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  it('marks only the owning account\'s messages read when a thread is expanded', async () => {
    await useEmailStore.getState().markThreadAsRead(clientA, threadKeyFor(a1));

    expect(clientA.batchMarkAsRead).toHaveBeenCalledWith(['a1'], true, 'acct-a');
    expect(clientB.batchMarkAsRead).not.toHaveBeenCalled();
    const byId = new Map(useEmailStore.getState().emails.map((e) => [e.id, e]));
    expect(byId.get('a1')?.keywords?.$seen).toBe(true);
    expect(byId.get('b1')?.keywords?.$seen).toBeUndefined();
  });

  it('marks a thread of a shared account read in that account, through the login that reaches it', async () => {
    // A group's mailbox in the unified view: reached through login a, owned
    // by the group's JMAP account. Without the account id the write lands in
    // the login's own account, where Stalwart answers notFound or marks an
    // unrelated message with the same id.
    const shared = inAccount('a', 'g1', { threadId: 'c', sourceAccountId: 'acct-team' });
    useEmailStore.setState({ emails: [a1, b1, shared] });

    await useEmailStore.getState().markThreadAsRead(clientA, threadKeyFor(shared));

    expect(clientA.batchMarkAsRead).toHaveBeenCalledTimes(1);
    expect(clientA.batchMarkAsRead).toHaveBeenCalledWith(['g1'], true, 'acct-team');
    expect(useEmailStore.getState().emails.find((e) => e.id === 'g1')?.keywords?.$seen).toBe(true);
  });

  it('marks a thread read in the group account whose folder is open, outside the unified view', async () => {
    // The sidebar's shared section lists a group folder's mail without source
    // stamps; the open folder names the account.
    const groupInbox = makeMailbox({ id: 'acct-team:inbox', originalId: 'inbox', accountId: 'acct-team', isShared: true });
    const plain = (id: string) => inAccount('a', id, {
      threadId: 't7', sourceClientAccountId: undefined, sourceAccountId: undefined, accountId: undefined,
    });
    useEmailStore.setState({
      isUnifiedView: false,
      crossView: null,
      selectedMailbox: groupInbox.id,
      mailboxes: [makeMailbox(), groupInbox],
      emails: [plain('m1'), plain('m2')],
    });

    await useEmailStore.getState().markThreadAsRead(clientA, threadKeyFor(plain('m1')));

    expect(clientA.batchMarkAsRead).toHaveBeenCalledWith(['m1', 'm2'], true, 'acct-team');
  });

  it('marks the messages of a thread the server accepted when it refuses some (Stalwart 0.16 and 1.0)', async () => {
    // A message the user may not mark in a shared folder stays unread; the
    // error names it, the rest of the batch was written.
    const g1 = inAccount('a', 'g1', { threadId: 'c', sourceAccountId: 'acct-team' });
    const g2 = inAccount('a', 'g2', { threadId: 'c', sourceAccountId: 'acct-team' });
    useEmailStore.setState({ emails: [a1, b1, g1, g2] });
    const refusal = jmapError('Failed to mark as read: forbidden', { type: 'forbidden' });
    refusal.jmapFailedIds = ['g2'];
    clientA.batchMarkAsRead.mockRejectedValueOnce(refusal);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await useEmailStore.getState().markThreadAsRead(clientA, threadKeyFor(g1));

    const byId = new Map(useEmailStore.getState().emails.map((e) => [e.id, e]));
    expect(byId.get('g1')?.keywords?.$seen).toBe(true);
    expect(byId.get('g2')?.keywords?.$seen).toBeUndefined();
    logged.mockRestore();
  });

  it('keeps expansion state apart for same-id threads of different accounts', () => {
    useEmailStore.getState().toggleThreadExpansion(threadKeyFor(a1));

    const expanded = useEmailStore.getState().expandedThreadIds;
    expect(expanded.has(threadKeyFor(a1))).toBe(true);
    expect(expanded.has(threadKeyFor(b1))).toBe(false);
  });
});
