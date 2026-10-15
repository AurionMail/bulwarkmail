import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// A folder page that brings its thread sizes along (Thread/get chained onto
// the list request) is stored with them, and only a page without them sends
// the separate Thread/get.

const row = (id: string, threadId: string): Email => ({
  id, threadId, mailboxIds: { inbox: true }, keywords: {}, subject: id,
  receivedAt: '2026-10-01T00:00:00Z', from: [], to: [], preview: '', size: 1, hasAttachment: false,
} as Email);

function makeClient(threadCounts?: Record<string, number>) {
  return {
    getEmails: vi.fn(async () => ({ emails: [row('e1', 't1'), row('e2', 't2')], hasMore: false, total: 2, state: 's1', threadCounts })),
    getThreads: vi.fn(async () => [{ id: 't1', emailIds: ['e1', 'a'] }, { id: 't2', emailIds: ['e2'] }]),
    getAccountId: () => 'me',
  } as unknown as IJMAPClient;
}

describe('thread sizes with the folder page', () => {
  beforeEach(() => {
    useSettingsStore.setState({ emailsPerPage: 50 } as never);
    useEmailStore.setState({
      isUnifiedView: false, unifiedRole: null, crossView: null, viewingAccountId: null, selectedKeyword: null,
      selectedMailbox: 'inbox', searchQuery: '', searchFilters: { ...DEFAULT_SEARCH_FILTERS },
      emails: [], threadEmailCounts: new Map(),
      mailboxes: [{ id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 2, unreadEmails: 0 } as Mailbox],
      accountMailboxes: {},
    });
  });

  function connect(client: IJMAPClient) {
    useAuthStore.setState({
      activeAccountId: 'account-a', client,
      getClientForAccount: (id: string) => (id === 'account-a' ? client : undefined) as never,
    } as never);
  }

  it('stores the counts the page brought and sends no Thread/get of its own', async () => {
    const client = makeClient({ t1: 4, t2: 1 });
    connect(client);

    await useEmailStore.getState().fetchEmails(client, 'inbox');

    expect(Object.fromEntries(useEmailStore.getState().threadEmailCounts)).toEqual({ t1: 4, t2: 1 });
    expect(client.getThreads).not.toHaveBeenCalled();
  });

  it('asks for the counts separately when the page came without them', async () => {
    const client = makeClient(undefined);
    connect(client);

    await useEmailStore.getState().fetchEmails(client, 'inbox');
    await vi.waitFor(() => expect(client.getThreads).toHaveBeenCalled());
    await vi.waitFor(() => expect(useEmailStore.getState().threadEmailCounts.get('t1')).toBe(2));
  });
});
