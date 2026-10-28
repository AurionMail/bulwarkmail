import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { buildShareSetCalls, parseShareTargets, readShareSetResults, type ShareChange } from '../jmap/share-batch';
import { CALENDAR_PRESETS, FILE_PRESETS, MAILBOX_PRESETS } from '../jmap/share-rights';

const change = (kind: ShareChange['kind'], id: string, rights: ShareChange['rights'], principalId = 'ck', accountId = 'ci'): ShareChange =>
  ({ kind, accountId, id, name: id, principalId, rights });

describe('buildShareSetCalls', () => {
  it('puts each type in one call with a shareWith patch per item', () => {
    const { calls } = buildShareSetCalls([
      change('mailbox', 'a', MAILBOX_PRESETS.read),
      change('mailbox', 'b', MAILBOX_PRESETS.read),
      change('calendar', 'c2', CALENDAR_PRESETS.read),
      change('file', 'n1', null),
    ], { maxObjectsInSet: 500 });
    expect(calls).toEqual([
      ['Mailbox/set', { accountId: 'ci', update: { a: { 'shareWith/ck': MAILBOX_PRESETS.read }, b: { 'shareWith/ck': MAILBOX_PRESETS.read } } }, 's0'],
      ['Calendar/set', { accountId: 'ci', update: { c2: { 'shareWith/ck': CALENDAR_PRESETS.read } } }, 's1'],
      ['FileNode/set', { accountId: 'ci', update: { n1: { 'shareWith/ck': null } } }, 's2'],
    ]);
  });

  it('splits a type past maxObjectsInSet', () => {
    const changes = ['a', 'b', 'c'].map((id) => change('mailbox', id, null));
    const { calls, changesByCall } = buildShareSetCalls(changes, { maxObjectsInSet: 2 });
    expect(calls.map(([, args]) => Object.keys(args.update as object))).toEqual([['a', 'b'], ['c']]);
    expect(changesByCall.get('s1')!.map((c) => c.id)).toEqual(['c']);
  });

  it('converts rights through wireRights, but never a revoke', () => {
    const { calls } = buildShareSetCalls([change('file', 'n1', FILE_PRESETS.read), change('file', 'n2', null)], {
      maxObjectsInSet: 500,
      wireRights: () => ({ mayRead: true, mayWrite: false, mayShare: false }),
    });
    expect(calls[0][1].update).toEqual({ n1: { 'shareWith/ck': { mayRead: true, mayWrite: false, mayShare: false } }, n2: { 'shareWith/ck': null } });
  });
});

describe('readShareSetResults', () => {
  it('reports each item: updated, refused with the reason, or the whole call failing', () => {
    const changes = [
      change('mailbox', 'a', MAILBOX_PRESETS.read),
      change('mailbox', 'b', MAILBOX_PRESETS.read),
      change('mailbox', 'z', MAILBOX_PRESETS.read),
      change('calendar', 'c2', CALENDAR_PRESETS.read),
    ];
    const { calls, changesByCall } = buildShareSetCalls(changes, { maxObjectsInSet: 500 });
    const results = readShareSetResults(calls, changesByCall, [
      ['Mailbox/set', { updated: { a: null }, notUpdated: { b: { type: 'forbidden', description: 'You may not share this folder' } } }, 's0'],
      ['error', { type: 'forbidden' }, 's1'],
    ]);
    expect(results.map((r) => [r.change.id, r.ok, r.error])).toEqual([
      ['a', true, undefined],
      ['b', false, 'You may not share this folder'],
      ['z', false, undefined],
      ['c2', false, 'forbidden'],
    ]);
  });
});

describe('parseShareTargets', () => {
  it('reads every type and names the ones whose call failed', () => {
    const { targets, failed } = parseShareTargets([
      ['Mailbox/get', { list: [{ id: 'a', name: 'Inbox', role: 'inbox', parentId: null, shareWith: { ck: MAILBOX_PRESETS.read } }] }, 'm'],
      ['error', { type: 'serverFail' }, 'c'],
      ['AddressBook/get', { list: [{ id: 'ab', name: 'Contacts', isDefault: true, shareWith: null }] }, 'a'],
    ], { mailbox: 'ci', calendar: 'ci', addressBook: 'ci' });
    expect(targets).toEqual([
      { kind: 'mailbox', accountId: 'ci', id: 'a', name: 'Inbox', role: 'inbox', parentId: null, shareWith: { ck: MAILBOX_PRESETS.read } },
      { kind: 'addressBook', accountId: 'ci', id: 'ab', name: 'Contacts', isDefault: true, shareWith: {} },
    ]);
    expect(failed).toEqual(['calendar']);
  });
});

describe('JMAPClient.applyShareChanges', () => {
  afterEach(() => vi.restoreAllMocks());

  function client(fileCapability: Record<string, unknown> = { forbiddenNameChars: '/' }) {
    const c = new JMAPClient('https://jmap.example.com', 'user', 'pass');
    Object.assign(c, {
      apiUrl: 'https://jmap.example.com/api',
      accountId: 'ci',
      capabilities: {
        'urn:ietf:params:jmap:core': { maxCallsInRequest: 2, maxObjectsInSet: 500 },
        'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:calendars': {}, 'urn:ietf:params:jmap:filenode': {},
      },
    });
    const accounts = { ci: { name: 'org-alice@example.org', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:filenode': fileCapability } } };
    Object.assign(c, { accounts, session: { accounts } });
    return c;
  }

  function respondWith(handler: (body: { using: string[]; methodCalls: [string, Record<string, unknown>, string][] }) => unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      const response = handler(body);
      return { ok: true, status: 200, text: async () => JSON.stringify(response), json: async () => response } as Response;
    });
  }

  it('sends one request per maxCallsInRequest calls and reports every item', async () => {
    const spy = respondWith((body) => ({
      methodResponses: body.methodCalls.map(([method, args, id]) => [method, { updated: Object.fromEntries(Object.keys(args.update as object).map((k) => [k, null])) }, id]),
    }));
    const results = await client().applyShareChanges([
      change('mailbox', 'a', MAILBOX_PRESETS.read),
      change('calendar', 'c2', CALENDAR_PRESETS.read),
      change('file', 'n1', null),
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
    const first = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(first.using).toEqual(expect.arrayContaining(['urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:mail:share', 'urn:ietf:params:jmap:calendars']));
    expect(results.map((r) => [r.change.id, r.ok])).toEqual([['a', true], ['c2', true], ['n1', true]]);
  });

  it('marks the items of a failed request failed instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const results = await client().applyShareChanges([change('mailbox', 'a', MAILBOX_PRESETS.read)]);
    expect(results).toEqual([{ change: expect.objectContaining({ id: 'a' }), ok: false, error: expect.any(String) }]);
  });

  it('sends the old file rights to a server before 0.16.6', async () => {
    const spy = respondWith((body) => ({ methodResponses: [['FileNode/set', { updated: { n1: null } }, body.methodCalls[0][2]]] }));
    await client({}).applyShareChanges([change('file', 'n1', FILE_PRESETS.readWrite)]);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.methodCalls[0][1].update).toEqual({ n1: { 'shareWith/ck': { mayRead: true, mayWrite: true, mayShare: false } } });
  });
});

describe('JMAPClient.getShareTargets', () => {
  afterEach(() => vi.restoreAllMocks());

  type Call = [string, Record<string, unknown>, string];
  function client(answer: (calls: Call[]) => unknown[]) {
    const c = new JMAPClient('https://jmap.example.com', 'user', 'pass');
    const accounts = {
      ci: {
        name: 'org-alice@example.org', isPersonal: true,
        accountCapabilities: {
          'urn:ietf:params:jmap:mail': {}, 'urn:ietf:params:jmap:mail:share': {}, 'urn:ietf:params:jmap:calendars': {},
          'urn:ietf:params:jmap:contacts': {}, 'urn:ietf:params:jmap:filenode': { forbiddenNameChars: '/' },
        },
      },
    };
    Object.assign(c, {
      apiUrl: 'https://jmap.example.com/api', accountId: 'ci', accounts,
      capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:mail': {} },
      session: { accounts, primaryAccounts: {} },
    });
    const request = vi.spyOn(c as unknown as { request: (calls: Call[]) => Promise<unknown> }, 'request')
      .mockImplementation(async (calls: Call[]) => ({ methodResponses: answer(calls) }));
    return { c, request };
  }
  const lists = (calls: Call[]) => calls.map(([method, , id]) => [method, {
    list: method === 'Mailbox/get' ? [{ id: 'a', name: 'Inbox', role: 'inbox', shareWith: { ck: MAILBOX_PRESETS.read } }]
      : method === 'Calendar/get' ? [{ id: 'b', name: 'Calendar', isDefault: true, shareWith: {} }]
        : [{ id: 'c', name: 'Contacts', isDefault: true, shareWith: {} }],
  }, id]);

  it('reads folders, calendars and address books in one request, and only the shared files', async () => {
    const { c, request } = client(lists);
    vi.spyOn(c, 'listAllFileNodes').mockResolvedValue([
      { id: 'n1', name: 'plan.pdf', parentId: null, shareWith: { ck: FILE_PRESETS.read } },
      { id: 'n2', name: 'notes.txt', parentId: null, shareWith: {} },
    ] as never);
    const { targets, failed } = await c.getShareTargets();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].map(([m]) => m)).toEqual(['Mailbox/get', 'Calendar/get', 'AddressBook/get']);
    expect(targets.map((t) => `${t.kind}:${t.id}`)).toEqual(['mailbox:a', 'calendar:b', 'addressBook:c', 'file:n1']);
    expect(failed).toEqual([]);
  });

  it('reads the file tree alongside the rest, not after it', async () => {
    let releaseCollections: () => void = () => {};
    const collectionsHeld = new Promise<void>((resolve) => { releaseCollections = resolve; });
    const { c, request } = client(lists);
    request.mockImplementation(async (calls: Call[]) => { await collectionsHeld; return { methodResponses: lists(calls) }; });
    const files = vi.spyOn(c, 'listAllFileNodes').mockResolvedValue([]);
    const pending = c.getShareTargets();
    // The collections haven't answered yet, and the file read has already started.
    await Promise.resolve();
    expect(files).toHaveBeenCalled();
    releaseCollections();
    expect((await pending).failed).toEqual([]);
  });

  it('skips the types whose feature is off', async () => {
    const { c, request } = client(lists);
    const files = vi.spyOn(c, 'listAllFileNodes').mockResolvedValue([]);
    await c.getShareTargets({ calendars: false, contacts: false, files: false });
    expect(request.mock.calls[0][0].map(([m]) => m)).toEqual(['Mailbox/get']);
    expect(files).not.toHaveBeenCalled();
  });

  it('names the types whose read failed', async () => {
    const { c } = client((calls) => calls.map((call) => (call[0] === 'Calendar/get' ? ['error', { type: 'serverFail' }, call[2]] : lists([call])[0])));
    vi.spyOn(c, 'listAllFileNodes').mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { failed } = await c.getShareTargets();
    expect(failed.sort()).toEqual(['calendar', 'file']);
  });
});

describe('JMAPClient.findPrincipalByEmail', () => {
  afterEach(() => vi.restoreAllMocks());

  function client(responses: unknown[]) {
    const c = new JMAPClient('https://jmap.example.com', 'user', 'pass');
    Object.assign(c, {
      apiUrl: 'https://jmap.example.com/api', accountId: 'ci',
      capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:principals': {} },
    });
    const request = vi.spyOn(c as unknown as { request: () => Promise<unknown> }, 'request').mockResolvedValue({ methodResponses: responses });
    return { c, request };
  }

  it('finds the principal with that address, whatever its case', async () => {
    const { c, request } = client([
      ['Principal/query', { ids: ['ck'] }, '0'],
      ['Principal/get', { list: [{ id: 'ck', type: 'individual', name: 'Carol', email: 'org-carol@example.org' }] }, '1'],
    ]);
    const found = await c.findPrincipalByEmail(' Org-Carol@Example.org ');
    expect(found).toEqual({ principal: expect.objectContaining({ id: 'ck', accountId: 'ci' }), status: 'ok' });
    const [calls] = request.mock.calls[0] as unknown as [[string, Record<string, unknown>][]];
    expect(calls[0][1].filter).toEqual({ email: 'org-carol@example.org' });
  });

  it('says when directory queries are off (Stalwart 1.0)', async () => {
    const { c } = client([
      ['error', { type: 'forbidden', description: 'The administrator has disabled directory queries.' }, '0'],
      ['error', { type: 'invalidResultReference' }, '1'],
    ]);
    expect(await c.findPrincipalByEmail('org-carol@example.org')).toEqual({ principal: null, status: 'forbidden', directoryQueriesOff: true });
  });

  it('tells a refusal for another reason apart, and an unknown address', async () => {
    expect(await client([['error', { type: 'forbidden', description: 'You are not authorized to perform this action' }, '0']]).c
      .findPrincipalByEmail('x@example.org')).toEqual({ principal: null, status: 'forbidden' });
    expect(await client([['Principal/query', { ids: [] }, '0'], ['Principal/get', { list: [] }, '1']]).c
      .findPrincipalByEmail('x@example.org')).toEqual({ principal: null, status: 'ok' });
  });
});
