import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { MetadataTooLargeError, MetadataUnsupportedError } from '@/lib/jmap/bulwark-metadata';
import { emitPushStateChange } from '@/lib/push-events';
import {
  loadSharedTags,
  resetSharedTags,
  saveSharedTags,
  sharedTagsKey,
  useSharedTagsStore,
  type SharedTagsClient,
} from '../shared-tags-store';

const KEY = sharedTagsKey('login-1', 'team');
const URGENT = { id: 'urgent', label: 'Urgent', color: 'red' };

function fakeClient(options: {
  type?: string | null;
  metadata?: boolean;
  shared?: Record<string, unknown> | null;
  keywords?: Record<string, number>;
} = {}) {
  let stored: Record<string, unknown> | null = options.shared === undefined ? { tags: { list: [URGENT] } } : options.shared;
  const client = {
    getAccountInfo: vi.fn(() => ({ isPersonal: false })),
    getPrincipalTypes: vi.fn(async (ids: string[]) =>
      options.type === null ? null : Object.fromEntries(ids.map((id) => [id, options.type ?? 'group']))),
    supportsBulwarkMetadata: vi.fn(() => options.metadata !== false),
    getBulwarkMetadata: vi.fn(async () => stored),
    setBulwarkMetadata: vi.fn(async (_id: string | undefined, key: string, value: unknown) => {
      stored = { ...(stored ?? {}), [key]: value };
    }),
    discoverKeywords: vi.fn(async () => ({ keywords: options.keywords ?? {}, scanned: 0, total: 0, complete: true })),
    setStored: (value: Record<string, unknown> | null) => { stored = value; },
  };
  return client as typeof client & SharedTagsClient;
}

const entry = () => useSharedTagsStore.getState().entries[KEY];

beforeEach(() => resetSharedTags());
afterEach(() => vi.restoreAllMocks());

describe('loadSharedTags', () => {
  it('reads the shared definitions of a group account', async () => {
    const client = fakeClient({ keywords: { '$label:found': 3, $seen: 9 } });
    await loadSharedTags(KEY, 'team', client);
    expect(client.getBulwarkMetadata).toHaveBeenCalledWith('team');
    expect(entry()).toMatchObject({ status: 'ready', tags: [URGENT] });
    // The recent messages are scanned in the group account, for tags only.
    expect(client.discoverKeywords).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'team' }));
    expect(entry().discovered).toEqual({ '$label:found': 3 });
  });

  it('leaves a mailbox a person shared to the user\'s own tags, without asking for metadata', async () => {
    const client = fakeClient({ type: 'individual' });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('personal');
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('counts any non-personal account as a group when the server won\'t say', async () => {
    const client = fakeClient({ type: null });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('ready');
  });

  it('sends no metadata request to a server without metadata (0.16)', async () => {
    const client = fakeClient({ metadata: false });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unsupported');
    expect(client.getBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('falls back when the metadata request fails (the 1.0 test build drops it)', async () => {
    const client = fakeClient({ shared: null });
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unsupported');
  });

  it('loads once per client and again for a new sign-in', async () => {
    const client = fakeClient();
    await loadSharedTags(KEY, 'team', client);
    await loadSharedTags(KEY, 'team', client);
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);
    const next = fakeClient({ shared: { tags: { list: [] } } });
    await loadSharedTags(KEY, 'team', next);
    expect(entry().tags).toEqual([]);
  });

  it('reads them again when push reports a Mailbox change in the group account', async () => {
    const client = fakeClient();
    await loadSharedTags(KEY, 'team', client);
    const later = { id: 'later', label: 'Later', color: 'blue' };
    client.setStored({ tags: { list: [URGENT, later] } });

    // A change in another account of the login doesn't concern it.
    emitPushStateChange({ '@type': 'StateChange', changed: { own: { Mailbox: 's2' } } }, client as never, 'active');
    await Promise.resolve();
    expect(client.getBulwarkMetadata).toHaveBeenCalledTimes(1);

    emitPushStateChange({ '@type': 'StateChange', changed: { team: { Mailbox: 's2' } } }, client as never, 'active');
    await vi.waitFor(() => expect(entry().tags).toEqual([URGENT, later]));
  });
});

describe('saveSharedTags', () => {
  it('applies the change to the newest definitions on the server and writes them back', async () => {
    const client = fakeClient();
    await loadSharedTags(KEY, 'team', client);
    // Another member added a tag meanwhile.
    client.setStored({ tags: { list: [URGENT, { id: 'theirs', label: 'Theirs', color: 'green' }] } });
    await saveSharedTags(KEY, 'team', client, (list) => [...list, { id: 'mine', label: 'Mine', color: 'blue', addedBy: 'x' }]);
    expect(client.setBulwarkMetadata).toHaveBeenCalledWith('team', 'tags', {
      list: [URGENT, { id: 'theirs', label: 'Theirs', color: 'green' }, { id: 'mine', label: 'Mine', color: 'blue' }],
    });
    expect(entry().tags.map((t) => t.id)).toEqual(['urgent', 'theirs', 'mine']);
  });

  it('refuses a list that no longer fits and writes nothing', async () => {
    const client = fakeClient();
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `tag-number-${i}`, label: `Tag number ${i}`, color: 'blue' }));
    await expect(saveSharedTags(KEY, 'team', client, () => many)).rejects.toBeInstanceOf(MetadataTooLargeError);
    expect(client.setBulwarkMetadata).not.toHaveBeenCalled();
  });

  it('refuses on a server without metadata', async () => {
    const client = fakeClient({ shared: null });
    await expect(saveSharedTags(KEY, 'team', client, (list) => list)).rejects.toBeInstanceOf(MetadataUnsupportedError);
  });
});

// The same, through the real JMAP client and recorded Stalwart answers.
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
    if (method === 'Mailbox/set') return json({ methodResponses: [['Mailbox/set', { updated: { a: null } }, '0']] });
    if (method === 'Email/query') return json({ methodResponses: [['Email/query', { ids: [], total: 0 }, '0'], ['Email/get', { list: [] }, '1']] });
    throw new Error(`unexpected ${method}`);
  };

  it('reads org.bulwarkmail.tags of the group Inbox and writes the list as an object', async () => {
    const { client, requests } = await connected((body) => answers(body, { metadata: { 'org.bulwarkmail.tags': { list: [URGENT] }, 'org.bulwarkmail.template.x': {} } }));
    await loadSharedTags(KEY, 'team', client);
    expect(entry()).toMatchObject({ status: 'ready', tags: [URGENT] });
    // Tags nobody named are looked for in the group account, not the own one.
    const scan = requests.find((r) => r.methodCalls[0][0] === 'Email/query')!;
    expect(scan.methodCalls.map((c) => c[1].accountId)).toEqual(['team', 'team']);

    await saveSharedTags(KEY, 'team', client, (list) => [...list, { id: 'later', label: 'Later', color: 'blue' }]);
    const set = requests.find((r) => r.methodCalls[0][0] === 'Mailbox/set')!;
    expect(set.methodCalls[0][1]).toEqual({
      accountId: 'team',
      update: { a: { 'metadata/org.bulwarkmail.tags': { list: [URGENT, { id: 'later', label: 'Later', color: 'blue' }] } } },
    });
  });

  it('turns a dropped metadata request into "not supported" without marking the login offline', async () => {
    const { client } = await connected((body) => {
      if (body.methodCalls[0][0] === 'Mailbox/query') throw new TypeError('Failed to fetch');
      return answers(body, {});
    });
    const connection = vi.fn();
    client.onConnectionChange(connection);
    await loadSharedTags(KEY, 'team', client);
    expect(entry().status).toBe('unsupported');
    expect(connection).not.toHaveBeenCalledWith(false);
  });
});
