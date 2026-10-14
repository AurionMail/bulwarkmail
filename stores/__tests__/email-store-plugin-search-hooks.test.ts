import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SEARCH_FILTERS, type SearchFilters } from '@/lib/jmap/search-utils';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import type { Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// onSearch lets a plugin change the query and filters before a search runs.

let client: IJMAPClient;

beforeEach(() => {
  clearAllHooks();
  client = {
    getAccountId: () => 'me',
    searchEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0 }),
    advancedSearchEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0 }),
    getSomeEmails: vi.fn().mockResolvedValue([]),
  } as unknown as IJMAPClient;
  useAuthStore.setState({ activeAccountId: 'acct', getClientForAccount: () => client as never } as never);
  useSettingsStore.setState({ emailsPerPage: 50 } as never);
  useEmailStore.setState({
    mailboxes: [{ id: 'inbox', name: 'Inbox', role: 'inbox', isShared: false } as Mailbox],
    accountMailboxes: {},
    viewingAccountId: null,
    selectedMailbox: 'inbox',
    searchMailboxId: 'inbox',
    selectedKeyword: null,
    isUnifiedView: false,
    unifiedRole: null,
    crossView: null,
    searchQuery: '',
    searchFilters: { ...DEFAULT_SEARCH_FILTERS },
    searchAbortController: null,
  });
});

afterEach(() => clearAllHooks());

describe('onSearch', () => {
  it('runs the quick search with the query a plugin returns, keeping what the user typed', async () => {
    const handler = vi.fn(({ query, filters }: { query: string; filters: SearchFilters }) => ({ query: `${query} -label:ads`, filters }));
    emailHooks.onSearch.register('t', handler);

    await useEmailStore.getState().searchEmails(client, 'invoice');

    expect(handler).toHaveBeenCalledWith({ query: 'invoice', filters: DEFAULT_SEARCH_FILTERS });
    expect(client.searchEmails).toHaveBeenCalledWith('invoice -label:ads', 'inbox', undefined, 50, 0);
    expect(useEmailStore.getState().searchQuery).toBe('invoice');
  });

  it('runs an advanced search when a plugin adds filters to a quick search', async () => {
    const handler = vi.fn(({ query }: { query: string }) => ({ query, filters: { isUnread: true } }));
    emailHooks.onSearch.register('t', handler);

    await useEmailStore.getState().searchEmails(client, 'invoice');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.searchEmails).not.toHaveBeenCalled();
    expect(client.advancedSearchEmails).toHaveBeenCalledTimes(1);
    const filter = vi.mocked(client.advancedSearchEmails).mock.calls[0][0] as { conditions?: unknown[] };
    expect(JSON.stringify(filter)).toContain('"notKeyword":"$seen"');
    expect(JSON.stringify(filter)).toContain('invoice');
  });

  it('applies returned filters to an advanced search and asks plugins once', async () => {
    useEmailStore.setState({ searchQuery: 'invoice', searchFilters: { ...DEFAULT_SEARCH_FILTERS, from: 'bob@x.test' } });
    const handler = vi.fn(({ query, filters }: { query: string; filters: SearchFilters }) => ({ query, filters: { ...filters, from: 'alice@x.test' } }));
    emailHooks.onSearch.register('t', handler);

    await useEmailStore.getState().advancedSearch(client);

    expect(handler).toHaveBeenCalledTimes(1);
    const filter = JSON.stringify(vi.mocked(client.advancedSearchEmails).mock.calls[0][0]);
    expect(filter).toContain('alice@x.test');
    expect(filter).not.toContain('bob@x.test');
  });
});

describe('onSearchResults', () => {
  it('adds the messages a plugin names, fetched from the server, and nothing else', async () => {
    vi.mocked(client.searchEmails).mockResolvedValue({ emails: [{ id: 'm1' }], hasMore: false, total: 1 } as never);
    vi.mocked(client.getSomeEmails).mockResolvedValue([{ id: 'm9' }] as never);
    const handler = vi.fn().mockReturnValue(['m9', 'm1', 42]);
    emailHooks.onSearchResults.register('test', handler);

    await useEmailStore.getState().searchEmails(client, 'invoice');

    expect(handler).toHaveBeenCalledWith([], expect.objectContaining({ query: 'invoice', emailIds: ['m1'] }));
    expect(client.getSomeEmails).toHaveBeenCalledWith(['m9'], undefined);
    expect(useEmailStore.getState().emails.map((e) => e.id)).toEqual(['m1', 'm9']);
  });

  it('ignores anything that is not a list of ids', async () => {
    vi.mocked(client.searchEmails).mockResolvedValue({ emails: [{ id: 'm1' }], hasMore: false, total: 1 } as never);
    emailHooks.onSearchResults.register('test', () => ({ result: { emails: [{ id: 'fake', subject: 'Pay now' }] } }));

    await useEmailStore.getState().searchEmails(client, 'invoice');

    expect(client.getSomeEmails).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails.map((e) => e.id)).toEqual(['m1']);
  });
});
