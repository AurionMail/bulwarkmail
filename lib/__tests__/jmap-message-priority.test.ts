import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { messagePriorityFromHeaders, messagePriorityHeaders, type MessagePriority } from '../message-priority';

/**
 * #970: the composer's priority goes out as Importance + X-Priority headers
 * on the Email/set create, for sends and for drafts, and normal writes none.
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

interface CapturedRequest { methodCalls: Array<[string, Record<string, unknown>, string]> }

function mockFlow() {
  const captured: CapturedRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body) as CapturedRequest;
    captured.push(body);
    const methodResponses: unknown[] = [];
    for (const [method, args, callId] of body.methodCalls) {
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
        const key = Object.keys((args.create ?? {}) as Record<string, unknown>)[0];
        methodResponses.push(['Email/set', key ? { created: { [key]: { id: 'email-new-1' } } } : {}, callId]);
      } else if (method === 'EmailSubmission/set') {
        methodResponses.push(['EmailSubmission/set', { created: { '1': { id: 'sub-1' } } }, callId]);
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

function createdEmail(captured: CapturedRequest[]): Record<string, unknown> {
  const call = captured.flatMap(r => r.methodCalls).find(c => c[0] === 'Email/set' && c[1].create);
  expect(call).toBeDefined();
  return Object.values(call![1].create as Record<string, Record<string, unknown>>)[0];
}

function priorityProps(email: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(email).filter(([k]) => /^header:(X-Priority|Importance|Priority):/i.test(k)));
}

const expected: Record<MessagePriority, Record<string, string>> = {
  high: { 'header:X-Priority:asText': '1 (Highest)', 'header:Importance:asText': 'high' },
  normal: {},
  low: { 'header:X-Priority:asText': '5 (Lowest)', 'header:Importance:asText': 'low' },
};

describe('message priority headers (#970)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each(['high', 'normal', 'low'] as const)('sendEmail writes the %s priority headers', async (priority) => {
    const client = createClient();
    const captured = mockFlow();
    await client.sendEmail(
      ['to@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { priority },
    );
    expect(priorityProps(createdEmail(captured))).toEqual(expected[priority]);
  });

  it('sendEmail without options writes no priority headers', async () => {
    const client = createClient();
    const captured = mockFlow();
    await client.sendEmail(['to@example.com'], 'Subject', 'body', undefined, undefined, 'identity-1', 'user@example.com');
    expect(priorityProps(createdEmail(captured))).toEqual({});
  });

  it.each(['high', 'normal', 'low'] as const)('createDraft writes the %s priority headers', async (priority) => {
    const client = createClient();
    const captured = mockFlow();
    await client.createDraft(
      ['to@example.com'], 'Subject', 'body',
      undefined, undefined, 'identity-1', 'user@example.com',
      undefined, undefined, undefined, undefined, undefined, undefined,
      { priority },
    );
    expect(priorityProps(createdEmail(captured))).toEqual(expected[priority]);
  });

  it('reads the priority back from a draft\'s headers', () => {
    // The draft round trip: what was written comes back as the same level.
    for (const level of ['high', 'low'] as const) {
      const headers = Object.fromEntries(
        Object.entries(messagePriorityHeaders(level)).map(([k, v]) => [k.split(':')[1], ` ${v}`]),
      );
      expect(messagePriorityFromHeaders(headers)).toBe(level);
    }
    expect(messagePriorityFromHeaders({ 'x-priority': '2 (High)' })).toBe('high');
    expect(messagePriorityFromHeaders({ 'X-Priority': '3 (Normal)', Importance: 'high' })).toBe('normal');
    expect(messagePriorityFromHeaders({ Importance: 'Low' })).toBe('low');
    expect(messagePriorityFromHeaders({ Subject: 'x' })).toBe('normal');
    expect(messagePriorityFromHeaders(undefined)).toBe('normal');
  });
});
