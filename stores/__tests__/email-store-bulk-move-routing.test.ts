import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { clearAllHooks } from '@/lib/plugin-hooks';
import { emailKeyFor, threadKeyFor } from '@/lib/thread-utils';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { useAuthStore } from '../auth-store';
import { useEmailStore } from '../email-store';

const initialStore = useEmailStore.getState();
const initialAuth = useAuthStore.getState();
const mailbox = (id: string, owner = 'owner', shared = false): Mailbox => ({
  id: shared ? `${owner}:${id}` : id, originalId: id, accountId: owner,
  name: id, isShared: shared, myRights: { mayAddItems: true },
} as Mailbox);
const email = (login: string, id: string, owner = 'owner'): Email => ({
  id, threadId: `thread-${id}`, sourceClientAccountId: login, sourceAccountId: owner,
  mailboxIds: { inbox: true }, keywords: {}, receivedAt: '2026-10-01T12:00:00Z',
  size: 100, hasAttachment: false,
} as Email);
const unstamped = (id: string): Email => ({
  ...email('a', id), sourceClientAccountId: undefined, sourceAccountId: undefined,
});

// Keep the real request serializer, authenticatedFetch and Email/set handling.
// A synthetic connected session avoids discovery and keepalive traffic.
function client(login: string, owner = 'owner'): JMAPClient {
  const server = `https://${login}.example.invalid`;
  const result = JMAPClient.withBearer(server, `token-${login}`, `${login}@example.invalid`);
  Object.assign(result, { accountId: owner, apiUrl: `${server}/jmap/api` });
  return result;
}

type SetArgs = { accountId: string; update: Record<string, { mailboxIds: Record<string, boolean> }> };
type Wire = { url: string; auth: string | null; args: SetArgs };
let a: JMAPClient;
let b: JMAPClient;
let clients: Map<string, JMAPClient>;
let requests: Wire[];
let serverMailboxes: Map<string, Record<string, boolean>>;
let refresh: ReturnType<typeof vi.fn<typeof initialStore.refreshCurrentMailbox>>;
const serverKey = (login: string, owner: string, id: string) => JSON.stringify([login, owner, id]);

function select(rows: Email[], selected = rows): void {
  useEmailStore.setState({
    emails: rows, selectedEmail: selected[0] ?? null,
    selectedEmailKeys: new Set(selected.map(emailKeyFor)),
  });
}

function expectRequests(expected: Array<[string, string, string[], string?]>): void {
  expect(requests).toEqual(expected.map(([login, owner, ids, dest = 'dest']) => ({
    url: `https://${login}.example.invalid/jmap/api`, auth: `Bearer token-${login}`,
    args: { accountId: owner, update: Object.fromEntries(ids.map(id => [id, { mailboxIds: { [dest]: true } }])) },
  })));
}

async function expectPreflightFailure(): Promise<void> {
  const before = useEmailStore.getState();
  expect(await before.batchMoveToMailbox(a, 'dest')).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(requests).toEqual([]);
  expect(refresh).not.toHaveBeenCalled();
  const after = useEmailStore.getState();
  expect(after.error).toMatch(/not connected/i);
  expect(after.isLoading).toBe(false);
  expect(after.emails).toBe(before.emails);
  expect(after.selectedEmailKeys).toBe(before.selectedEmailKeys);
  expect(after.selectedEmail).toBe(before.selectedEmail);
  expect(after.threadEmailsCache).toBe(before.threadEmailsCache);
}

beforeEach(() => {
  clearAllHooks();
  a = client('a'); b = client('b'); clients = new Map([['a', a], ['b', b]]);
  requests = []; serverMailboxes = new Map();
  refresh = vi.fn<typeof initialStore.refreshCurrentMailbox>().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { methodCalls: Array<[string, SetArgs, string]> };
    const responses = body.methodCalls.map(([method, args, tag]) => {
      expect(method).toBe('Email/set');
      const auth = new Headers(init?.headers).get('Authorization');
      const login = new URL(String(url)).hostname.split('.')[0];
      expect(auth).toBe(`Bearer token-${login}`);
      requests.push({ url: String(url), auth, args });
      // These responses explicitly confirm every requested ID. Partial-result
      // accounting is intentionally outside this routing regression suite.
      for (const [id, patch] of Object.entries(args.update)) {
        serverMailboxes.set(serverKey(login, args.accountId, id), patch.mailboxIds);
      }
      return [method, { accountId: args.accountId, updated: Object.fromEntries(Object.keys(args.update).map(id => [id, null])) }, tag];
    });
    return new Response(JSON.stringify({ methodResponses: responses }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }));
  useAuthStore.setState({
    activeAccountId: 'a', client: a,
    getClientForAccount: (id: string) => clients.get(id),
  });
  useEmailStore.setState({
    ...initialStore, isUnifiedView: true, unifiedRole: 'inbox', crossView: null,
    selectedMailbox: '__unified_inbox__', selectedKeyword: null, viewingAccountId: null,
    searchQuery: '', emails: [], selectedEmail: null, selectedEmailKeys: new Set(),
    mailboxes: [mailbox('inbox'), mailbox('dest')], accountMailboxes: {},
    threadEmailsCache: new Map(), expandedThreadIds: new Set(),
    error: null, isLoading: false, refreshCurrentMailbox: refresh,
  });
});

afterEach(() => {
  clearAllHooks();
  vi.unstubAllGlobals();
  useEmailStore.setState(initialStore);
  useAuthStore.setState(initialAuth);
});

describe('bulk Move authenticated-client routing', () => {
  it('keeps colliding owner IDs on their authenticated clients, leaving an unselected namesake alone', async () => {
    const selectedA = email('a', 'p'), namesakeA = email('a', 'q'), selectedB = email('b', 'q');
    select([selectedA, namesakeA, selectedB], [selectedA, selectedB]);
    serverMailboxes.set(serverKey('a', 'owner', 'q'), { inbox: true });

    expect(await useEmailStore.getState().batchMoveToMailbox(a, 'dest')).toBe(true);

    expectRequests([['a', 'owner', ['p']], ['b', 'owner', ['q']]]);
    expect(serverMailboxes.get(serverKey('a', 'owner', 'p'))).toEqual({ dest: true });
    expect(serverMailboxes.get(serverKey('b', 'owner', 'q'))).toEqual({ dest: true });
    expect(serverMailboxes.get(serverKey('a', 'owner', 'q'))).toEqual({ inbox: true });
    expect(useEmailStore.getState().emails).toEqual([namesakeA]);
    expect(useEmailStore.getState().selectedEmailKeys.size).toBe(0);
  });

  it('sends equal selected email IDs separately through each client', async () => {
    select([email('a', 'same'), email('b', 'same')]);
    expect(await useEmailStore.getState().batchMoveToMailbox(a, 'dest')).toBe(true);
    expectRequests([['a', 'owner', ['same']], ['b', 'owner', ['same']]]);
    expect(useEmailStore.getState().emails).toEqual([]);
  });

  it('moves only the selected client copy when another client has the same ID', async () => {
    const other = email('a', 'same'), selected = email('b', 'same');
    select([other, selected], [selected]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['b', 'owner', ['same']]]);
    expect(useEmailStore.getState().emails).toEqual([other]);
  });

  it('keeps delegated owners separate when they share a reaching client', async () => {
    select([email('a', 'p'), email('a', 'q', 'shared')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['a', 'owner', ['p']], ['a', 'shared', ['q']]]);
  });

  it('groups aliases of the same effective client and owner into one request', async () => {
    clients.set('alias-a', a);
    select([email('a', 'p'), email('alias-a', 'q')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['a', 'owner', ['p', 'q']]]);
  });

  it('preserves personal-folder routing for unstamped messages', async () => {
    useEmailStore.setState({ isUnifiedView: false, selectedMailbox: 'inbox' });
    select([unstamped('p'), unstamped('q')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['a', 'owner', ['p', 'q']]]);
    expect(refresh).toHaveBeenCalledWith(a);
  });

  it.each([false, true])('preserves direct shared-folder routing (viewing account=%s)', async viewing => {
    const login = viewing ? 'b' : 'a';
    const folders = [mailbox('inbox', 'shared', true), mailbox('dest', 'shared', true)];
    useEmailStore.setState({
      isUnifiedView: false, selectedMailbox: 'shared:inbox', viewingAccountId: viewing ? 'b' : null,
      mailboxes: viewing ? [] : folders, accountMailboxes: viewing ? { b: folders } : {},
    });
    select([unstamped('p'), unstamped('q')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'shared:dest');
    expectRequests([[login, 'shared', ['p', 'q']]]);
  });

  it('uses the viewing client for an unstamped personal folder', async () => {
    b = client('b', 'owner-b'); clients.set('b', b);
    useEmailStore.setState({
      isUnifiedView: false, selectedMailbox: 'inbox', viewingAccountId: 'b',
      accountMailboxes: { b: [mailbox('inbox', 'owner-b'), mailbox('dest', 'owner-b')] },
    });
    select([unstamped('p'), unstamped('q')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['b', 'owner-b', ['p', 'q']]]);
  });

  it('honors source stamps after the aggregate-view flag has changed', async () => {
    useEmailStore.setState({ isUnifiedView: false, selectedMailbox: 'inbox' });
    select([email('b', 'p'), email('b', 'q')]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['b', 'owner', ['p', 'q']]]);
  });

  it('routes selected expanded-thread members without moving an unselected list namesake', async () => {
    const other = email('a', 'same'), member = email('b', 'same');
    select([other], [member]);
    useEmailStore.setState({ threadEmailsCache: new Map([[threadKeyFor(member), [member]]]) });
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest');
    expectRequests([['b', 'owner', ['same']]]);
    expect(useEmailStore.getState().emails).toEqual([other]);
  });

  it.each(['owner', undefined])('preflights a disconnected explicit source (owner=%s) before sending any group', async owner => {
    clients.delete('b');
    select([email('a', 'p'), { ...email('b', 'q'), sourceAccountId: owner }]);
    await expectPreflightFailure();
  });

  it('rejects an owner stamp without a reaching login instead of using the active client', async () => {
    select([email('a', 'p'), { ...email('b', 'q'), sourceClientAccountId: undefined }]);
    await expectPreflightFailure();
  });

  it.each([false, true])('preflights an unavailable viewing client (shared=%s)', async shared => {
    clients.delete('b');
    useEmailStore.setState({
      isUnifiedView: false, selectedMailbox: shared ? 'shared:inbox' : 'inbox', viewingAccountId: 'b',
      accountMailboxes: { b: [mailbox('inbox', 'shared', shared), mailbox('dest', 'shared', shared)] },
    });
    select([unstamped('p'), unstamped('q')]);
    await expectPreflightFailure();
  });

  it('preflights unavailable source stamps outside aggregate views too', async () => {
    clients.delete('b');
    useEmailStore.setState({ isUnifiedView: false, selectedMailbox: 'inbox' });
    select([email('a', 'p'), email('b', 'q')]);
    await expectPreflightFailure();
  });

  it('preflights the viewing client even when a stamped group was resolved first', async () => {
    clients.delete('b');
    useEmailStore.setState({ viewingAccountId: 'b' });
    select([email('a', 'p'), unstamped('q')]);
    await expectPreflightFailure();
  });

  it('preserves explicit-target routing without using the unrelated selection', async () => {
    const selected = email('a', 'selected');
    select([selected]);
    await useEmailStore.getState().batchMoveToMailbox(a, 'dest', { client: b, accountId: 'shared', emailIds: ['unloaded'] });
    expectRequests([['b', 'shared', ['unloaded']]]);
    expect(useEmailStore.getState().emails).toEqual([selected]);
    expect([...useEmailStore.getState().selectedEmailKeys]).toEqual([emailKeyFor(selected)]);
  });
});
