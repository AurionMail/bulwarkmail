import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapErrorFailedIds, jmapErrorProperties, jmapErrorType } from '../jmap/jmap-error';

// Regression coverage for the shared-account keyword write path (#281): keyword
// mutations (tags, $answered/$forwarded) on a unified-inbox message must target
// the email's owning account, not the reaching client's primary. Writing to the
// primary account silently no-ops server-side (JMAP returns notUpdated without
// throwing), so the keyword is lost on the next reload. toggleStar already
// threaded accountId through; updateEmailKeywords/setKeyword did not.

function createClient(): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: 'primary-account',
    username: 'user@example.com',
  });
  return client;
}

interface JMAPMethodCall {
  0: string;
  1: Record<string, unknown>;
  2: string;
}

function mockEmailSet() {
  const captured: JMAPMethodCall[] = [];
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body) as { methodCalls: JMAPMethodCall[] };
    captured.push(...body.methodCalls);
    return new Response(JSON.stringify({ methodResponses: [['Email/set', { updated: {} }, '0']] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { captured, fetchSpy };
}

function patchFor(call: JMAPMethodCall, emailId: string): Record<string, unknown> {
  const update = call[1].update as Record<string, Record<string, unknown>>;
  return update[emailId];
}

describe('JMAP keyword writes route to the email account (#281)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('updateEmailKeywords sends the explicit accountId', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.updateEmailKeywords('email-x', { '$label:work': true }, 'shared-account');
    expect(captured[0][0]).toBe('Email/set');
    expect(captured[0][1].accountId).toBe('shared-account');
  });

  it('updateEmailKeywords falls back to the primary account when none is given', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.updateEmailKeywords('email-x', { '$label:work': true });
    expect(captured[0][1].accountId).toBe('primary-account');
  });

  it('setKeyword sends the explicit accountId', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.setKeyword('email-x', '$answered', 'shared-account');
    expect(captured[0][0]).toBe('Email/set');
    expect(captured[0][1].accountId).toBe('shared-account');
  });

  it('setKeyword falls back to the primary account when none is given', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.setKeyword('email-x', '$answered');
    expect(captured[0][1].accountId).toBe('primary-account');
  });
});

describe('Email/set clears keywords with null, not false', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('updateEmailKeywords writes a full map of true values only', async () => {
    // Local copies carry `$seen: false` after marking unread; RFC 8621 allows
    // only true in a keyword map.
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.updateEmailKeywords('email-x', { $seen: false, $flagged: false, '$label:work': true, $pinned: true });
    expect(patchFor(captured[0], 'email-x')).toEqual({ keywords: { '$label:work': true, $pinned: true } });
  });

  it('markAsRead(false) removes $seen with null', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.markAsRead('email-x', false);
    const patch = patchFor(captured[0], 'email-x');
    expect(patch['keywords/$seen']).toBeNull();
    expect(patch['keywords/$seen']).not.toBe(false);
  });

  it('markAsRead(true) sets $seen to true', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.markAsRead('email-x', true);
    expect(patchFor(captured[0], 'email-x')['keywords/$seen']).toBe(true);
  });

  it('batchMarkAsRead(false) removes $seen with null for every id', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.batchMarkAsRead(['email-a', 'email-b'], false);
    for (const id of ['email-a', 'email-b']) {
      const patch = patchFor(captured[0], id);
      expect(patch['keywords/$seen']).toBeNull();
      expect(patch['keywords/$seen']).not.toBe(false);
    }
  });

  it('batchMarkAsRead(true) sets $seen to true for every id', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.batchMarkAsRead(['email-a', 'email-b'], true);
    for (const id of ['email-a', 'email-b']) {
      expect(patchFor(captured[0], id)['keywords/$seen']).toBe(true);
    }
  });

  it('toggleStar(false) removes $flagged with null', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.toggleStar('email-x', false);
    const patch = patchFor(captured[0], 'email-x');
    expect(patch['keywords/$flagged']).toBeNull();
    expect(patch['keywords/$flagged']).not.toBe(false);
  });

  it('toggleStar(true) sets $flagged to true', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.toggleStar('email-x', true);
    expect(patchFor(captured[0], 'email-x')['keywords/$flagged']).toBe(true);
  });
});

// "Not spam" used to patch only mailboxIds, so a message restored to the Inbox
// kept its $junk keyword and stayed flagged as junk for every other JMAP client.
// Both directions now move the message and flip $junk/$notjunk in one patch.
describe('spam / not-spam patch keywords alongside the move (#850)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('undoSpam clears $junk (null) and sets $notjunk with the move', async () => {
    const client = createClient();
    const { captured } = mockEmailSet();
    await client.undoSpam('email-x', 'inbox-id', 'shared-account');
    expect(captured[0][0]).toBe('Email/set');
    expect(captured[0][1].accountId).toBe('shared-account');
    const patch = patchFor(captured[0], 'email-x');
    expect(patch.mailboxIds).toEqual({ 'inbox-id': true });
    expect(patch['keywords/$junk']).toBeNull();
    expect(patch['keywords/$junk']).not.toBe(false);
    expect(patch['keywords/$notjunk']).toBe(true);
  });

  it('markAsSpam sets $junk and clears $notjunk (null) with the move', async () => {
    const client = createClient();
    vi.spyOn(client, 'getMailboxes').mockResolvedValue([
      { id: 'junk-id', role: 'junk', name: 'Junk', isShared: false } as never,
    ]);
    const { captured } = mockEmailSet();
    await client.markAsSpam('email-x');
    const patch = patchFor(captured[0], 'email-x');
    expect(patch.mailboxIds).toEqual({ 'junk-id': true });
    expect(patch['keywords/$junk']).toBe(true);
    expect(patch['keywords/$notjunk']).toBeNull();
    expect(patch['keywords/$seen']).toBeUndefined();
  });
});

// Stalwart refuses a keyword per message in Email/set `notUpdated`, not as a
// request error, so a writer that only awaited the request reported success
// and the UI showed a tag that was gone after a reload. 1.0 refuses keywords
// over 128 bytes and more than 100 keywords on one message; 0.16 accepts both
// (it cuts long keywords to 128 characters).
describe('keyword writes report what the server refused', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const TOO_LONG = {
    type: 'invalidProperties',
    description: 'Keywords cannot be longer than 128 bytes.',
    properties: ['keywords'],
  };
  const TOO_MANY = {
    type: 'tooManyKeywords',
    description: 'An email cannot have more than 100 keywords.',
    properties: ['keywords'],
  };

  /** Answers every Email/set with `result` for the ids it names. */
  function mockEmailSetResult(result: (ids: string[]) => Record<string, unknown>) {
    const captured: JMAPMethodCall[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body) as { methodCalls: JMAPMethodCall[] };
      captured.push(...body.methodCalls);
      const methodResponses = body.methodCalls.map((call) => {
        const ids = Object.keys((call[1].update ?? {}) as Record<string, unknown>);
        return ['Email/set', { accountId: call[1].accountId, newState: 's2', ...result(ids) }, call[2]];
      });
      return new Response(JSON.stringify({ methodResponses }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    return captured;
  }

  const refuseAll = (error: Record<string, unknown>) => (ids: string[]) => ({
    notUpdated: Object.fromEntries(ids.map((id) => [id, error])),
  });
  const acceptAll = (ids: string[]) => ({ updated: Object.fromEntries(ids.map((id) => [id, null])) });

  const writers: Array<[string, (client: JMAPClient) => Promise<void>]> = [
    ['updateEmailKeywords', (c) => c.updateEmailKeywords('m1', { [`$label:${'x'.repeat(130)}`]: true })],
    ['setKeyword', (c) => c.setKeyword('m1', `$label:${'x'.repeat(130)}`)],
    ['removeKeyword', (c) => c.removeKeyword('m1', '$label:work')],
    ['batchUpdateKeywords', (c) => c.batchUpdateKeywords(['m1'], { [`keywords/$label:${'x'.repeat(130)}`]: true })],
    ['toggleStar', (c) => c.toggleStar('m1', true)],
    ['markAsRead', (c) => c.markAsRead('m1', true)],
    ['batchMarkAsRead', (c) => c.batchMarkAsRead(['m1'], true)],
  ];

  it.each(writers)('%s rejects with the SetError type on Stalwart 1.0', async (_name, write) => {
    mockEmailSetResult(refuseAll(TOO_LONG));
    const error = await write(createClient()).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Keywords cannot be longer than 128 bytes.');
    expect(jmapErrorType(error)).toBe('invalidProperties');
    expect(jmapErrorProperties(error)).toEqual(['keywords']);
  });

  it.each(writers)('%s resolves when Stalwart 0.16 accepts the write', async (_name, write) => {
    mockEmailSetResult(acceptAll);
    await expect(write(createClient())).resolves.toBeUndefined();
  });

  it('reports too many keywords on one message (Stalwart 1.0)', async () => {
    mockEmailSetResult(refuseAll(TOO_MANY));
    const error = await createClient().setKeyword('m1', '$label:one-more').then(() => null, (e: unknown) => e);
    expect(jmapErrorType(error)).toBe('tooManyKeywords');
    expect((error as Error).message).toContain('An email cannot have more than 100 keywords.');
  });

  it('reports a method-level refusal with its type', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      methodResponses: [['error', { type: 'accountReadOnly' }, '0']],
    }), { status: 200 }));
    const error = await createClient().toggleStar('m1', false).then(() => null, (e: unknown) => e);
    expect(jmapErrorType(error)).toBe('accountReadOnly');
  });

  it('writes every batch before reporting a refused message', async () => {
    const client = createClient();
    Object.assign(client, { capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: 1 } } });
    const captured = mockEmailSetResult((ids) => (ids[0] === 'm1' ? refuseAll(TOO_LONG)(ids) : acceptAll(ids)));

    await expect(client.batchUpdateKeywords(['m1', 'm2', 'm3'], { 'keywords/$label:work': true }))
      .rejects.toThrow('Keywords cannot be longer than 128 bytes.');
    expect(captured.map((call) => Object.keys(call[1].update as Record<string, unknown>))).toEqual([['m1'], ['m2'], ['m3']]);

    captured.length = 0;
    await expect(client.batchMarkAsRead(['m1', 'm2'], true)).rejects.toThrow(/mark as read/);
    expect(captured).toHaveLength(2);
  });

  // The rest of a batch was written, so a caller can show it as done.
  it('names the messages a batched write left unchanged (Stalwart 1.0)', async () => {
    const client = createClient();
    Object.assign(client, { capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: 2 } } });
    mockEmailSetResult((ids) => ({
      ...acceptAll(ids.filter((id) => id !== 'm2')),
      ...(ids.includes('m2') ? { notUpdated: { m2: TOO_MANY } } : {}),
    }));

    const error = await client.batchUpdateKeywords(['m1', 'm2', 'm3'], { 'keywords/$label:work': true })
      .then(() => null, (e: unknown) => e);

    expect(jmapErrorType(error)).toBe('tooManyKeywords');
    expect(jmapErrorFailedIds(error)).toEqual(['m2']);
  });

  it('counts every message of a batch whose call was refused as unchanged', async () => {
    const client = createClient();
    Object.assign(client, { capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: 2 } } });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const [call] = (JSON.parse((init as { body: string }).body) as { methodCalls: JMAPMethodCall[] }).methodCalls;
      const ids = Object.keys((call[1].update ?? {}) as Record<string, unknown>);
      const methodResponses = ids.includes('m3')
        ? [['error', { type: 'accountReadOnly' }, call[2]]]
        : [['Email/set', { accountId: call[1].accountId, newState: 's2', ...acceptAll(ids) }, call[2]]];
      return new Response(JSON.stringify({ methodResponses }), { status: 200 });
    });

    const error = await client.batchMarkAsRead(['m1', 'm2', 'm3', 'm4'], true).then(() => null, (e: unknown) => e);

    expect(jmapErrorType(error)).toBe('accountReadOnly');
    expect(jmapErrorFailedIds(error)).toEqual(['m3', 'm4']);
  });

  // A request that failed outright - the connection dropped - used to count
  // the whole selection as unchanged, although the batches before it were
  // written, and those rows showed unread until the next refresh.
  it.each([
    ['batchMarkAsRead', (c: JMAPClient, ids: string[]) => c.batchMarkAsRead(ids, true)],
    ['batchUpdateKeywords', (c: JMAPClient, ids: string[]) => c.batchUpdateKeywords(ids, { 'keywords/$label:work': true })],
  ])('%s stops at a failed request and names only what was not written', async (_name, write) => {
    const client = createClient();
    Object.assign(client, { capabilities: { 'urn:ietf:params:jmap:core': { maxObjectsInSet: 2 } } });
    const requested: string[][] = [];
    const dropped = new TypeError('Failed to fetch');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const [call] = (JSON.parse((init as { body: string }).body) as { methodCalls: JMAPMethodCall[] }).methodCalls;
      const ids = Object.keys((call[1].update ?? {}) as Record<string, unknown>);
      requested.push(ids);
      if (ids.includes('m3')) throw dropped;
      return new Response(JSON.stringify({
        methodResponses: [['Email/set', { accountId: call[1].accountId, newState: 's2', ...acceptAll(ids) }, call[2]]],
      }), { status: 200 });
    });

    const error = await write(client, ['m1', 'm2', 'm3', 'm4', 'm5']).then(() => null, (e: unknown) => e);

    expect(requested.filter((ids) => ids.includes('m5'))).toEqual([]);
    expect(requested[0]).toEqual(['m1', 'm2']);
    expect(error).toBeInstanceOf(Error);
    expect(jmapErrorFailedIds(error)).toEqual(['m3', 'm4', 'm5']);
  });
});
