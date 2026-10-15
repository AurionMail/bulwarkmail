import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useSettingsStore } from '../settings-store';
import { forgetFolderLists } from '@/lib/folder-list-cache';
import { clearAllStores, evictAll, restoreAccount, snapshotAccount } from '@/lib/account-state-manager';
import type { SortLevel } from '@/lib/message-list-order';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

/**
 * Switching back to an account repainted its list several times: the restored
 * rows were drawn by date because the snapshot did not keep the order they
 * were fetched in ("unread first" jumped when the refresh landed), and the
 * refresh re-read the whole page even when nothing had changed.
 */

const UNREAD_FIRST: SortLevel[] = [{ criterion: 'unread', direction: 'desc' }];

const makeEmail = (id: string): Email =>
  ({
    id,
    threadId: `t-${id}`,
    mailboxIds: { inbox: true },
    keywords: {},
    from: [{ email: 'a@example.com' }],
    subject: id,
    receivedAt: '2026-10-08T10:00:00Z',
    size: 1,
  }) as unknown as Email;

const inbox = {
  id: 'inbox',
  originalId: 'inbox',
  name: 'Inbox',
  role: 'inbox',
  accountId: 'acc',
  totalEmails: 2,
  unreadEmails: 1,
  myRights: {},
} as unknown as Mailbox;

function makeClient() {
  const getEmails = vi.fn(async () => ({ emails: [makeEmail('b'), makeEmail('a')], hasMore: false, total: 2, state: 's2' }));
  const getEmailChanges = vi.fn(async () => ({ created: [], updated: [], destroyed: [], newState: 's2', hasMoreChanges: false }));
  const client = {
    getEmails,
    getEmailChanges,
    getSomeEmails: vi.fn(async () => []),
    getAccountId: () => 'acc',
    getThreadEmails: vi.fn(async () => []),
  } as unknown as IJMAPClient;
  return { client, getEmails, getEmailChanges };
}

beforeEach(() => {
  evictAll();
  forgetFolderLists();
  useSettingsStore.setState({ emailsPerPage: 50, messageListOrder: UNREAD_FIRST, messageListOrderScope: 'inbox' });
  clearAllStores();
});

describe('account snapshot', () => {
  it('keeps the order and sync state the rows were fetched with', () => {
    useEmailStore.setState({
      emails: [makeEmail('a')],
      mailboxes: [inbox],
      selectedMailbox: 'inbox',
      listOrder: UNREAD_FIRST,
      emailListSync: { state: 's1', accountId: 'acc', mailboxId: 'inbox' },
      threadEmailCounts: new Map([['t-a', 3]]),
    });
    snapshotAccount('A');
    clearAllStores();

    expect(useEmailStore.getState().listOrder).toEqual([]);
    expect(useEmailStore.getState().emailListSync).toBeNull();

    restoreAccount('A');
    const s = useEmailStore.getState();
    expect(s.listOrder).toEqual(UNREAD_FIRST);
    expect(s.emailListSync).toEqual({ state: 's1', accountId: 'acc', mailboxId: 'inbox' });
    expect(s.threadEmailCounts.get('t-a')).toBe(3);
  });
});

describe('background refresh of restored rows', () => {
  function restoreRows(order: SortLevel[]) {
    useEmailStore.setState({
      emails: [makeEmail('a'), makeEmail('b')],
      mailboxes: [inbox],
      selectedMailbox: 'inbox',
      listOrder: order,
      emailListSync: { state: 's1', accountId: 'acc', mailboxId: 'inbox' },
      threadEmailCounts: new Map([['t-a', 1], ['t-b', 1]]),
    });
  }

  it('asks only for what changed and leaves the rows alone when nothing did', async () => {
    restoreRows(UNREAD_FIRST);
    const before = useEmailStore.getState().emails;
    const { client, getEmails, getEmailChanges } = makeClient();

    await useEmailStore.getState().fetchEmails(client, 'inbox', { background: true });

    expect(getEmailChanges).toHaveBeenCalledWith('s1', undefined, expect.any(Number));
    expect(getEmails).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails).toBe(before);
    expect(useEmailStore.getState().emailListSync?.state).toBe('s2');
  });

  it('re-reads the page when the order changed since the rows were fetched', async () => {
    restoreRows([]);
    const { client, getEmails } = makeClient();

    await useEmailStore.getState().fetchEmails(client, 'inbox', { background: true });

    expect(getEmails).toHaveBeenCalled();
    expect(useEmailStore.getState().emails.map((e) => e.id)).toEqual(['b', 'a']);
    expect(useEmailStore.getState().listOrder).toEqual(UNREAD_FIRST);
  });
});
