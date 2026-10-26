import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { emailKeyFor } from '@/lib/thread-utils';
import { JMAPClient } from '@/lib/jmap/client';
import type { Email, Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// "Remove from this folder" (#615): the message leaves the open folder and
// stays in its other folders.

function makeMailbox(id: string, overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id, name: id, sortOrder: 0, totalEmails: 10, unreadEmails: 3, totalThreads: 10, unreadThreads: 3,
    isSubscribed: true, isShared: false, ...overrides,
  } as Mailbox;
}

function makeEmail(id: string, overrides: Partial<Email> = {}): Email {
  return {
    id, threadId: `t-${id}`, subject: id, receivedAt: '2026-01-01T00:00:00Z',
    keywords: {}, mailboxIds: { inbox: true, work: true }, ...overrides,
  } as Email;
}

const mailboxes = [makeMailbox('inbox', { role: 'inbox' }), makeMailbox('work')];

function makeClient(): IJMAPClient {
  return {
    getAccountId: () => 'me',
    removeEmailsFromMailbox: vi.fn().mockResolvedValue(undefined),
    moveEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as IJMAPClient;
}

let client: IJMAPClient;

function openFolder(folderId: string, emails: Email[], extra: Record<string, unknown> = {}) {
  useEmailStore.setState({
    mailboxes,
    accountMailboxes: {},
    viewingAccountId: null,
    selectedMailbox: folderId,
    selectedKeyword: null,
    isUnifiedView: false,
    crossView: null,
    isScheduledView: false,
    searchQuery: '',
    searchFilters: DEFAULT_SEARCH_FILTERS,
    searchMailboxId: '',
    emails,
    selectedEmail: null,
    selectedEmailKeys: new Set(),
    threadEmailsCache: new Map(),
    error: null,
    ...extra,
  });
}

beforeEach(() => {
  clearAllHooks();
  client = makeClient();
  useAuthStore.setState({ activeAccountId: 'acct', client } as never);
});

afterEach(() => clearAllHooks());

describe('removeFromMailbox', () => {
  it('takes the message out of the open folder only and drops its row', async () => {
    const e1 = makeEmail('e1');
    const e2 = makeEmail('e2', { keywords: { $seen: true } });
    openFolder('inbox', [e1, e2], { selectedEmail: e1, selectedEmailKeys: new Set([emailKeyFor(e1)]) });

    expect(await useEmailStore.getState().removeFromMailbox(client, [e1])).toBe(true);

    expect(client.removeEmailsFromMailbox).toHaveBeenCalledWith(['e1'], 'inbox', undefined);
    expect(client.moveEmail).not.toHaveBeenCalled();
    const state = useEmailStore.getState();
    expect(state.emails.map(e => e.id)).toEqual(['e2']);
    expect(state.selectedEmail?.id).toBe('e2');
    expect(state.selectedEmailKeys.size).toBe(0);
    // e1 was unread: the open folder loses one message and one unread; the
    // other folder still has it.
    const inbox = state.mailboxes.find(m => m.id === 'inbox')!;
    const work = state.mailboxes.find(m => m.id === 'work')!;
    expect([inbox.totalEmails, inbox.unreadEmails]).toEqual([9, 2]);
    expect([work.totalEmails, work.unreadEmails]).toEqual([10, 3]);
  });

  it('sends the bare id of a shared folder to its owner account', async () => {
    const shared = [
      makeMailbox('S:inbox', { role: 'inbox', isShared: true, accountId: 'S', originalId: 'inbox' }),
      makeMailbox('S:work', { isShared: true, accountId: 'S', originalId: 'work' }),
    ];
    const e1 = makeEmail('e1', { mailboxIds: { 'S:inbox': true, 'S:work': true } });
    openFolder('S:inbox', [e1], { mailboxes: shared });

    expect(await useEmailStore.getState().removeFromMailbox(client, [e1])).toBe(true);
    expect(client.removeEmailsFromMailbox).toHaveBeenCalledWith(['e1'], 'inbox', 'S');
  });

  it('leaves a message alone that is only in the open folder', async () => {
    const only = makeEmail('e1', { mailboxIds: { inbox: true } });
    openFolder('inbox', [only]);

    expect(await useEmailStore.getState().removeFromMailbox(client, [only])).toBe(false);
    expect(client.removeEmailsFromMailbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails).toHaveLength(1);
  });

  it('does nothing in a view without one open folder', async () => {
    const e1 = makeEmail('e1');
    openFolder('inbox', [e1], { selectedKeyword: '$label:red' });

    expect(await useEmailStore.getState().removeFromMailbox(client, [e1])).toBe(false);
    expect(client.removeEmailsFromMailbox).not.toHaveBeenCalled();
  });

  it('matches rows by key, so a namesake from another account stays', async () => {
    const mine = makeEmail('e1');
    const namesake = makeEmail('e1', { sourceAccountId: 'other', sourceClientAccountId: 'other-login' });
    openFolder('inbox', [mine, namesake]);

    await useEmailStore.getState().removeFromMailbox(client, [mine]);
    expect(useEmailStore.getState().emails).toEqual([namesake]);
  });

  it('asks the move hooks first and reports the removal', async () => {
    const e1 = makeEmail('e1');
    openFolder('inbox', [e1]);
    const before = vi.fn(() => true);
    const after = vi.fn();
    emailHooks.onBeforeEmailMove.register('t', before);
    emailHooks.onAfterEmailMove.register('t', after);

    await useEmailStore.getState().removeFromMailbox(client, [e1]);

    const payload = { emailIds: ['e1'], fromMailboxId: 'inbox', toMailboxId: null };
    expect(before).toHaveBeenCalledWith(payload);
    expect(after).toHaveBeenCalledWith(payload);
  });

  it('stops when a plugin refuses', async () => {
    const e1 = makeEmail('e1');
    openFolder('inbox', [e1]);
    emailHooks.onBeforeEmailMove.register('t', () => false);

    expect(await useEmailStore.getState().removeFromMailbox(client, [e1])).toBe(false);
    expect(client.removeEmailsFromMailbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().emails).toHaveLength(1);
  });

  it('keeps the row when the server refuses', async () => {
    const e1 = makeEmail('e1');
    openFolder('inbox', [e1]);
    vi.mocked(client.removeEmailsFromMailbox).mockRejectedValue(new Error('invalidProperties'));

    await expect(useEmailStore.getState().removeFromMailbox(client, [e1])).rejects.toThrow('invalidProperties');
    expect(useEmailStore.getState().emails).toHaveLength(1);
    expect(useEmailStore.getState().mailboxes.find(m => m.id === 'inbox')!.totalEmails).toBe(10);
  });
});

describe('JMAPClient.removeEmailsFromMailbox', () => {
  type Call = [string, Record<string, unknown>, string];

  it('patches only the one mailbox away', async () => {
    const jmap = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(jmap, { accountId: 'me' });
    const request = vi.spyOn(jmap as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({ methodResponses: [['Email/set', { updated: { e1: null, e2: null } }, '0']] });

    await jmap.removeEmailsFromMailbox(['e1', 'e2'], 'a/b', 'shared');

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual([
      ['Email/set', {
        accountId: 'shared',
        update: { e1: { 'mailboxIds/a~1b': null }, e2: { 'mailboxIds/a~1b': null } },
      }, '0'],
    ]);
  });

  it('fails when the server refuses a message', async () => {
    const jmap = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(jmap, { accountId: 'me' });
    vi.spyOn(jmap as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({ methodResponses: [['Email/set', { notUpdated: { e1: { type: 'invalidProperties' } } }, '0']] });

    await expect(jmap.removeEmailsFromMailbox(['e1'], 'inbox')).rejects.toThrow();
  });
});
