import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useSettingsStore } from '../settings-store';
import { useAuthStore } from '../auth-store';
import { usePolicyStore } from '../policy-store';
import { useMessageListTabsStore } from '../message-list-tabs-store';
import { resetListFilters, setListFilterActive, setPluginListFilters } from '@/lib/plugin-sandbox/list-filters';
import { confirmGroups, resetConfirmedGroups } from '@/lib/plugin-sandbox/account-kind';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Plugins' list filters (api.ui.setListFilters): a filter the user turned on
// is part of the folder's query, only in the folders it applies to, and
// leaves it again when turned off.

const teamInbox = { id: 'ch:a', originalId: 'a', role: 'inbox', isShared: true, accountId: 'ch' } as unknown as Mailbox;
const ownInbox = { id: 'a', role: 'inbox', isShared: false } as Mailbox;

function email(id: string, keywords: Record<string, boolean> = {}): Email {
  return {
    id, threadId: `thread-${id}`, mailboxIds: { a: true }, keywords,
    subject: id, receivedAt: '2026-10-01T00:00:00Z', from: [{ email: 'sender@example.com' }], to: [],
    preview: '', size: 1, hasAttachment: false,
  } as Email;
}

// Plugins hear "group" once the server confirmed the account is one.
async function signIn(c: IJMAPClient) {
  useAuthStore.setState({ client: c });
  await confirmGroups(c);
}

function client(rows: Email[] = []) {
  return {
    getEmails: vi.fn(async () => ({ emails: rows, total: rows.length, hasMore: false, state: 's' })),
    getThreads: vi.fn(async () => []),
    getAccountId: () => 'ci',
    getAccountInfo: (id: string) => (id === 'ch' ? { name: 'org-team@example.org', isPersonal: false, isReadOnly: false, accountCapabilities: {} } : null),
    getSharedAccounts: () => [{ id: 'ci', name: 'org-alice@example.org', isPrimary: true, capabilities: { mail: true } }, { id: 'ch', name: 'org-team@example.org', isPrimary: false, capabilities: { mail: true } }],
    getPrincipalTypes: async () => ({ ch: 'group' }),
    batchUpdateKeywords: vi.fn(async () => undefined),
  } as unknown as IJMAPClient;
}

beforeEach(() => {
  resetListFilters();
  resetConfirmedGroups();
  useAuthStore.setState(useAuthStore.getInitialState());
  useMessageListTabsStore.setState(useMessageListTabsStore.getInitialState());
  useSettingsStore.setState({
    emailsPerPage: 25, messageListOrder: [], messageListOrderScope: 'inbox',
    notificationMutes: { accounts: [], mailboxes: {} },
  });
  useEmailStore.setState({ ...useEmailStore.getInitialState(), selectedMailbox: 'ch:a', mailboxes: [ownInbox, teamInbox] });
  setPluginListFilters('team-inbox', 'Team inbox', [
    { id: 'open', label: 'Open', notKeyword: '$done', accounts: ['group'] },
    { id: 'mine', label: 'Assigned to me', hasKeyword: '$assigned:ci', accounts: ['group'] },
  ]);
});

afterEach(() => {
  resetListFilters();
  usePolicyStore.setState({ subject: null });
});

describe('plugin list filters in the folder query', () => {
  it('queries a team folder with the filters that are on, and without them once removed', async () => {
    const c = client();
    await signIn(c);
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    expect(vi.mocked(c.getEmails).mock.calls[0][6]).toBeUndefined();

    setListFilterActive('team-inbox:open');
    setListFilterActive('team-inbox:mine');
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    expect(vi.mocked(c.getEmails).mock.calls[1][0]).toBe('a');
    expect(vi.mocked(c.getEmails).mock.calls[1][1]).toBe('ch');
    expect(vi.mocked(c.getEmails).mock.calls[1][6]).toEqual({
      operator: 'AND', conditions: [{ hasKeyword: '$assigned:ci' }, { notKeyword: '$done' }],
    });

    setListFilterActive('team-inbox:mine', false);
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    expect(vi.mocked(c.getEmails).mock.calls[2][6]).toEqual({ notKeyword: '$done' });
  });

  it('leaves the user\'s own folders alone', async () => {
    const c = client();
    await signIn(c);
    setListFilterActive('team-inbox:open');
    useEmailStore.setState({ selectedMailbox: 'a' });
    await useEmailStore.getState().fetchEmails(c, 'a');
    expect(vi.mocked(c.getEmails).mock.calls[0][6]).toBeUndefined();
  });

  it('loads the list again when a message changes a keyword an active filter tests', async () => {
    const c = client([email('m1')]);
    await signIn(c);
    setListFilterActive('team-inbox:open');
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    const calls = vi.mocked(c.getEmails).mock.calls.length;
    await useEmailStore.getState().patchEmailKeywords(c, 'm1', { $done: true });
    await vi.waitFor(() => expect(vi.mocked(c.getEmails).mock.calls.length).toBeGreaterThan(calls));
    expect(vi.mocked(c.getEmails).mock.calls.at(-1)?.[6]).toEqual({ notKeyword: '$done' });
  });

  it('filters a refresh and the next page the same way', async () => {
    const c = client([email('m1')]);
    await signIn(c);
    setListFilterActive('team-inbox:open');
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    const before = vi.mocked(c.getEmails).mock.calls.length;
    await useEmailStore.getState().refreshCurrentMailbox(c);
    expect(vi.mocked(c.getEmails).mock.calls.length).toBeGreaterThan(before);
    expect(vi.mocked(c.getEmails).mock.calls.at(-1)?.[6]).toEqual({ notKeyword: '$done' });

    useEmailStore.setState({ hasMoreEmails: true, isLoadingMore: false });
    const beforeMore = vi.mocked(c.getEmails).mock.calls.length;
    await useEmailStore.getState().loadMoreEmails(c);
    expect(vi.mocked(c.getEmails).mock.calls.length).toBeGreaterThan(beforeMore);
    expect(vi.mocked(c.getEmails).mock.calls.at(-1)?.[6]).toEqual({ notKeyword: '$done' });
  });

  it('leaves a tag view alone', async () => {
    const c = client();
    await signIn(c);
    setListFilterActive('team-inbox:open');
    useEmailStore.setState({ selectedKeyword: 'work' });
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    expect(vi.mocked(c.getEmails).mock.calls.length).toBeGreaterThan(0);
    for (const args of vi.mocked(c.getEmails).mock.calls) expect(JSON.stringify(args[6] ?? null)).not.toContain('$done');
  });

  it('applies nothing to a team folder before the server confirmed it is a group', async () => {
    const c = { ...client(), getPrincipalTypes: async () => null } as unknown as IJMAPClient;
    await signIn(c);
    setListFilterActive('team-inbox:open');
    await useEmailStore.getState().fetchEmails(c, 'ch:a');
    expect(vi.mocked(c.getEmails).mock.calls[0][6]).toBeUndefined();
  });
});
