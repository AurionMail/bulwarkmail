import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import { emailSummary } from '@/lib/plugin-projection';
import type { Email, Mailbox, StateChange } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Sync hooks: new mail in the Inbox, live-update connection, and the
// syncing/idle/error cycle of a push or poll.

function makeMailbox(overrides: Partial<Mailbox>): Mailbox {
  return {
    id: 'inbox', name: 'Inbox', sortOrder: 0, totalEmails: 0, unreadEmails: 0,
    totalThreads: 0, unreadThreads: 0, isSubscribed: true, isShared: false, ...overrides,
  } as Mailbox;
}

function makeEmail(id: string, overrides: Partial<Email> = {}): Email {
  return {
    id, threadId: `t-${id}`, subject: id, receivedAt: '2026-01-01T00:00:00Z',
    keywords: {}, mailboxIds: { inbox: true }, from: [{ name: 'A', email: 'a@x.test' }], ...overrides,
  } as Email;
}

const serverEmails: Record<string, Email> = {
  arrived: makeEmail('arrived'),
  draft: makeEmail('draft', { keywords: { $draft: true } }),
  sent: makeEmail('sent', { mailboxIds: { sent: true } }),
  movedIn: makeEmail('movedIn'),
  old: makeEmail('old'),
};

let client: IJMAPClient;

function change(state: string): StateChange {
  return { '@type': 'StateChange', changed: { me: { Email: state } } } as StateChange;
}

/** Let the void-ed new-mail check finish. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

beforeEach(() => {
  clearAllHooks();
  client = {
    getAccountId: () => 'me',
    getEmailChanges: vi.fn().mockResolvedValue({
      oldState: 's0', newState: 's1', hasMoreChanges: false,
      created: ['arrived', 'draft', 'sent'], updated: ['movedIn'], destroyed: [], updatedProperties: null,
    }),
    getSomeEmails: vi.fn().mockImplementation(async (ids: string[]) => ids.map(id => serverEmails[id]).filter(Boolean)),
    getEmails: vi.fn().mockResolvedValue({ emails: [], hasMore: false, total: 0, state: 's1' }),
    getMaxObjectsInGet: () => 500,
    getThreads: vi.fn().mockResolvedValue([]),
  } as unknown as IJMAPClient;
  useAuthStore.setState({ activeAccountId: 'acct', getClientForAccount: () => client as never } as never);
  useSettingsStore.setState({ emailsPerPage: 50, emailKeywords: [] } as never);
  useEmailStore.setState({
    mailboxes: [makeMailbox({ id: 'inbox', role: 'inbox' }), makeMailbox({ id: 'sent', role: 'sent' })],
    accountMailboxes: {},
    viewingAccountId: null,
    selectedMailbox: 'inbox',
    selectedKeyword: null,
    isUnifiedView: false,
    isScheduledView: false,
    crossView: null,
    searchQuery: '',
    searchFilters: { ...DEFAULT_SEARCH_FILTERS },
    emails: [],
    emailListSync: null,
    isPushConnected: false,
  });
});

afterEach(() => clearAllHooks());

describe('onNewEmailReceived', () => {
  it('reports each message created in the Inbox, and not drafts, other folders or moves', async () => {
    // A baseline other tests have not advanced yet.
    useEmailStore.setState({ emailListSync: { state: 's0', accountId: 'me', mailboxId: 'inbox' } });
    vi.mocked(client.getEmailChanges!).mockResolvedValue({
      oldState: 's0', newState: 's1', hasMoreChanges: false,
      created: ['arrived', 'draft', 'sent'], updated: ['movedIn'], destroyed: [], updatedProperties: null,
    });
    const received = vi.fn();
    emailHooks.onNewEmailReceived.register('t', received);

    await useEmailStore.getState().handleStateChange(change('s1'), client);
    await settle();

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(emailSummary(serverEmails.arrived));
    expect(client.getEmailChanges).toHaveBeenCalledWith('s0', undefined, expect.any(Number));

    // The same state again reports nothing new.
    await useEmailStore.getState().handleStateChange(change('s1'), client);
    await settle();
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for what was there before the first sync state (the initial load)', async () => {
    const received = vi.fn();
    emailHooks.onNewEmailReceived.register('t', received);
    // A fresh account: no list baseline, so the first push only sets one.
    useAuthStore.setState({ activeAccountId: 'fresh' } as never);
    const freshClient = { ...client, getAccountId: () => 'fresh' } as IJMAPClient;
    vi.mocked(client.getEmailChanges!).mockResolvedValue({
      oldState: 'f0', newState: 'f1', hasMoreChanges: false,
      created: ['old'], updated: [], destroyed: [], updatedProperties: null,
    });

    await useEmailStore.getState().handleStateChange(
      { '@type': 'StateChange', changed: { fresh: { Email: 'f1' } } } as StateChange, freshClient,
    );
    await settle();

    expect(received).not.toHaveBeenCalled();
  });
});

describe('onSyncStateChange', () => {
  it('goes syncing then idle around a state change', async () => {
    const states = vi.fn();
    emailHooks.onSyncStateChange.register('t', states);

    await useEmailStore.getState().handleStateChange({ '@type': 'StateChange', changed: {} } as StateChange, client);

    expect(states.mock.calls).toEqual([[{ state: 'syncing' }], [{ state: 'idle' }]]);
  });

  it('reports an error when handling the change failed', async () => {
    const states = vi.fn();
    emailHooks.onSyncStateChange.register('t', states);
    const broken = { ...client, getAccountId: () => { throw new Error('session gone'); } } as IJMAPClient;

    await useEmailStore.getState().handleStateChange({ '@type': 'StateChange', changed: {} } as StateChange, broken);

    expect(states.mock.calls).toEqual([[{ state: 'syncing' }], [{ state: 'error', error: 'session gone' }]]);
  });
});

describe('onPushConnectionChange', () => {
  it('reports when live updates connect and drop, not repeats', () => {
    const connection = vi.fn();
    emailHooks.onPushConnectionChange.register('t', connection);

    useEmailStore.getState().setPushConnected(true);
    useEmailStore.getState().setPushConnected(true);
    useEmailStore.getState().setPushConnected(false);

    expect(connection.mock.calls).toEqual([[{ connected: true }], [{ connected: false }]]);
  });
});
