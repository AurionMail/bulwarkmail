import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient, RequestTimeoutError } from '@/lib/jmap/client';
import { clearAllStores } from '@/lib/account-state-manager';
import { useEmailStore } from '../email-store';
import { useAuthStore } from '../auth-store';
import { useMessageListTabsStore } from '../message-list-tabs-store';
import { useSettingsStore } from '../settings-store';
import { clearAllHooks, emailHooks } from '@/lib/plugin-hooks';
import { emailKeyFor, threadKeyFor } from '@/lib/thread-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';

const initial = useEmailStore.getState();
const initialTabs = useMessageListTabsStore.getState();
const row = (id: string, login = 'a', owner = 'c'): Email => ({ id, threadId: 't', sourceClientAccountId: login,
  sourceAccountId: owner, size: 100, hasAttachment: false, keywords: {}, mailboxIds: { inbox: true }, receivedAt: '2026-10-01T00:00:00Z' } as Email);
const folder = (id = 'inbox', accountId = 'c'): Mailbox => ({ id, accountId, name: id, role: 'inbox',
  totalEmails: 10, unreadEmails: 10, totalThreads: 10, unreadThreads: 10 } as Mailbox);
function makeClient(login: string, size = 500) {
  const client = JMAPClient.withBearer(`https://${login}.example.invalid`, `synthetic-${login}`, `${login}@example.invalid`);
  Object.assign(client, { accountId: 'c', apiUrl: `https://${login}.example.invalid/jmap`,
    capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: size } } });
  return client;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve };
}
type Request = { login: string; accountId: string; destroy: string[] };
let a: JMAPClient, b: JMAPClient, requests: Request[];
let reply: (r: Request, index: number) => object | Promise<object>;
let after = vi.fn<(...args: unknown[]) => void>();
let refresh = vi.fn(async () => {});
function select(rows: Email[], selected = rows) {
  useEmailStore.setState({ emails: rows, selectedEmailKeys: new Set(selected.map(emailKeyFor)), selectedEmail: selected.at(-1) ?? null });
}
const state = () => useEmailStore.getState();
const no = { type: 'forbidden', description: 'Synthetic refusal' };
beforeEach(() => {
  useMessageListTabsStore.setState(initialTabs, true);
  clearAllHooks(); a = makeClient('a', 2); b = makeClient('b'); requests = [];
  reply = r => ({ destroyed: r.destroy });
  after = vi.fn(); refresh = vi.fn(async () => {});
  emailHooks.onAfterEmailDelete.register('test', after);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const login = ['a', 'b'].find(id => url === `https://${id}.example.invalid/jmap`);
    if (!login) throw new Error(`Blocked unexpected URL: ${url}`);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer synthetic-${login}`);
    const [[method, args]] = JSON.parse(String(init.body)).methodCalls;
    if (method === 'Mailbox/get') return new Response(JSON.stringify({ methodResponses: [[method, { list: [] }, '0']] }));
    expect(method).toBe('Email/set');
    const r = { login, ...args }; const index = requests.length; requests.push(r);
    const result = await reply(r, index);
    return new Response(JSON.stringify({ methodResponses: [['Email/set', result, '0']] }));
  }));
  useAuthStore.setState({ activeAccountId: 'a', client: a, getClientForAccount: (id: string) => id === 'a' ? a : id === 'b' ? b : undefined } as never);
  useSettingsStore.setState({ deleteAction: 'trash', permanentlyDeleteJunk: false });
  useEmailStore.setState(initial, true);
  useEmailStore.setState({ isUnifiedView: true, unifiedRole: 'inbox', selectedMailbox: '__unified_inbox__',
    mailboxes: [folder()], accountMailboxes: { b: [folder()] }, totalEmails: 10,
    refreshCurrentMailbox: refresh });
});
afterEach(() => { clearAllHooks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('selected permanent-delete reconciliation', () => {
  it('keeps refused rows selected, reconciles confirmed IDs, and retries only the remainder', async () => {
    const ok = row('ok'), refused = row('no'); select([ok, refused]);
    reply = () => ({ destroyed: ['ok'], notDestroyed: { no } });
    expect(await state().batchDelete(a, true)).toBe(false);
    expect(state().emails).toEqual([refused]); expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(refused)]);
    expect(state().selectedEmail).toBe(refused); expect(state().error).toContain('Synthetic refusal');
    expect(state().totalEmails).toBe(9); expect(state().mailboxes[0].totalEmails).toBe(9);
    expect(after).toHaveBeenCalledWith({ emailIds: ['ok'], permanent: true });
    reply = r => ({ destroyed: r.destroy }); await state().batchDelete(a, true);
    expect(requests.map(r => r.destroy)).toEqual([['ok', 'no'], ['no']]);
    expect(state().selectedEmailKeys.size).toBe(0); expect(state().selectedEmail).toBeNull();
  });

  it.each([{}, { destroyed: [] }])('retains everything when nothing is confirmed: %j', async result => {
    const selected = row('missing'); select([selected]); reply = () => result;
    expect(await state().batchDelete(a, true)).toBe(false);
    expect(state().emails).toEqual([selected]); expect(state().selectedEmail).toBe(selected);
    expect(state().selectedEmailKeys.has(emailKeyFor(selected))).toBe(true);
    expect(after).not.toHaveBeenCalled(); expect(state().mailboxes[0].totalEmails).toBe(10);
  });

  it.each(['refusal', 'transport'])('keeps confirmed earlier chunks after %s', async kind => {
    const rows = ['p', 'q', 'r', 's', 'unsent'].map(id => row(id)); select(rows);
    reply = (r, i) => {
      if (!i) return { destroyed: r.destroy };
      if (kind === 'transport') throw new RequestTimeoutError(30_000);
      return { destroyed: ['s'], notDestroyed: { r: no } };
    };
    expect(await state().batchDelete(a, true)).toBe(false);
    expect(state().emails.map(e => e.id)).toEqual(kind === 'transport' ? ['r', 's', 'unsent'] : ['r', 'unsent']);
    expect(requests).toHaveLength(2);
  });

  it('awaits a slower sibling, and keeps colliding failed IDs and unselected namesakes', async () => {
    const slow = deferred<object>(), started = deferred<void>();
    const ok = row('same', 'a'), refused = row('same', 'b'), namesake = row('other', 'a');
    select([ok, refused, namesake], [ok, refused]);
    reply = r => r.login === 'a' ? (started.resolve(), slow.promise) : { notDestroyed: { same: no } };
    const pending = state().batchDelete(a, true); let settled = false; void pending.then(() => { settled = true; });
    await started.promise; await Promise.resolve(); expect(settled).toBe(false);
    slow.resolve({ destroyed: ['same'] }); expect(await pending).toBe(false);
    expect(state().emails).toEqual([refused, namesake]); expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(refused)]);
    expect(requests).toEqual([{ login: 'a', accountId: 'c', destroy: ['same'] }, { login: 'b', accountId: 'c', destroy: ['same'] }]);
  });

  it('never sends an unselected same owner/email ID through another authenticated client', async () => {
    const namesake = row('same', 'a'), selected = row('same', 'b'); select([namesake, selected], [selected]);
    expect(await state().batchDelete(a, true)).toBe(true); expect(state().emails).toEqual([namesake]);
    expect(requests).toEqual([{ login: 'b', accountId: 'c', destroy: ['same'] }]);
  });

  it('retains unavailable groups and never falls back to the active client', async () => {
    const unavailable = row('same', 'b'); select([unavailable]);
    useAuthStore.setState({ getClientForAccount: () => undefined } as never);
    expect(await state().batchDelete(a, true)).toBe(false); expect(requests).toEqual([]);
    expect(state().emails).toEqual([unavailable]); expect(state().error).toMatch(/connected/i);
    expect(state().selectedEmailKeys.has(emailKeyFor(unavailable))).toBe(true);
  });

  it('does not fall back when a directly viewed login is unavailable', async () => {
    const selected = { ...row('x'), sourceAccountId: undefined, sourceClientAccountId: undefined };
    select([selected]); useEmailStore.setState({ viewingAccountId: 'gone', isUnifiedView: false });
    expect(await state().batchDelete(a, true)).toBe(false); expect(requests).toEqual([]);
    expect(state().emails).toEqual([selected]);
  });

  it('prunes confirmed thread children, updates counts, and preserves an unrelated viewer', async () => {
    const parent = row('parent'), child = row('child'), key = threadKeyFor(parent); select([parent], [child]);
    useEmailStore.setState({ selectedEmail: parent, threadEmailsCache: new Map([[key, [parent, child]]]),
      expandedThreadIds: new Set([key]), threadEmailCounts: new Map([[key, 2]]) });
    expect(await state().batchDelete(a, true)).toBe(true);
    expect(state().threadEmailsCache.get(key)).toEqual([parent]); expect(state().threadEmailCounts.get(key)).toBe(1);
    expect(state().selectedEmail).toBe(parent); expect(state().expandedThreadIds.has(key)).toBe(true);
    expect(state().totalEmails).toBe(10); // A child outside this query is not a removed query row.
    await state().batchDelete(a, true); expect(requests).toHaveLength(1);
  });

  it('matches a stamped viewer to an unstamped row without clearing another owner namesake', async () => {
    const selected = { ...row('same'), sourceAccountId: undefined, sourceClientAccountId: undefined };
    select([selected]); useEmailStore.setState({ isUnifiedView: false, selectedMailbox: 'inbox', selectedEmail: row('same', 'b') });
    await state().batchDelete(a, true); expect(state().selectedEmail).toEqual(row('same', 'b'));
    select([selected]); useEmailStore.setState({ selectedEmail: row('same', 'a') });
    await state().batchDelete(a, true); expect(state().selectedEmail).toBeNull();
  });

  it('does not overwrite a new view when its request completes', async () => {
    select([row('old'), row('old-other')], [row('old')]); const gate = deferred<object>(), started = deferred<void>();
    reply = () => { started.resolve(); return gate.promise; };
    const pending = state().batchDelete(a, true); await started.promise;
    state().selectMailbox('new-folder'); const fresh = row('fresh', 'b'); select([fresh]);
    gate.resolve({ destroyed: ['old'] }); await pending;
    expect(state().selectedMailbox).toBe('new-folder'); expect(state().emails).toEqual([fresh]);
    expect(state().selectedEmail).toBe(fresh); expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(fresh)]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rebases on same-view arrivals and preserves selections/viewers changed while pending', async () => {
    const old = row('old'), other = row('other'), arrived = row('arrived'); select([old, other], [old]);
    const gate = deferred<object>(), started = deferred<void>(); reply = () => { started.resolve(); return gate.promise; };
    const pending = state().batchDelete(a, true); await started.promise;
    select([old, other, arrived], [other]); gate.resolve({ destroyed: ['old'] }); await pending;
    expect(state().emails).toEqual([other, arrived]); expect(state().selectedEmail).toBe(other);
    expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(other)]);
  });

  it('uses the approved selection and captured routing after asynchronous approval', async () => {
    const old = row('approved'), other = row('other', 'b'); select([old, other], [old]);
    const gate = deferred<boolean>(), started = deferred<void>();
    const before = vi.fn(() => { started.resolve(); return gate.promise; }); emailHooks.onBeforeEmailDelete.register('delay', before);
    const pending = state().batchDelete(a, true); await started.promise;
    select([old, other], [other]); gate.resolve(true); await pending;
    expect(before).toHaveBeenCalledWith({ emailIds: ['approved'], permanent: true });
    expect(requests).toEqual([{ login: 'a', accountId: 'c', destroy: ['approved'] }]);
    expect(state().emails).toEqual([other]); expect(state().selectedEmail).toBe(other);
  });

  it('never restores failed selections deliberately cleared while pending', async () => {
    select([row('ok'), row('no')]); const gate = deferred<object>(), started = deferred<void>();
    reply = () => { started.resolve(); return gate.promise; };
    const pending = state().batchDelete(a, true); await started.promise; state().clearSelection();
    gate.resolve({ destroyed: ['ok'], notDestroyed: { no } }); await pending;
    expect(state().selectedEmailKeys.size).toBe(0); expect(state().emails.map(e => e.id)).toEqual(['no']);
  });

  it('preserves the incomplete-operation error through owner refresh', async () => {
    select([row('ok'), row('no')]); reply = () => ({ destroyed: ['ok'], notDestroyed: { no } });
    const folders = vi.spyOn(a, 'getMailboxes').mockImplementation(async () => { useEmailStore.setState({ error: null }); return [folder()]; });
    expect(await state().batchDelete(a, true)).toBe(false);
    expect(folders).toHaveBeenCalledWith('c'); expect(state().error).toContain('Synthetic refusal');
  });

  it('preserves full-success and plugin-veto behavior', async () => {
    const selected = row('ok'); select([selected]); const veto = emailHooks.onBeforeEmailDelete.register('veto', () => false);
    expect(await state().batchDelete(a, true)).toBe(false); expect(requests).toEqual([]);
    expect(state().emails).toEqual([selected]); expect(after).not.toHaveBeenCalled();
    veto.dispose(); expect(await state().batchDelete(a, true)).toBe(true);
    expect(state().emails).toEqual([]); expect(state().error).toBeNull();
  });
});

describe('permanent-delete source snapshots and refreshes', () => {
  it('keeps a shared owner and viewing client pinned across navigation during plugin approval', async () => {
    const selected = { ...row('same'), sourceClientAccountId: undefined, sourceAccountId: undefined };
    select([selected]);
    useEmailStore.setState({ isUnifiedView: false, viewingAccountId: 'b', selectedMailbox: 'd:inbox',
      accountMailboxes: { b: [{ ...folder('d:inbox', 'd'), originalId: 'inbox', isShared: true }] } });
    const gate = deferred<boolean>(), started = deferred<void>();
    emailHooks.onBeforeEmailDelete.register('delay', () => { started.resolve(); return gate.promise; });
    const pending = state().batchDelete(a, true); await started.promise;
    state().selectAccountMailbox('a', 'inbox'); const fresh = row('same', 'a'); select([fresh]);
    gate.resolve(true); expect(await pending).toBe(true);
    expect(requests).toEqual([{ login: 'b', accountId: 'd', destroy: ['same'] }]);
    expect(state().emails).toEqual([fresh]); expect(state().selectedEmail).toBe(fresh);
    expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(fresh)]);
  });

  it('does not reuse a client disconnected during plugin approval', async () => {
    const selected = row('same', 'b'); select([selected]); const gate = deferred<boolean>(), started = deferred<void>();
    emailHooks.onBeforeEmailDelete.register('delay', () => { started.resolve(); return gate.promise; });
    const pending = state().batchDelete(a, true); await started.promise;
    useAuthStore.setState({ getClientForAccount: () => undefined } as never); gate.resolve(true);
    expect(await pending).toBe(false); expect(requests).toEqual([]); expect(state().emails).toEqual([selected]);
  });

  it('refreshes only the confirmed delegated owner and keeps other authenticated caches intact', async () => {
    const selected = { ...row('ok', 'a', 'd'), mailboxIds: { 'd:inbox': true } }; select([selected]);
    const unrelated = [folder('unrelated', 'd')];
    useEmailStore.setState({ mailboxes: [folder(), { ...folder('d:inbox', 'd'), originalId: 'inbox', isShared: true }],
      accountMailboxes: { 'b|d': unrelated } });
    const fetchFolders = vi.spyOn(a, 'getMailboxes').mockResolvedValue([{ ...folder('inbox', 'd'), isShared: true, parentId: 'root' }]);
    expect(await state().batchDelete(a, true)).toBe(true);
    expect(fetchFolders).toHaveBeenCalledWith('d');
    expect(state().mailboxes.map(f => f.id)).toEqual(['inbox', 'd:inbox']);
    expect(state().accountMailboxes['a|d'][0]).toMatchObject({ id: 'd:inbox', originalId: 'inbox', parentId: 'd:root' });
    expect(state().accountMailboxes['b|d']).toBe(unrelated);
  });

  it('refills a fully successful page without resurrecting confirmed IDs from a stale refresh', async () => {
    const selected = row('ok'), other = row('other'); select([selected]); useEmailStore.setState({ hasMoreEmails: true });
    refresh.mockImplementation(async () => { useEmailStore.setState({ emails: [selected, other], totalEmails: 2 }); });
    expect(await state().batchDelete(a, true)).toBe(true); expect(refresh).toHaveBeenCalledTimes(1);
    expect(state().emails).toEqual([other]); expect(state().totalEmails).toBe(1);
  });
});


describe('new search and category navigation during deletion', () => {
  it.each(['search', 'filter', 'category'])('does not refill or end loading for a new %s view', async kind => {
    select([row('old')]); const gate = deferred<object>(), started = deferred<void>();
    reply = () => { started.resolve(); return gate.promise; };
    const pending = state().batchDelete(a, true); await started.promise;
    if (kind === 'search') state().setSearchQuery('other');
    if (kind === 'filter') state().setSearchFilters({ from: 'other@example.invalid' });
    if (kind === 'category') useMessageListTabsStore.setState({ activeTabId: 'other' });
    const fresh = row('fresh'); select([fresh]); useEmailStore.setState({ hasMoreEmails: true, isLoading: true });
    gate.resolve({ destroyed: ['old'] }); await pending;
    expect(refresh).not.toHaveBeenCalled(); expect(state().isLoading).toBe(true);
    expect(state().emails).toEqual([fresh]); expect(state().selectedEmail).toBe(fresh);
    expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(fresh)]);
  });
});


describe('late permanent-delete failures', () => {
  function visibleState() {
    const s = state();
    return { emails: s.emails, selectedEmailKeys: s.selectedEmailKeys, selectedEmail: s.selectedEmail,
      selectedMailbox: s.selectedMailbox, isLoading: s.isLoading, error: s.error };
  }
  function leaveOperation(kind: string) {
    if (kind === 'reset') clearAllStores();
    else {
      state().selectMailbox('new-folder');
      const fresh = row('fresh', 'b'); select([fresh]);
      useEmailStore.setState({ isLoading: true, error: 'New view failed to load more mail' });
    }
    return visibleState();
  }

  it.each(['navigation', 'reset'])('keeps %s state unchanged after the old delete rejects', async kind => {
    select([row('old')]); const gate = deferred<object>(), started = deferred<void>();
    reply = async () => { started.resolve(); await gate.promise; throw new Error('Old delete failed'); };
    const pending = state().batchDelete(a, true); await started.promise;
    const expected = leaveOperation(kind);
    gate.resolve({}); expect(await pending).toBe(false);
    expect(visibleState()).toEqual(expected);
    expect(state().emails).toBe(expected.emails); expect(state().selectedEmailKeys).toBe(expected.selectedEmailKeys);
    expect(state().selectedEmail).toBe(expected.selectedEmail); expect(after).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'reset'])('keeps %s state unchanged after an old owner refresh rejects', async kind => {
    select([row('confirmed')]); const gate = deferred<void>(), started = deferred<void>();
    const folders = vi.spyOn(a, 'getMailboxes').mockImplementation(async () => {
      started.resolve(); await gate.promise; throw new Error('Old owner refresh failed');
    });
    const pending = state().batchDelete(a, true); await started.promise;
    // Server progress is already reconciled before the owner refresh finishes.
    expect(state().emails).toEqual([]); expect(state().totalEmails).toBe(9);
    expect(after).toHaveBeenCalledWith({ emailIds: ['confirmed'], permanent: true });
    const expected = leaveOperation(kind);
    gate.resolve(); expect(await pending).toBe(false);
    expect(folders).toHaveBeenCalledWith('c'); expect(visibleState()).toEqual(expected);
    expect(state().emails).toBe(expected.emails); expect(state().selectedEmailKeys).toBe(expected.selectedEmailKeys);
    expect(state().selectedEmail).toBe(expected.selectedEmail);
  });

  it('still sets the incomplete-delete error and returns false in the captured view', async () => {
    const refused = row('no'); select([row('ok'), refused]);
    const gate = deferred<object>(), started = deferred<void>();
    reply = () => { started.resolve(); return gate.promise; };
    const pending = state().batchDelete(a, true); await started.promise;
    gate.resolve({ destroyed: ['ok'], notDestroyed: { no } });
    expect(await pending).toBe(false); expect(state().error).toContain('Synthetic refusal');
    expect(state().isLoading).toBe(false); expect(state().emails).toEqual([refused]);
    expect([...state().selectedEmailKeys]).toEqual([emailKeyFor(refused)]); expect(state().selectedEmail).toBe(refused);
    expect(after).toHaveBeenCalledWith({ emailIds: ['ok'], permanent: true });
  });
});
