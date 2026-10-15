import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingInitialData, useEmailStore } from '../email-store';
import { useSettingsStore } from '../settings-store';
import type { Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// login() starts loading the mail data (prefetchInitialData). The mail view's
// bootstrap asks pendingInitialData whether that load is running or has just
// finished, and joins or skips it instead of sending everything again.

const inbox = { id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 0, unreadEmails: 0, sortOrder: 0, myRights: {} } as unknown as Mailbox;

function makeClient() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const client = {
    getAllMailboxes: vi.fn(async () => { await gate; return [inbox]; }),
    getQuota: vi.fn(async () => null),
    getEmails: vi.fn(async () => ({ emails: [], hasMore: false, total: 0, state: 's1' })),
    getTagCounts: vi.fn(async () => ({})),
    getAccountId: () => 'acc',
  } as unknown as IJMAPClient;
  return { client, release };
}

describe('pendingInitialData', () => {
  beforeEach(() => {
    useSettingsStore.setState({ emailsPerPage: 50 });
    useEmailStore.setState({ mailboxes: [], emails: [], selectedMailbox: 'inbox', accountMailboxes: {} });
  });

  it('hands out the running load, then reports it done once', async () => {
    const { client, release } = makeClient();
    expect(pendingInitialData(client)).toBeUndefined();

    const loading = useEmailStore.getState().prefetchInitialData(client);
    expect(pendingInitialData(client)).toBeInstanceOf(Promise);

    release();
    await loading;
    expect(pendingInitialData(client)).toBe('done');
    // Only the bootstrap right after the login may skip its fetch.
    expect(pendingInitialData(client)).toBeUndefined();
  });
});
