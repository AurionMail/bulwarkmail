import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { JMAPClient } from '../jmap/client';

/**
 * Stalwart 1.0 advertises JMAP Metadata (`urn:ietf:params:jmap:metadata`) by
 * default, but every handler behind it is still `todo!()`. Selecting
 * `metadata` / `privateMetadata` (or a `metadata/...` pointer) in a get, or
 * sending `ignoreMetadataOnlyChanges` to a /changes method, panics the request
 * on the server. 0.16 knows none of it. So Bulwark must never send any of it,
 * and the gets whose server default could grow to include metadata ask for an
 * explicit property list instead.
 */

const METADATA_CAPABILITY = 'urn:ietf:params:jmap:metadata';

type MethodCall = [string, Record<string, unknown>, string];
type RequestBody = { using: string[]; methodCalls: MethodCall[] };

function makeSession(server: '0.16' | '1.0') {
  const metadata = server === '1.0';
  const info = { namespaces: [], supportsVendorNamespaces: true, supportsPrivate: true, maxDepth: null };
  return {
    capabilities: {
      'urn:ietf:params:jmap:core': { maxObjectsInGet: 500, maxObjectsInSet: 500 },
      'urn:ietf:params:jmap:mail': {},
      'urn:ietf:params:jmap:submission': {},
      'urn:ietf:params:jmap:sieve': {},
      ...(metadata ? { [METADATA_CAPABILITY]: {} } : {}),
    },
    accounts: {
      'acct-1': {
        name: 'user@example.org',
        isPersonal: true,
        accountCapabilities: {
          'urn:ietf:params:jmap:mail': {},
          'urn:ietf:params:jmap:submission': {},
          'urn:ietf:params:jmap:sieve': { implementation: 'Stalwart v1.0.0' },
          ...(metadata
            ? { [METADATA_CAPABILITY]: { dataTypes: { Email: info, Mailbox: info, SieveScript: info } } }
            : {}),
        },
      },
    },
    primaryAccounts: {
      'urn:ietf:params:jmap:mail': 'acct-1',
      'urn:ietf:params:jmap:submission': 'acct-1',
      'urn:ietf:params:jmap:sieve': 'acct-1',
    },
    username: 'user@example.org',
    apiUrl: 'https://mail.example.org/jmap/',
    downloadUrl: 'https://mail.example.org/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.org/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

const MAILBOXES = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, sortOrder: 1, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: {} },
  { id: 'drafts', name: 'Drafts', role: 'drafts', parentId: null, sortOrder: 2, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: {} },
  { id: 'sent', name: 'Sent', role: 'sent', parentId: null, sortOrder: 3, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true, myRights: {} },
];

/** Answers every call the way both server versions do for these methods. */
function answer([name, args, callId]: MethodCall): MethodCall {
  const created = () => Object.fromEntries(
    Object.keys((args.create as Record<string, unknown>) ?? {}).map((key) => [key, { id: `new-${key}` }]),
  );
  switch (name) {
    case 'Mailbox/get':
      return [name, { accountId: args.accountId, state: 'm1', list: MAILBOXES, notFound: [] }, callId];
    case 'SieveScript/get':
      return [name, { accountId: args.accountId, state: 's1', list: [{ id: 'sc1', name: 'bulwark', blobId: 'b1', isActive: true }], notFound: [] }, callId];
    case 'Identity/get':
      return [name, { accountId: args.accountId, state: 'i1', list: [{ id: 'id1', name: 'User', email: 'user@example.org', mayDelete: false }] }, callId];
    case 'Mailbox/changes':
    case 'Email/changes':
      return [name, { accountId: args.accountId, oldState: args.sinceState, newState: 'next', hasMoreChanges: false, created: [], updated: [], destroyed: [] }, callId];
    case 'Email/set':
    case 'EmailSubmission/set':
      return [name, { accountId: args.accountId, created: created() }, callId];
    default:
      return [name, { accountId: args.accountId }, callId];
  }
}

/** Every way a request could reach one of 1.0's unfinished Metadata handlers. */
function metadataUses(body: RequestBody): string[] {
  const found: string[] = [];
  if (body.using.includes(METADATA_CAPABILITY)) found.push(`using ${METADATA_CAPABILITY}`);
  for (const [name, args] of body.methodCalls) {
    if ('ignoreMetadataOnlyChanges' in args) found.push(`${name} ignoreMetadataOnlyChanges`);
    for (const key of ['properties', 'bodyProperties']) {
      const list = args[key];
      if (!Array.isArray(list)) continue;
      for (const property of list) {
        if (/^(private)?[Mm]etadata(\/|$)/.test(String(property))) found.push(`${name} ${key} ${property}`);
      }
    }
  }
  return found;
}

describe('JMAP Metadata never reaches the server', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;
  let requests: RequestBody[];

  async function connect(server: '0.16' | '1.0') {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(makeSession(server)), { status: 200 }));
    client = new JMAPClient('https://mail.example.org', 'user@example.org', 'secret');
    await client.connect();
    fetchSpy.mockReset();
    requests = [];
    fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as RequestBody;
      requests.push(body);
      return new Response(JSON.stringify({ methodResponses: body.methodCalls.map(answer) }), { status: 200 });
    });
  }

  /** The folder, filter, delta-sync and send paths. */
  async function sweep() {
    await client.getMailboxes();
    await client.getAllMailboxesWithState();
    await client.getMailboxesByIds(['inbox']);
    await client.getMailboxChanges('m0');
    await client.getEmailChanges('e0');
    await client.getSieveScripts();
    await client.sendEmail(['friend@example.net'], 'Hello', 'Hi there', undefined, undefined, 'id1', 'user@example.org');
  }

  const callsOf = (method: string) => requests.flatMap((r) => r.methodCalls).filter(([name]) => name === method);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    client?.disconnect();
    vi.restoreAllMocks();
  });

  it.each(['0.16', '1.0'] as const)('asks Mailbox/get and SieveScript/get for explicit RFC properties on Stalwart %s', async (server) => {
    await connect(server);
    await sweep();

    const folderList = ['id', 'name', 'parentId', 'role', 'sortOrder', 'totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads', 'myRights', 'isSubscribed'];
    const mailboxGets = callsOf('Mailbox/get');
    // getMailboxes, getAllMailboxesWithState, getMailboxesByIds, then sendEmail.
    expect(mailboxGets).toHaveLength(4);
    expect(mailboxGets.slice(0, 3).map(([, args]) => args.properties)).toEqual([folderList, folderList, folderList]);
    expect(mailboxGets[3][1].properties).toEqual(['id', 'role']);

    const sieveGets = callsOf('SieveScript/get');
    expect(sieveGets).toHaveLength(1);
    expect(sieveGets[0][1].properties).toEqual(['id', 'name', 'blobId', 'isActive']);
  });

  it('keeps the folder list working with the explicit properties on Stalwart 1.0', async () => {
    await connect('1.0');
    const mailboxes = await client.getMailboxes();
    expect(mailboxes.map((m) => [m.id, m.role, m.sortOrder])).toEqual([['inbox', 'inbox', 1], ['drafts', 'drafts', 2], ['sent', 'sent', 3]]);
    expect((await client.getSieveScripts()).map((s) => s.id)).toEqual(['sc1']);
  });

  it('never selects metadata, sends ignoreMetadataOnlyChanges or uses the Metadata capability on Stalwart 1.0', async () => {
    await connect('1.0');
    await sweep();

    expect(requests.length).toBeGreaterThan(0);
    // The delta-sync paths build their /changes arguments explicitly.
    expect(callsOf('Mailbox/changes').map(([, args]) => args)).toEqual([{ accountId: 'acct-1', sinceState: 'm0' }]);
    expect(callsOf('Email/changes').map(([, args]) => Object.keys(args).sort())).toEqual([['accountId', 'sinceState']]);
    expect(requests.flatMap(metadataUses)).toEqual([]);
  });
});

/**
 * The runtime sweep covers the paths above; this catches any other request a
 * future change builds. Comments may name the Metadata properties, code may
 * not. The dev JMAP mock (a server, not the client) is skipped.
 */
describe('JMAP Metadata in the request-building sources', () => {
  const root = process.cwd();
  const SOURCE_DIRS = ['app', 'components', 'hooks', 'lib', 'stores'];

  function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || rel === 'app/api/dev-jmap') continue;
        files.push(...sourceFiles(rel));
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(rel);
      }
    }
    return files;
  }

  // Drops block comments and line comments that start a line or follow
  // whitespace, so `https://` inside a string stays.
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  const FORBIDDEN = [
    /privateMetadata/,
    /ignoreMetadataOnlyChanges/,
    /urn:ietf:params:jmap:metadata/,
    // A `metadata` property or a `metadata/...` pointer as a string literal.
    /(['"`])metadata(\/[^'"`\n]*)?\1/,
  ];

  it('never names a JMAP Metadata property, argument or capability in code', () => {
    const files = SOURCE_DIRS.flatMap(sourceFiles);
    expect(files).toContain('lib/jmap/client.ts');
    const hits: string[] = [];
    for (const file of files) {
      const code = withoutComments(readFileSync(path.join(root, file), 'utf8'));
      for (const pattern of FORBIDDEN) {
        const match = code.match(pattern);
        if (match) hits.push(`${file}: ${match[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
