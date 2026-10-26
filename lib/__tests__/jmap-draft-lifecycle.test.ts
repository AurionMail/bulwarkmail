import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient, SendUnconfirmedError } from '../jmap/client';

/**
 * #849: replacing a draft (autosave, send) used to bundle the destroy of the
 * previous version with the create. The two are processed independently, so a
 * failed create - e.g. the new version referencing part blobs of the old one
 * that die with it - still destroyed the user's only copy. The destroy must
 * only ever go out after the replacement (or the outgoing message) is
 * confirmed created.
 */

function createClient(): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: 'account-1',
    username: 'user@example.com',
  });
  return client;
}

interface JMAPMethodCall { 0: string; 1: Record<string, unknown>; 2: string }
interface CapturedRequest { methodCalls: JMAPMethodCall[] }

/**
 * Capture every request; answer Mailbox/get, Identity/get, Email/set
 * (create and/or destroy) and EmailSubmission/set. `failCreate` makes the
 * Email/set create come back as notCreated; `failSubmission` does the same
 * for EmailSubmission/set.
 */
function mockFlow({ failCreate = false, failSubmission = false, methodError = false, missingSubmission = false, emptyErrors = false } = {}) {
  const captured: CapturedRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body) as CapturedRequest;
    captured.push(body);

    const methodResponses: unknown[] = [];
    for (const [method, args, callId] of body.methodCalls as unknown as Array<[string, Record<string, unknown>, string]>) {
      if (method === 'Mailbox/get') {
        methodResponses.push(['Mailbox/get', {
          list: [
            { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
            { id: 'mb-sent', name: 'Sent', role: 'sent' },
          ],
        }, callId]);
      } else if (method === 'Identity/get') {
        methodResponses.push(['Identity/get', { list: [{ id: 'identity-1', email: 'user@example.com' }] }, callId]);
      } else if (method === 'Email/set') {
        const result: Record<string, unknown> = {};
        if (args.create) {
          const key = Object.keys(args.create as Record<string, unknown>)[0];
          if (failCreate) {
            result.notCreated = { [key]: { type: 'blobNotFound', description: 'blobId does not exist on this server' } };
          } else {
            result.created = { [key]: { id: 'email-new-1' } };
          }
        }
        if (emptyErrors) result.notCreated = {};
        if (args.destroy) {
          result.destroyed = args.destroy;
        }
        methodResponses.push(['Email/set', result, callId]);
      } else if (method === 'EmailSubmission/set') {
        if (missingSubmission) continue;
        if (methodError) { methodResponses.push(['error', { type: 'serverFail', description: 'Google unavailable; draft retained' }, callId]); continue; }
        methodResponses.push(['EmailSubmission/set',
          failSubmission
            ? { notCreated: { '1': { type: 'forbiddenFrom', description: 'not allowed' } } }
            : { created: { '1': { id: 'sub-1' } } },
          callId]);
      }
    }

    const payload = { methodResponses };
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
    } as Response;
  });
  return captured;
}

/** Every Email/set call across all captured requests, in wire order. */
function emailSetCalls(captured: CapturedRequest[]): Array<Record<string, unknown>> {
  return captured.flatMap(r => r.methodCalls.filter(c => c[0] === 'Email/set').map(c => c[1]));
}

describe('draft replace lifecycle (#849)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('createDraft without a previous draft issues a single create and no destroy', async () => {
    const client = createClient();
    const captured = mockFlow();

    const id = await client.createDraft(['bob@example.com'], 'Subject', 'body');

    expect(id).toBe('email-new-1');
    const sets = emailSetCalls(captured);
    expect(sets).toHaveLength(1);
    expect(sets[0].destroy).toBeUndefined();
  });

  it('createDraft keeps a reply draft in its thread', async () => {
    // A reply draft re-opened (or restored by Undo) has nothing else to
    // rebuild In-Reply-To / References from, so the draft must carry them.
    const client = createClient();
    const captured = mockFlow();

    await client.createDraft(
      ['bob@example.com'], 'Re: Subject', 'body',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      ['<parent@example.com>'], ['root@example.com', 'parent@example.com'],
    );

    const created = Object.values(emailSetCalls(captured)[0].create as Record<string, Record<string, unknown>>)[0];
    expect(created.inReplyTo).toEqual(['parent@example.com']);
    expect(created.references).toEqual(['root@example.com', 'parent@example.com']);
  });

  it('createDraft destroys the previous version only after the create succeeded', async () => {
    const client = createClient();
    const captured = mockFlow();

    const id = await client.createDraft(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, undefined, undefined,
      'draft-old-1',
      [{ blobId: 'blob-part-1', name: 'report.pdf', type: 'application/pdf', size: 1234 }],
    );

    expect(id).toBe('email-new-1');
    const sets = emailSetCalls(captured);
    expect(sets).toHaveLength(2);
    // First request: create only - no destroy riding along.
    expect(sets[0].create).toBeDefined();
    expect(sets[0].destroy).toBeUndefined();
    // Second, separate request: the destroy of the old version.
    expect(sets[1].create).toBeUndefined();
    expect(sets[1].destroy).toEqual(['draft-old-1']);
  });

  it('createDraft keeps the previous version when the create fails', async () => {
    const client = createClient();
    const captured = mockFlow({ failCreate: true });

    await expect(client.createDraft(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, undefined, undefined,
      'draft-old-1',
      [{ blobId: 'blob-dead', name: 'report.pdf', type: 'application/pdf', size: 1234 }],
    )).rejects.toThrow(/blobId does not exist/);

    for (const set of emailSetCalls(captured)) {
      expect(set.destroy).toBeUndefined();
    }
  });

  it('sendEmail destroys the draft only after the submission succeeded', async () => {
    const client = createClient();
    const captured = mockFlow();

    const result = await client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      'draft-old-1',
    );

    expect(result.emailId).toBe('email-new-1');
    const sets = emailSetCalls(captured);
    expect(sets).toHaveLength(2);
    expect(sets[0].create).toBeDefined();
    expect(sets[0].destroy).toBeUndefined();
    expect(sets[1].destroy).toEqual(['draft-old-1']);
    // The destroy request must come after the submission, not before it.
    const destroyRequestIndex = captured.findIndex(r => r.methodCalls.some(c => c[0] === 'Email/set' && c[1].destroy));
    const submissionRequestIndex = captured.findIndex(r => r.methodCalls.some(c => c[0] === 'EmailSubmission/set'));
    expect(destroyRequestIndex).toBeGreaterThan(submissionRequestIndex);
  });

  it('sendEmail keeps the draft when the create fails', async () => {
    const client = createClient();
    const captured = mockFlow({ failCreate: true });

    await expect(client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      'draft-old-1',
    )).rejects.toThrow();

    for (const set of emailSetCalls(captured)) {
      expect(set.destroy).toBeUndefined();
    }
  });

  it('sendEmail keeps the draft but removes its own Drafts copy when the submission fails', async () => {
    const client = createClient();
    const captured = mockFlow({ failSubmission: true });

    await expect(client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      'draft-old-1',
    )).rejects.toThrow();

    // Every attempt creates a fresh copy to submit; left behind, each failed
    // send added one more duplicate to Drafts. The user's draft stays.
    const destroyed = emailSetCalls(captured).flatMap(set => (set.destroy as string[] | undefined) ?? []);
    expect(destroyed).toEqual(['email-new-1']);
  });

  it('sendEmail removes its Drafts copy when the submission call fails outright', async () => {
    const client = createClient();
    const captured = mockFlow();
    const fetchMock = vi.mocked(globalThis.fetch);
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const response = await answer(url, init);
      const payload = await response.json() as { methodResponses: Array<[string, unknown, string]> };
      // A method-level error instead of EmailSubmission/set's answer.
      const methodResponses = payload.methodResponses.map(([name, result, callId]) => (
        name === 'EmailSubmission/set' ? ['error', { type: 'serverFail', description: 'Temporary failure' }, callId] : [name, result, callId]
      ));
      return { ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ methodResponses })) } as Response;
    });

    await expect(client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      'draft-old-1',
    )).rejects.toThrow('Temporary failure');

    const destroyed = emailSetCalls(captured).flatMap(set => (set.destroy as string[] | undefined) ?? []);
    expect(destroyed).toEqual(['email-new-1']);
  });

  it('createDraft replaces own drafts in the own account', async () => {
    const client = createClient();
    const captured = mockFlow();

    await client.createDraft(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, undefined, undefined,
      'draft-old-1',
    );

    const sets = emailSetCalls(captured);
    expect(sets[0].accountId).toBe('account-1');
    expect(sets[1]).toEqual({ accountId: 'account-1', destroy: ['draft-old-1'] });
  });

  it('createDraft round-trips cid and disposition on attachments', async () => {
    const client = createClient();
    const captured = mockFlow();

    await client.createDraft(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, undefined, undefined, undefined,
      [
        { blobId: 'blob-1', name: 'logo.png', type: 'image/png', size: 10, cid: 'img1@local', disposition: 'inline' },
        { blobId: 'blob-2', name: 'report.pdf', type: 'application/pdf', size: 20 },
      ],
    );

    const create = Object.values(emailSetCalls(captured)[0].create as Record<string, Record<string, unknown>>)[0];
    expect(create.attachments).toEqual([
      { blobId: 'blob-1', name: 'logo.png', type: 'image/png', cid: 'img1@local', disposition: 'inline' },
      { blobId: 'blob-2', name: 'report.pdf', type: 'application/pdf', disposition: 'attachment' },
    ]);
  });
});

/**
 * Stalwart (1.0 and 0.16.23 alike) files a message sent from a group identity
 * such as team@example.org in the group's account, beside its submission, and
 * an undone send goes back to that account's Drafts. Email ids repeat across
 * accounts - live, `eaaaaab` is both userb's first own message and the team
 * account's - so replacing or sending that draft must remove the old version
 * in the group account. Destroying the id in the own account deleted an
 * unrelated message.
 */
describe('a draft that lives in a group account', () => {
  function groupClient(): JMAPClient {
    const client = createClient();
    const submission = { 'urn:ietf:params:jmap:submission': { maxDelayedSend: 2592000 } };
    Object.assign(client, {
      accounts: {
        'account-1': { name: 'user@example.com', isPersonal: true },
        c: { name: 'team@example.org', isPersonal: false },
      },
      session: {
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1', 'urn:ietf:params:jmap:submission': 'account-1' },
        accounts: {
          'account-1': { accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...submission } },
          c: { accountCapabilities: { 'urn:ietf:params:jmap:mail': {}, ...submission } },
        },
      },
    });
    return client;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('createDraft from the own identity saves the new version in the own account and removes the old one in the group account', async () => {
    const client = groupClient();
    const captured = mockFlow();

    const id = await client.createDraft(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, undefined, 'user@example.com',
      'eaaaaab', undefined, undefined, undefined,
      undefined, undefined, { previousDraftAccountId: 'c' },
    );

    expect(id).toBe('email-new-1');
    const sets = emailSetCalls(captured);
    expect(sets).toHaveLength(2);
    expect(sets[0].accountId).toBe('account-1');
    expect(sets[0].destroy).toBeUndefined();
    expect(sets[1]).toEqual({ accountId: 'c', destroy: ['eaaaaab'] });
  });

  it('sendEmail from the group identity removes the draft in the group account after the send', async () => {
    const client = groupClient();
    const captured = mockFlow();

    await client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'team@example.org',
      'eaaaaab', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { draftAccountId: 'c' },
    );

    const sets = emailSetCalls(captured);
    // The outgoing copy goes where the group's mail goes ...
    expect(sets[0].accountId).toBe('c');
    expect(sets[0].create).toBeDefined();
    // ... and the draft is removed where it lives, once the send went through.
    expect(sets[1]).toEqual({ accountId: 'c', destroy: ['eaaaaab'] });
  });

  it('sendEmail from the own identity still removes a group-account draft in the group account', async () => {
    const client = groupClient();
    const captured = mockFlow();

    await client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      'eaaaaab', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { draftAccountId: 'c' },
    );

    const sets = emailSetCalls(captured);
    expect(sets[0].accountId).toBe('account-1');
    expect(sets[1]).toEqual({ accountId: 'c', destroy: ['eaaaaab'] });
  });

  it('sendEmail removes an own draft in the own account', async () => {
    const client = groupClient();
    const captured = mockFlow();

    await client.sendEmail(
      ['bob@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'team@example.org',
      'draft-old-1',
    );

    expect(emailSetCalls(captured)[1]).toEqual({ accountId: 'account-1', destroy: ['draft-old-1'] });
  });
});

describe('compose failure recovery', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  it.each([{ methodError: true }, { missingSubmission: true }])('does not claim success or delete the old draft without confirmation: %j', async options => {
    const client = createClient(); const captured = mockFlow(options);
    await expect(client.sendEmail(['bob@example.com'], 'Subject', 'body', undefined, undefined, 'identity-1', 'user@example.com', 'old-draft')).rejects.toThrow(
      // Only the missing submission is unconfirmed; a method error is a plain failure.
      options.missingSubmission ? SendUnconfirmedError : Error,
    );
    expect(emailSetCalls(captured).some(call => (call.destroy as string[] | undefined)?.includes('old-draft'))).toBe(false);
  });
  it('accepts empty notCreated maps as success', async () => {
    const client = createClient(); mockFlow({ emptyErrors: true });
    expect(await client.createDraft(['bob@example.com'], 'Subject', 'body')).toBe('email-new-1');
  });
});
