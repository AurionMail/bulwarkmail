import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { MAX_METADATA_ENTRY_BYTES, MetadataPatchError, MetadataTooLargeError, metadataValueBytes } from '@/lib/jmap/bulwark-metadata';
import { emitPushStateChange } from '@/lib/push-events';
import {
  DISCOVERY_INTERVAL_MS,
  GROUP_CHECK_RETRY_MS,
  PUSH_DEBOUNCE_MS,
  STALE_AFTER_MS,
  SharedTagsSaveDeferredError,
  loadSharedTags,
  resetSharedTags,
  saveSharedTags,
  sharedTagsKey,
  useSharedTagsStore,
  type SharedTagsClient,
} from '../shared-tags-store';

const KEY = sharedTagsKey('login-1', 'team');
const URGENT = { label: 'Urgent', color: 'red' };

/** org-team's Inbox metadata on a v1.0.0 server, shared by every member's client. */
class FakeServer {
  namespace: Record<string, unknown> | null = { tags: { urgent: { ...URGENT } } };
  state = 1;
  failReads = false;
  failWrites = false;

  patch(patches: Array<{ path: string[]; value: unknown }>): { newState: string } {
    if (this.failWrites) throw new TypeError('Failed to fetch');
    let next = this.namespace === null ? null : structuredClone(this.namespace);
    for (const { path, value } of patches) {
      if (path.length === 0) { next = value as Record<string, unknown> | null; continue; }
      if (!next) throw new MetadataPatchError('The namespace does not exist.');
      let parent: Record<string, unknown> = next;
      for (const segment of path.slice(0, -1)) {
        const child = parent[segment];
        if (!child || typeof child !== 'object' || Array.isArray(child)) throw new MetadataPatchError('A parent of the patched value does not exist or is not an object.');
        parent = child as Record<string, unknown>;
      }
      const last = path[path.length - 1];
      if (value === null) delete parent[last];
      else parent[last] = value;
    }
    if (next && metadataValueBytes(next) > MAX_METADATA_ENTRY_BYTES) throw new MetadataTooLargeError('exceeds the maximum');
    this.namespace = next;
    this.state += 1;
    return { newState: `s${this.state}` };
  }
}

function member(server: FakeServer, options: { type?: string | null; advertised?: boolean; keywords?: Record<string, number> } = {}) {
  let paused = false;
  const client = {
    getAccountInfo: vi.fn(() => ({ isPersonal: false })),
    getPrincipalTypes: vi.fn(async (ids: string[]) =>
      options.type === null ? null : Object.fromEntries(ids.map((id) => [id, options.type ?? 'group']))),
    advertisesBulwarkMetadata: vi.fn(() => options.advertised !== false),
    supportsBulwarkMetadata: vi.fn(() => options.advertised !== false && !paused),
    getBulwarkMetadata: vi.fn(async () => {
      if (server.failReads) { paused = true; return null; }
      return server.namespace ? { tags: structuredClone(server.namespace) } : {};
    }),
    patchBulwarkMetadata: vi.fn(async (_id: string | undefined, _key: string, patches: Array<{ path: string[]; value: unknown }>) => server.patch(patches)),
    discoverKeywords: vi.fn(async () => ({ keywords: options.keywords ?? {}, scanned: 0, total: 0, complete: true })),
    endPause: () => { paused = false; },
  };
  return client as typeof client & SharedTagsClient;
}

const entry = (key = KEY) => useSharedTagsStore.getState().entries[key];
const push = (client: SharedTagsClient, state: string, account = 'team') =>
  emitPushStateChange({ '@type': 'StateChange', changed: { [account]: { Mailbox: state } } }, client as never, 'active');
function becomeVisible() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

let server: FakeServer;
beforeEach(() => { resetSharedTags(); server = new FakeServer(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('loading', () => {
  it('reads the shared definitions of a confirmed group and scans its messages', async () => {
    const client = member(server, { keywords: { '$label:found': 3, $seen: 9 } });
    await loadSharedTags(KEY, 'team', client);
    expect(client.getBulwarkMetadata).toHaveBeenCalledWith('team');
    expect(entry()).toMatchObject({ status: 'ready', tags: [{ id: 'urgent', ...URGENT }] });
    expect(client.discoverKeywords).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'team' }));
    expect(entry().discovered).toEqual({ '$label:found': 3 });
  });

  it('leaves a mailbox a person shared to the user\'s own tags, without asking for metadata', async () => {
    const client = member(server, { type: 'individual' });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('personal');
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('never guesses a group when the principal lookup fails, and asks again later', async () => {
    vi.useFakeTimers();
    const client = member(server, { type: null });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('loading');
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();

    client.getPrincipalTypes.mockImplementation(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'group'])));
    await vi.advanceTimersByTimeAsync(GROUP_CHECK_RETRY_MS);
    await vi.waitFor(() => expect(entry().status).toBe('ready'));
  });

  it('sends no metadata request where the server advertises none (0.16)', async () => {
    const client = member(server, { advertised: false });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unsupported');
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('tells a failed read apart from no metadata, and reads again after the client\'s pause', async () => {
    server.failReads = true;
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unavailable');

    // Still paused: coming back to the tab asks nothing.
    server.failReads = false;
    becomeVisible();
    await Promise.resolve();
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);

    client.endPause();
    becomeVisible();
    await vi.waitFor(() => expect(entry().status).toBe('ready'));
  });

  it('keeps the last good tags when a later read fails', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    server.failReads = true;
    await loadSharedTags(KEY, 'team', client, { force: true });
    expect(entry()).toMatchObject({ status: 'ready', tags: [{ id: 'urgent', ...URGENT }] });
    expect(entry().readFailedAt).not.toBeNull();
  });

  it('loads once per client and from scratch for a new sign-in', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    await loadSharedTags(KEY, 'team', client);
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);
    server.namespace = { tags: {} };
    await loadSharedTags(KEY, 'team', member(server));
    expect(entry().tags).toEqual([]);
  });
});

describe('refreshing', () => {
  it('reads again once push has been quiet for 5 s, once for a burst', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    vi.useFakeTimers();
    server.patch([{ path: ['tags', 'later'], value: { label: 'Later', color: 'blue' } }]);

    // Another account of the login doesn't concern it.
    push(client, 'x9', 'own');
    push(client, 's2');
    await vi.advanceTimersByTimeAsync(2_000);
    push(client, 's3');
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS - 1);
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(entry().tags.map((t) => t.id)).toEqual(['later', 'urgent']));
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(2);
  });

  it('skips the push of its own save', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    await saveSharedTags(KEY, 'team', client, [{ id: 'later', value: { label: 'Later', color: 'blue' } }]);
    vi.useFakeTimers();
    push(client, `s${server.state}`);
    await vi.advanceTimersByTimeAsync(PUSH_DEBOUNCE_MS * 2);
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);
  });

  it('reloads only the definitions when the tab comes back, and scans the messages at most every 30 minutes', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    expect(client.discoverKeywords).toHaveBeenCalledTimes(1);

    now += STALE_AFTER_MS;
    becomeVisible();
    await vi.waitFor(() => expect(entry().loadedAt).toBe(now));
    // Let that load finish before the tab comes back again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(2);
    expect(client.discoverKeywords).toHaveBeenCalledTimes(1);

    now += DISCOVERY_INTERVAL_MS;
    becomeVisible();
    await vi.waitFor(() => expect(client.discoverKeywords).toHaveBeenCalledTimes(2));
  });
});

describe('saving', () => {
  it('keeps the tags two members add at the same time', async () => {
    const alice = member(server);
    const bob = member(server);
    const bobKey = sharedTagsKey('login-2', 'team');
    await loadSharedTags(KEY, 'team', alice);
    await loadSharedTags(bobKey, 'team', bob);
    await Promise.all([
      saveSharedTags(KEY, 'team', alice, [{ id: 'alice-tag', value: { label: 'Alice', color: 'green' } }]),
      saveSharedTags(bobKey, 'team', bob, [{ id: 'bob-tag', value: { label: 'Bob', color: 'blue' } }]),
    ]);
    expect(Object.keys((server.namespace as { tags: object }).tags).sort()).toEqual(['alice-tag', 'bob-tag', 'urgent']);
  });

  it('leaves a color another client set alone when it edits something else, or renames that tag', async () => {
    server.namespace = { tags: { urgent: { ...URGENT }, other: { label: 'Other', color: 'chartreuse', icon: 'flame' } } };
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    await saveSharedTags(KEY, 'team', client, [{ id: 'urgent', value: { label: 'Very urgent', color: 'red-dark' } }]);
    await saveSharedTags(KEY, 'team', client, [{ id: 'other', value: { label: 'Renamed' } }]);
    expect(server.namespace).toEqual({ tags: {
      urgent: { label: 'Very urgent', color: 'red-dark' },
      other: { label: 'Renamed', color: 'chartreuse', icon: 'flame' },
    } });
    expect(client.patchBulwarkMetadata.mock.calls.map((c) => c[2])).toEqual([
      [{ path: ['tags', 'urgent'], value: { label: 'Very urgent', color: 'red-dark' } }],
      [{ path: ['tags', 'other'], value: { label: 'Renamed', color: 'chartreuse', icon: 'flame' } }],
    ]);
  });

  it('converts the earlier list shape once, then patches', async () => {
    server.namespace = { list: [{ id: 'urgent', ...URGENT }] };
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    await saveSharedTags(KEY, 'team', client, [{ id: 'later', value: { label: 'Later', color: 'blue' } }]);
    expect(server.namespace).toEqual({ tags: { urgent: URGENT, later: { label: 'Later', color: 'blue' } } });
    await saveSharedTags(KEY, 'team', client, [{ id: 'later', value: null }]);
    expect(client.patchBulwarkMetadata.mock.calls[1][2]).toEqual([{ path: ['tags', 'later'], value: null }]);
    expect(server.namespace).toEqual({ tags: { urgent: URGENT } });
  });

  it('creates the namespace when there is none, keeping a tag another member just created it with', async () => {
    server.namespace = null;
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    await saveSharedTags(KEY, 'team', client, [{ id: 'first', value: { label: 'First', color: 'blue' } }]);
    expect(server.namespace).toEqual({ tags: { first: { label: 'First', color: 'blue' } } });

    // Bob read nothing, Alice created it meanwhile: Bob's patch lands next to hers.
    server.namespace = null;
    const bob = member(server);
    const bobKey = sharedTagsKey('login-2', 'team');
    await loadSharedTags(bobKey, 'team', bob);
    server.namespace = { tags: { alice: { label: 'Alice', color: 'green' } } };
    await saveSharedTags(bobKey, 'team', bob, [{ id: 'bob', value: { label: 'Bob', color: 'red' } }]);
    expect(Object.keys((server.namespace as { tags: object }).tags).sort()).toEqual(['alice', 'bob']);
  });

  it('refuses a list that no longer fits and sends nothing', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `tag-number-${i}`, value: { label: `Tag number ${i}`, color: 'blue' } }));
    await expect(saveSharedTags(KEY, 'team', client, many)).rejects.toBeInstanceOf(MetadataTooLargeError);
    expect(client.patchBulwarkMetadata).not.toHaveBeenCalled();
    expect(entry().pending).toEqual([]);
  });

  it('keeps a change the server didn\'t take, shows it, and sends it with the next good read', async () => {
    const client = member(server);
    await loadSharedTags(KEY, 'team', client);
    server.failWrites = true;
    await expect(saveSharedTags(KEY, 'team', client, [{ id: 'later', value: { label: 'Later', color: 'blue' } }]))
      .rejects.toBeInstanceOf(SharedTagsSaveDeferredError);
    expect(entry().pending).toHaveLength(1);
    expect(entry().tags.map((t) => t.id)).toEqual(['later', 'urgent']);

    server.failWrites = false;
    becomeVisible();
    await vi.waitFor(() => expect(entry().pending).toEqual([]));
    expect((server.namespace as { tags: object }).tags).toHaveProperty('later');
  });
});

// Through the real JMAP client and recorded Stalwart v1.0.0 answers.
describe('with the JMAP client', () => {
  const METADATA_CAP = {
    'urn:ietf:params:jmap:metadata': {
      dataTypes: { Mailbox: { namespaces: [], supportsVendorNamespaces: true, supportsPrivate: true, maxDepth: 8 } },
    },
  };
  const session = {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:principals': {}, 'urn:ietf:params:jmap:metadata': {} },
    accounts: {
      me: { name: 'org-alice@example.org', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...METADATA_CAP } },
      team: { name: 'org-team@example.org', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:principals': {}, ...METADATA_CAP } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'me', 'urn:ietf:params:jmap:principals': 'me' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  type Body = { using: string[]; methodCalls: Array<[string, Record<string, unknown>, string]> };

  async function connected(answer: (body: Body) => Response | Promise<Response>) {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(json(session));
    const client = new JMAPClient('https://mail.example.com', 'org-alice@example.org', 'pw');
    await client.connect();
    fetchSpy.mockReset();
    const requests: Body[] = [];
    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Body;
      requests.push(body);
      return answer(body);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return { client, requests };
  }

  const answers = (body: Body, inbox: Record<string, unknown>) => {
    const method = body.methodCalls[0][0];
    if (method === 'Principal/get') return json({ methodResponses: [['Principal/get', { list: [{ id: 'team', type: 'group' }] }, '0']] });
    if (method === 'Mailbox/query') {
      return json({ methodResponses: [['Mailbox/query', { ids: ['a'] }, 'q'], ['Mailbox/get', { list: [{ id: 'a', ...inbox }] }, 'g']] });
    }
    if (method === 'Mailbox/set') return json({ methodResponses: [['Mailbox/set', { oldState: 's1', newState: 's2', updated: { a: null } }, '0']] });
    if (method === 'Email/query') return json({ methodResponses: [['Email/query', { ids: [], total: 0 }, '0'], ['Email/get', { list: [] }, '1']] });
    throw new Error(`unexpected ${method}`);
  };

  it('reads org.bulwarkmail.tags of the group Inbox and patches one tag, its id escaped', async () => {
    const { client, requests } = await connected((body) => answers(body, { metadata: { 'org.bulwarkmail.tags': { tags: { urgent: URGENT } }, 'org.bulwarkmail.template.x': {} } }));
    await loadSharedTags(KEY, 'team', client);
    expect(entry()).toMatchObject({ status: 'ready', tags: [{ id: 'urgent', ...URGENT }] });
    // Tags nobody named are looked for in the group account, not the own one.
    const scan = requests.find((r) => r.methodCalls[0][0] === 'Email/query')!;
    expect(scan.methodCalls.map((c) => c[1].accountId)).toEqual(['team', 'team']);

    await saveSharedTags(KEY, 'team', client, [{ id: 'work/clients', value: { label: 'Clients', color: 'blue' } }]);
    const set = requests.find((r) => r.methodCalls[0][0] === 'Mailbox/set')!;
    expect(set.methodCalls[0][1]).toEqual({
      accountId: 'team',
      update: { a: { 'metadata/org.bulwarkmail.tags/tags/work~1clients': { label: 'Clients', color: 'blue' } } },
    });
  });

  it('counts a dropped metadata request as unavailable, not as no metadata', async () => {
    const { client } = await connected((body) => {
      if (body.methodCalls[0][0] === 'Mailbox/query') throw new TypeError('Failed to fetch');
      return answers(body, {});
    });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unavailable');
  });
});
