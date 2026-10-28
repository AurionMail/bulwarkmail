import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Personal templates kept in the user's own Inbox metadata on Stalwart
// v1.0.0, one namespace per template plus a marker entry holding the
// tombstones of deleted ones. The server below answers with the envelopes
// recorded from stw-rel (fixtures/…template-metadata.json) and keeps the
// metadata in memory, refusing like the real one once 64 KB are used.

const config = vi.hoisted(() => ({ value: { settingsSyncEnabled: true } as Record<string, unknown> | null }));
vi.mock('@/hooks/use-config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedConfig: () => config.value,
}));

import { JMAPClient } from '../jmap/client';
import { syncPersonalTemplates, type BrowserList } from '../templates/account-template-sync';
import { planPersonalSync, pruneTombstones, storableId } from '../templates/metadata-templates';
import { browserListFor, flushAccountTemplates, personalTemplatesFor, syncAccountTemplates } from '../templates/personal-templates';
import { useAccountTemplatesStore } from '@/stores/account-templates-store';
import { useAuthStore } from '@/stores/auth-store';
import { useTemplateStore } from '@/stores/template-store';
import { useSettingsStore } from '@/stores/settings-store';
import { purgeSignedOutData, runBeforeSignOut } from '@/lib/sign-out-cleanup';
import type { EmailTemplate } from '../template-types';
import recorded from './fixtures/stalwart-1.0.0-template-metadata.json';

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
let omitMetadata: boolean;
let onSet: (() => void) | null;
const SHARED_MAX = 65536;

function answer(body: { methodCalls: Call[] }): Response {
  if (drop) throw new TypeError('Failed to fetch');
  const [method, args] = body.methodCalls[body.methodCalls.length - 1];
  if (method === 'Mailbox/get') {
    const out = clone(recorded.getEmpty);
    const inbox = (out.methodResponses[1][1] as { list: Array<Record<string, unknown>> }).list[0];
    if (omitMetadata) delete inbox.metadata;
    else inbox.metadata = clone(server);
    return json(out);
  }
  if (method === 'Mailbox/set') {
    onSet?.();
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
const MARKER = 'org.bulwarkmail.templates';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let client: JMAPClient;
let connection: ReturnType<typeof vi.fn<(connected: boolean) => void>>;
let browser: BrowserList;
const sync = () => syncPersonalTemplates('carol@mail', client, () => browser);
const list = (templates: EmailTemplate[]): BrowserList => ({ status: 'list', templates });
const partition = () => useAccountTemplatesStore.getState().personal['carol@mail'];
const names = () => partition().templates.map((t) => t.name).sort();
const edit = (fn: (templates: EmailTemplate[]) => EmailTemplate[]) =>
  useAccountTemplatesStore.getState().updatePersonal('carol@mail', (p) => ({ ...p, templates: fn(p.templates) }));

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

const original = useAuthStore.getState();
const asCarol = () => useAuthStore.setState({
  activeAccountId: 'carol@mail',
  getClientForAccount: (id: string) => (id === 'carol@mail' ? client : undefined),
} as never);

beforeEach(async () => {
  vi.useRealTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  server = {};
  sets = [];
  drop = false;
  omitMetadata = false;
  onSet = null;
  browser = list([]);
  config.value = { settingsSyncEnabled: true };
  localStorage.removeItem('settings-sync-owner');
  useAccountTemplatesStore.setState({ personal: {}, teams: {}, active: null, browserListOwner: null });
  useTemplateStore.setState({ templates: [], deletedTemplateIds: {}, recentTemplateIds: [] });
  useSettingsStore.setState({ settingsSyncDisabled: false });
  await connect();
});
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ activeAccountId: original.activeAccountId, getClientForAccount: original.getClientForAccount } as never);
});

describe('the browser\'s own list', () => {
  it('goes into an empty account, with the marker after it', async () => {
    browser = list([tpl('aaaa-1', 'Hello'), tpl('aaaa-2', 'Thanks')]);
    expect(await sync()).toBe('synced');
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-1'), ns('aaaa-2'), MARKER]);
    expect(server[MARKER]).toEqual({ version: 1, deleted: {} });
    expect(names()).toEqual(['Hello', 'Thanks']);
    expect(partition().markerOnServer).toBe(true);

    // Each version is taken once: the next round writes nothing.
    sets = [];
    await sync();
    expect(sets).toEqual([]);
  });

  it('is merged into an account that holds templates already, so a second browser keeps both lists', async () => {
    server = { [ns('bbbb-1')]: tpl('bbbb-1', 'From the other browser'), [MARKER]: { version: 1, deleted: {} } };
    browser = list([tpl('aaaa-1', 'Only here')]);
    await sync();
    expect(names()).toEqual(['From the other browser', 'Only here']);
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-1')]);
  });

  it('leaves out a template that a newer tombstone deleted', async () => {
    server = { [MARKER]: { version: 1, deleted: { 'aaaa-1': ago(1000) } } };
    browser = list([tpl('aaaa-1', 'Deleted elsewhere', ago(60_000)), tpl('aaaa-2', 'Kept', ago(60_000))]);
    await sync();
    expect(names()).toEqual(['Kept']);
    expect(server[ns('aaaa-1')]).toBeUndefined();
  });

  it('is not used, and no marker written, while it isn\'t known whose it is', async () => {
    browser = { status: 'unknown' };
    useTemplateStore.setState({ templates: [tpl('aaaa-9', 'Someone else’s')] });
    await sync();
    expect(sets).toEqual([]);
    expect(partition().templates).toEqual([]);
    expect(partition().markerOnServer).toBe(false);
  });

  it('gives an id that doesn\'t fit a metadata key the same new id on every device', async () => {
    const id = storableId('Demo_Template 1');
    expect(id).toMatch(/^[0-9a-f]{28}$/);
    expect(storableId('Demo_Template 1')).toBe(id);
    expect(storableId('Demo_Template 2')).not.toBe(id);
    browser = list([tpl('Demo_Template 1', 'Old id')]);
    await sync();
    expect(partition().templates[0].id).toBe(id);
    expect(server[ns(id)]).toBeTruthy();
  });

  it('keeps a template over 8 KB and one the server has no room for in this browser, with why', async () => {
    server = { 'org.bulwarkmail.other': { fill: 'y'.repeat(SHARED_MAX - 4000) } };
    browser = list([tpl('aaaa-big', 'Big', undefined, { body: 'x'.repeat(9000) }), tpl('aaaa-mid', 'Mid', undefined, { body: 'z'.repeat(5000) }), tpl('aaaa-ok', 'Small')]);
    await sync();
    expect(partition().localOnly).toEqual({ 'aaaa-big': 'too-large', 'aaaa-mid': 'no-room' });
    expect(names()).toEqual(['Big', 'Mid', 'Small']);
    expect(server[ns('aaaa-ok')]).toBeTruthy();
    expect(sets.some((s) => s.key === ns('aaaa-big'))).toBe(false);
  });
});

describe('later rounds', () => {
  beforeEach(async () => {
    browser = list([tpl('aaaa-1', 'One'), tpl('aaaa-2', 'Two')]);
    await sync();
    sets = [];
  });

  it('take a newer server version and upload a newer local one', async () => {
    server[ns('aaaa-1')] = tpl('aaaa-1', 'One, edited elsewhere', '2026-10-05T00:00:00.000Z');
    edit((templates) => templates.map((t) => (t.id === 'aaaa-2' ? { ...t, name: 'Two, edited here', updatedAt: '2026-10-06T00:00:00.000Z' } : t)));
    await sync();
    expect(names()).toEqual(['One, edited elsewhere', 'Two, edited here']);
    expect(sets.map((s) => s.key)).toEqual([ns('aaaa-2')]);
  });

  it('upload an entry that is missing without a tombstone, never take it as deleted', async () => {
    delete server[ns('aaaa-1')];
    await sync();
    expect(names()).toEqual(['One', 'Two']);
    expect(server[ns('aaaa-1')]).toBeTruthy();
  });

  it('delete through the tombstone: the marker first, then the entry', async () => {
    personalTemplatesFor('carol@mail').remove('aaaa-2');
    await sync();
    expect(sets.map((s) => s.key)).toEqual([MARKER, ns('aaaa-2')]);
    expect((server[MARKER] as { deleted: Record<string, string> }).deleted['aaaa-2']).toBeTruthy();
    expect(partition().serverDeleted['aaaa-2']).toBeTruthy();
  });

  it('drop a template another device deleted, also when the store changes during the round (review A)', async () => {
    server[MARKER] = { version: 1, deleted: { 'aaaa-1': ago(0) } };
    delete server[ns('aaaa-1')];
    edit((templates) => templates.map((t) => (t.id === 'aaaa-2' ? { ...t, name: 'Two!', updatedAt: ago(500) } : t)));
    onSet = () => {
      // While the upload runs, a new template arrives (this tab or another one).
      edit((templates) => [...templates, tpl('aaaa-3', 'Three', ago(100))]);
      onSet = null;
    };
    await sync();
    await sync();
    expect(partition().templates.map((t) => t.id).sort()).toEqual(['aaaa-2', 'aaaa-3']);
    expect(server[ns('aaaa-1')]).toBeUndefined();
    expect(server[ns('aaaa-3')]).toBeTruthy();
  });

  it('keep what another tab wrote while the round ran', async () => {
    onSet = () => {
      // Another tab's write replaces the whole partition (storage rehydrate).
      const p = partition();
      useAccountTemplatesStore.setState({
        personal: {
          'carol@mail': {
            ...p,
            templates: [...p.templates.filter((t) => t.id !== 'aaaa-1'), tpl('aaaa-4', 'From the other tab', ago(50))],
            deletedTemplateIds: { 'aaaa-1': ago(10) },
          },
        },
      });
      onSet = null;
    };
    edit((templates) => templates.map((t) => (t.id === 'aaaa-2' ? { ...t, updatedAt: ago(1000) } : t)));
    await sync();
    expect(partition().templates.map((t) => t.id).sort()).toEqual(['aaaa-2', 'aaaa-4']);
    expect(server[ns('aaaa-1')]).toBeUndefined();
    expect(server[ns('aaaa-4')]).toBeTruthy();
  });

  it('keep the copy when an answer comes without the metadata property (review B)', async () => {
    omitMetadata = true;
    expect(await sync()).toBe('unsupported');
    expect(names()).toEqual(['One', 'Two']);
  });

  it('keep an edit made on a device whose clock is behind (review C)', async () => {
    server[ns('aaaa-1')] = tpl('aaaa-1', 'Edited on a fast clock', new Date(Date.now() + 3_600_000).toISOString());
    await sync();
    personalTemplatesFor('carol@mail').update('aaaa-1', { name: 'Edited here later' });
    await sync();
    expect(partition().templates.find((t) => t.id === 'aaaa-1')?.name).toBe('Edited here later');
    expect((server[ns('aaaa-1')] as EmailTemplate).name).toBe('Edited here later');
  });
});

describe('whose the browser\'s list is', () => {
  beforeEach(asCarol);

  it('is unknown until settings sync loaded the account\'s settings, whose templates then reach the account (review D)', async () => {
    expect(browserListFor('carol@mail')).toEqual({ status: 'unknown' });
    await syncAccountTemplates('carol@mail');
    expect(server[MARKER]).toBeUndefined();
    expect(partition().markerOnServer).toBe(false);

    // The settings blob loads: its templates go into the account's copy too.
    localStorage.setItem('settings-sync-owner', 'carol@mail');
    useSettingsStore.getState().importSettings(JSON.stringify({ templates: [tpl('blob-1', 'Only in the blob')], deletedTemplateIds: {} }), { serverAccountId: 'carol@mail' });
    expect(partition().templates.map((t) => t.id)).toEqual(['blob-1']);
    await syncAccountTemplates('carol@mail');
    expect(server[ns('blob-1')]).toBeTruthy();
    expect(server[MARKER]).toEqual({ version: 1, deleted: {} });
  });

  it('is another account\'s while that account\'s settings are loaded', () => {
    localStorage.setItem('settings-sync-owner', 'alice@mail');
    expect(browserListFor('carol@mail')).toEqual({ status: 'unknown' });
    expect(browserListFor('dave@mail')).toEqual({ status: 'none' });
  });

  it('goes into the first account only without settings sync, and others start empty', async () => {
    config.value = { settingsSyncEnabled: false };
    useTemplateStore.setState({ templates: [tpl('aaaa-1', 'Browser')] });
    expect(browserListFor('carol@mail').status).toBe('list');
    await syncAccountTemplates('carol@mail');
    expect(useAccountTemplatesStore.getState().browserListOwner).toBe('carol@mail');
    expect(names()).toEqual(['Browser']);
    expect(browserListFor('dave@mail')).toEqual({ status: 'none' });
    expect(browserListFor('carol@mail').status).toBe('list');
  });
});

describe('servers without metadata', () => {
  it('leave an account without the capability alone', async () => {
    vi.restoreAllMocks();
    await connect(false);
    browser = list([tpl('aaaa-1', 'Local')]);
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    expect(await sync()).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(partition()).toBeUndefined();
  });

  it('keep the app online when the server drops the connection on metadata (the 1.0 test build)', async () => {
    drop = true;
    browser = list([tpl('aaaa-1', 'Local')]);
    expect(await sync()).toBe('unsupported');
    expect(partition()).toBeUndefined();
    expect(connection).not.toHaveBeenCalledWith(false);
    const fetchSpy = vi.mocked(globalThis.fetch);
    fetchSpy.mockClear();
    expect(await sync()).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  beforeEach(async () => {
    asCarol();
    localStorage.setItem('settings-sync-owner', 'carol@mail');
    useTemplateStore.setState({ templates: [tpl('aaaa-1', 'One'), tpl('aaaa-2', 'Two')] });
    await syncAccountTemplates('carol@mail');
    sets = [];
  });

  it('sends a deletion that is still queued before the account signs out', async () => {
    personalTemplatesFor('carol@mail').remove('aaaa-1');
    await runBeforeSignOut('carol@mail');
    expect(sets.map((s) => s.key)).toEqual([MARKER, ns('aaaa-1')]);
    expect(server[ns('aaaa-1')]).toBeUndefined();
  });

  it('keeps only unsent templates and deletions after a full sign-out', async () => {
    drop = true;
    personalTemplatesFor('carol@mail').remove('aaaa-1');
    personalTemplatesFor('carol@mail').add({ name: 'Unsent', subject: '', body: '', category: '', isFavorite: false });
    await flushAccountTemplates('carol@mail');
    purgeSignedOutData();
    const kept = useAccountTemplatesStore.getState().personal['carol@mail'];
    expect(kept.templates.map((t) => t.name)).toEqual(['Unsent']);
    expect(Object.keys(kept.deletedTemplateIds)).toEqual(['aaaa-1']);
  });

  it('drops an account copy that the server holds in full', () => {
    purgeSignedOutData();
    expect(useAccountTemplatesStore.getState().personal['carol@mail']).toBeUndefined();
  });
});

describe('tombstones', () => {
  it('keep 90 days and at most 8 KB, the oldest go first', () => {
    const deleted: Record<string, string> = { old: ago(91 * 86_400_000) };
    for (let i = 0; i < 400; i++) deleted[`id-${String(i).padStart(4, '0')}-${'x'.repeat(20)}`] = ago(i * 1000);
    const kept = pruneTombstones(deleted);
    expect(kept.old).toBeUndefined();
    expect(new TextEncoder().encode(JSON.stringify({ version: 1, deleted: kept })).length).toBeLessThanOrEqual(8192);
    expect(kept[`id-0000-${'x'.repeat(20)}`]).toBeDefined();
    expect(kept[`id-0399-${'x'.repeat(20)}`]).toBeUndefined();
  });

  it('a deletion here wins over an older server copy, an edit there over an older deletion', () => {
    const plan = planPersonalSync(
      { templates: [], deletedTemplateIds: { a: ago(5000), b: ago(5000) } },
      { a: tpl('a', 'A', ago(10_000)), b: tpl('b', 'B', ago(1000)) },
      {},
    );
    expect(plan.deletes).toEqual(['a']);
    expect(plan.templates.map((t) => t.id)).toEqual(['b']);
  });
});
