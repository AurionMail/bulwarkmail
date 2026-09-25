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
});
