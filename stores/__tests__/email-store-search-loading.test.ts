import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient, SearchEmailsResult } from '@/lib/jmap/client-interface';

// Starting a search keeps the rows on screen (dimmed by the loading state)
// instead of blanking the list, and writes that loading state only after the
// request has left, so the click's render pass does not hold the request back.

const row = (id: string): Email => ({
  id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: {}, subject: id,
  receivedAt: '2026-10-01T00:00:00Z', from: [], to: [], preview: '', size: 1, hasAttachment: false,
} as Email);

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('starting a search', () => {
  let answer: (result: SearchEmailsResult) => void;
  let client: IJMAPClient;
  const folderRows = [row('old-1'), row('old-2')];

  beforeEach(() => {
    client = {
      searchEmails: vi.fn(() => new Promise<SearchEmailsResult>((resolve) => { answer = resolve; })),
      advancedSearchEmails: vi.fn(),
      getSomeEmails: vi.fn().mockResolvedValue([]),
      getAccountId: () => 'me',
    } as unknown as IJMAPClient;
    useAuthStore.setState({
      activeAccountId: 'account-a',
      getClientForAccount: (id: string) => (id === 'account-a' ? client : undefined) as never,
    } as never);
    useSettingsStore.setState({ emailsPerPage: 50 } as never);
    useEmailStore.setState({
      isUnifiedView: false, unifiedRole: null, crossView: null, viewingAccountId: null, selectedKeyword: null,
      selectedMailbox: 'inbox', searchMailboxId: 'inbox',
      searchQuery: '', searchFilters: { ...DEFAULT_SEARCH_FILTERS }, searchAbortController: null,
      emails: folderRows, isLoading: false,
      mailboxes: [{ id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 2, unreadEmails: 0 } as Mailbox],
      accountMailboxes: {},
    });
  });

  it('sends the request before anything the list renders from changes', async () => {
    const done = useEmailStore.getState().searchEmails(client, 'invoice');

    expect(client.searchEmails).toHaveBeenCalledTimes(1);
    expect(useEmailStore.getState()).toMatchObject({ emails: folderRows, isLoading: false, searchQuery: '' });

    await nextTask();
    // Loading now, over the old rows rather than an empty list.
    expect(useEmailStore.getState()).toMatchObject({ emails: folderRows, isLoading: true, searchQuery: 'invoice' });

    answer({ emails: [row('hit')], hasMore: false, total: 1 });
    await done;
    expect(useEmailStore.getState().emails.map((e) => e.id)).toEqual(['hit']);
    expect(useEmailStore.getState()).toMatchObject({ isLoading: false, searchQuery: 'invoice' });
  });

  it('records the query when the answer lands before the deferred loading write', async () => {
    const done = useEmailStore.getState().searchEmails(client, 'invoice');
    answer({ emails: [row('hit')], hasMore: false, total: 1 });
    await done;

    expect(useEmailStore.getState()).toMatchObject({ searchQuery: 'invoice', isLoading: false });
    await nextTask();
    // The late loading write sees a finished search and stays out.
    expect(useEmailStore.getState().isLoading).toBe(false);
  });
});
