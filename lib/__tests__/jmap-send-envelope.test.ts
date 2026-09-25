import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient } from '../jmap/client';

// #1009: a From override is asked for as the envelope MAIL FROM, so the
// Return-Path doesn't reveal the identity's address where the server allows it.

type MethodCall = [string, Record<string, unknown>, string];

function createClient(username = 'user@example.com'): JMAPClient {
  const client = new JMAPClient('https://jmap.example.com', username, 'pass');
  Object.assign(client, {
    apiUrl: 'https://jmap.example.com/api',
    accountId: 'account-1',
    username,
  });
  return client;
}

function enableDelayedSend(client: JMAPClient) {
  Object.assign(client, {
    capabilities: {
      'urn:ietf:params:jmap:core': {},
      'urn:ietf:params:jmap:mail': {},
      'urn:ietf:params:jmap:submission': {},
    },
    session: {
      primaryAccounts: {
        'urn:ietf:params:jmap:mail': 'account-1',
        'urn:ietf:params:jmap:submission': 'account-1',
      },
      accounts: {
        'account-1': {
          accountCapabilities: {
            'urn:ietf:params:jmap:mail': {},
            'urn:ietf:params:jmap:submission': { maxDelayedSend: 3600, submissionExtensions: { FUTURERELEASE: true } },
          },
        },
      },
    },
  });
}

const IDENTITIES = [
  { id: 'identity-1', email: 'user@example.com', mayDelete: false },
  { id: 'identity-2', email: 'Sales@example.com', mayDelete: true, replyTo: [{ email: 'team@example.com' }] },
];

/**
 * Answers the requests sendEmail makes; `refuseMailFrom` makes every
 * EmailSubmission/set whose envelope asks for another MAIL FROM than the
 * identity's fail the way Stalwart does. `overQuotaOnce` refuses the first
 * submission the way Stalwart 1.0 does at its `maxSubmissions` limit - before
 * it looks at the envelope.
 */
function mockServer(options: { refuseMailFrom?: boolean; overQuotaOnce?: boolean; identities?: typeof IDENTITIES } = {}) {
  const submissions: Array<Record<string, unknown>> = [];
  const identities = options.identities ?? IDENTITIES;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const { methodCalls } = JSON.parse((init as { body: string }).body) as { methodCalls: MethodCall[] };
    const methodResponses = methodCalls.map(([name, args, callId]) => {
      if (name === 'Mailbox/get') {
        return [name, { list: [{ id: 'mb-drafts', name: 'Drafts', role: 'drafts' }, { id: 'mb-sent', name: 'Sent', role: 'sent' }] }, callId];
      }
      if (name === 'Identity/get') return [name, { list: identities }, callId];
      if (name === 'Email/set') {
        const created = Object.keys((args.create ?? {}) as object);
        return [name, { created: Object.fromEntries(created.map((id) => [id, { id: 'email-9' }])) }, callId];
      }
      if (name === 'EmailSubmission/set') {
        const create = (args.create as Record<string, Record<string, unknown>>)['1'];
        submissions.push(create);
        if (options.overQuotaOnce && submissions.length === 1) {
          return [name, { notCreated: { '1': { type: 'overQuota', description: 'There are too many email submissions, please delete some before adding a new one.' } } }, callId];
        }
        const identity = identities.find((i) => i.id === create.identityId);
        const mailFrom = (create.envelope as { mailFrom?: { email: string } } | undefined)?.mailFrom?.email;
        if (options.refuseMailFrom && mailFrom && mailFrom.toLowerCase() !== identity?.email.toLowerCase()) {
          return [name, { notCreated: { '1': { type: 'forbiddenFrom', description: 'Envelope mailFrom does not match identity email address.' } } }, callId];
        }
        return [name, { created: { '1': { id: `sub-${submissions.length}` } } }, callId];
      }
      return ['error', { type: 'unknownMethod' }, callId];
    });
    const payload = { methodResponses };
    return {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
      json: () => Promise.resolve(payload),
    } as Response;
  });
  return submissions;
}

function send(client: JMAPClient, fromEmail: string, envelopeMailFrom?: string, delayedUntil?: string) {
  return client.sendEmail(
    ['Recipient <rcpt@example.net>'],
    'Subject',
    'body',
    undefined, undefined, 'identity-1', fromEmail,
    undefined, undefined, undefined, undefined,
    undefined, undefined,
    delayedUntil,
    envelopeMailFrom,
  );
}

describe('JMAPClient.sendEmail envelope MAIL FROM (#1009)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for the From override as MAIL FROM', async () => {
    const submissions = mockServer();

    const result = await send(createClient(), 'alias@example.com', 'alias@example.com');

    expect(submissions).toEqual([{
      emailId: expect.stringMatching(/^#send-/),
      identityId: 'identity-1',
      envelope: { mailFrom: { email: 'alias@example.com' }, rcptTo: [{ email: 'rcpt@example.net' }] },
    }]);
    expect(result).toMatchObject({ emailId: 'email-9', emailSubmissionId: 'sub-1' });
  });

  it("submits again with the identity's address when the server refuses the override", async () => {
    const submissions = mockServer({ refuseMailFrom: true });

    const result = await send(createClient(), 'alias@example.com', 'alias@example.com');

    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual({ emailId: 'email-9', identityId: 'identity-1' });
    expect(result).toMatchObject({ emailId: 'email-9', emailSubmissionId: 'sub-2' });
  });

  it("makes room at a full quota, then falls back to the identity's address on Stalwart 1.0", async () => {
    const submissions = mockServer({ refuseMailFrom: true, overQuotaOnce: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await send(createClient(), 'alias@example.com', 'alias@example.com');

    const mailFroms = submissions.map((s) => (s.envelope as { mailFrom?: { email: string } } | undefined)?.mailFrom?.email ?? 'identity');
    expect(mailFroms).toEqual(['alias@example.com', 'alias@example.com', 'identity']);
    expect(submissions[1].emailId).toBe('email-9');
    expect(result).toMatchObject({ emailId: 'email-9', emailSubmissionId: 'sub-3' });
  });

  it('sends through the identity that owns the override address', async () => {
    const submissions = mockServer({ refuseMailFrom: true });

    await send(createClient(), 'sales@example.com', 'sales@example.com');

    expect(submissions).toEqual([{ emailId: expect.stringMatching(/^#send-/), identityId: 'identity-2' }]);
  });

  it("keeps the identity's address as MAIL FROM of a sub-addressed scheduled send", async () => {
    const client = createClient();
    enableDelayedSend(client);
    const submissions = mockServer({ refuseMailFrom: true });

    await send(client, 'user+shop@example.com', undefined, new Date(Date.now() + 60_000).toISOString());

    expect(submissions).toHaveLength(1);
    expect(submissions[0].envelope).toMatchObject({ mailFrom: { email: 'user@example.com' } });
  });
});

// A send that names neither identity nor From - the List-Unsubscribe mailto:
// path of the unified view - goes out from the login's own identity.
describe('JMAPClient.sendEmail without a named sender', () => {
  // Identity/get order for a member of team@: Stalwart 1.0 lists the group's
  // identity first, 0.16.23 the member's own.
  const GROUP = { id: 'identity-team', email: 'team@example.org', mayDelete: false };
  const OWN = { id: 'identity-own', email: 'usera@example.org', mayDelete: false };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sendUnnamed = (client: JMAPClient) =>
    client.sendEmail(['list-unsubscribe@lists.example'], 'unsubscribe', '', undefined, undefined, undefined, undefined);

  it.each([
    ['Stalwart 1.0', [GROUP, OWN]],
    ['Stalwart 0.16', [OWN, GROUP]],
  ])("sends from the login's own identity on %s, whatever case the login was typed in", async (_server, identities) => {
    const submissions = mockServer({ identities });

    await sendUnnamed(createClient('UserA@Example.org'));

    expect(submissions[0].identityId).toBe('identity-own');
  });

  it.each([
    ['Stalwart 1.0', [GROUP, OWN]],
    ['Stalwart 0.16', [OWN, GROUP]],
  ])('matches a From address regardless of case on %s', async (_server, identities) => {
    const submissions = mockServer({ identities });

    await createClient('usera@example.org').sendEmail(
      ['rcpt@example.net'], 'Subject', 'body', undefined, undefined, undefined, 'Team@Example.org',
    );

    expect(submissions[0].identityId).toBe('identity-team');
  });
});
