import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Mailbox } from '@/lib/jmap/types';

// Sending destroys the autosaved draft. The folder counts have to follow the
// send itself, not the push that arrives some time later: until then Drafts
// still counted the draft that was just sent (#1412).

function mailbox(id: string, role: string, totalEmails: number): Mailbox {
  return { id, name: role, role, sortOrder: 0, totalEmails, unreadEmails: 0, totalThreads: totalEmails, unreadThreads: 0, isSubscribed: true } as Mailbox;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('folder counts after a send', () => {
  let client: IJMAPClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = {
      getAccountId: () => 'acc-1',
      pruneEmailSubmissions: vi.fn().mockResolvedValue(0),
      sendEmail: vi.fn().mockResolvedValue({ scheduled: false, emailId: 'sent-1', emailSubmissionId: 'sub-1' }),
      // What the server holds once the send returned: the draft is gone.
      getAllMailboxesWithState: vi.fn().mockResolvedValue({
        mailboxes: [mailbox('mb-drafts', 'drafts', 0), mailbox('mb-sent', 'sent', 1)],
        states: { 'acc-1': 'm2' },
      }),
    } as unknown as IJMAPClient;
    useAuthStore.setState({ client });
    useEmailStore.setState({
      emails: [],
      // The autosaved draft, counted before the send.
      mailboxes: [mailbox('mb-drafts', 'drafts', 1), mailbox('mb-sent', 'sent', 0)],
      mailboxSyncStates: { 'acc-1': 'm1' },
      selectedMailbox: 'mb-drafts',
      pendingUndoSend: null,
    });
  });

  it('stops counting the sent draft once the send returns', async () => {
    await useEmailStore.getState().sendEmail(client, ['bob@example.net'], 'Subject', 'body', undefined, undefined, undefined, undefined, 'draft-1');
    await flush();

    const drafts = useEmailStore.getState().mailboxes.find((mb) => mb.role === 'drafts');
    const sent = useEmailStore.getState().mailboxes.find((mb) => mb.role === 'sent');
    expect(drafts?.totalEmails).toBe(0);
    expect(sent?.totalEmails).toBe(1);
  });

  it("leaves the folders alone when the send went through another account's login", async () => {
    const otherLogin = { ...client, getAllMailboxesWithState: vi.fn() } as unknown as IJMAPClient;
    await useEmailStore.getState().sendEmail(otherLogin, ['bob@example.net'], 'Subject', 'body', undefined, undefined, undefined, undefined, 'draft-1');
    await flush();

    expect(otherLogin.getAllMailboxesWithState).not.toHaveBeenCalled();
    expect(useEmailStore.getState().mailboxes.find((mb) => mb.role === 'drafts')?.totalEmails).toBe(1);
  });

  it('keeps the counts after a failed send', async () => {
    vi.mocked(client.sendEmail).mockRejectedValueOnce(new Error('refused'));
    await expect(useEmailStore.getState().sendEmail(client, ['bob@example.net'], 'Subject', 'body')).rejects.toThrow('refused');
    await flush();

    expect(client.getAllMailboxesWithState).not.toHaveBeenCalled();
    expect(useEmailStore.getState().mailboxes.find((mb) => mb.role === 'drafts')?.totalEmails).toBe(1);
  });
});
