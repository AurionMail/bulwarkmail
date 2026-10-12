import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { SendCancelledCleanupError } from '@/lib/send-failure-message';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Email, Mailbox } from '@/lib/jmap/types';

// "Undo send" and "Cancel and edit" cancel the submission, then put the
// message back in Drafts (or remove an S/MIME copy). Only a failed cancel may
// read as "undo failed": after a cancel that went through, the mail no longer
// goes out, whatever fails next.

function mailbox(id: string, role: string): Mailbox {
  return { id, name: role, role, sortOrder: 0, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true } as Mailbox;
}

const pending = {
  submissionId: 'sub-1',
  emailId: 'sent-1',
  identityId: 'identity-1',
  sendAt: new Date(Date.now() + 10_000).toISOString(),
  isSmime: false,
};

const scheduled = {
  id: 'sent-1',
  emailSubmissionId: 'sub-1',
  scheduledAccountId: 'account-1',
  isSmimeScheduled: false,
} as unknown as Email;

describe('cancelling a send and restoring the draft', () => {
  let client: IJMAPClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    client = {
      getAccountId: vi.fn(() => 'account-1'),
      pruneEmailSubmissions: vi.fn(() => new Promise<number>(() => {})),
      getScheduledEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0, nextPosition: 0 }),
      cancelEmailSubmission: vi.fn().mockResolvedValue(undefined),
      restoreEmailToDraft: vi.fn().mockResolvedValue(undefined),
      deleteEmail: vi.fn().mockResolvedValue(undefined),
      getEmail: vi.fn().mockResolvedValue({ id: 'sent-1' }),
      getMailboxes: vi.fn().mockResolvedValue([]),
    } as unknown as IJMAPClient;
    useEmailStore.setState({
      emails: [],
      mailboxes: [mailbox('mb-drafts', 'drafts'), mailbox('mb-sent', 'sent')],
      pendingUndoSend: pending,
    });
  });

  it('undoes the send and returns the draft to open', async () => {
    const restored = await useEmailStore.getState().cancelUndoSend(client, pending);

    expect(client.cancelEmailSubmission).toHaveBeenCalledWith('sub-1', undefined);
    expect(client.restoreEmailToDraft).toHaveBeenCalledWith('sent-1', 'mb-drafts', 'mb-sent');
    expect(restored).toEqual({ id: 'sent-1' });
    expect(useEmailStore.getState().pendingUndoSend).toBeNull();
  });

  it('lets a failed cancel through as it is: the mail may still go out', async () => {
    vi.mocked(client.cancelEmailSubmission).mockRejectedValueOnce(new Error('The requested message is no longer in the queue.'));

    const error = await useEmailStore.getState().cancelUndoSend(client, pending).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(SendCancelledCleanupError);
    expect((error as Error).message).toBe('The requested message is no longer in the queue.');
    expect(client.restoreEmailToDraft).not.toHaveBeenCalled();
  });

  it('says the send was cancelled when only putting the message back in Drafts failed', async () => {
    vi.mocked(client.restoreEmailToDraft).mockRejectedValueOnce(new Error('Request failed: 503'));

    const error = await useEmailStore.getState().cancelUndoSend(client, pending).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SendCancelledCleanupError);
    expect((error as SendCancelledCleanupError).step).toBe('restore');
    // The undo toast is done with: the mail is not going out.
    expect(useEmailStore.getState().pendingUndoSend).toBeNull();
  });

  it('says the send was cancelled when only removing an S/MIME copy failed', async () => {
    vi.mocked(client.deleteEmail).mockRejectedValueOnce(new Error('Request failed: 503'));

    const error = await useEmailStore.getState().cancelUndoSend(client, { ...pending, isSmime: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SendCancelledCleanupError);
    expect((error as SendCancelledCleanupError).step).toBe('remove');
  });

  it('counts the undo as done when only reading the restored draft back failed', async () => {
    vi.mocked(client.getEmail).mockRejectedValueOnce(new Error('Request failed: 503'));

    await expect(useEmailStore.getState().cancelUndoSend(client, pending)).resolves.toBeNull();
    expect(client.restoreEmailToDraft).toHaveBeenCalled();
  });

  it('reports "Cancel and edit" the same way', async () => {
    vi.mocked(client.restoreEmailToDraft).mockRejectedValueOnce(new Error('Request failed: 503'));
    const restoreFailed = await useEmailStore.getState().cancelScheduledEmailForEdit(client, scheduled).catch((e: unknown) => e);
    expect(restoreFailed).toBeInstanceOf(SendCancelledCleanupError);
    expect(client.cancelEmailSubmission).toHaveBeenCalledWith('sub-1', 'account-1');

    vi.mocked(client.cancelEmailSubmission).mockRejectedValueOnce(new Error('cannotUnsend'));
    const cancelFailed = await useEmailStore.getState().cancelScheduledEmailForEdit(client, scheduled).catch((e: unknown) => e);
    expect(cancelFailed).not.toBeInstanceOf(SendCancelledCleanupError);

    await expect(useEmailStore.getState().cancelScheduledEmailForEdit(client, scheduled)).resolves.toEqual({ id: 'sent-1' });
  });

  it('restores mail sent from the own identity in the own Drafts, as before', async () => {
    const restored = await useEmailStore.getState().cancelUndoSend(client, { ...pending, submissionAccountId: 'account-1' });

    expect(client.restoreEmailToDraft).toHaveBeenCalledWith('sent-1', 'mb-drafts', 'mb-sent', 'account-1');
    expect(client.getMailboxes).not.toHaveBeenCalled();
    expect(client.getEmail).toHaveBeenCalledWith('sent-1', 'account-1');
    expect(restored).toEqual({ id: 'sent-1' });
  });
});

// userb's session on the test servers: the own account `e` and the group
// team@example.org as account `c`. Mail sent from the team identity is created
// in `c` together with its submission. Email ids are per account and repeat:
// live, `eaaaaab` is userb's first own message and the team account's too (on
// Stalwart 1.0 and 0.16.23). The group's folders come back in a different
// order on the two versions; the ids are the same.
const GROUP_MAILBOXES = {
  '1.0': [['a', 'inbox'], ['d', 'drafts'], ['c', 'junk'], ['b', 'trash'], ['e', 'sent']],
  '0.16': [['e', 'sent'], ['d', 'drafts'], ['a', 'inbox'], ['c', 'junk'], ['b', 'trash']],
} as const;

type StoredEmail = { mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>; subject: string };

/** A client for userb that keeps each account's messages apart, as the server does. */
function twoAccountClient(version: keyof typeof GROUP_MAILBOXES) {
  const accounts: Record<string, Record<string, StoredEmail>> = {
    e: { eaaaaab: { mailboxIds: { a: true }, keywords: { $seen: true }, subject: 'Unrelated message in the own inbox' } },
    c: { eaaaaab: { mailboxIds: { e: true }, keywords: { $seen: true }, subject: 'Sent from team@example.org' } },
  };
  const at = (accountId?: string) => accounts[accountId ?? 'e'];
  const client = {
    getAccountId: () => 'e',
    pruneEmailSubmissions: vi.fn(() => new Promise<number>(() => {})),
    getScheduledEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0, nextPosition: 0 }),
    cancelEmailSubmission: vi.fn().mockResolvedValue(undefined),
    getMailboxes: vi.fn(async (accountId?: string) => (accountId === 'c' ? GROUP_MAILBOXES[version] : GROUP_MAILBOXES['1.0'])
      .map(([id, role]) => mailbox(id, role))),
    restoreEmailToDraft: vi.fn(async (emailId: string, draftMailboxId: string, _sentMailboxId?: string, accountId?: string) => {
      const email = at(accountId)[emailId];
      if (!email) throw new Error('notFound');
      email.mailboxIds = { [draftMailboxId]: true };
      email.keywords = { ...email.keywords, $draft: true, $seen: true };
    }),
    deleteEmail: vi.fn(async (emailId: string, accountId?: string) => {
      delete at(accountId)[emailId];
    }),
    getEmail: vi.fn(async (emailId: string, accountId?: string) => {
      const email = at(accountId)[emailId];
      return email ? { id: emailId, ...email } : null;
    }),
  };
  return { client: client as unknown as IJMAPClient, accounts };
}

// The store's merged folder list: the own folders by their ids, the group's
// namespaced by account.
const OWN_AND_GROUP_FOLDERS = [
  mailbox('a', 'inbox'), mailbox('d', 'drafts'), mailbox('e', 'sent'),
  { ...mailbox('c:d', 'drafts'), originalId: 'd', accountId: 'c', isShared: true },
  { ...mailbox('c:e', 'sent'), originalId: 'e', accountId: 'c', isShared: true },
] as Mailbox[];

describe.each(['1.0', '0.16'] as const)('undoing a send from a group identity on Stalwart %s', (version) => {
  const groupPending = {
    submissionId: 'sub-team',
    emailId: 'eaaaaab',
    identityId: 'b',
    sendAt: new Date(Date.now() + 10_000).toISOString(),
    isSmime: false,
    submissionAccountId: 'c',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useEmailStore.setState({ emails: [], mailboxes: OWN_AND_GROUP_FOLDERS, pendingUndoSend: groupPending });
  });

  it('puts the message back in the group account\'s Drafts and leaves the own message with the same id alone', async () => {
    const { client, accounts } = twoAccountClient(version);

    const restored = await useEmailStore.getState().cancelUndoSend(client, groupPending);

    expect(client.cancelEmailSubmission).toHaveBeenCalledWith('sub-team', 'c');
    expect(client.getMailboxes).toHaveBeenCalledWith('c');
    expect(client.restoreEmailToDraft).toHaveBeenCalledWith('eaaaaab', 'd', 'e', 'c');
    expect(accounts.c.eaaaaab).toEqual({
      mailboxIds: { d: true }, keywords: { $seen: true, $draft: true }, subject: 'Sent from team@example.org',
    });
    expect(accounts.e.eaaaaab).toEqual({
      mailboxIds: { a: true }, keywords: { $seen: true }, subject: 'Unrelated message in the own inbox',
    });
    // The draft handed to the composer is the group's message.
    expect(client.getEmail).toHaveBeenCalledWith('eaaaaab', 'c');
    expect(restored).toMatchObject({ id: 'eaaaaab', subject: 'Sent from team@example.org' });
  });

  it('"Cancel and edit" restores a scheduled group message in the group account', async () => {
    const { client, accounts } = twoAccountClient(version);
    const scheduledTeam = { id: 'eaaaaab', emailSubmissionId: 'sub-team', scheduledAccountId: 'c', isSmimeScheduled: false } as unknown as Email;

    const restored = await useEmailStore.getState().cancelScheduledEmailForEdit(client, scheduledTeam);

    expect(client.cancelEmailSubmission).toHaveBeenCalledWith('sub-team', 'c');
    expect(accounts.c.eaaaaab.mailboxIds).toEqual({ d: true });
    expect(accounts.e.eaaaaab.mailboxIds).toEqual({ a: true });
    expect(accounts.e.eaaaaab.keywords.$draft).toBeUndefined();
    expect(restored).toMatchObject({ subject: 'Sent from team@example.org' });
  });

  it('"Cancel and compose again" removes an S/MIME group message in the group account only', async () => {
    const { client, accounts } = twoAccountClient(version);
    const scheduledTeam = { id: 'eaaaaab', emailSubmissionId: 'sub-team', scheduledAccountId: 'c', isSmimeScheduled: true } as unknown as Email;

    await expect(useEmailStore.getState().cancelScheduledEmailForEdit(client, scheduledTeam)).resolves.toBeNull();

    expect(client.deleteEmail).toHaveBeenCalledWith('eaaaaab', 'c');
    expect(accounts.c.eaaaaab).toBeUndefined();
    expect(accounts.e.eaaaaab.subject).toBe('Unrelated message in the own inbox');
  });

  it('reports a restore the group account refused as a cancelled send, touching nothing else', async () => {
    const { client, accounts } = twoAccountClient(version);
    delete accounts.c.eaaaaab;

    const error = await useEmailStore.getState().cancelUndoSend(client, groupPending).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SendCancelledCleanupError);
    expect(accounts.e.eaaaaab.mailboxIds).toEqual({ a: true });
  });
});
