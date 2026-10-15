import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useSettingsStore } from '../settings-store';
import { useAuthStore } from '../auth-store';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// #1169: new mail in a muted Inbox, or an Inbox of a muted account, does not
// raise the in-app new-mail notification (its sound).

const inbox = { id: 'inbox', role: 'inbox', isShared: false } as Mailbox;

function email(id: string, receivedAt: string): Email {
  return {
    id, threadId: `thread-${id}`, mailboxIds: { inbox: true }, keywords: {},
    subject: id, receivedAt, from: [{ email: 'sender@example.com' }], to: [],
    preview: '', size: 1, hasAttachment: false,
  } as Email;
}

function client(rows: Email[]) {
  return {
    getEmails: vi.fn(async () => ({ emails: rows, total: rows.length, hasMore: false, state: 's' })),
    getThreads: vi.fn(async () => []),
    getAccountId: () => 'me',
  } as unknown as IJMAPClient;
}

async function arrive() {
  const old = email('old', '2026-10-01T00:00:00Z');
  useEmailStore.setState({ emails: [old], totalEmails: 1 });
  await useEmailStore.getState().refreshCurrentMailbox(client([email('new', '2026-10-15T00:00:00Z'), old]));
  return useEmailStore.getState().newEmailNotification?.id ?? null;
}

describe('new-mail notification in a muted Inbox (#1169)', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState());
    useSettingsStore.setState({
      emailsPerPage: 25, messageListOrder: [], messageListOrderScope: 'inbox',
      notificationMutes: { accounts: [], mailboxes: {} },
    });
    useEmailStore.setState({
      ...useEmailStore.getInitialState(),
      selectedMailbox: 'inbox', mailboxes: [inbox],
    });
  });

  it('notifies for new Inbox mail by default', async () => {
    expect(await arrive()).toBe('new');
  });

  it('stays quiet when the Inbox is muted', async () => {
    useSettingsStore.setState({ notificationMutes: { accounts: [], mailboxes: { 'me/inbox': true } } });
    expect(await arrive()).toBeNull();
  });

  it('stays quiet when the account is muted, unless the Inbox is unmuted again', async () => {
    useSettingsStore.setState({ notificationMutes: { accounts: ['me'], mailboxes: {} } });
    expect(await arrive()).toBeNull();

    useEmailStore.setState({ newEmailNotification: null });
    useSettingsStore.setState({ notificationMutes: { accounts: ['me'], mailboxes: { 'me/inbox': false } } });
    expect(await arrive()).toBe('new');
  });
});
