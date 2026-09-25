import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useSettingsStore } from '../settings-store';
import { useAuthStore } from '../auth-store';
import { useMessageListTabsStore } from '../message-list-tabs-store';
import type { SortLevel } from '@/lib/message-list-order';
import type { Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

/**
 * A sender or subject order is collated by the server, and the versions
 * differ: Stalwart 1.0 lowercases, 0.16 compares raw bytes (capitals first).
 * Thread grouping keeps the order of a 1.0 folder as fetched and re-sorts
 * anything else (JMAPClient.keepsServerTextOrder), so the store records which
 * one the list is.
 */

const FROM_ASC: SortLevel[] = [{ criterion: 'from', direction: 'asc' }];

const mailbox = (overrides: Partial<Mailbox>): Mailbox => ({
  id: 'inbox', name: 'Inbox', role: 'inbox', sortOrder: 0,
  totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0,
  isSubscribed: true, isShared: false,
  ...overrides,
}) as Mailbox;

const inbox = mailbox({});
// A group's Inbox, shown in the sidebar's shared section.
const groupInbox = mailbox({ id: 'team:inbox', originalId: 'inbox', accountId: 'team', isShared: true });

/** A client whose accounts collate text the way `stalwart10Accounts` says. */
function makeClient(stalwart10Accounts: string[]) {
  return {
    getAccountId: () => 'acct',
    getEmails: vi.fn(async () => ({ emails: [], total: 0, hasMore: false, state: 'email-state' })),
    getThreads: vi.fn(async () => []),
    keepsServerTextOrder: vi.fn((accountId?: string) => stalwart10Accounts.includes(accountId ?? 'acct')),
  } as unknown as IJMAPClient & { keepsServerTextOrder: ReturnType<typeof vi.fn> };
}

describe('server text order of the message list', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState());
    useMessageListTabsStore.setState(useMessageListTabsStore.getInitialState());
    useSettingsStore.setState({ emailsPerPage: 50, emailKeywords: [], messageListOrder: FROM_ASC, messageListOrderScope: 'all' });
    useEmailStore.setState({
      ...useEmailStore.getInitialState(),
      selectedMailbox: 'inbox',
      mailboxes: [inbox, groupInbox],
    });
  });

  it('keeps the fetched sender order of a folder on Stalwart 1.0', async () => {
    const client = makeClient(['acct']);

    await useEmailStore.getState().fetchEmails(client, 'inbox');

    expect(useEmailStore.getState().listOrder).toEqual(FROM_ASC);
    expect(useEmailStore.getState().listKeepsServerTextOrder).toBe(true);
  });

  it('re-sorts the sender order of a folder on Stalwart 0.16', async () => {
    const client = makeClient([]);

    await useEmailStore.getState().fetchEmails(client, 'inbox');

    expect(useEmailStore.getState().listOrder).toEqual(FROM_ASC);
    expect(useEmailStore.getState().listKeepsServerTextOrder).toBe(false);
  });

  it('asks about the account of the shared folder that is open', async () => {
    const client = makeClient(['team']);
    useEmailStore.setState({ selectedMailbox: groupInbox.id });

    await useEmailStore.getState().fetchEmails(client, groupInbox.id);

    expect(client.keepsServerTextOrder).toHaveBeenCalledWith('team');
    expect(useEmailStore.getState().listKeepsServerTextOrder).toBe(true);
  });

  it('re-sorts a tag view, which merges its accounts on the client, even on Stalwart 1.0', async () => {
    const client = makeClient(['acct', 'team']);
    await useEmailStore.getState().fetchEmails(client, 'inbox');
    expect(useEmailStore.getState().listKeepsServerTextOrder).toBe(true);

    useEmailStore.setState({ selectedKeyword: 'red' });
    await useEmailStore.getState().fetchEmails(client);

    expect(useEmailStore.getState().listOrder).toEqual(FROM_ASC);
    expect(useEmailStore.getState().listKeepsServerTextOrder).toBe(false);
  });
});
