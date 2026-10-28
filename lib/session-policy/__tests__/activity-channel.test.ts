import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_ACTIVITY_KEY, openActivityChannel, readLastActivity } from '../activity-channel';

/** BroadcastChannel between "tabs" of one test: every instance of a name hears the others. */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    for (const other of FakeBroadcastChannel.instances) {
      if (other !== this && !other.closed && other.name === this.name) other.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
  }
}

describe('activity shared between tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    FakeBroadcastChannel.instances = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells the other tabs through a BroadcastChannel and keeps the time', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const heardA = vi.fn();
    const heardB = vi.fn();
    const a = openActivityChannel(heardA);
    const b = openActivityChannel(heardB);

    a.post(1234);

    expect(heardB).toHaveBeenCalledWith(1234);
    expect(heardA).not.toHaveBeenCalled();
    expect(readLastActivity()).toBe(1234);

    b.close();
    a.post(5678);
    expect(heardB).toHaveBeenCalledTimes(1);
    a.close();
  });

  it('falls back to storage events without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const heard = vi.fn();
    const channel = openActivityChannel(heard);

    // Another tab's write arrives as a storage event.
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVITY_KEY, newValue: '4321' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '1' }));
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVITY_KEY, newValue: 'garbage' }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(4321);

    channel.post(9999);
    expect(readLastActivity()).toBe(9999);

    channel.close();
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVITY_KEY, newValue: '5555' }));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
