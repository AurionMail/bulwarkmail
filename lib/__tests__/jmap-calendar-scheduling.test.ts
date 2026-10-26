import { describe, it, expect, vi } from 'vitest';
import { JMAPClient, SchedulingDeniedError } from '../jmap/client';
import { jmapErrorProperties, jmapErrorType } from '../jmap/jmap-error';
import { participantLimitOf } from '../calendar-participants';
import { stalwartCalendarSession } from './helpers/stalwart-calendar';

type Call = [string, Record<string, unknown>, string];

// Stalwart 0.16.21+ fails the whole CalendarEvent/set with `forbidden` when
// the account may not send iTIP messages; the UI can then save without them.
function clientRefusing(type: string) {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  Object.assign(client, { accountId: 'me' });
  vi.spyOn(client as unknown as { getCalendarsAccountId: () => string }, 'getCalendarsAccountId').mockReturnValue('me');
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (calls: Call[]) => {
      const [, args, id] = calls[0];
      const error = { type, description: 'Scheduling is not allowed for this account' };
      return {
        methodResponses: [['CalendarEvent/set', args.create
          ? { notCreated: { 'new-event': error } }
          : { notUpdated: Object.fromEntries(Object.keys(args.update as object).map((k) => [k, error])) }, id]],
      };
    });
  return client;
}

describe('calendar scheduling refusals', () => {
  it('reports a refused invitation as SchedulingDeniedError', async () => {
    const client = clientRefusing('forbidden');
    await expect(client.createCalendarEvent({ title: 'Meet' }, true)).rejects.toBeInstanceOf(SchedulingDeniedError);
    await expect(client.updateCalendarEvent('e1', { title: 'Meet' }, true)).rejects.toThrow(SchedulingDeniedError);
  });

  it('keeps other failures as plain errors', async () => {
    await expect(clientRefusing('forbidden').createCalendarEvent({ title: 'Meet' }, false))
      .rejects.not.toBeInstanceOf(SchedulingDeniedError);
    await expect(clientRefusing('invalidProperties').createCalendarEvent({ title: 'Meet' }, true))
      .rejects.not.toBeInstanceOf(SchedulingDeniedError);
  });
});

// Stalwart 1.0 enforces maxParticipantsPerEvent (default 20) on every JMAP
// create and update, an answer to an invitation included:
//   invalidProperties on `participants`, "An event cannot have more than 20
//   participants." (jmap/src/calendar_event/set.rs, assert_participants_limit)
// 0.16 advertises the same capability value and accepts any number.
describe('the participant limit', () => {
  function clientAnswering(setError: Record<string, unknown> | null) {
    const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(client, { accountId: 'me' });
    vi.spyOn(client as unknown as { getCalendarsAccountId: () => string }, 'getCalendarsAccountId').mockReturnValue('me');
    vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
      .mockImplementation(async (calls: Call[]) => {
        const [method, args, id] = calls[0];
        if (method === 'CalendarEvent/get') return { methodResponses: [['CalendarEvent/get', { list: [] }, id]] };
        if (args.create) {
          return { methodResponses: [['CalendarEvent/set', setError
            ? { notCreated: { 'new-event': setError } }
            : { created: { 'new-event': { id: 'e1' } } }, id]] };
        }
        return { methodResponses: [['CalendarEvent/set', setError
          ? { notUpdated: { e1: setError } }
          : { updated: { e1: null } }, id]] };
      });
    return client;
  }
  const refusal = {
    type: 'invalidProperties',
    properties: ['participants'],
    description: 'An event cannot have more than 20 participants.',
  };

  it('reports the limit of a refused create and answer on Stalwart 1.0', async () => {
    const client = clientAnswering(refusal);

    const created = await client.createCalendarEvent({ title: 'All hands' }, true).then(() => null, (e: unknown) => e);
    expect(jmapErrorType(created)).toBe('invalidProperties');
    expect(jmapErrorProperties(created)).toEqual(['participants']);
    expect(participantLimitOf(created)).toBe(20);

    const answered = await client.updateCalendarEvent('e1', { 'participants/p1/participationStatus': 'accepted' } as never, true)
      .then(() => null, (e: unknown) => e);
    expect(participantLimitOf(answered)).toBe(20);
  });

  it('saves the same event on 0.16', async () => {
    const client = clientAnswering(null);
    await expect(client.createCalendarEvent({ title: 'All hands' }, true)).resolves.toMatchObject({ id: 'e1' });
    await expect(client.updateCalendarEvent('e1', { title: 'All hands' }, true)).resolves.toBeUndefined();
  });

  it('reads the limit from the calendars capability on both versions', () => {
    for (const version of ['0.16', '1.0'] as const) {
      const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
      const session = stalwartCalendarSession(version, {
        accounts: { shared: { name: 'Team', isPersonal: false, accountCapabilities: {} } },
      });
      Object.assign(client, { session, accounts: session.accounts, accountId: 'acct-1' });
      expect(client.getMaxParticipantsPerEvent()).toBe(20);
      // A shared account that names no limit falls back to the user's own.
      expect(client.getMaxParticipantsPerEvent('shared')).toBe(20);
    }
    const bare = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
    Object.assign(bare, { session: { accounts: {}, primaryAccounts: {} }, accountId: 'me' });
    expect(bare.getMaxParticipantsPerEvent()).toBeNull();
  });
});
