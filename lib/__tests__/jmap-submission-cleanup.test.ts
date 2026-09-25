import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient, NoLongerScheduledError, SubmissionQuotaError, prunableSubmissionIds } from '../jmap/client';
import { jmapErrorType } from '../jmap/jmap-error';

/**
 * Stalwart 1.0 counts every EmailSubmission record of an account against
 * `maxSubmissions` (500 by default) and never purges them, so the client has
 * to destroy the records that can no longer be cancelled. Destroying a
 * pending one would not stop its mail, only make it impossible to cancel.
 *
 * The fake below answers the way Stalwart does:
 * - 1.0 (2663169eb): the create returns {id, sendAt, undoStatus}, pending while
 *   queued; overQuota with Stalwart's description once the limit is reached;
 * - 0.16.10-0.16.16: the create returns undoStatus final, even for a held send;
 * - 0.16.6-0.16.9: the create returns {id} only;
 * - every version: EmailSubmission/get computes pending while the message is
 *   queued, final once it left, canceled once canceled; the query only sees
 *   sendAt from three days back on; destroy removes the record, nothing else.
 */

type Version = '1.0' | '0.16.12' | '0.16.6';
type MethodCall = [string, Record<string, unknown>, string];
type SetError = { type: string; description?: string };

interface FakeSubmission {
  id: string;
  accountId: string;
  emailId: string;
  sendAt?: string;
  canceled: boolean;
  /** Still in the queue: held, or retrying. */
  queued: boolean;
}

const OVER_QUOTA_DESCRIPTION = 'There are too many email submissions, please delete some before adding a new one.';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function utcDate(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface FakeOptions {
  version?: Version;
  /** Stalwart 1.0 `maxSubmissions`; null = unlimited. */
  quota?: number | null;
  /** Answer the query with every record, ignoring filter and window. */
  queryIgnoresFilter?: boolean;
  /** Override the answer to an EmailSubmission/set destroy. */
  destroyAnswer?: (ids: string[], callId: string) => [string, Record<string, unknown>, string] | undefined;
  /** Override the answer to an EmailSubmission/set create (after the quota check). */
  createAnswer?: (creationId: string, create: Record<string, unknown>) => SetError | undefined;
  /** Override the answer to an EmailSubmission/set update. */
  updateAnswer?: (id: string, callId: string) => [string, Record<string, unknown>, string] | undefined;
  /** Refuse Email/set creates with this error (storage quota). */
  emailCreateError?: SetError;
  /** Answer a call before the fake does. */
  intercept?: (call: MethodCall) => Array<[string, Record<string, unknown>, string]> | undefined;
}

function fakeStalwart(options: FakeOptions = {}) {
  const version = options.version ?? '1.0';
  const submissions = new Map<string, FakeSubmission>();
  const emails = new Map<string, { accountId: string; mailboxIds: Record<string, boolean> }>();
  const requests: MethodCall[][] = [];
  let next = 1;

  const newId = (prefix: string) => `${prefix}-${next++}`;

  function computedStatus(s: FakeSubmission): 'pending' | 'final' | 'canceled' {
    if (s.canceled) return 'canceled';
    return s.queued ? 'pending' : 'final';
  }

  function add(record: Partial<FakeSubmission> & { accountId: string }): FakeSubmission {
    const submission: FakeSubmission = {
      id: record.id ?? newId('sub'),
      emailId: record.emailId ?? newId('email'),
      canceled: false,
      queued: false,
      ...record,
    };
    submissions.set(submission.id, submission);
    return submission;
  }

  function matches(s: FakeSubmission, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true;
    if (filter.operator === 'OR') return (filter.conditions as Array<Record<string, unknown>>).some((c) => matches(s, c));
    if (filter.operator === 'AND') return (filter.conditions as Array<Record<string, unknown>>).every((c) => matches(s, c));
    if (typeof filter.before === 'string') return !!s.sendAt && Date.parse(s.sendAt) < Date.parse(filter.before);
    if (typeof filter.undoStatus === 'string') return computedStatus(s) === filter.undoStatus;
    return true;
  }

  function handle(call: MethodCall, earlier: Array<[string, Record<string, unknown>, string]>): Array<[string, Record<string, unknown>, string]> {
    const intercepted = options.intercept?.(call);
    if (intercepted) return intercepted;
    const [name, rawArgs, callId] = call;
    const args = { ...rawArgs };
    const ref = args['#ids'] as { resultOf: string; path: string } | undefined;
    if (ref) {
      const source = earlier.find(([, , id]) => id === ref.resultOf);
      if (!source || source[0] === 'error') return [['error', { type: 'invalidResultReference' }, callId]];
      args.ids = source[1][ref.path.replace(/^\//, '')];
    }
    const accountId = args.accountId as string;

    switch (name) {
      case 'Mailbox/get':
        return [[name, { accountId, list: [
          { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
          { id: 'mb-sent', name: 'Sent', role: 'sent' },
        ] }, callId]];
      case 'Identity/get':
        return [[name, { accountId, list: [{ id: 'identity-1', email: 'user@example.com', mayDelete: false }] }, callId]];
      case 'Email/get':
        return [[name, { accountId, list: ((args.ids as string[] | undefined) ?? []).map((id) => ({
          id, threadId: 'thread-1', mailboxIds: { 'mb-drafts': true }, keywords: {}, to: [{ email: 'bob@example.net' }], subject: 'Subject',
        })), notFound: [] }, callId]];
      case 'Email/import': {
        const created: Record<string, { id: string }> = {};
        for (const [key, value] of Object.entries(args.emails as Record<string, { mailboxIds: Record<string, boolean> }>)) {
          const id = newId('imported');
          emails.set(id, { accountId, mailboxIds: value.mailboxIds });
          created[key] = { id };
        }
        return [[name, { accountId, created }, callId]];
      }
      case 'Email/set': {
        const result: Record<string, unknown> = { accountId };
        if (args.create) {
          const created: Record<string, { id: string }> = {};
          const notCreated: Record<string, SetError> = {};
          for (const [key, value] of Object.entries(args.create as Record<string, { mailboxIds: Record<string, boolean> }>)) {
            if (options.emailCreateError) {
              notCreated[key] = options.emailCreateError;
              continue;
            }
            const id = newId('email');
            emails.set(id, { accountId, mailboxIds: value.mailboxIds });
            created[key] = { id };
          }
          if (Object.keys(created).length) result.created = created;
          if (Object.keys(notCreated).length) result.notCreated = notCreated;
        }
        if (args.update) {
          result.updated = Object.fromEntries(Object.keys(args.update as object).map((id) => [id, null]));
        }
        if (args.destroy) {
          const destroyed: string[] = [];
          const notDestroyed: Record<string, SetError> = {};
          for (const id of args.destroy as string[]) {
            if (emails.delete(id) || id.startsWith('draft-')) destroyed.push(id);
            else notDestroyed[id] = { type: 'notFound' };
          }
          result.destroyed = destroyed;
          if (Object.keys(notDestroyed).length) result.notDestroyed = notDestroyed;
        }
        return [[name, result, callId]];
      }
      case 'EmailSubmission/set': {
        const destroy = args.destroy as string[] | undefined;
        if (destroy) {
          const answer = options.destroyAnswer?.(destroy, callId);
          if (answer) return [answer];
          const destroyed: string[] = [];
          const notDestroyed: Record<string, SetError> = {};
          for (const id of destroy) {
            if (submissions.delete(id)) destroyed.push(id);
            else notDestroyed[id] = { type: 'notFound' };
          }
          return [[name, { accountId, destroyed, ...(Object.keys(notDestroyed).length ? { notDestroyed } : {}) }, callId]];
        }
        if (args.update) {
          const [id] = Object.keys(args.update as object);
          const answer = options.updateAnswer?.(id, callId);
          if (answer) return [answer];
          const submission = submissions.get(id);
          if (!submission) return [[name, { accountId, notUpdated: { [id]: { type: 'notFound' } } }, callId]];
          if (!submission.queued) {
            return [[name, { accountId, notUpdated: { [id]: { type: 'cannotUnsend', description: 'The requested message is no longer in the queue.' } } }, callId]];
          }
          submission.canceled = true;
          submission.queued = false;
          return [[name, { accountId, updated: { [id]: null } }, callId]];
        }
        const created: Record<string, Record<string, unknown>> = {};
        const notCreated: Record<string, SetError> = {};
        const successEmails: Record<string, string> = {};
        for (const [key, create] of Object.entries(args.create as Record<string, Record<string, unknown>>)) {
          const used = [...submissions.values()].filter((s) => s.accountId === accountId).length;
          if (version === '1.0' && options.quota != null && used >= options.quota) {
            notCreated[key] = { type: 'overQuota', description: OVER_QUOTA_DESCRIPTION };
            continue;
          }
          const refused = options.createAnswer?.(key, create);
          if (refused) {
            notCreated[key] = refused;
            continue;
          }
          let emailId = create.emailId as string;
          if (emailId.startsWith('#')) {
            const source = earlier.find(([method]) => method === 'Email/set' || method === 'Email/import');
            emailId = ((source?.[1].created as Record<string, { id: string }> | undefined)?.[emailId.slice(1)]?.id) ?? '';
            if (!emailId) {
              notCreated[key] = { type: 'invalidProperties', description: 'emailId not found' };
              continue;
            }
          }
          const holdFor = Number((create.envelope as { mailFrom?: { parameters?: { HOLDFOR?: string } } } | undefined)?.mailFrom?.parameters?.HOLDFOR ?? 0);
          const submission = add({ accountId, emailId, sendAt: utcDate(Date.now() + holdFor * 1000), queued: true });
          successEmails[key] = emailId;
          created[key] = version === '0.16.6'
            ? { id: submission.id }
            : { id: submission.id, sendAt: submission.sendAt, undoStatus: version === '1.0' ? 'pending' : 'final' };
        }
        const responses: Array<[string, Record<string, unknown>, string]> = [[name, {
          accountId,
          ...(Object.keys(created).length ? { created } : {}),
          ...(Object.keys(notCreated).length ? { notCreated } : {}),
        }, callId]];
        // The implicit Email/set of onSuccessUpdateEmail / onSuccessDestroyEmail.
        if (Object.keys(created).length && (args.onSuccessUpdateEmail || args.onSuccessDestroyEmail)) {
          const implicit: Record<string, unknown> = { accountId };
          if (args.onSuccessUpdateEmail) {
            implicit.updated = Object.fromEntries(Object.keys(args.onSuccessUpdateEmail as object)
              .map((ref) => [successEmails[ref.slice(1)] ?? ref, null]));
          }
          if (args.onSuccessDestroyEmail) {
            implicit.destroyed = (args.onSuccessDestroyEmail as string[]).map((ref) => {
              const id = successEmails[ref.slice(1)] ?? ref;
              emails.delete(id);
              return id;
            });
          }
          responses.push(['Email/set', implicit, callId]);
        }
        return responses;
      }
      case 'EmailSubmission/query': {
        const now = Date.now();
        const all = [...submissions.values()].filter((s) => s.accountId === accountId);
        const visible = options.queryIgnoresFilter
          ? all
          : all
            .filter((s) => !!s.sendAt && Date.parse(s.sendAt) >= now - 3 * DAY)
            .filter((s) => matches(s, args.filter as Record<string, unknown> | undefined))
            .sort((a, b) => Date.parse(a.sendAt!) - Date.parse(b.sendAt!));
        const position = (args.position as number | undefined) ?? 0;
        const limit = (args.limit as number | undefined) ?? 5000;
        const ids = visible.slice(position, position + limit).map((s) => s.id);
        return [[name, {
          accountId, queryState: 'q1', canCalculateChanges: true, position, ids,
          ...(args.calculateTotal ? { total: visible.length } : {}),
        }, callId]];
      }
      case 'EmailSubmission/get': {
        const ids = (args.ids as string[] | null) ?? [];
        const list: Array<Record<string, unknown>> = [];
        const notFound: string[] = [];
        for (const id of ids) {
          const s = submissions.get(id);
          if (!s || s.accountId !== accountId) {
            notFound.push(id);
            continue;
          }
          list.push({ id: s.id, emailId: s.emailId, identityId: 'identity-1', ...(s.sendAt ? { sendAt: s.sendAt } : {}), undoStatus: computedStatus(s) });
        }
        return [[name, { accountId, state: 's1', list, notFound }, callId]];
      }
      case 'EmailSubmission/changes': {
        const created = [...submissions.values()].filter((s) => s.accountId === accountId).map((s) => s.id);
        return [[name, { accountId, oldState: args.sinceState, newState: 's-final', hasMoreChanges: false, created, updated: [], destroyed: [] }, callId]];
      }
      default:
        return [['error', { type: 'unknownMethod' }, callId]];
    }
  }

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body) as { methodCalls: MethodCall[] };
    requests.push(body.methodCalls);
    const methodResponses: Array<[string, Record<string, unknown>, string]> = [];
    for (const call of body.methodCalls) methodResponses.push(...handle(call, methodResponses));
    const payload = { methodResponses };
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
    } as Response;
  });

  /** Every call of `method` across all requests, in wire order. */
  const calls = (method: string) => requests.flat().filter(([name]) => name === method).map(([, args]) => args);
  const destroys = () => calls('EmailSubmission/set').filter((args) => args.destroy);
  const destroyedIds = () => destroys().flatMap((args) => args.destroy as string[]);

  return { submissions, emails, requests, calls, destroys, destroyedIds, add };
}

interface ClientOptions {
  stalwart?: boolean;
  accounts?: string[];
  maxObjectsInSet?: number;
  maxObjectsInGet?: number;
  delayedSend?: boolean;
}

function createClient({ stalwart = true, accounts = ['account-1'], maxObjectsInSet = 500, maxObjectsInGet = 500, delayedSend = true }: ClientOptions = {}): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  const submissionCapability = delayedSend
    ? { maxDelayedSend: 7 * 24 * 60 * 60, submissionExtensions: { FUTURERELEASE: [] } }
    : {};
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: 'account-1',
    username: 'user@example.com',
    capabilities: {
      'urn:ietf:params:jmap:core': { maxObjectsInSet, maxObjectsInGet },
      'urn:ietf:params:jmap:mail': {},
      'urn:ietf:params:jmap:submission': {},
      ...(stalwart ? { 'urn:stalwart:jmap': {} } : {}),
    },
    session: {
      primaryAccounts: {
        'urn:ietf:params:jmap:mail': 'account-1',
        'urn:ietf:params:jmap:submission': 'account-1',
      },
      accounts: Object.fromEntries(accounts.map((id) => [id, {
        name: id === 'account-1' ? 'user@example.com' : `${id}@example.com`,
        accountCapabilities: {
          'urn:ietf:params:jmap:mail': {},
          'urn:ietf:params:jmap:submission': submissionCapability,
          ...(stalwart ? { 'urn:stalwart:jmap': {} } : {}),
        },
      }])),
    },
  });
  return client;
}

function send(client: JMAPClient, opts: { draftId?: string; delayedUntil?: string } = {}) {
  return client.sendEmail(
    ['bob@example.net'], 'Subject', 'body',
    undefined, undefined, 'identity-1', 'user@example.com',
    opts.draftId,
    undefined, undefined, undefined, undefined, undefined,
    opts.delayedUntil,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('destroying the record of an immediate send', () => {
  it('destroys it in its own request after the send on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });

    const result = await send(createClient());

    expect(result.emailSubmissionId).toBeDefined();
    expect(result.filingError).toBeUndefined();
    const last = server.requests.at(-1)!;
    expect(last).toEqual([['EmailSubmission/set', { accountId: 'account-1', destroy: [result.emailSubmissionId] }, '0']]);
    expect(server.submissions.size).toBe(0);
  });

  it('rides along with the old-draft cleanup on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });

    const result = await send(createClient(), { draftId: 'draft-old-1' });

    const cleanup = server.requests.at(-1)!;
    expect(cleanup).toEqual([
      ['Email/set', { accountId: 'account-1', destroy: ['draft-old-1'] }, '0'],
      ['EmailSubmission/set', { accountId: 'account-1', destroy: [result.emailSubmissionId] }, '1'],
    ]);
    expect(result.filingError).toBeUndefined();
  });

  it('does not turn a refused destroy into a filing warning on Stalwart 1.0', async () => {
    fakeStalwart({
      version: '1.0',
      destroyAnswer: (ids, callId) => ['EmailSubmission/set', { notDestroyed: { [ids[0]]: { type: 'forbidden' } } }, callId],
    });

    const alone = await send(createClient());
    const withDraft = await send(createClient(), { draftId: 'draft-old-1' });

    expect(alone.filingError).toBeUndefined();
    expect(withDraft.filingError).toBeUndefined();
  });

  it('does not turn a failed destroy call into a filing warning on Stalwart 1.0', async () => {
    fakeStalwart({
      version: '1.0',
      destroyAnswer: (_ids, callId) => ['error', { type: 'serverFail', description: 'boom' }, callId],
    });

    const result = await send(createClient(), { draftId: 'draft-old-1' });

    expect(result.filingError).toBeUndefined();
    expect(result.emailSubmissionId).toBeDefined();
  });

  it('still reports a refused old-draft destroy riding with it on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });

    // 'kept-draft' is unknown to the fake, so its destroy comes back notFound.
    const result = await send(createClient(), { draftId: 'kept-draft' });

    expect(result.filingError).toBe('notFound');
    expect(server.destroyedIds()).toEqual([result.emailSubmissionId]);
  });

  it('destroys the {id}-only record 0.16.6 creates', async () => {
    const server = fakeStalwart({ version: '0.16.6' });

    const result = await send(createClient());

    expect(server.destroyedIds()).toEqual([result.emailSubmissionId]);
  });

  it('leaves a held send alone although 0.16.12 reports it final', async () => {
    const server = fakeStalwart({ version: '0.16.12' });

    const result = await send(createClient(), { delayedUntil: new Date(Date.now() + 10_000).toISOString() });

    expect(result.scheduled).toBe(true);
    expect(server.destroys()).toEqual([]);
    expect(server.submissions.has(result.emailSubmissionId!)).toBe(true);
  });

  it('leaves undo-window and scheduled sends alone on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });
    const client = createClient();

    await send(client, { delayedUntil: new Date(Date.now() + 30_000).toISOString() });
    await send(client, { delayedUntil: new Date(Date.now() + 2 * HOUR).toISOString(), draftId: 'draft-old-1' });

    expect(server.destroys()).toEqual([]);
    expect(server.submissions.size).toBe(2);
  });

  it('leaves the record alone without urn:stalwart:jmap', async () => {
    const server = fakeStalwart({ version: '1.0' });

    await send(createClient({ stalwart: false }));
    await send(createClient({ stalwart: false }), { draftId: 'draft-old-1' });

    expect(server.destroys()).toEqual([]);
  });

  it('destroys the records of immediate raw sends on Stalwart 1.0, not of held ones', async () => {
    const server = fakeStalwart({ version: '1.0' });
    const client = createClient();
    vi.spyOn(client, 'uploadBlob').mockResolvedValue({ blobId: 'blob-1', size: 10, type: 'message/rfc822' });
    const raw = new Blob(['raw'], { type: 'message/rfc822' });

    const sent = await client.sendRawEmail(raw, 'identity-1', 'mb-sent', 'mb-drafts');
    const submitted = await client.submitRawEmail(raw, 'identity-1');
    const held = await client.sendRawEmail(raw, 'identity-1', 'mb-sent', 'mb-drafts', new Date(Date.now() + 60_000).toISOString());

    expect(server.destroyedIds()).toEqual([sent.emailSubmissionId, submitted.emailSubmissionId]);
    expect(server.submissions.has(held.emailSubmissionId!)).toBe(true);
  });
});

describe('prunableSubmissionIds', () => {
  it('picks canceled records and final ones whose sendAt has passed', () => {
    const now = Date.now();
    const ids = prunableSubmissionIds([
      { id: 'pending-future', undoStatus: 'pending', sendAt: utcDate(now + HOUR) },
      { id: 'pending-past', undoStatus: 'pending', sendAt: utcDate(now - HOUR) },
      { id: 'final-past', undoStatus: 'final', sendAt: utcDate(now - HOUR) },
      { id: 'final-future', undoStatus: 'final', sendAt: utcDate(now + HOUR) },
      { id: 'canceled-future', undoStatus: 'canceled', sendAt: utcDate(now + HOUR) },
      { id: 'canceled-no-sendAt', undoStatus: 'canceled' },
      { id: 'final-no-sendAt', undoStatus: 'final' },
    ], now);

    expect(ids).toEqual(['final-past', 'canceled-future', 'canceled-no-sendAt']);
  });
});

describe('pruneEmailSubmissions', () => {
  /** One record of each kind in `accountId`. */
  function seed(server: ReturnType<typeof fakeStalwart>, accountId: string) {
    const now = Date.now();
    return {
      pendingFuture: server.add({ accountId, id: `${accountId}-pending-future`, sendAt: utcDate(now + HOUR), queued: true }),
      pendingPast: server.add({ accountId, id: `${accountId}-pending-past`, sendAt: utcDate(now - HOUR), queued: true }),
      finalPast: server.add({ accountId, id: `${accountId}-final-past`, sendAt: utcDate(now - HOUR) }),
      canceledFuture: server.add({ accountId, id: `${accountId}-canceled-future`, sendAt: utcDate(now + HOUR), canceled: true }),
      noSendAt: server.add({ accountId, id: `${accountId}-no-sendAt` }),
    };
  }

  it('destroys canceled and delivered records in every submission account on Stalwart 1.0, never pending ones', async () => {
    const server = fakeStalwart({ version: '1.0' });
    seed(server, 'account-1');
    seed(server, 'shared-1');
    const client = createClient({ accounts: ['account-1', 'shared-1'], maxObjectsInSet: 1 });

    const destroyed = await client.pruneEmailSubmissions();

    expect(destroyed).toBe(4);
    // One destroy per record at maxObjectsInSet 1, each in its own account.
    expect(server.destroys().map((d) => `${d.accountId}: ${(d.destroy as string[]).join()}`).sort()).toEqual([
      'account-1: account-1-canceled-future', 'account-1: account-1-final-past',
      'shared-1: shared-1-canceled-future', 'shared-1: shared-1-final-past',
    ]);
    expect([...server.submissions.keys()].sort()).toEqual([
      'account-1-no-sendAt', 'account-1-pending-future', 'account-1-pending-past',
      'shared-1-no-sendAt', 'shared-1-pending-future', 'shared-1-pending-past',
    ]);
    // Each account is asked in its own request, candidates only.
    const queries = server.calls('EmailSubmission/query');
    expect(queries.map((q) => q.accountId)).toEqual(['account-1', 'shared-1']);
    expect(queries[0].filter).toEqual({ operator: 'OR', conditions: [{ before: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) }, { undoStatus: 'canceled' }] });
    expect(queries[0].calculateTotal).toBe(true);
    expect(server.calls('EmailSubmission/get')[0].properties).toEqual(['id', 'sendAt', 'undoStatus']);
  });

  it('decides from EmailSubmission/get, not from what the query returns (0.16.12)', async () => {
    const server = fakeStalwart({ version: '0.16.12', queryIgnoresFilter: true });
    seed(server, 'account-1');

    await createClient().pruneEmailSubmissions();

    expect(server.destroyedIds().sort()).toEqual(['account-1-canceled-future', 'account-1-final-past']);
  });

  it('pages through the query and batches destroys by maxObjectsInSet on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });
    const now = Date.now();
    for (let i = 0; i < 5; i++) server.add({ accountId: 'account-1', id: `old-${i}`, sendAt: utcDate(now - (i + 1) * HOUR) });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(now + HOUR), queued: true });

    await createClient({ maxObjectsInGet: 2, maxObjectsInSet: 2 }).pruneEmailSubmissions();

    expect(server.calls('EmailSubmission/query').map((q) => q.position)).toEqual([0, 2, 4]);
    expect(server.destroys().map((d) => (d.destroy as string[]).length)).toEqual([2, 2, 1]);
    expect([...server.submissions.keys()]).toEqual(['held']);
  });

  it('runs at most once per account every ten minutes unless forced on Stalwart 1.0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = fakeStalwart({ version: '1.0' });
    const client = createClient();

    await client.pruneEmailSubmissions();
    await client.pruneEmailSubmissions();
    expect(server.calls('EmailSubmission/query')).toHaveLength(1);

    await client.pruneEmailSubmissions({ force: true });
    expect(server.calls('EmailSubmission/query')).toHaveLength(2);

    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await client.pruneEmailSubmissions();
    expect(server.calls('EmailSubmission/query')).toHaveLength(3);
  });

  it('never rejects when the server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(createClient().pruneEmailSubmissions()).resolves.toBe(0);
  });
});

describe('overQuota on EmailSubmission/set create', () => {
  /** Fill the account with records the query no longer sees (sendAt 5 days back). */
  function fillWithOldRecords(server: ReturnType<typeof fakeStalwart>, count: number, queued = false) {
    const sendAt = utcDate(Date.now() - 5 * DAY);
    for (let i = 0; i < count; i++) server.add({ accountId: 'account-1', id: `old-${i}`, sendAt, queued });
  }

  it('prunes, walks the change log and submits again on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 3 });
    fillWithOldRecords(server, 3);

    const result = await send(createClient(), { draftId: 'draft-old-1' });

    expect(result.emailSubmissionId).toBeDefined();
    const methods = server.requests.map((r) => r.map(([name, args]) => (
      name === 'EmailSubmission/set' ? `${name} ${Object.keys(args).find((k) => ['create', 'destroy', 'update'].includes(k))}` : name
    )).join(' + '));
    expect(methods).toEqual([
      'Mailbox/get',
      'Identity/get',
      'Email/set + EmailSubmission/set create',
      'EmailSubmission/query + EmailSubmission/get',
      'EmailSubmission/changes',
      'EmailSubmission/get',
      'EmailSubmission/set destroy',
      'EmailSubmission/set create',
      'Email/set + EmailSubmission/set destroy',
    ]);
    expect(server.calls('EmailSubmission/changes')[0]).toEqual({ accountId: 'account-1', sinceState: 'n' });
    // The retry submits the Drafts copy the first attempt created.
    const creates = server.calls('EmailSubmission/set').filter((args) => args.create);
    expect((creates[1].create as Record<string, { emailId: string }>)['1'].emailId).toBe(result.emailId);
    expect(result.filingError).toBeUndefined();
  });

  it('does not walk the change log when the prune made room on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 2 });
    server.add({ accountId: 'account-1', id: 'recent-final', sendAt: utcDate(Date.now() - HOUR) });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + HOUR), queued: true });

    const result = await send(createClient());

    expect(result.emailSubmissionId).toBeDefined();
    expect(server.calls('EmailSubmission/changes')).toEqual([]);
    expect(server.submissions.has('held')).toBe(true);
  });

  it('only prunes when a server without urn:stalwart:jmap answers overQuota', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 1 });
    fillWithOldRecords(server, 1);

    const error = await send(createClient({ stalwart: false })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SubmissionQuotaError);
    // Its overQuota need not be about submission records: no Stalwart wording.
    expect((error as SubmissionQuotaError).countsRecords).toBe(false);
    expect(server.calls('EmailSubmission/query')).toHaveLength(1);
    expect(server.calls('EmailSubmission/changes')).toEqual([]);
  });

  it('throws SubmissionQuotaError and removes the Drafts copy when the retry fails too on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 2 });
    // Held for later: nothing may be destroyed.
    server.add({ accountId: 'account-1', id: 'held-1', sendAt: utcDate(Date.now() + DAY), queued: true });
    server.add({ accountId: 'account-1', id: 'held-2', sendAt: utcDate(Date.now() + 2 * DAY), queued: true });

    const error = await send(createClient(), { draftId: 'draft-old-1' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SubmissionQuotaError);
    expect((error as Error).message).toBe(OVER_QUOTA_DESCRIPTION);
    expect((error as SubmissionQuotaError).countsRecords).toBe(true);
    expect(jmapErrorType(error)).toBe('overQuota');
    expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(2);
    // The copy made for this attempt is gone; the user's own draft stays.
    const destroyedEmails = server.calls('Email/set').flatMap((args) => (args.destroy as string[] | undefined) ?? []);
    expect(destroyedEmails).toHaveLength(1);
    expect(destroyedEmails[0]).toMatch(/^email-/);
    expect(destroyedEmails).not.toContain('draft-old-1');
    expect(server.emails.size).toBe(0);
    expect([...server.submissions.keys()].sort()).toEqual(['held-1', 'held-2']);
  });

  it('does not take the storage overQuota of Email/set for a submission quota on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', emailCreateError: { type: 'overQuota', description: 'Account quota exceeded.' } });

    const error = await send(createClient()).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(SubmissionQuotaError);
    expect(jmapErrorType(error)).toBe('overQuota');
    expect((error as Error).message).toContain('Account quota exceeded.');
    expect(server.calls('EmailSubmission/query')).toEqual([]);
  });

  it('makes room for a reschedule and keeps the original on failure on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 2 });
    const original = server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(Date.now() + HOUR), queued: true });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + DAY), queued: true });
    const client = createClient();

    const error = await client.rescheduleEmailSubmission('original', 'email-x', 'identity-1', new Date(Date.now() + 2 * HOUR).toISOString(), 'account-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SubmissionQuotaError);
    expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(2);
    // Nothing was canceled: the mail still goes out at its original time.
    expect(original.canceled).toBe(false);
    expect(server.calls('EmailSubmission/set').filter((args) => args.update)).toEqual([]);
  });

  describe('when making room takes a while', () => {
    const reschedule = (client: JMAPClient, delayedUntil: string) =>
      client.rescheduleEmailSubmission('original', 'email-x', 'identity-1', delayedUntil, 'account-1');

    it('stops without a replacement when the original went out meanwhile on Stalwart 1.0', async () => {
      let original!: FakeSubmission;
      const server = fakeStalwart({
        version: '1.0',
        quota: 2,
        // Its sendAt comes while the prune looks for room.
        intercept: ([name]) => {
          if (name === 'EmailSubmission/query') original.queued = false;
          return undefined;
        },
      });
      original = server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(Date.now() + 1000), queued: true });
      server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + DAY), queued: true });

      // "Send now"
      const error = await reschedule(createClient(), new Date(Date.now() + 1000).toISOString()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NoLongerScheduledError);
      expect((error as NoLongerScheduledError).sent).toBe(true);
      // A second create would have sent the message twice.
      expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(1);
      expect(server.calls('EmailSubmission/set').filter((args) => args.update)).toEqual([]);
    });

    it('stops when the original was cancelled elsewhere meanwhile on Stalwart 1.0', async () => {
      let original!: FakeSubmission;
      const server = fakeStalwart({
        version: '1.0',
        quota: 2,
        intercept: ([name]) => {
          if (name === 'EmailSubmission/query') {
            original.canceled = true;
            original.queued = false;
          }
          return undefined;
        },
      });
      original = server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(Date.now() + HOUR), queued: true });
      server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + DAY), queued: true });

      const error = await reschedule(createClient(), new Date(Date.now() + 2 * HOUR).toISOString()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NoLongerScheduledError);
      expect((error as NoLongerScheduledError).sent).toBe(false);
      expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(1);
    });

    it('takes the time spent off the hold of the replacement on Stalwart 1.0', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now();
      const server = fakeStalwart({
        version: '1.0',
        quota: 2,
        // Walking the change log takes ten minutes.
        intercept: ([name]) => {
          if (name === 'EmailSubmission/changes') vi.setSystemTime(Date.now() + 10 * 60 * 1000);
          return undefined;
        },
      });
      server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(start + 3 * HOUR), queued: true });
      fillWithOldRecords(server, 1);

      const result = await reschedule(createClient(), new Date(start + 2 * HOUR).toISOString());

      const holds = server.calls('EmailSubmission/set')
        .filter((args) => args.create)
        .map((args) => (args.create as Record<string, { envelope: { mailFrom: { parameters: { HOLDFOR: string } } } }>)
          .replacement.envelope.mailFrom.parameters.HOLDFOR);
      expect(holds.map(Number)).toEqual([2 * 60 * 60, 2 * 60 * 60 - 10 * 60]);
      expect(Math.abs(Date.parse(result.sendAt!) - (start + 2 * HOUR))).toBeLessThan(1000);
    });
  });

  describe('when no room can be made', () => {
    function fullOfHeldSends(options: FakeOptions = {}) {
      const server = fakeStalwart({ version: '1.0', quota: 2, ...options });
      server.add({ accountId: 'account-1', id: 'held-1', sendAt: utcDate(Date.now() + DAY), queued: true });
      server.add({ accountId: 'account-1', id: 'held-2', sendAt: utcDate(Date.now() + 2 * DAY), queued: true });
      return server;
    }

    it('searches again for every send the user starts on Stalwart 1.0', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const server = fullOfHeldSends();
      const client = createClient();
      const searches = () => server.calls('EmailSubmission/query').length + server.calls('EmailSubmission/changes').length;

      await expect(send(client)).rejects.toBeInstanceOf(SubmissionQuotaError);
      expect(searches()).toBe(2);

      await expect(send(client)).rejects.toBeInstanceOf(SubmissionQuotaError);
      expect(searches()).toBe(4);
    });

    // A search that found nothing used to hold off the next one for five
    // minutes, whoever sent: a held send that went out within them could not
    // make room, and every send failed with "ask your administrator".
    it('makes room once a held send went out, minutes after a search found nothing, on Stalwart 1.0', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const server = fakeStalwart({ version: '1.0', quota: 2 });
      const undoHold = server.add({ accountId: 'account-1', id: 'undo-hold', sendAt: utcDate(Date.now() + 60 * 1000), queued: true });
      server.add({ accountId: 'account-1', id: 'scheduled', sendAt: utcDate(Date.now() + DAY), queued: true });
      const client = createClient();

      await expect(send(client)).rejects.toBeInstanceOf(SubmissionQuotaError);

      // Two minutes later the undo hold has run out and its message left.
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      undoHold.queued = false;
      const result = await send(client);

      expect(result.emailSubmissionId).toBeDefined();
      expect(server.destroyedIds()).toContain('undo-hold');
      expect(server.submissions.has('scheduled')).toBe(true);
    });

    it('searches again right away when the search itself failed on Stalwart 1.0', async () => {
      let failures = 1;
      const server = fullOfHeldSends({
        intercept: ([name, , callId]) => (name === 'EmailSubmission/query' && failures-- > 0
          ? [['error', { type: 'serverFail', description: 'Temporary failure' }, callId]]
          : undefined),
      });
      const client = createClient();

      await expect(send(client)).rejects.toBeInstanceOf(SubmissionQuotaError);
      await expect(send(client)).rejects.toBeInstanceOf(SubmissionQuotaError);

      expect(server.calls('EmailSubmission/query')).toHaveLength(2);
    });
  });

  it('reschedules once the prune made room on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 2 });
    server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(Date.now() + HOUR), queued: true });
    server.add({ accountId: 'account-1', id: 'delivered', sendAt: utcDate(Date.now() - HOUR) });

    const result = await createClient().rescheduleEmailSubmission('original', 'email-x', 'identity-1', new Date(Date.now() + 2 * HOUR).toISOString(), 'account-1');

    expect(result.emailSubmissionId).toBeDefined();
    // The delivered record made room; the canceled original went after the cancel.
    expect(server.destroyedIds()).toEqual(['delivered', 'original']);
    expect([...server.submissions.keys()]).toEqual([result.emailSubmissionId]);
  });

  it('submits the imported raw message again after making room on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 1 });
    server.add({ accountId: 'account-1', id: 'delivered', sendAt: utcDate(Date.now() - HOUR) });
    const client = createClient();
    vi.spyOn(client, 'uploadBlob').mockResolvedValue({ blobId: 'blob-1', size: 10, type: 'message/rfc822' });

    const result = await client.sendRawEmail(new Blob(['raw']), 'identity-1', 'mb-sent', 'mb-drafts');

    const creates = server.calls('EmailSubmission/set').filter((args) => args.create);
    expect(creates).toHaveLength(2);
    expect((creates[1].create as Record<string, { emailId: string }>)['raw-submit'].emailId).toBe(result.emailId);
  });

  it('removes the imported raw message when the submission stays refused on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 1 });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + HOUR), queued: true });
    const client = createClient();
    vi.spyOn(client, 'uploadBlob').mockResolvedValue({ blobId: 'blob-1', size: 10, type: 'message/rfc822' });

    await expect(client.submitRawEmail(new Blob(['raw']), 'identity-1')).rejects.toBeInstanceOf(SubmissionQuotaError);

    expect(server.emails.size).toBe(0);
  });
});

describe('cancelEmailSubmission', () => {
  it('destroys the record in a request of its own once the cancel succeeded on 0.16', async () => {
    const server = fakeStalwart({ version: '0.16.6' });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + HOUR), queued: true });

    await createClient().cancelEmailSubmission('held', 'account-1');

    expect(server.requests).toEqual([
      [['EmailSubmission/set', { accountId: 'account-1', update: { held: { undoStatus: 'canceled' } } }, '0']],
      [['EmailSubmission/set', { accountId: 'account-1', destroy: ['held'] }, '0']],
    ]);
  });

  it('sends no destroy when the cancel is refused on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });
    server.add({ accountId: 'account-1', id: 'gone', sendAt: utcDate(Date.now() - HOUR) });

    await expect(createClient().cancelEmailSubmission('gone', 'account-1')).rejects.toThrow('no longer in the queue');

    expect(server.destroys()).toEqual([]);
    expect(server.submissions.has('gone')).toBe(true);
  });

  it('sends no destroy when the cancel call fails on Stalwart 1.0', async () => {
    const server = fakeStalwart({
      version: '1.0',
      updateAnswer: (_id, callId) => ['error', { type: 'serverFail', description: 'Temporary failure' }, callId],
    });
    const held = server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + HOUR), queued: true });

    const error = await createClient().cancelEmailSubmission('held', 'account-1').catch((e: unknown) => e);

    expect(jmapErrorType(error)).toBe('serverFail');
    expect(server.destroys()).toEqual([]);
    // Still held, still cancellable.
    expect(held.queued).toBe(true);
    expect(server.submissions.has('held')).toBe(true);
  });

  it('destroys the canceled original of a reschedule, and the canceled replacement when the original could not be canceled, on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });
    server.add({ accountId: 'account-1', id: 'original', emailId: 'email-x', sendAt: utcDate(Date.now() + HOUR), queued: true });
    const client = createClient();

    const result = await client.rescheduleEmailSubmission('original', 'email-x', 'identity-1', new Date(Date.now() + 2 * HOUR).toISOString(), 'account-1');
    expect(server.destroyedIds()).toEqual(['original']);

    // Already sent: the original can't be canceled, so the replacement goes.
    server.submissions.get(result.emailSubmissionId!)!.queued = false;
    await expect(client.rescheduleEmailSubmission(result.emailSubmissionId!, 'email-x', 'identity-1', new Date(Date.now() + 3 * HOUR).toISOString(), 'account-1'))
      .rejects.toThrow('could not cancel the original');
    expect(server.destroyedIds()).toHaveLength(2);
    expect(server.submissions.has(result.emailSubmissionId!)).toBe(true);
    expect(server.submissions.size).toBe(1);
  });
});

describe('sendReadReceipt', () => {
  function mdnClient(options: ClientOptions = {}) {
    const client = createClient(options);
    vi.spyOn(client, 'uploadBlob').mockResolvedValue({ blobId: 'blob-mdn', size: 10, type: 'message/rfc822' });
    vi.spyOn(client, 'getMailboxes').mockResolvedValue([
      { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
      { id: 'mb-sent', name: 'Sent', role: 'sent' },
    ] as never);
    return client;
  }

  const receipt = {
    to: 'sender@example.net',
    fromEmail: 'user@example.com',
    identityId: 'identity-1',
    originalMessageId: 'orig@example.net',
    originalSubject: 'Hello',
  };

  it('destroys its record once sent on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });

    await mdnClient().sendReadReceipt(receipt);

    expect(server.destroys()).toHaveLength(1);
    expect(server.submissions.size).toBe(0);
    // The receipt itself stays in Sent.
    expect(server.emails.size).toBe(1);
  });

  it('takes the receipt back out of Sent when the submission is refused on 0.16', async () => {
    const server = fakeStalwart({
      version: '0.16.12',
      createAnswer: () => ({ type: 'forbiddenFrom', description: 'Envelope mailFrom does not match identity email address.' }),
    });

    await expect(mdnClient().sendReadReceipt(receipt)).rejects.toThrow('MDN submission failed: Envelope mailFrom does not match');

    expect(server.emails.size).toBe(0);
  });

  it('treats a method-level error as a failed receipt on Stalwart 1.0', async () => {
    const server = fakeStalwart({
      version: '1.0',
      intercept: ([name, args, callId]) => (name === 'EmailSubmission/set' && args.create
        ? [['error', { type: 'serverFail', description: 'Temporary failure' }, callId]]
        : undefined),
    });

    const error = await mdnClient().sendReadReceipt(receipt).catch((e: unknown) => e);

    expect(jmapErrorType(error)).toBe('serverFail');
    expect(server.emails.size).toBe(0);
  });

  it('throws SubmissionQuotaError at a full quota and leaves nothing in Sent on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0', quota: 1 });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + HOUR), queued: true });

    await expect(mdnClient().sendReadReceipt(receipt)).rejects.toBeInstanceOf(SubmissionQuotaError);

    expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(2);
    expect(server.emails.size).toBe(0);
  });

  it('does not search again for automatic receipts for a few minutes after finding nothing that can go on Stalwart 1.0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = fakeStalwart({ version: '1.0', quota: 1 });
    server.add({ accountId: 'account-1', id: 'held', sendAt: utcDate(Date.now() + DAY), queued: true });
    const client = mdnClient();
    const searches = () => server.calls('EmailSubmission/query').length + server.calls('EmailSubmission/changes').length;
    const automatic = { ...receipt, automatic: true };

    await expect(client.sendReadReceipt(automatic)).rejects.toBeInstanceOf(SubmissionQuotaError);
    expect(searches()).toBe(2);

    // Every further automatic receipt only tries the create once more ...
    await expect(client.sendReadReceipt(automatic)).rejects.toBeInstanceOf(SubmissionQuotaError);
    expect(searches()).toBe(2);
    expect(server.calls('EmailSubmission/set').filter((args) => args.create)).toHaveLength(4);

    // ... while one the user sends looks again,
    await expect(client.sendReadReceipt(receipt)).rejects.toBeInstanceOf(SubmissionQuotaError);
    expect(searches()).toBe(4);

    // and so do automatic ones after a few minutes.
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    await expect(client.sendReadReceipt(automatic)).rejects.toBeInstanceOf(SubmissionQuotaError);
    expect(searches()).toBe(6);
  });
});

describe('getScheduledEmails', () => {
  it('reads every page of the query, so mail scheduled furthest ahead is listed on Stalwart 1.0', async () => {
    const server = fakeStalwart({ version: '1.0' });
    const now = Date.now();
    for (let i = 0; i < 60; i++) server.add({ accountId: 'account-1', id: `delivered-${i}`, sendAt: utcDate(now - (i + 1) * 60_000) });
    server.add({ accountId: 'account-1', id: 'later', emailId: 'email-later', sendAt: utcDate(now + DAY), queued: true });
    const result = await createClient().getScheduledEmails(50, 0);

    expect(result.emails.map((email) => email.emailSubmissionId)).toEqual(['later']);
    expect(server.calls('EmailSubmission/query').map((q) => q.position)).toEqual([0, 50]);
  });
});
