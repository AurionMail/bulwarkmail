import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import type { Mailbox } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// Folder hooks: create, rename, delete, empty, the refreshed folder list and
// the storage quota.

function makeMailbox(overrides: Partial<Mailbox>): Mailbox {
  return {
    id: 'inbox',
    name: 'Inbox',
    sortOrder: 0,
    totalEmails: 0,
    unreadEmails: 0,
    totalThreads: 0,
    unreadThreads: 0,
    isSubscribed: true,
    isShared: false,
    myRights: { mayRename: true, mayDelete: true },
    ...overrides,
  } as Mailbox;
}

const mailboxes = [
  makeMailbox({ id: 'inbox', role: 'inbox', totalEmails: 4, unreadEmails: 1 }),
  makeMailbox({ id: 'projects', name: 'Projects', parentId: 'inbox' }),
  makeMailbox({ id: 'junk', name: 'Junk', role: 'junk', totalEmails: 7 }),
  makeMailbox({ id: 'trash', name: 'Trash', role: 'trash' }),
];

let client: IJMAPClient;

beforeEach(() => {
  clearAllHooks();
  client = {
    getAccountId: () => 'me',
    createMailbox: vi.fn().mockResolvedValue(makeMailbox({ id: 'new-1', name: 'Receipts' })),
    updateMailbox: vi.fn().mockResolvedValue(undefined),
    deleteMailbox: vi.fn().mockResolvedValue(undefined),
    emptyMailbox: vi.fn().mockResolvedValue(undefined),
    moveMailboxContents: vi.fn().mockResolvedValue(undefined),
    getAllMailboxes: vi.fn().mockResolvedValue(mailboxes),
    // A fresh object per read, as from the server.
    getQuota: vi.fn().mockImplementation(async () => ({ used: 50, total: 200 })),
  } as unknown as IJMAPClient;
  useAuthStore.setState({ activeAccountId: 'acct', getClientForAccount: () => client as never } as never);
  useSettingsStore.setState({ deleteAction: 'trash' } as never);
  useEmailStore.setState({
    mailboxes,
    accountMailboxes: {},
    viewingAccountId: null,
    selectedMailbox: 'inbox',
    emails: [],
    quota: null,
    error: null,
  });
});

afterEach(() => clearAllHooks());

describe('folder hooks', () => {
  it('asks before creating a folder and reports the new folder', async () => {
    const before = vi.fn(() => true);
    const after = vi.fn();
    emailHooks.onBeforeMailboxCreate.register('t', before);
    emailHooks.onMailboxCreate.register('t', after);

    expect(await useEmailStore.getState().createMailbox(client, 'Receipts', 'inbox')).toBe(true);

    expect(before).toHaveBeenCalledWith({ name: 'Receipts', parentId: 'inbox' });
    expect(after).toHaveBeenCalledWith({ mailboxId: 'new-1', name: 'Receipts', parentId: 'inbox' });
  });

  it('creates nothing when a plugin refuses', async () => {
    const after = vi.fn();
    emailHooks.onBeforeMailboxCreate.register('t', () => false);
    emailHooks.onMailboxCreate.register('t', after);

    expect(await useEmailStore.getState().createMailbox(client, 'Receipts')).toBe(false);

    expect(client.createMailbox).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('does not report a folder the server refused to create', async () => {
    vi.mocked(client.createMailbox).mockRejectedValue(new Error('nope'));
    const after = vi.fn();
    emailHooks.onMailboxCreate.register('t', after);

    await expect(useEmailStore.getState().createMailbox(client, 'Receipts')).rejects.toThrow('nope');
    expect(after).not.toHaveBeenCalled();
  });

  it('reports a rename with the previous name', async () => {
    const before = vi.fn(() => true);
    const after = vi.fn();
    emailHooks.onBeforeMailboxRename.register('t', before);
    emailHooks.onMailboxRename.register('t', after);

    expect(await useEmailStore.getState().renameMailbox(client, 'projects', 'Work')).toBe(true);

    expect(before).toHaveBeenCalledWith({ mailboxId: 'projects', name: 'Work' });
    expect(after).toHaveBeenCalledWith({ mailboxId: 'projects', name: 'Work', previousName: 'Projects' });
  });

  it('keeps the name when a plugin refuses a rename', async () => {
    emailHooks.onBeforeMailboxRename.register('t', () => false);

    expect(await useEmailStore.getState().renameMailbox(client, 'projects', 'Work')).toBe(false);

    expect(client.updateMailbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().mailboxes.find(m => m.id === 'projects')?.name).toBe('Projects');
  });

  it('asks before deleting a folder and reports it', async () => {
    const before = vi.fn(() => true);
    const after = vi.fn();
    emailHooks.onBeforeMailboxDelete.register('t', before);
    emailHooks.onMailboxDelete.register('t', after);

    expect(await useEmailStore.getState().deleteMailbox(client, 'projects')).toBe(true);

    expect(before).toHaveBeenCalledWith({ mailboxId: 'projects', name: 'Projects' });
    expect(after).toHaveBeenCalledWith({ mailboxId: 'projects', name: 'Projects' });
  });

  it('keeps a folder a plugin refuses to delete', async () => {
    emailHooks.onBeforeMailboxDelete.register('t', () => false);

    expect(await useEmailStore.getState().deleteMailbox(client, 'projects')).toBe(false);

    expect(client.deleteMailbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().mailboxes.some(m => m.id === 'projects')).toBe(true);
  });

  it('asks before emptying a folder and reports how many messages it held', async () => {
    const before = vi.fn(() => true);
    const after = vi.fn();
    emailHooks.onBeforeMailboxEmpty.register('t', before);
    emailHooks.onMailboxEmpty.register('t', after);

    expect(await useEmailStore.getState().emptyMailbox(client, 'junk')).toBe(true);

    expect(before).toHaveBeenCalledWith({ mailboxId: 'junk', role: 'junk' });
    expect(after).toHaveBeenCalledWith({ mailboxId: 'junk', role: 'junk', count: 7 });
  });

  it('leaves a folder full when a plugin refuses to empty it', async () => {
    const after = vi.fn();
    emailHooks.onBeforeMailboxEmpty.register('t', () => false);
    emailHooks.onMailboxEmpty.register('t', after);

    expect(await useEmailStore.getState().emptyMailbox(client, 'junk')).toBe(false);

    expect(client.emptyMailbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().mailboxes.find(m => m.id === 'junk')?.totalEmails).toBe(7);
    expect(after).not.toHaveBeenCalled();
  });

  it('hands plugins plain folder views on refresh', async () => {
    const refreshed = vi.fn();
    emailHooks.onMailboxesRefresh.register('t', refreshed);

    await useEmailStore.getState().fetchMailboxes(client);

    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(refreshed.mock.calls[0][0][1]).toEqual({
      id: 'projects', name: 'Projects', role: null, totalEmails: 0, unreadEmails: 0, parentId: 'inbox',
    });
  });
});

describe('quota hook', () => {
  it('reports the quota when it was read and changed, not when it stayed the same', async () => {
    const changed = vi.fn();
    emailHooks.onQuotaChange.register('t', changed);

    await useEmailStore.getState().fetchQuota(client);
    await useEmailStore.getState().fetchQuota(client);
    vi.mocked(client.getQuota).mockImplementation(async () => ({ used: 60, total: 200 }));
    await useEmailStore.getState().fetchQuota(client);

    expect(changed.mock.calls).toEqual([
      [{ used: 50, total: 200, percentUsed: 25 }],
      [{ used: 60, total: 200, percentUsed: 30 }],
    ]);
  });
});
