import { describe, it, expect, vi } from 'vitest';
import { cachedPrincipals } from '../principal-cache';
import type { IJMAPClient } from '../client-interface';
import type { Principal } from '../types';

const alice: Principal = { id: 'a', type: 'individual', name: 'alice', email: 'alice@example.com' };

describe('cachedPrincipals', () => {
  it('asks the server once per client', async () => {
    const getPrincipals = vi.fn().mockResolvedValue([alice]);
    const client = { getPrincipals } as unknown as IJMAPClient;

    expect(await cachedPrincipals(client)).toEqual([alice]);
    expect(await cachedPrincipals(client)).toEqual([alice]);
    expect(getPrincipals).toHaveBeenCalledTimes(1);
  });

  it('does not keep an empty or failed answer, so the next caller asks again', async () => {
    const getPrincipals = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([alice]);
    const client = { getPrincipals } as unknown as IJMAPClient;

    expect(await cachedPrincipals(client)).toEqual([]);
    expect(await cachedPrincipals(client)).toEqual([]);
    expect(await cachedPrincipals(client)).toEqual([alice]);
    expect(await cachedPrincipals(client)).toEqual([alice]);
    expect(getPrincipals).toHaveBeenCalledTimes(3);
  });
});
