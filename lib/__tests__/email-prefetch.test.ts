import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetEmailPrefetches, prefetchEmailContent, requestEmailContent } from '../email-prefetch';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Email } from '@/lib/jmap/types';

// A mouse press on a row starts the body request; the click that follows
// takes that request over instead of sending a second one.

const client = (getEmail = vi.fn(async (id: string) => ({ id }) as Email)) =>
  ({ getAccountId: () => 'login', getEmail }) as unknown as IJMAPClient & { getEmail: typeof getEmail };

describe('email prefetch', () => {
  afterEach(() => {
    forgetEmailPrefetches();
    vi.useRealTimers();
  });

  it('hands the open the request the press started', async () => {
    const c = client();
    prefetchEmailContent(c, 'e1', 'acct');
    prefetchEmailContent(c, 'e1', 'acct'); // a second press does not ask again
    const email = await requestEmailContent(c, 'e1', 'acct');

    expect(email?.id).toBe('e1');
    expect(c.getEmail).toHaveBeenCalledTimes(1);
    expect(c.getEmail).toHaveBeenCalledWith('e1', 'acct');
  });

  it('asks again when the press was for another account or message', async () => {
    const c = client();
    prefetchEmailContent(c, 'e1', 'acct');
    await requestEmailContent(c, 'e1', 'other');
    await requestEmailContent(c, 'e2', 'acct');
    expect(c.getEmail).toHaveBeenCalledTimes(3);
  });

  it('does not hand out a request older than a few seconds', async () => {
    vi.useFakeTimers();
    const c = client();
    prefetchEmailContent(c, 'e1');
    vi.advanceTimersByTime(6_000);
    await requestEmailContent(c, 'e1');
    expect(c.getEmail).toHaveBeenCalledTimes(2);
  });

  it('lets the open see a failed prefetch, and an unclaimed one fail quietly', async () => {
    const failing = client(vi.fn(async () => { throw new Error('offline'); }));
    prefetchEmailContent(failing, 'e1');
    await expect(requestEmailContent(failing, 'e1')).rejects.toThrow('offline');
    prefetchEmailContent(failing, 'e2'); // never claimed: no unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
  });
});
