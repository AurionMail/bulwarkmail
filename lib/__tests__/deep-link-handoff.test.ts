import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setPendingDeepLink,
  deliverDeepLink,
  consumePendingDeepLink,
  consumePendingDeepLinkEntry,
  subscribePendingDeepLink,
  clearPendingDeepLinks,
} from '@/lib/deep-link-handoff';

describe('deep-link handoff', () => {
  beforeEach(() => {
    clearPendingDeepLinks();
  });

  it('parks segments and yields them exactly once', () => {
    setPendingDeepLink('mail', ['message', 'abc']);
    expect(consumePendingDeepLink('mail')).toEqual(['message', 'abc']);
    expect(consumePendingDeepLink('mail')).toBeNull();
  });

  it('keeps surfaces separate', () => {
    setPendingDeepLink('mail', ['message', 'abc']);
    setPendingDeepLink('settings', ['folders']);
    expect(consumePendingDeepLink('settings')).toEqual(['folders']);
    expect(consumePendingDeepLink('mail')).toEqual(['message', 'abc']);
  });

  it('delivers live to a subscribed surface instead of parking', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingDeepLink('mail', listener);

    setPendingDeepLink('mail', ['message', 'abc']);

    expect(listener).toHaveBeenCalledWith(['message', 'abc']);
    // Delivered, not parked: a later mount finds nothing.
    expect(consumePendingDeepLink('mail')).toBeNull();
    unsubscribe();
  });

  it('a listener only receives its own surface', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingDeepLink('mail', listener);

    setPendingDeepLink('settings', ['folders']);

    expect(listener).not.toHaveBeenCalled();
    expect(consumePendingDeepLink('settings')).toEqual(['folders']);
    unsubscribe();
  });

  it('unsubscribing restores parking', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingDeepLink('mail', listener);
    unsubscribe();

    setPendingDeepLink('mail', ['folder', 'inbox']);

    expect(listener).not.toHaveBeenCalled();
    expect(consumePendingDeepLink('mail')).toEqual(['folder', 'inbox']);
  });

  it('parks the search string with the segments and yields both once', () => {
    setPendingDeepLink('calendar', ['event', 'ev1'], '?account=c&login=a@b');
    expect(consumePendingDeepLinkEntry('calendar')).toEqual({
      segments: ['event', 'ev1'],
      search: '?account=c&login=a@b',
    });
    expect(consumePendingDeepLinkEntry('calendar')).toBeNull();
  });

  it('the segments-only consumer still works when a search string was parked', () => {
    setPendingDeepLink('files', ['Documents'], '?preview=notes.txt');
    expect(consumePendingDeepLink('files')).toEqual(['Documents']);
    expect(consumePendingDeepLink('files')).toBeNull();
  });

  it('delivers the search string live to a subscribed surface', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingDeepLink('files', listener);
    setPendingDeepLink('files', ['Documents'], '?preview=notes.txt');
    expect(listener).toHaveBeenCalledWith(['Documents'], '?preview=notes.txt');
    expect(consumePendingDeepLinkEntry('files')).toBeNull();
    unsubscribe();
  });

  it('delivers only to a mounted surface and parks nothing when none listens', () => {
    expect(deliverDeepLink('files', [], '?shared=owner1%3An5')).toBe(false);
    expect(consumePendingDeepLinkEntry('files')).toBeNull();

    const listener = vi.fn();
    const unsubscribe = subscribePendingDeepLink('files', listener);
    expect(deliverDeepLink('files', [], '?shared=owner1%3An5')).toBe(true);
    expect(listener).toHaveBeenCalledWith([], '?shared=owner1%3An5');
    expect(consumePendingDeepLinkEntry('files')).toBeNull();
    unsubscribe();
  });
});
