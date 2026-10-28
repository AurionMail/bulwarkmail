import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINIMISED_COMPOSER_REOPEN_MS, useMinimisedComposerFlush } from '../use-minimised-composer-flush';
import { flushComposers, registerComposeFlush, resetComposeFlushRegistry } from '@/lib/compose-flush-registry';

/**
 * mail-app keeps a minimised composer's edits in memory only. Before an
 * automatic sign-out the hook opens the composer again and lets it save.
 */
describe('minimised composer flush', () => {
  beforeEach(() => {
    resetComposeFlushRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the minimised composer again and runs its own save', async () => {
    const save = vi.fn(async () => {});
    // Opening the composer mounts it, and it registers its flush.
    const reopen = vi.fn(() => { registerComposeFlush(save); });
    renderHook(() => useMinimisedComposerFlush(true, reopen));

    const result = await flushComposers(8000);

    expect(reopen).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ total: 1, settled: 1, failed: 0, timedOut: false });
  });

  it('registers nothing without unsaved minimised edits', async () => {
    const reopen = vi.fn();
    renderHook(() => useMinimisedComposerFlush(false, reopen));

    await expect(flushComposers(8000)).resolves.toMatchObject({ total: 0 });
    expect(reopen).not.toHaveBeenCalled();
  });

  it('counts a composer that does not come back as a draft not saved', async () => {
    renderHook(() => useMinimisedComposerFlush(true, () => {}));

    const done = flushComposers(8000);
    await vi.advanceTimersByTimeAsync(MINIMISED_COMPOSER_REOPEN_MS);
    await expect(done).resolves.toEqual({ total: 1, settled: 1, failed: 1, timedOut: false });
  });

  it('stops registering once the composer is open again', async () => {
    const { rerender } = renderHook(({ minimised }) => useMinimisedComposerFlush(minimised, () => {}), { initialProps: { minimised: true } });
    rerender({ minimised: false });
    await expect(flushComposers(8000)).resolves.toMatchObject({ total: 0 });
  });
});
