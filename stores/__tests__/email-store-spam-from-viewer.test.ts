import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// #695: with the unread quick-filter active, the push refresh drops the
// now-read message from `emails` while it is still open in the viewer. Marking
// it as spam must still reach the server (via `selectedEmail`) - and when the
// message is nowhere to be found, fail loudly instead of letting the caller
// show a success toast.

function makeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'inbox',
    name: 'Inbox',
    sortOrder: 0,
    totalEmails: 1,
    unreadEmails: 0,
    totalThreads: 1,
    unreadThreads: 0,
    myRights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      mayCreateChild: true,
      mayRename: true,
      mayDelete: true,
      maySubmit: true,
    },
    isSubscribed: true,
    isShared: false,
    ...overrides,
  } as Mailbox;
}

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'email-1',
    threadId: 'thread-1',
    subject: 'Hi',
    receivedAt: new Date().toISOString(),
    keywords: { $seen: true },
    mailboxIds: { inbox: true },
    ...overrides,
  } as Email;
}

describe('markAsSpam from the viewer after the list dropped the message (#695)', () => {
  let client: IJMAPClient;

  beforeEach(() => {
    client = {
      markAsSpam: vi.fn().mockResolvedValue(undefined),
    } as unknown as IJMAPClient;

    useAuthStore.setState({
      activeAccountId: 'account-a',
      getClientForAccount: (id: string) => (id === 'account-a' ? client : undefined) as never,
    } as never);
    useSettingsStore.setState({ deleteAction: 'trash' } as never);

    useEmailStore.setState({
      isUnifiedView: false,
      unifiedRole: null,
      viewingAccountId: null,
      selectedMailbox: 'inbox',
      mailboxes: [
        makeMailbox({ id: 'inbox', role: 'inbox' }),
        makeMailbox({ id: 'junk', name: 'Junk', role: 'junk', totalEmails: 0, totalThreads: 0 }),
      ],
      accountMailboxes: {},
      emails: [],
      selectedEmail: makeEmail({ id: 'e1' }),
      spamUndoCache: new Map(),
    });
  });

  it('falls back to selectedEmail when the list no longer holds the message', async () => {
    await useEmailStore.getState().markAsSpam(client, 'e1');

    expect(client.markAsSpam).toHaveBeenCalledWith('e1', undefined, false);
    expect(useEmailStore.getState().spamUndoCache.get('e1')).toMatchObject({
      emailId: 'e1',
      originalMailboxId: 'inbox',
    });
  });

  it('rejects when the message is neither listed nor selected', async () => {
    await expect(useEmailStore.getState().markAsSpam(client, 'missing')).rejects.toThrow(/not found/i);
    expect(client.markAsSpam).not.toHaveBeenCalled();
  });
});
