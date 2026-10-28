import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushComposers,
  registerComposeFlush,
  resetComposeFlushRegistry,
  waitForComposeFlush,
} from '../compose-flush-registry';

describe('compose flush registry', () => {
  beforeEach(() => {
    resetComposeFlushRegistry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs every registered flush and waits for them', async () => {
    const order: string[] = [];
    registerComposeFlush(async () => {
      await new Promise((r) => setTimeout(r, 100));
      order.push('a');
    });
    registerComposeFlush(async () => { order.push('b'); });

    const done = flushComposers(5000);
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toEqual({ total: 2, settled: 2, failed: 0, timedOut: false });
    expect(order.sort()).toEqual(['a', 'b']);
  });

  it('stops waiting for a hanging flush at the timeout', async () => {
    const quick = vi.fn(async () => {});
    registerComposeFlush(() => new Promise<void>(() => {}));
    registerComposeFlush(quick);

    let result: Awaited<ReturnType<typeof flushComposers>> | null = null;
    void flushComposers(3000).then((r) => { result = r; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ total: 2, settled: 1, failed: 0, timedOut: true });
    expect(quick).toHaveBeenCalledTimes(1);
  });

  it('goes on when a flush fails', async () => {
    registerComposeFlush(async () => { throw new Error('save refused'); });
    await expect(flushComposers(1000)).resolves.toEqual({ total: 1, settled: 1, failed: 1, timedOut: false });
  });

  it('forgets a composer that unregistered', async () => {
    const flush = vi.fn(async () => {});
    const unregister = registerComposeFlush(flush);
    unregister();
    await expect(flushComposers(1000)).resolves.toEqual({ total: 0, settled: 0, failed: 0, timedOut: false });
    expect(flush).not.toHaveBeenCalled();
  });

  it('hands the next registration to a waiting host, or null after the timeout', async () => {
    const waiting = waitForComposeFlush(500);
    const flush = vi.fn(async () => {});
    registerComposeFlush(flush);
    await expect(waiting).resolves.toBe(flush);

    const nobody = waitForComposeFlush(500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(nobody).resolves.toBeNull();
  });
});
