import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { MetadataTooLargeError, MetadataUnsupportedError, bulwarkEntries, isValidMetadataKey } from '../jmap/bulwark-metadata';

// Bulwark keeps shared tags and templates in the Inbox metadata of an
// account, one namespace per item (each namespace holds at most 8 KB on
// Stalwart v1.0.0). Servers without metadata, and the pre-release 1.0 build
// that drops the connection on these calls, count as "not supported".

const METADATA_CAP = {
  'urn:ietf:params:jmap:metadata': {
    dataTypes: { Mailbox: { namespaces: [], supportsVendorNamespaces: true, supportsPrivate: true, maxDepth: 8 } },
  },
};

function session() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:metadata': {} },
    accounts: {
      me: { name: 'me@example.org', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...METADATA_CAP } },
      team: { name: 'team@example.org', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...METADATA_CAP } },
      old: { name: 'old@example.org', isPersonal: false, accountCapabilities: { 'urn:ietf:params:jmap:mail': {} } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'me' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchSpy: ReturnType<typeof vi.spyOn>;
let client: JMAPClient;
let requests: Array<{ using: string[]; methodCalls: Array<[string, Record<string, unknown>, string]> }>;
let answer: (body: (typeof requests)[number]) => Response | Promise<Response>;

beforeEach(async () => {
  vi.useRealTimers();
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(json(session()));
  client = new JMAPClient('https://mail.example.com', 'me@example.org', 'pw');
  await client.connect();
  fetchSpy.mockReset();
  requests = [];
  fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    requests.push(body);
    return answer(body);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const inboxAnswer = (metadata: unknown, property = 'metadata') => json({
  methodResponses: [
    ['Mailbox/query', { ids: ['inbox-1'] }, 'q'],
    ['Mailbox/get', { list: [{ id: 'inbox-1', [property]: metadata }] }, 'g'],
  ],
});

describe('getBulwarkMetadata', () => {
  it('reads Bulwark\'s namespaces of the Inbox in a request of its own', async () => {
    answer = () => inboxAnswer({ 'org.bulwarkmail.tags': [{ id: 'urgent' }], 'org.bulwarkmail.template.a': { name: 'A' }, 'other.example': 1 });
    expect(await client.getBulwarkMetadata('team')).toEqual({ tags: [{ id: 'urgent' }], 'template.a': { name: 'A' } });
    expect(requests).toHaveLength(1);
    expect(requests[0].using).toContain('urn:ietf:params:jmap:metadata');
    expect(requests[0].methodCalls.map((c) => c[0])).toEqual(['Mailbox/query', 'Mailbox/get']);
    expect(requests[0].methodCalls[1][1].properties).toEqual(['id', 'metadata']);
  });

  it('reads private metadata when asked', async () => {
    answer = () => inboxAnswer({ 'org.bulwarkmail.templates': { x: 1 } }, 'privateMetadata');
    expect(await client.getBulwarkMetadata('me', { private: true })).toEqual({ templates: { x: 1 } });
    expect(requests[0].methodCalls[1][1].properties).toEqual(['id', 'privateMetadata']);
  });

  it('asks nothing of an account without the capability', async () => {
    answer = () => { throw new Error('should not be asked'); };
    expect(client.supportsBulwarkMetadata('old')).toBe(false);
    expect(await client.getBulwarkMetadata('old')).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it('treats a dropped connection as unsupported and leaves the account alone afterwards', async () => {
    answer = () => { throw new TypeError('Failed to fetch'); };
    expect(await client.getBulwarkMetadata('team')).toBeNull();
    const asked = requests.length;
    expect(client.supportsBulwarkMetadata('team')).toBe(false);
    expect(await client.getBulwarkMetadata('team')).toBeNull();
    expect(requests).toHaveLength(asked);
    // Other accounts are not affected.
    expect(client.supportsBulwarkMetadata('me')).toBe(true);
  });
});

describe('setBulwarkMetadata', () => {
  it('patches one namespace of the Inbox and nothing else', async () => {
    answer = (body) => body.methodCalls[0][0] === 'Mailbox/set'
      ? json({ methodResponses: [['Mailbox/set', { updated: { 'inbox-1': null } }, '0']] })
      : inboxAnswer({});
    await client.setBulwarkMetadata('team', 'tags', [{ id: 'urgent', color: '#f00' }]);
    const set = requests.find((r) => r.methodCalls[0][0] === 'Mailbox/set')!;
    expect(set.methodCalls[0][1]).toEqual({
      accountId: 'team',
      update: { 'inbox-1': { 'metadata/org.bulwarkmail.tags': [{ id: 'urgent', color: '#f00' }] } },
    });
  });

  it('refuses an entry over 8 KB before asking, and passes on the server\'s size refusal', async () => {
    answer = (body) => body.methodCalls[0][0] === 'Mailbox/set'
      ? json({ methodResponses: [['Mailbox/set', { notUpdated: { 'inbox-1': { type: 'invalidProperties', description: 'Metadata size 70413 exceeds the maximum of 65536 bytes.' } } }, '0']] })
      : inboxAnswer({});
    await expect(client.setBulwarkMetadata('team', 'template.big', { body: 'x'.repeat(9000) })).rejects.toBeInstanceOf(MetadataTooLargeError);
    expect(requests.some((r) => r.methodCalls[0][0] === 'Mailbox/set')).toBe(false);
    await expect(client.setBulwarkMetadata('team', 'template.ok', { body: 'small' })).rejects.toBeInstanceOf(MetadataTooLargeError);
  });

  it('says unsupported for an account without metadata', async () => {
    await expect(client.setBulwarkMetadata('old', 'tags', [])).rejects.toBeInstanceOf(MetadataUnsupportedError);
  });
});

describe('helpers', () => {
  it('accepts lowercase dotted keys only', () => {
    expect(isValidMetadataKey('template.abc-1')).toBe(true);
    expect(isValidMetadataKey('Tags')).toBe(false);
    expect(isValidMetadataKey('a/b')).toBe(false);
    expect(isValidMetadataKey('.x')).toBe(false);
  });

  it('ignores other vendors and non-objects', () => {
    expect(bulwarkEntries(null)).toEqual({});
    expect(bulwarkEntries({ 'org.bulwarkmail': 1, 'org.bulwarkmailx.a': 2, 'org.bulwarkmail.a': 3 })).toEqual({ a: 3 });
  });
});
