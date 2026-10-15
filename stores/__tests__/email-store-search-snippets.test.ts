import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { SearchSnippetResult } from '@/lib/search-snippet';

// An interactive search lists its hits as soon as Email/query + Email/get
// answer; the SearchSnippet/get highlighting follows in a request of its own
// and is applied to the rows already on screen.

const hit = (id: string): Email => ({
  id, threadId: `t-${id}`, mailboxIds: { inbox: true }, keywords: {}, subject: `Subject ${id}`,
  receivedAt: '2026-10-01T00:00:00Z', from: [], to: [], preview: '', size: 1, hasAttachment: false,
} as Email);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('interactive search with deferred snippets', () => {
  let client: IJMAPClient;
  let snippets: ReturnType<typeof deferred<SearchSnippetResult[] | undefined>>;

  beforeEach(() => {
    snippets = deferred();
    client = {
      searchEmails: vi.fn(async () => ({ emails: [hit('e1'), hit('e2')], hasMore: false, total: 2, snippets: snippets.promise })),
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
      selectedMailbox: 'inbox',
      // Scoped to one folder: a single searchEmails call on the client.
      searchMailboxId: 'inbox',
      searchQuery: '', searchFilters: { ...DEFAULT_SEARCH_FILTERS }, searchAbortController: null, emails: [],
      mailboxes: [{ id: 'inbox', name: 'Inbox', role: 'inbox', totalEmails: 2, unreadEmails: 0 } as Mailbox],
      accountMailboxes: {},
    });
  });

  it('lists the results before the snippets arrive and highlights them after', async () => {
    await useEmailStore.getState().searchEmails(client, 'subject');

    expect(client.searchEmails).toHaveBeenCalledWith('subject', 'inbox', undefined, 50, 0, { deferSnippets: true });
    const listed = useEmailStore.getState().emails;
    expect(listed.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(listed[0].searchSnippet).toBeUndefined();

    snippets.resolve([{ emailId: 'e2', subject: '<mark>Subject</mark> e2', preview: null }]);
    await vi.waitFor(() => expect(useEmailStore.getState().emails[1].searchSnippet).toBeDefined());
    const highlighted = useEmailStore.getState().emails;
    expect(highlighted[1].searchSnippet).toEqual({ subject: '<mark>Subject</mark> e2', preview: null });
    // The row without a snippet keeps its object, so it does not re-render.
    expect(highlighted[0]).toBe(listed[0]);
  });

  it('drops the snippets when the search was left before they arrived', async () => {
    await useEmailStore.getState().searchEmails(client, 'subject');
    useEmailStore.setState({ searchQuery: '' });

    snippets.resolve([{ emailId: 'e1', subject: '<mark>Subject</mark> e1', preview: null }]);
    await snippets.promise;
    await new Promise((r) => setTimeout(r, 0));

    expect(useEmailStore.getState().emails.every((e) => e.searchSnippet === undefined)).toBe(true);
  });
});
