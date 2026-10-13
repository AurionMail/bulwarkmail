import { describe, it, expect, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';
import type { Calendar } from '../jmap/types';

type Call = [string, Record<string, unknown>, string];

// #1209: calendar default alerts are edited through updateCalendar, which
// drops every key Stalwart's Calendar/set would reject.
function capturingClient() {
  const client = new JMAPClient('https://jmap.example.com', 'user@example.com', 'pass');
  vi.spyOn(client as unknown as { getCalendarsAccountId: () => string }, 'getCalendarsAccountId').mockReturnValue('me');
  const calls: Call[] = [];
  vi.spyOn(client as unknown as { request: (c: Call[]) => Promise<unknown> }, 'request')
    .mockImplementation(async (sent: Call[]) => {
      calls.push(sent[0]);
      return { methodResponses: [['Calendar/set', { updated: { cal1: null } }, '0']] };
    });
  return { client, calls };
}

describe('updateCalendar default alerts', () => {
  it('sends both default alert maps, including email alerts', async () => {
    const { client, calls } = capturingClient();
    const withTime = {
      a: { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT15M', relativeTo: 'start' }, action: 'email', acknowledged: null, relatedTo: null },
    } as Calendar['defaultAlertsWithTime'];
    await client.updateCalendar('cal1', {
      defaultAlertsWithTime: withTime,
      defaultAlertsWithoutTime: null,
      myRights: {} as Calendar['myRights'],
    });
    const update = (calls[0][1].update as Record<string, Record<string, unknown>>).cal1;
    expect(update).toEqual({ defaultAlertsWithTime: withTime, defaultAlertsWithoutTime: null });
  });
});
