import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { syncPersonalTemplates, PERSONAL_MARKER_KEY } from '../templates/account-template-sync';
import { planPersonalSync } from '../templates/metadata-templates';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import type { EmailTemplate } from '../template-types';
import recorded from './fixtures/stalwart-1.0.0-template-metadata.json';
import { syncAccountTemplates } from '../templates/personal-templates';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';

// Personal templates kept in the user's own Inbox metadata on Stalwart
// v1.0.0, one namespace per template. The server below answers with the
// envelopes recorded from stw-rel (fixtures/…template-metadata.json) and
// keeps the metadata in memory, refusing like the real one once 64 KB are
// used.

const METADATA_CAP = {
  'urn:ietf:params:jmap:metadata': {
    dataTypes: { Mailbox: { namespaces: [], supportsVendorNamespaces: true, supportsPrivate: true, maxDepth: 8 } },
  },
};

function session(withMetadata = true) {
  return {
    capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {}, ...(withMetadata ? { 'urn:ietf:params:jmap:metadata': {} } : {}) },
    accounts: {
      bl: { name: 'carol@example.org', isPersonal: true, isReadOnly: false, accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...(withMetadata ? METADATA_CAP : {}) } },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'bl' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: '',
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

type Call = [string, Record<string, unknown>, string];
let server: Record<string, unknown>;
let sets: Array<{ key: string; value: unknown }>;
let drop: boolean;
const SHARED_MAX = 65536;

function answer(body: { methodCalls: Call[] }): Response {
  if (drop) throw new TypeError('Failed to fetch');
  const [method, args] = body.methodCalls[body.methodCalls.length - 1];
  if (method === 'Mailbox/get') {
    const out = clone(recorded.getEmpty);
    (out.methodResponses[1][1] as { list: Array<{ metadata: unknown }> }).list[0].metadata = clone(server);
    return json(out);
  }
  if (method === 'Mailbox/set') {
    const patch = (args.update as Record<string, Record<string, unknown>>).a;
    const [path, value] = Object.entries(patch)[0];
    const namespace = path.replace(/^metadata\//, '');
    const next = { ...server, [namespace]: value };
    if (value === null) delete next[namespace];
    if (new TextEncoder().encode(JSON.stringify(next)).length > SHARED_MAX) return json(clone(recorded.setNoRoom));
    server = next;
    sets.push({ key: namespace, value });
    return json(clone(value === null ? recorded.deleteOne : recorded.setOne));
  }
  throw new Error(`unexpected ${method}`);
}

const tpl = (id: string, name: string, updatedAt = '2026-10-01T00:00:00.000Z', extra: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id, name, subject: '', body: `${name} body`, isHTML: false, category: '', isFavorite: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt, ...extra,
});
const ns = (id: string) => `org.bulwarkmail.template.${id}`;

let client: JMAPClient;
let connection: ReturnType<typeof vi.fn<(connected: boolean) => void>>;
let legacy: EmailTemplate[];
const sync = () => syncPersonalTemplates('carol@mail', client, () => legacy);
const partition = () => useAccountTemplatesStore.getState().personal['carol@mail'];

async function connect(withMetadata = true) {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(json(session(withMetadata)));
  client = new JMAPClient('https://mail.example.com', 'carol@example.org', 'pw');
  await client.connect();
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => answer(JSON.parse(String(init?.body ?? '{}'))));
  connection = vi.fn<(connected: boolean) => void>();
  client.onConnectionChange(connection);
}

beforeEach(async () => {
  vi.useRealTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  server = {};
  sets = [];
  drop = false;
  legacy = [];
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null });
  await connect();
});
afterEach(() => vi.restoreAllMocks());

describe('the first load with metadata', () => {
  it('uploads the browser\'s templates once into an empty account and marks it', async () => {
    legacy = [tpl('aaaa-1', 'Hello'), tpl('aaaa-2', 'Thanks')];
    expect(await sync()).toBe('synced');
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-1'), ns('aaaa-2'), `org.bulwarkmail.${PERSONAL_MARKER_KEY}`]);
    expect((server[ns('aaaa-1')] as EmailTemplate).name).toBe('Hello');
    expect(partition().templates.map((t) => t.name).sort()).toEqual(['Hello', 'Thanks']);

    // Once: the next round has nothing to write.
    sets = [];
    expect(await sync()).toBe('synced');
    expect(sets).toEqual([]);
  });

  it('doesn\'t upload the browser\'s list to an account set up before, even an empty one', async () => {
    server = { [`org.bulwarkmail.${PERSONAL_MARKER_KEY}`]: { v: 1 } };
    legacy = [tpl('aaaa-1', 'Deleted elsewhere long ago')];
    await sync();
    expect(sets).toEqual([]);
    expect(partition().templates).toEqual([]);
  });

  it('takes the server copy in a second browser instead of the local list', async () => {
    server = { [ns('bbbb-1')]: tpl('bbbb-1', 'From the other browser'), [`org.bulwarkmail.${PERSONAL_MARKER_KEY}`]: { v: 1 } };
    legacy = [tpl('aaaa-1', 'Only here')];
    await sync();
    expect(partition().templates.map((t) => t.name)).toEqual(['From the other browser']);
    expect(sets).toEqual([]);
  });

  it('keeps a template over 8 KB and one the server has no room for in this browser, with why', async () => {
    // 64 KB minus a bit is in use by something else already.
    server = { 'org.bulwarkmail.other': { fill: 'y'.repeat(SHARED_MAX - 4000) } };
    legacy = [tpl('aaaa-big', 'Big', undefined, { body: 'x'.repeat(9000) }), tpl('aaaa-mid', 'Mid', undefined, { body: 'z'.repeat(5000) }), tpl('aaaa-ok', 'Small')];
    await sync();
    const p = partition();
    expect(p.localOnly).toEqual({ 'aaaa-big': 'too-large', 'aaaa-mid': 'no-room' });
    expect(p.templates.map((t) => t.name).sort()).toEqual(['Big', 'Mid', 'Small']);
    expect(server[ns('aaaa-ok')]).toBeTruthy();
    expect(server[ns('aaaa-mid')]).toBeUndefined();
    // The 9 KB one never went out.
    expect(sets.some((s) => s.key === ns('aaaa-big'))).toBe(false);
  });

  it('gives an id that doesn\'t fit a metadata key a new one', async () => {
    legacy = [tpl('Demo_Template 1', 'Old id')];
    await sync();
    const [template] = partition().templates;
    expect(template.id).not.toBe('Demo_Template 1');
    expect(server[ns(template.id)]).toBeTruthy();
  });
});

describe('whose list is uploaded', () => {
  const original = useAuthStore.getState();
  afterEach(() => {
    localStorage.removeItem('settings-sync-owner');
    useAuthStore.setState({ activeAccountId: original.activeAccountId, getClientForAccount: original.getClientForAccount } as never);
  });

  it("waits while the browser's list still holds another account's synced templates", async () => {
    useTemplateStore.setState({ templates: [tpl('aaaa-9', "Alice's")] });
    useAuthStore.setState({ activeAccountId: 'carol@mail', getClientForAccount: (id: string) => (id === 'carol@mail' ? client : undefined) } as never);
    localStorage.setItem('settings-sync-owner', 'alice@mail');
    expect(await syncAccountTemplates('carol@mail')).toBe('unsupported');
    expect(sets).toEqual([]);
    expect(partition()).toBeUndefined();

    // Carol's settings have loaded: now the list is hers.
    useTemplateStore.setState({ templates: [tpl('cccc-1', "Carol's")] });
    localStorage.setItem('settings-sync-owner', 'carol@mail');
    expect(await syncAccountTemplates('carol@mail')).toBe('synced');
    expect(partition().templates.map((t) => t.name)).toEqual(["Carol's"]);
  });

  it("never uploads the browser's list into an account that isn't the active one", async () => {
    useTemplateStore.setState({ templates: [tpl('aaaa-9', "Active account's")] });
    useAuthStore.setState({ activeAccountId: 'alice@mail', getClientForAccount: (id: string) => (id === 'carol@mail' ? client : undefined) } as never);
    expect(await syncAccountTemplates('carol@mail')).toBe('unsupported');
    expect(sets).toEqual([]);
    // Once set up elsewhere, its own copy is read from the server.
    server = { [ns('cccc-2')]: tpl('cccc-2', 'Set up elsewhere'), [`org.bulwarkmail.${PERSONAL_MARKER_KEY}`]: { v: 1 } };
    expect(await syncAccountTemplates('carol@mail')).toBe('synced');
    expect(partition().templates.map((t) => t.name)).toEqual(['Set up elsewhere']);
  });
});

describe('later rounds merge by id and updatedAt', () => {
  beforeEach(async () => {
    legacy = [tpl('aaaa-1', 'One'), tpl('aaaa-2', 'Two')];
    await sync();
    sets = [];
  });

  it('takes a newer server version and uploads a newer local one', async () => {
    server[ns('aaaa-1')] = tpl('aaaa-1', 'One, edited elsewhere', '2026-10-05T00:00:00.000Z');
    useAccountTemplatesStore.getState().updatePersonal('carol@mail', (p) => ({
      ...p, templates: p.templates.map((t) => (t.id === 'aaaa-2' ? { ...t, name: 'Two, edited here', updatedAt: '2026-10-06T00:00:00.000Z' } : t)),
    }));
    await sync();
    expect(partition().templates.find((t) => t.id === 'aaaa-1')?.name).toBe('One, edited elsewhere');
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-2')]);
    expect((server[ns('aaaa-2')] as EmailTemplate).name).toBe('Two, edited here');
  });

  it('drops a template deleted elsewhere, and removes one deleted here from the server', async () => {
    delete server[ns('aaaa-1')];
    useAccountTemplatesStore.getState().updatePersonal('carol@mail', (p) => ({
      ...p,
      templates: p.templates.filter((t) => t.id !== 'aaaa-2'),
      deletedTemplateIds: { 'aaaa-2': '2026-10-07T00:00:00.000Z' },
    }));
    await sync();
    expect(partition().templates).toEqual([]);
    expect(sets).toEqual([{ key: ns('aaaa-2'), value: null }]);
    expect(partition().deletedTemplateIds).toEqual({});
  });

  it('keeps a template edited here after another browser deleted it', async () => {
    delete server[ns('aaaa-1')];
    useAccountTemplatesStore.getState().updatePersonal('carol@mail', (p) => ({
      ...p, templates: p.templates.map((t) => (t.id === 'aaaa-1' ? { ...t, updatedAt: '2026-10-09T00:00:00.000Z' } : t)),
    }));
    await sync();
    expect(partition().templates.map((t) => t.id).sort()).toEqual(['aaaa-1', 'aaaa-2']);
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-1')]);
  });
});

describe('servers without metadata', () => {
  it('leaves an account without the capability alone', async () => {
    vi.restoreAllMocks();
    await connect(false);
    legacy = [tpl('aaaa-1', 'Local')];
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    expect(await sync()).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(partition()).toBeUndefined();
  });

  it('keeps the app online when the server drops the connection on metadata (the 1.0 test build)', async () => {
    drop = true;
    legacy = [tpl('aaaa-1', 'Local')];
    expect(await sync()).toBe('unsupported');
    expect(partition()).toBeUndefined();
    expect(connection).not.toHaveBeenCalledWith(false);
    // And it isn't asked again for a while.
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    expect(await sync()).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('planPersonalSync', () => {
  it('keeps a deletion here over an older server copy, and an edit there over an older deletion', () => {
    const plan = planPersonalSync(
      { templates: [], deletedTemplateIds: { a: '2026-10-05T00:00:00.000Z', b: '2026-10-05T00:00:00.000Z' }, serverVersions: { a: '2026-10-01T00:00:00.000Z', b: '2026-10-01T00:00:00.000Z' } },
      { a: tpl('a', 'A', '2026-10-01T00:00:00.000Z'), b: tpl('b', 'B', '2026-10-06T00:00:00.000Z') },
    );
    expect(plan.deletes).toEqual(['a']);
    expect(plan.templates.map((t) => t.id)).toEqual(['b']);
    expect(plan.uploads).toEqual([]);
  });
});
