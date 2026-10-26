import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Mailbox } from '@/lib/jmap/types';

// Stalwart 1.0 stops accepting submissions once an account holds
// `maxSubmissions` EmailSubmission records, so the records that can no longer
// be cancelled are pruned whenever they pile up or turn prunable: at startup
// and on EmailSubmission changes (both refresh the scheduled metadata), after
// sends, and after undo. The prune is background work - nothing waits for it.

function mailbox(id: string, role: string): Mailbox {
  return { id, name: role, role, sortOrder: 0, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true } as Mailbox;
}

describe('pruning submission records from the store', () => {
  let prune: ReturnType<typeof vi.fn>;
  let client: IJMAPClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Never settles: the store must not wait for it.
    prune = vi.fn(() => new Promise<number>(() => {}));
    client = {
      pruneEmailSubmissions: prune,
      getScheduledEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0, nextPosition: 0 }),
      sendEmail: vi.fn().mockResolvedValue({ scheduled: false, emailId: 'sent-1', emailSubmissionId: 'sub-1' }),
      getMailboxes: vi.fn().mockResolvedValue([mailbox('mb-drafts', 'drafts'), mailbox('mb-sent', 'sent')]),
      sendRawEmail: vi.fn().mockResolvedValue({ scheduled: false, emailId: 'raw-1', emailSubmissionId: 'sub-2', isSmime: true }),
      cancelEmailSubmission: vi.fn().mockResolvedValue(undefined),
      restoreEmailToDraft: vi.fn().mockResolvedValue(undefined),
      getEmail: vi.fn().mockResolvedValue(null),
    } as unknown as IJMAPClient;
    useEmailStore.setState({ emails: [], mailboxes: [mailbox('mb-drafts', 'drafts'), mailbox('mb-sent', 'sent')], pendingUndoSend: null });
  });

  it('starts a prune on every scheduled-metadata refresh without waiting for it', async () => {
    await useEmailStore.getState().refreshScheduledMetadata(client);

    expect(prune).toHaveBeenCalledTimes(1);
    expect(client.getScheduledEmails).toHaveBeenCalled();
  });

  it('starts a prune after a send, and not after a failed one', async () => {
    await useEmailStore.getState().sendEmail(client, ['bob@example.net'], 'Subject', 'body');
    await useEmailStore.getState().sendRawEmail(client, new Blob(['raw']), 'identity-1');
    expect(prune).toHaveBeenCalledTimes(2);

    vi.mocked(client.sendEmail).mockRejectedValueOnce(new Error('refused'));
    await expect(useEmailStore.getState().sendEmail(client, ['bob@example.net'], 'Subject', 'body')).rejects.toThrow('refused');
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it('starts a prune after undoing a send', async () => {
    await useEmailStore.getState().cancelUndoSend(client, {
      submissionId: 'sub-1',
      emailId: 'sent-1',
      identityId: 'identity-1',
      sendAt: new Date(Date.now() + 10_000).toISOString(),
      isSmime: false,
    });

    expect(client.cancelEmailSubmission).toHaveBeenCalledWith('sub-1', undefined);
    expect(prune).toHaveBeenCalledTimes(1);
  });
});
