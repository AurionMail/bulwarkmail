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
import { resetPluginRateLimits } from '../plugin-sandbox/host-api-input';
import { resetConfirmedGroups } from '../plugin-sandbox/account-kind';
import { pluginDeclaresNetwork } from '../outgoing-hosts';
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
  resetConfirmedGroups();
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
    getPrincipalTypes: vi.fn(async () => ({ ch: 'group', cx: 'individual' })),
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
  useEmailStore.setState({ mailboxes: [], selectedMailbox: '', emails: [], selectedEmail: null, threadEmailsCache: new Map() });
});

describe('account info for plugins (account:read)', () => {
  it('is refused without account:read', async () => {
    await expect(call(plugin([]), 'user.getSelf')).rejects.toThrow(/lacks permission "account:read"/);
    await expect(call(plugin(['email:read']), 'user.getMailAccounts')).rejects.toThrow(/account:read/);
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

  it('says group only for accounts the server confirmed, whatever the policy subject says', async () => {
    // The policy subject (above) lists the team; the server can't say.
    client.getPrincipalTypes.mockRejectedValue(new Error('Principal/get failed'));
    const accounts = await call(plugin(['account:read']), 'user.getMailAccounts') as Array<{ accountId: string; kind: string }>;
    expect(accounts.find((a) => a.accountId === 'ch')?.kind).toBe('shared');
    expect(accounts.find((a) => a.accountId === 'cx')?.kind).toBe('shared');
  });

  it('counts a person\'s shared mailbox as shared even when the subject calls it a group', async () => {
    usePolicyStore.setState({ subject: { email: 'org-alice@example.org', groups: ['org-team@example.org', 'boss@example.org'] } });
    const accounts = await call(plugin(['account:read']), 'user.getMailAccounts') as Array<{ accountId: string; kind: string }>;
    expect(accounts.find((a) => a.accountId === 'cx')?.kind).toBe('shared');
  });
});

describe('the directory for plugins (directory:read)', () => {
  const finder = () => plugin(['directory:read']);

  it('needs directory:read, which account:read doesn\'t give and isn\'t network access', async () => {
    await expect(call(plugin(['account:read']), 'user.findPeople', { text: 'team' })).rejects.toThrow(/lacks permission "directory:read"/);
    // Installed by a user who didn't agree to it yet: refused.
    const unconsented = { ...finder(), managed: false, grantedPermissions: ['account:read'] };
    await expect(call(unconsented, 'user.findPeople', { text: 'team' })).rejects.toThrow(/directory:read/);
    expect(pluginDeclaresNetwork({ permissions: ['email:read', 'email:write', 'account:read', 'directory:read', 'ui:message-list', 'ui:toolbar'] })).toBe(false);
  });

  it('looks people up by text or id and says when the directory is off', async () => {
    await expect(call(finder(), 'user.findPeople', { text: 'team' })).resolves.toEqual({
      people: [{ id: 'ch', type: 'group', name: 'Org Team', email: 'org-team@example.org' }],
      complete: false,
    });
    await expect(call(finder(), 'user.findPeople', { ids: ['ci', 'nobody'] })).resolves.toEqual({
      people: [{ id: 'ci', type: 'individual', name: 'Org Alice', email: 'org-alice@example.org' }],
      complete: false,
    });
    // One directory listing serves both lookups.
    expect(client.listPrincipals).toHaveBeenCalledTimes(1);
    await expect(call(finder(), 'user.findPeople', {})).rejects.toThrow(/text or ids/);
    await expect(call(finder(), 'user.findPeople', { name: 'x' })).rejects.toThrow(/unknown property/);
  });

  it('wants at least 3 characters of text and at most 20 ids', async () => {
    await expect(call(finder(), 'user.findPeople', { text: 'or' })).rejects.toThrow(/at least 3 characters/);
    const ids = Array.from({ length: 21 }, (_, i) => `p${i}`);
    await expect(call(finder(), 'user.findPeople', { ids })).rejects.toThrow(/1 to 20 ids/);
    await expect(call(finder(), 'user.findPeople', { ids: ids.slice(0, 20) })).resolves.toMatchObject({ people: [] });
  });

  it('answers at most 20 people and 10 lookups a minute', async () => {
    client.listPrincipals.mockResolvedValue({
      status: 'ok',
      principals: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, type: 'individual', name: `org-p${i}@example.org`, email: `org-p${i}@example.org` })),
    });
    const first = await call(finder(), 'user.findPeople', { text: 'org-p' }) as { people: unknown[]; complete: boolean };
    expect(first.people).toHaveLength(20);
    expect(first.complete).toBe(true);
    for (let i = 1; i < 10; i++) await call(finder(), 'user.findPeople', { text: 'org-p' });
    await expect(call(finder(), 'user.findPeople', { text: 'org-p' })).rejects.toThrow(/too many lookups/);
  });

  it('asks the directory of the account the call names, and only the login\'s own accounts', async () => {
    await call(finder(), 'user.findPeople', { text: 'team', accountId: 'ch' });
    expect(client.listPrincipals).toHaveBeenCalledWith('ch');
    await expect(call(finder(), 'user.findPeople', { text: 'team', accountId: 'elsewhere' })).rejects.toThrow(/no mail account/);
  });

  it('keeps one load in flight per client', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const listing = (id: string) => async () => {
      await gate;
      return { status: 'ok', principals: [{ id, type: 'individual', name: `${id}@example.org`, email: `${id}@example.org` }] };
    };
    client.listPrincipals.mockImplementation(listing('from-first'));
    const firstA = call(finder(), 'user.findPeople', { text: 'example' });
    const firstB = call(finder(), 'user.findPeople', { text: 'example' });
    const other = { ...client, listPrincipals: vi.fn(listing('from-second')) };
    useAuthStore.setState({ client: other as unknown as IJMAPClient });
    const second = call(finder(), 'user.findPeople', { text: 'example' });
    release();
    const [a, b, c] = await Promise.all([firstA, firstB, second]) as Array<{ people: Array<{ id: string }> }>;
    expect(client.listPrincipals).toHaveBeenCalledTimes(1);
    expect(other.listPrincipals).toHaveBeenCalledTimes(1);
    expect([a.people[0].id, b.people[0].id, c.people[0].id]).toEqual(['from-first', 'from-first', 'from-second']);
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

  it('refuses the keywords that change how the app and the server treat a message', async () => {
    const writer = plugin(['email:write']);
    for (const keyword of ['$draft', '$junk', '$NotJunk', '$phishing']) {
      await expect(call(writer, 'email.updateKeywords', 'm1', { [keyword]: true })).rejects.toThrow(/can't be changed by a plugin/);
      await expect(call(writer, 'email.setKeyword', 'm1', keyword)).rejects.toThrow(/can't be changed by a plugin/);
      await expect(call(writer, 'email.removeKeyword', 'm1', keyword)).rejects.toThrow(/can't be changed by a plugin/);
    }
    await expect(call(writer, 'email.setKeyword', 'm1', 'a b')).rejects.toThrow(/Invalid JMAP keyword/);
    expect(client.batchUpdateKeywords).not.toHaveBeenCalled();
  });

  it('updates the message in an expanded conversation too', async () => {
    const inner = mail('m2', { keywords: { $seen: true }, threadId: 't-m1' });
    useEmailStore.setState({
      emails: [mail('m1', { keywords: { $seen: true } })],
      threadEmailsCache: new Map([['t-m1', [mail('m1'), inner]]]),
    });
    await call(plugin(['email:write']), 'email.updateKeywords', 'm2', { $done: true }, 'ch');
    expect(useEmailStore.getState().threadEmailsCache.get('t-m1')?.[1].keywords).toEqual({ $seen: true, $done: true });
    expect(useEmailStore.getState().threadEmailsCache.get('t-m1')?.[0].keywords).toEqual({ $seen: true });
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

  it('refuses an account the user doesn\'t reach and a value over 4 KB, leaving room for Bulwark\'s own entries', async () => {
    client.supportsBulwarkMetadata.mockReturnValue(true);
    await expect(call(plugin(['email:read']), 'accountData.get', 'zz')).rejects.toThrow(/no mail account/);
    await expect(call(plugin(['email:write']), 'accountData.set', 'ch', 'x'.repeat(5000))).rejects.toThrow(/at most 4096/);
    expect(client.setBulwarkMetadata).not.toHaveBeenCalled();
    await call(plugin(['email:write']), 'accountData.set', 'ch', 'x'.repeat(4000));
    expect(client.setBulwarkMetadata).toHaveBeenCalledTimes(1);
  });

  it('reads at most 30 times a minute', async () => {
    client.supportsBulwarkMetadata.mockReturnValue(true);
    client.getBulwarkMetadata.mockResolvedValue({});
    for (let i = 0; i < 30; i++) await call(plugin(['email:read']), 'accountData.get', 'ch');
    await expect(call(plugin(['email:read']), 'accountData.get', 'ch')).rejects.toThrow(/too many reads/);
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(30);
  });
});
