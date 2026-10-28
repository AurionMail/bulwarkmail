import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { deleteTeamTemplate, groupAccounts, loadTeamTemplates, saveTeamTemplate } from '../templates/team-templates';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import { useAuthStore } from '@/stores/auth-store';
import type { EmailTemplate } from '../template-types';
import recorded from './fixtures/stalwart-1.0.0-template-metadata.json';

// Team templates live in the Inbox metadata of a group account. Only group
// principals count: a mailbox another person shared is non-personal too,
// and stays out. The answers use the envelopes recorded on stw-rel.

const META = { 'urn:ietf:params:jmap:metadata': { dataTypes: { Mailbox: { namespaces: [], supportsVendorNamespaces: true, supportsPrivate: true, maxDepth: 8 } } } };
const MAIL = { 'urn:ietf:params:jmap:mail': {} };

function session() {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:metadata': {}, 'urn:ietf:params:jmap:principals': {} },
    accounts: {
      bj: { name: 'org-alice@example.org', isPersonal: true, isReadOnly: false, accountCapabilities: { ...MAIL, ...META } },
      bi: { name: 'org-team@example.org', isPersonal: false, isReadOnly: false, accountCapabilities: { ...MAIL, ...META } },
      bk: { name: 'org-carol@example.org', isPersonal: false, isReadOnly: false, accountCapabilities: { ...MAIL, ...META } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'bj' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
type Call = [string, Record<string, unknown>, string];

let metadata: Record<string, Record<string, unknown>>;
let maySetMetadata: boolean;
let requests: Call[][];
let refuse: boolean;

function answer(body: { methodCalls: Call[] }): Response {
  requests.push(body.methodCalls);
  const [method, args] = body.methodCalls[body.methodCalls.length - 1];
  const accountId = args.accountId as string;
  if (method === 'Principal/get') {
    return json({ methodResponses: [['Principal/get', { list: [{ id: 'bi', type: 'group' }, { id: 'bk', type: 'individual' }], notFound: [] }, '0']] });
  }
  if (method === 'Mailbox/get' && !args['#ids']) {
    const rights = { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: true, maySubmit: true, mayDelete: true, mayShare: true, maySetMetadata };
    return json({ methodResponses: [['Mailbox/get', { accountId, list: [{ id: 'a', name: 'Inbox', role: 'inbox', myRights: rights }] }, '0']] });
  }
  if (method === 'Mailbox/get') {
    const out = clone(recorded.getEmpty);
    (out.methodResponses[1][1] as { list: Array<{ metadata: unknown }> }).list[0].metadata = clone(metadata[accountId] ?? {});
    return json(out);
  }
  if (method === 'Mailbox/set') {
    // Stalwart v1.0.0's refusal for a user who may read the Inbox but not set its metadata.
    if (refuse) return json(clone(recorded.setForbidden));
    const [path, value] = Object.entries((args.update as Record<string, Record<string, unknown>>).a)[0];
    const namespace = path.replace(/^metadata\//, '');
    metadata[accountId] = { ...metadata[accountId] };
    if (value === null) delete metadata[accountId][namespace];
    else metadata[accountId][namespace] = value;
    return json(clone(recorded.setOne));
  }
  throw new Error(`unexpected ${method}`);
}

const tpl = (id: string, name: string, extra: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id, name, subject: '', body: `${name} body`, isHTML: false, category: '', isFavorite: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...extra,
});

let client: JMAPClient;
const original = useAuthStore.getState();

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  metadata = {
    bi: { 'org.bulwarkmail.template.t1': tpl('t1', 'Team reply') },
    bk: { 'org.bulwarkmail.template.c1': tpl('c1', 'Carol’s own') },
  };
  maySetMetadata = true;
  refuse = false;
  requests = [];
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(json(session()));
  client = new JMAPClient('https://mail.example.com', 'org-alice@example.org', 'pw');
  await client.connect();
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => answer(JSON.parse(String(init?.body ?? '{}'))));
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null });
  useAuthStore.setState({ activeAccountId: 'alice@mail', getClientForAccount: (id: string) => (id === 'alice@mail' ? client : undefined) } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ activeAccountId: original.activeAccountId, getClientForAccount: original.getClientForAccount } as never);
});

describe('team templates', () => {
  it('reads the group mailbox\'s templates, not those of a mailbox a person shared', async () => {
    expect(await groupAccounts(client)).toEqual([{ id: 'bi', name: 'org-team@example.org' }]);
    const teams = await loadTeamTemplates('alice@mail', client);
    expect(teams).toEqual([{ accountId: 'bi', name: 'org-team@example.org', templates: [tpl('t1', 'Team reply')], mayWrite: true }]);
    expect(useAccountTemplatesStore.getState().teams['alice@mail']).toEqual(teams);
    expect(requests.flat().some(([, args]) => args.accountId === 'bk' && args['#ids'])).toBe(false);
  });

  it('is read-only for a member without the right to set the Inbox\'s metadata', async () => {
    maySetMetadata = false;
    const [team] = await loadTeamTemplates('alice@mail', client);
    expect(team.mayWrite).toBe(false);
  });

  it('saves into the group\'s Inbox without the member\'s identity, favourite or blind copies, and deletes', async () => {
    await loadTeamTemplates('alice@mail', client);
    const result = await saveTeamTemplate('alice@mail', 'bi', tpl('t2', 'Offer', {
      identityId: 'alice-identity', isFavorite: true, defaultRecipients: { to: ['a@x.test'], cc: ['c@x.test'], bcc: ['boss@x.test'] },
    }), null);
    expect(result).toBe('ok');
    const saved = metadata.bi['org.bulwarkmail.template.t2'] as EmailTemplate;
    expect(saved.name).toBe('Offer');
    expect(saved.identityId).toBeUndefined();
    expect(saved.isFavorite).toBe(false);
    expect(saved.defaultRecipients).toEqual({ to: ['a@x.test'], cc: ['c@x.test'] });
    expect(useAccountTemplatesStore.getState().teams['alice@mail'][0].templates.map((t) => t.id).sort()).toEqual(['t1', 't2']);

    expect(await deleteTeamTemplate('alice@mail', 'bi', 't1', tpl('t1', 'Team reply').updatedAt)).toBe('ok');
    expect(metadata.bi['org.bulwarkmail.template.t1']).toBeUndefined();
    expect(useAccountTemplatesStore.getState().teams['alice@mail'][0].templates.map((t) => t.id)).toEqual(['t2']);
  });

  it('says why the server refused a change', async () => {
    await loadTeamTemplates('alice@mail', client);
    expect(await saveTeamTemplate('alice@mail', 'bi', tpl('t3', 'Huge', { body: 'x'.repeat(9000) }), null)).toBe('too-large');
    refuse = true;
    expect(await saveTeamTemplate('alice@mail', 'bi', tpl('t4', 'Small'), null)).toBe('forbidden');
    expect(metadata.bi['org.bulwarkmail.template.t4']).toBeUndefined();
  });

  it('refuses a change to a template someone else changed since, and shows their version', async () => {
    await loadTeamTemplates('alice@mail', client);
    const base = tpl('t1', 'Team reply').updatedAt;
    // Bob saves first.
    metadata.bi['org.bulwarkmail.template.t1'] = tpl('t1', 'Version of Bob', { updatedAt: '2026-10-20T00:00:00.000Z' });
    const result = await saveTeamTemplate('alice@mail', 'bi', tpl('t1', 'Version of Alice', { updatedAt: '2026-10-21T00:00:00.000Z' }), base);
    expect(result).toBe('conflict');
    expect((metadata.bi['org.bulwarkmail.template.t1'] as EmailTemplate).name).toBe('Version of Bob');
    expect(useAccountTemplatesStore.getState().teams['alice@mail'][0].templates[0].name).toBe('Version of Bob');
    expect(await deleteTeamTemplate('alice@mail', 'bi', 't1', base)).toBe('conflict');
    // A new template whose id someone took meanwhile is refused too.
    expect(await saveTeamTemplate('alice@mail', 'bi', tpl('t1', 'New'), null)).toBe('conflict');
    // Starting from Bob's version, the change goes through.
    expect(await saveTeamTemplate('alice@mail', 'bi', tpl('t1', 'Alice again', { updatedAt: '2026-10-22T00:00:00.000Z' }), '2026-10-20T00:00:00.000Z')).toBe('ok');
  });
});
