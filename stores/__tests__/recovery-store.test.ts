import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_RETRY_MS, UNSUPPORTED_RETRY_MS, recoveryKey, useRecoveryStore } from '../recovery-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { LICENSE_REFUSAL } from '@/lib/recovery/__tests__/fixtures';

function makeClient(query: () => Promise<string[]>, stalwart = true) {
  return {
    getAccountId: () => 'ci',
    advertisesArchivedItems: () => stalwart,
    queryArchivedItemIds: vi.fn(query),
  };
}

const asClient = (c: ReturnType<typeof makeClient>) => c as unknown as IJMAPClient;
const refused = () => Promise.reject(jmapError(LICENSE_REFUSAL.description, LICENSE_REFUSAL));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});

afterEach(() => {
  useRecoveryStore.getState().reset();
  vi.useRealTimers();
});

describe('recovery detection', () => {
  it('hides the feature when the server refuses (no license) and asks again only after the retry time', async () => {
    const client = makeClient(refused);
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(false);
    expect(useRecoveryStore.getState().checks[key]).toEqual({ supported: false, retryAt: Date.now() + UNSUPPORTED_RETRY_MS });

    await useRecoveryStore.getState().detect(asClient(client), key);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);

    // The license arrives later: the next check after the retry time shows it.
    client.queryArchivedItemIds.mockImplementation(async () => []);
    vi.setSystemTime(Date.now() + UNSUPPORTED_RETRY_MS + 1);
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    expect(useRecoveryStore.getState().checks[key]?.supported).toBe(true);
  });

  it('hides it on any other error too, and asks again sooner', async () => {
    const client = makeClient(() => Promise.reject(new Error('Failed to fetch')));
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(false);
    expect(useRecoveryStore.getState().checks[key]?.retryAt).toBe(Date.now() + ERROR_RETRY_MS);
  });

  it('shows it when the query answers, and keeps that for the session', async () => {
    const client = makeClient(async () => ['a']);
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it('asks once for two callers at the same time', async () => {
    const client = makeClient(async () => []);
    const key = recoveryKey('acc-alice', asClient(client));
    await Promise.all([useRecoveryStore.getState().detect(asClient(client), key), useRecoveryStore.getState().detect(asClient(client), key)]);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it('keeps one answer per account', async () => {
    const alice = makeClient(async () => []);
    const bob = makeClient(refused);
    await useRecoveryStore.getState().detect(asClient(alice), recoveryKey('acc-alice', asClient(alice)));
    await useRecoveryStore.getState().detect(asClient(bob), recoveryKey('acc-bob', asClient(bob)));
    const { checks } = useRecoveryStore.getState();
    expect(checks['acc-alice|ci']?.supported).toBe(true);
    expect(checks['acc-bob|ci']?.supported).toBe(false);
  });

  it("doesn't ask a server that isn't Stalwart", async () => {
    const client = makeClient(async () => [], false);
    await expect(useRecoveryStore.getState().detect(asClient(client), 'k')).resolves.toBe(false);
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
  });
});
