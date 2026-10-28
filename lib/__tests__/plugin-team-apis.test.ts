import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import type { IJMAPClient } from '../jmap/client-interface';
import type { Email, Mailbox } from '../jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { usePolicyStore } from '@/stores/policy-store';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { dispatchApiCall } from '../plugin-sandbox/host-api';
import { resetPluginDirectory } from '../plugin-sandbox/host-api-account';
import { resetPluginRateLimits } from '../plugin-sandbox/host-api-input';
import { actionApplies, checkActions } from '../plugin-sandbox/actions';
import {
  activeListFilterCondition, clearPluginListFilters, listFilterRevision, listFilters, resetListFilters,
  setListFilterActive,
} from '../plugin-sandbox/list-filters';

function plugin(perms: string[], id = 'team-inbox'): InstalledPlugin {
  return {
    id, name: 'Team inbox', version: '1.0.0', author: 'test', description: '',
    type: 'hook', permissions: perms, grantedPermissions: perms, entrypoint: 'index.js',
    enabled: true, status: 'running', settings: {},
  };
}
const call = (p: InstalledPlugin, method: string, ...args: unknown[]) => dispatchApiCall(p, method, args);

const ACCOUNTS: Record<string, { name: string; isPersonal: boolean; isReadOnly: boolean }> = {
  ci: { name: 'org-alice@example.org', isPersonal: true, isReadOnly: false },
  ch: { name: 'org-team@example.org', isPersonal: false, isReadOnly: false },
  cx: { name: 'boss@example.org', isPersonal: false, isReadOnly: true },
};

const teamInbox = { id: 'ch:a', originalId: 'a', name: 'Inbox', role: 'inbox', isShared: true, accountId: 'ch', totalEmails: 1, unreadEmails: 0, sortOrder: 0 } as unknown as Mailbox;
const ownInbox = { id: 'a', name: 'Inbox', role: 'inbox', totalEmails: 1, unreadEmails: 0, sortOrder: 0 } as unknown as Mailbox;

function mail(id: string, over: Partial<Email> = {}): Email {
  return {
    id, threadId: `t-${id}`, mailboxIds: { a: true }, keywords: { $seen: true },
    from: [{ name: 'Bob', email: 'bob@example.com' }], subject: id, receivedAt: '2026-10-01T10:00:00Z',
    preview: '', size: 1, hasAttachment: false, ...over,
  } as Email;
}

let client: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  resetPluginDirectory();
  resetPluginRateLimits();
  resetListFilters();
  client = {
    getAccountId: vi.fn(() => 'ci'),
    getUsername: vi.fn(() => 'org-alice@example.org'),
    getAccountInfo: vi.fn((id: string) => (ACCOUNTS[id] ? { ...ACCOUNTS[id], accountCapabilities: {} } : null)),
    getSharedAccounts: vi.fn(() => Object.keys(ACCOUNTS).map((id) => ({
      id, name: ACCOUNTS[id].name, isPrimary: id === 'ci',
      capabilities: { mail: true, sieve: false, calendars: false, contacts: false, filenode: false },
    }))),
    supportsPrincipals: vi.fn(() => true),
    listPrincipals: vi.fn(async () => ({
      status: 'restricted',
      principals: [
        { id: 'ci', type: 'individual', name: 'org-alice@example.org', description: 'Org Alice', email: 'org-alice@example.org' },
        { id: 'ch', type: 'group', name: 'org-team@example.org', description: 'Org Team', email: 'org-team@example.org' },
      ],
    })),
    getPrincipals: vi.fn(async () => []),
    batchUpdateKeywords: vi.fn(async () => undefined),
    supportsBulwarkMetadata: vi.fn(() => false),
    getBulwarkMetadata: vi.fn(async () => null),
    setBulwarkMetadata: vi.fn(async () => undefined),
  };
  useAuthStore.setState({ client: client as unknown as IJMAPClient, activeAccountId: 'login1' });
  usePolicyStore.setState({ subject: { email: 'org-alice@example.org', groups: ['org-team@example.org'] } });
  useEmailStore.setState({ mailboxes: [ownInbox, teamInbox], selectedMailbox: 'ch:a', emails: [], selectedEmail: null, viewingAccountId: null });
});

afterEach(() => {
  useAuthStore.setState({ client: null, activeAccountId: null });
  usePolicyStore.setState({ subject: null });
  useEmailStore.setState({ mailboxes: [], selectedMailbox: '', emails: [], selectedEmail: null });
});

describe('account info for plugins (account:read)', () => {
  it('is refused without account:read', async () => {
    await expect(call(plugin([]), 'user.getSelf')).rejects.toThrow(/lacks permission "account:read"/);
    await expect(call(plugin(['email:read']), 'user.getMailAccounts')).rejects.toThrow(/account:read/);
    await expect(call(plugin([]), 'user.findPeople', { text: 'bob' })).rejects.toThrow(/account:read/);
  });

  it('names the user by their own account id, which is their principal id', async () => {
    await expect(call(plugin(['account:read']), 'user.getSelf')).resolves.toEqual(expect.objectContaining({
      accountId: 'ci', email: 'org-alice@example.org',
    }));
  });

  it('tells group accounts from mailboxes a person shared, and marks the open folder\'s', async () => {
    const accounts = await call(plugin(['account:read']), 'user.getMailAccounts');
    expect(accounts).toEqual([
      { accountId: 'ci', name: 'org-alice@example.org', kind: 'personal', isReadOnly: false, isOpen: false },
      { accountId: 'ch', name: 'org-team@example.org', kind: 'group', isReadOnly: false, isOpen: true },
      { accountId: 'cx', name: 'boss@example.org', kind: 'shared', isReadOnly: true, isOpen: false },
    ]);
  });

  it('counts an account as a group only once the policy subject lists it', async () => {
    usePolicyStore.setState({ subject: { email: 'org-alice@example.org', groups: [] } });
    const accounts = await call(plugin(['account:read']), 'user.getMailAccounts') as Array<{ accountId: string; kind: string }>;
    expect(accounts.find((a) => a.accountId === 'ch')?.kind).toBe('shared');
  });

  it('looks people up by text or id and says when the directory is off', async () => {
    const reader = plugin(['account:read']);
    await expect(call(reader, 'user.findPeople', { text: 'team' })).resolves.toEqual({
      people: [{ id: 'ch', type: 'group', name: 'Org Team', email: 'org-team@example.org' }],
      complete: false,
    });
    await expect(call(reader, 'user.findPeople', { ids: ['ci', 'nobody'] })).resolves.toEqual({
      people: [{ id: 'ci', type: 'individual', name: 'Org Alice', email: 'org-alice@example.org' }],
      complete: false,
    });
    // One directory listing serves both lookups.
    expect(client.listPrincipals).toHaveBeenCalledTimes(1);
    await expect(call(reader, 'user.findPeople', {})).rejects.toThrow(/text or ids/);
    await expect(call(reader, 'user.findPeople', { name: 'x' })).rejects.toThrow(/unknown property/);
  });
});

describe('email.updateKeywords', () => {
  it('needs email:write and real keywords', async () => {
    await expect(call(plugin(['email:read']), 'email.updateKeywords', 'm1', { $done: true })).rejects.toThrow(/email:write/);
    const writer = plugin(['email:write']);
    await expect(call(writer, 'email.updateKeywords', 'm1', { 'bad@kw': true })).rejects.toThrow(/Invalid JMAP keyword/);
    await expect(call(writer, 'email.updateKeywords', 'm1', { $done: 'yes' })).rejects.toThrow(/true \(set\) or false/);
  });

  it('swaps two keywords of a listed team message in one change and shows it in the list', async () => {
    useEmailStore.setState({ emails: [mail('m1', { keywords: { $seen: true, '$assigned:cj': true } })] });
    const done = await call(plugin(['email:write']), 'email.updateKeywords', 'm1', { '$assigned:cj': false, '$assigned:ck': true }, 'ch');
    expect(done).toBe(true);
    expect(client.batchUpdateKeywords).toHaveBeenCalledTimes(1);
    expect(client.batchUpdateKeywords).toHaveBeenCalledWith(['m1'], { 'keywords/$assigned:cj': null, 'keywords/$assigned:ck': true }, 'ch');
    expect(useEmailStore.getState().emails[0].keywords).toEqual({ $seen: true, '$assigned:ck': true });
  });

  it('changes a message that isn\'t listed on the server only, in the named account', async () => {
    await call(plugin(['email:write']), 'email.updateKeywords', 'other', { $done: true }, 'ch');
    expect(client.batchUpdateKeywords).toHaveBeenCalledWith(['other'], { 'keywords/$done': true }, 'ch');
  });
});

describe('ui.setListFilters', () => {
  it('needs ui:message-list and checks what it gets', async () => {
    await expect(call(plugin([]), 'ui.setListFilters', [{ id: 'open', label: 'Open', notKeyword: '$done' }])).rejects.toThrow(/ui:message-list/);
    const lister = plugin(['ui:message-list']);
    await expect(call(lister, 'ui.setListFilters', [{ id: 'x', label: 'No condition' }])).rejects.toThrow(/hasKeyword or notKeyword/);
    await expect(call(lister, 'ui.setListFilters', [{ id: 'x', label: 'X', hasKeyword: 'a@b' }])).rejects.toThrow(/must be a keyword/);
    await expect(call(lister, 'ui.setListFilters', [{ id: 'x', label: 'X', hasKeyword: '$a', accounts: ['team'] }])).rejects.toThrow(/accounts/);
    await call(lister, 'ui.setListFilters', [{ id: 'open', label: 'Open', notKeyword: '$done', accounts: ['group'] }]);
    expect(listFilters().map((f) => f.key)).toEqual(['team-inbox:open']);
  });

  it('adds the conditions of the filters that are on, only where they apply', async () => {
    await call(plugin(['ui:message-list']), 'ui.setListFilters', [
      { id: 'mine', label: 'Assigned to me', hasKeyword: '$assigned:ci', accounts: ['group'] },
      { id: 'open', label: 'Open', notKeyword: '$done', accounts: ['group'] },
    ]);
    const team = { role: 'inbox', accountKind: 'group' as const };
    expect(activeListFilterCondition(team)).toBeNull();
    setListFilterActive('team-inbox:open');
    expect(activeListFilterCondition(team)).toEqual({ notKeyword: '$done' });
    setListFilterActive('team-inbox:mine');
    expect(activeListFilterCondition(team)).toEqual({ operator: 'AND', conditions: [{ hasKeyword: '$assigned:ci' }, { notKeyword: '$done' }] });
    expect(activeListFilterCondition({ role: 'inbox', accountKind: 'personal' })).toBeNull();
    setListFilterActive('team-inbox:mine');
    expect(activeListFilterCondition(team)).toEqual({ notKeyword: '$done' });
  });

  it('drops a filter that was on when the plugin goes away, and says the list must load again', async () => {
    await call(plugin(['ui:message-list']), 'ui.setListFilters', [{ id: 'open', label: 'Open', notKeyword: '$done' }]);
    setListFilterActive('team-inbox:open');
    const before = listFilterRevision();
    clearPluginListFilters('team-inbox');
    expect(listFilterRevision()).toBe(before + 1);
    expect(activeListFilterCondition({ role: 'inbox', accountKind: 'group' })).toBeNull();
  });
});

describe('action conditions', () => {
  const [assign, unassign, done, reopen] = checkActions([
    { id: 'assign', label: 'Assign to me', accounts: ['group'] },
    { id: 'unassign', label: 'Unassign', accounts: ['group'], hasKeyword: '$assigned:*' },
    { id: 'done', label: 'Mark done', accounts: ['group'], notKeyword: '$done' },
    { id: 'reopen', label: 'Reopen', accounts: ['group'], hasKeyword: '$DONE' },
  ]);

  it('shows team actions only on messages of group accounts', () => {
    expect(actionApplies(assign, { accountKind: 'group', keywords: [] })).toBe(true);
    expect(actionApplies(assign, { accountKind: 'personal', keywords: [] })).toBe(false);
    expect(actionApplies(assign, { accountKind: 'shared', keywords: [] })).toBe(false);
    // A surface that doesn't know the account hides them.
    expect(actionApplies(assign, {})).toBe(false);
  });

  it('follows the message\'s keywords, with a prefix and in any case', () => {
    expect(actionApplies(unassign, { accountKind: 'group', keywords: ['$seen'] })).toBe(false);
    expect(actionApplies(unassign, { accountKind: 'group', keywords: ['$assigned:cj'] })).toBe(true);
    expect(actionApplies(done, { accountKind: 'group', keywords: ['$done'] })).toBe(false);
    expect(actionApplies(reopen, { accountKind: 'group', keywords: ['$done'] })).toBe(true);
    expect(actionApplies(done, { accountKind: 'group', keywords: null })).toBe(false);
  });

  it('refuses conditions that aren\'t keywords or account kinds', () => {
    expect(() => checkActions([{ id: 'a', label: 'A', hasKeyword: 'a b' }])).toThrow(/hasKeyword/);
    expect(() => checkActions([{ id: 'a', label: 'A', accounts: [] }])).toThrow(/accounts/);
    expect(() => checkActions([{ id: 'a', label: 'A', accounts: ['team'] }])).toThrow(/accounts/);
  });
});

describe('accountData (shared plugin data in a mail account)', () => {
  it('needs email:read to read and email:write to change', async () => {
    await expect(call(plugin([]), 'accountData.get', 'ch')).rejects.toThrow(/email:read/);
    await expect(call(plugin(['email:read']), 'accountData.set', 'ch', {})).rejects.toThrow(/email:write/);
  });

  it('says unsupported where the server keeps no metadata', async () => {
    await expect(call(plugin(['email:read']), 'accountData.get', 'ch')).resolves.toEqual({ supported: false, value: null });
    await expect(call(plugin(['email:write']), 'accountData.set', 'ch', { a: 1 })).rejects.toThrow(/keeps no shared data/);
  });

  it('keeps the plugin\'s value under its own entry of the account\'s Inbox', async () => {
    client.supportsBulwarkMetadata.mockReturnValue(true);
    client.getBulwarkMetadata.mockResolvedValue({ tags: [1], 'plugin.team-inbox': { names: { cj: 'Bob' } } });
    await expect(call(plugin(['email:read']), 'accountData.get', 'ch')).resolves.toEqual({ supported: true, value: { names: { cj: 'Bob' } } });
    expect(client.getBulwarkMetadata).toHaveBeenCalledWith('ch');
    await call(plugin(['email:write']), 'accountData.set', 'ch', { names: {} });
    expect(client.setBulwarkMetadata).toHaveBeenCalledWith('ch', 'plugin.team-inbox', { names: {} });
  });

  it('refuses an account the user doesn\'t reach and a value over 8 KB', async () => {
    client.supportsBulwarkMetadata.mockReturnValue(true);
    await expect(call(plugin(['email:read']), 'accountData.get', 'zz')).rejects.toThrow(/no mail account/);
    await expect(call(plugin(['email:write']), 'accountData.set', 'ch', 'x'.repeat(9000))).rejects.toThrow(/at most 8192/);
    expect(client.setBulwarkMetadata).not.toHaveBeenCalled();
  });
});
