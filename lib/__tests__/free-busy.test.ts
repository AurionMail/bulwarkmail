import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVAILABILITY_TTL_MS,
  RATE_LIMIT_BACKOFF_MS,
  availabilityWindow,
  lookUpAvailability,
} from '../jmap/free-busy';
import type { IJMAPClient } from '../jmap/client-interface';
import type { PrincipalAvailability } from '../jmap/types';

const BUSY: PrincipalAvailability = { periods: [{ utcStart: '2026-09-01T10:30:00Z', utcEnd: '2026-09-01T11:30:00Z', busyStatus: 'confirmed' }] };
const EMPTY: PrincipalAvailability = { periods: [] };

// A client whose getPrincipalsAvailability answers every principal with
// `answer(id)`, as one batched request would.
function makeClient(answer: (id: string) => PrincipalAvailability = () => BUSY) {
  const getPrincipalsAvailability = vi.fn(async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, answer(id)])) as Record<string, PrincipalAvailability>);
  return { client: { getPrincipalsAvailability } as unknown as IJMAPClient, getPrincipalsAvailability };
}

const at = (time: string) => new Date(`2026-09-01T${time}`);

describe('availabilityWindow', () => {
  it('covers the local days the event touches', () => {
    const { start, end } = availabilityWindow(at('10:00:00'), at('11:00:00'));
    expect(start).toEqual(new Date(2026, 8, 1));
    expect(end).toEqual(new Date(2026, 8, 2));
  });

  it('ends at the midnight an event ends on, and spans several days', () => {
    expect(availabilityWindow(new Date(2026, 8, 1, 22), new Date(2026, 8, 2)).end).toEqual(new Date(2026, 8, 2));
    const { start, end } = availabilityWindow(new Date(2026, 8, 1, 22), new Date(2026, 8, 3, 1));
    expect(start).toEqual(new Date(2026, 8, 1));
    expect(end).toEqual(new Date(2026, 8, 4));
  });
});

describe('lookUpAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 1, 9));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for every principal in one call over the whole day', async () => {
    const { client, getPrincipalsAvailability } = makeClient((id) => (id === 'anna' ? BUSY : EMPTY));

    const answers = await lookUpAvailability(client, ['anna', 'bob', 'anna'], at('10:00:00'), at('11:00:00'));

    expect(answers).toEqual({ anna: BUSY, bob: EMPTY });
    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(1);
    const days = availabilityWindow(at('10:00:00'), at('11:00:00'));
    expect(getPrincipalsAvailability).toHaveBeenCalledWith(['anna', 'bob'], days.start, days.end);
  });

  it('answers another time on the same day from the cache until it is stale', async () => {
    const { client, getPrincipalsAvailability } = makeClient();

    await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'));
    expect(await lookUpAvailability(client, ['anna'], at('14:00:00'), at('15:00:00'))).toEqual({ anna: BUSY });
    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + AVAILABILITY_TTL_MS);
    await lookUpAvailability(client, ['anna'], at('14:00:00'), at('15:00:00'));
    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(2);
  });

  it('asks only for the principals it has no answer for', async () => {
    const { client, getPrincipalsAvailability } = makeClient();

    await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'));
    await lookUpAvailability(client, ['anna', 'bob'], at('10:00:00'), at('11:00:00'));

    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(2);
    expect(getPrincipalsAvailability.mock.calls[1][0]).toEqual(['bob']);
  });

  it('shares a lookup that is already on its way', async () => {
    const { client, getPrincipalsAvailability } = makeClient();

    const [first, second] = await Promise.all([
      lookUpAvailability(client, ['anna', 'bob'], at('10:00:00'), at('11:00:00')),
      lookUpAvailability(client, ['bob'], at('10:30:00'), at('11:00:00')),
    ]);

    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(1);
    expect(first.bob).toEqual(BUSY);
    expect(second.bob).toEqual(BUSY);
  });

  it('stops asking for a minute after Stalwart 1.0 answers rateLimit', async () => {
    let limited = true;
    const { client, getPrincipalsAvailability } = makeClient(() => (limited ? { error: 'rateLimit' } : BUSY));

    expect(await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'))).toEqual({ anna: { error: 'rateLimit' } });
    limited = false;

    vi.setSystemTime(Date.now() + RATE_LIMIT_BACKOFF_MS - 1);
    expect(await lookUpAvailability(client, ['anna', 'bob'], at('10:00:00'), at('11:00:00'))).toEqual({
      anna: { error: 'rateLimit' },
      bob: { error: 'rateLimit' },
    });
    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 1);
    expect(await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'))).toEqual({ anna: BUSY });
    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(2);
  });

  it('keeps no refusals: forbidden and a failed request are asked again next time', async () => {
    const { client, getPrincipalsAvailability } = makeClient(() => ({ error: 'forbidden' }));

    expect(await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'))).toEqual({ anna: { error: 'forbidden' } });
    getPrincipalsAvailability.mockRejectedValueOnce(new Error('Request failed: 500 - Internal Server Error'));
    expect(await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'))).toEqual({ anna: { error: 'serverUnavailable' } });
    await lookUpAvailability(client, ['anna'], at('10:00:00'), at('11:00:00'));

    expect(getPrincipalsAvailability).toHaveBeenCalledTimes(3);
  });

  it('keeps caches apart per client', async () => {
    const one = makeClient();
    const two = makeClient();

    await lookUpAvailability(one.client, ['anna'], at('10:00:00'), at('11:00:00'));
    await lookUpAvailability(two.client, ['anna'], at('10:00:00'), at('11:00:00'));

    expect(one.getPrincipalsAvailability).toHaveBeenCalledTimes(1);
    expect(two.getPrincipalsAvailability).toHaveBeenCalledTimes(1);
  });
});
