import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_RETRY_MS, RECENT_TTL_MS, UNSUPPORTED_RETRY_MS, recoveryKey, useRecoveryStore } from '../recovery-store';
import { jmapError } from '@/lib/jmap/jmap-error';
import { purgeSignedOutData } from '@/lib/sign-out-cleanup';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { ArchiveQueryPage } from '@/lib/recovery/archived-items';
import { LICENSE_REFUSAL } from '@/lib/recovery/__tests__/fixtures';

const page = (ids: string[]): ArchiveQueryPage => ({ ids, total: null });

function makeClient(query: () => Promise<ArchiveQueryPage>, stalwart = true, has: () => Promise<boolean> = async () => true) {
  return {
    getAccountId: () => 'ci',
    advertisesArchivedItems: () => stalwart,
    queryArchivedItemIds: vi.fn(query),
    hasArchivedEmail: vi.fn(has),
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
  it('asks a one-item query, hides the feature when the server refuses and asks again only after the retry time', async () => {
    const client = makeClient(refused);
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(false);
    expect(client.queryArchivedItemIds).toHaveBeenCalledWith(undefined, { limit: 1 });
    expect(useRecoveryStore.getState().checks[key]).toEqual({ supported: false, retryAt: Date.now() + UNSUPPORTED_RETRY_MS });

    await useRecoveryStore.getState().detect(asClient(client), key);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);

    // The license arrives later: the next check after the retry time shows it.
    client.queryArchivedItemIds.mockImplementation(async () => page([]));
    vi.setSystemTime(Date.now() + UNSUPPORTED_RETRY_MS + 1);
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    expect(useRecoveryStore.getState().checks[key]?.supported).toBe(true);
  });

  it('asks again before the retry time when forced', async () => {
    const client = makeClient(refused);
    const key = recoveryKey('acc-alice', asClient(client));
    await useRecoveryStore.getState().detect(asClient(client), key);
    await useRecoveryStore.getState().detect(asClient(client), key, { force: true });
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(2);
  });

  it('hides it on any other error too, and asks again sooner', async () => {
    const client = makeClient(() => Promise.reject(new Error('Failed to fetch')));
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(false);
    expect(useRecoveryStore.getState().checks[key]?.retryAt).toBe(Date.now() + ERROR_RETRY_MS);
  });

  it('shows it when the query answers, and keeps that for the session', async () => {
    const client = makeClient(async () => page(['a']));
    const key = recoveryKey('acc-alice', asClient(client));
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    await expect(useRecoveryStore.getState().detect(asClient(client), key)).resolves.toBe(true);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it('asks once for two callers at the same time', async () => {
    const client = makeClient(async () => page([]));
    const key = recoveryKey('acc-alice', asClient(client));
    await Promise.all([useRecoveryStore.getState().detect(asClient(client), key), useRecoveryStore.getState().detect(asClient(client), key)]);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
  });

  it('keeps one answer per account', async () => {
    const alice = makeClient(async () => page([]));
    const bob = makeClient(refused);
    await useRecoveryStore.getState().detect(asClient(alice), recoveryKey('acc-alice', asClient(alice)));
    await useRecoveryStore.getState().detect(asClient(bob), recoveryKey('acc-bob', asClient(bob)));
    const { checks } = useRecoveryStore.getState();
    expect(checks['acc-alice|ci']?.supported).toBe(true);
    expect(checks['acc-bob|ci']?.supported).toBe(false);
  });

  it('remembers the answer across a reload of the tab', async () => {
    const client = makeClient(refused);
    const key = recoveryKey('acc-alice', asClient(client));
    await useRecoveryStore.getState().detect(asClient(client), key);
    vi.resetModules();
    const reloaded = await import('../recovery-store');
    expect(reloaded.useRecoveryStore.getState().checks[key]).toEqual({ supported: false, retryAt: Date.now() + UNSUPPORTED_RETRY_MS });
    await reloaded.useRecoveryStore.getState().detect(asClient(client), key);
    expect(client.queryArchivedItemIds).toHaveBeenCalledTimes(1);
    reloaded.useRecoveryStore.getState().reset();
  });

  it('forgets everything, stored too, when everyone signs out', async () => {
    const client = makeClient(async () => page([]));
    const key = recoveryKey('acc-alice', asClient(client));
    await useRecoveryStore.getState().detect(asClient(client), key);
    await useRecoveryStore.getState().checkRecent(asClient(client), key, 0);
    expect(sessionStorage.getItem('bulwark-recovery-checks')).toContain(key);
    purgeSignedOutData();
    expect(useRecoveryStore.getState().checks).toEqual({});
    expect(useRecoveryStore.getState().recent).toEqual({});
    expect(sessionStorage.getItem('bulwark-recovery-checks')).toBeNull();
  });

  it("doesn't ask a server that isn't Stalwart", async () => {
    const client = makeClient(async () => page([]), false);
    await expect(useRecoveryStore.getState().detect(asClient(client), 'k')).resolves.toBe(false);
    expect(client.queryArchivedItemIds).not.toHaveBeenCalled();
  });
});

describe('the Trash link check', () => {
  it('looks once per days value for a while, and again after a restore', async () => {
    const client = makeClient(async () => page([]));
    const key = 'acc-alice|ci';
    await expect(useRecoveryStore.getState().checkRecent(asClient(client), key, 7)).resolves.toBe(true);
    await useRecoveryStore.getState().checkRecent(asClient(client), key, 7);
    expect(client.hasArchivedEmail).toHaveBeenCalledTimes(1);
    expect(client.hasArchivedEmail).toHaveBeenCalledWith(undefined, { days: 7 });
    await useRecoveryStore.getState().checkRecent(asClient(client), key, 14);
    expect(client.hasArchivedEmail).toHaveBeenCalledTimes(2);
    useRecoveryStore.getState().forgetRecent(key);
    await useRecoveryStore.getState().checkRecent(asClient(client), key, 14);
    expect(client.hasArchivedEmail).toHaveBeenCalledTimes(3);
    vi.setSystemTime(Date.now() + RECENT_TTL_MS + 1);
    await useRecoveryStore.getState().checkRecent(asClient(client), key, 14);
    expect(client.hasArchivedEmail).toHaveBeenCalledTimes(4);
  });

  it('records a refusal like detection does', async () => {
    const client = makeClient(async () => page([]), true, refused);
    await expect(useRecoveryStore.getState().checkRecent(asClient(client), 'k', 0)).resolves.toBe(false);
    expect(useRecoveryStore.getState().checks.k?.supported).toBe(false);
  });
});
