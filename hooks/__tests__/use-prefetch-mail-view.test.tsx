import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The login form prefetches the mail view so signing in doesn't wait for its
// scripts. A mobile hand-off never opens the mail view and skips it.

const prefetch = vi.fn();
const router = { prefetch };
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));

const { usePrefetchMailView } = await import('../use-prefetch-mail-view');

describe('usePrefetchMailView', () => {
  beforeEach(() => prefetch.mockReset());

  it('prefetches the mail view once', () => {
    const { rerender } = renderHook(() => usePrefetchMailView(true));
    rerender();
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith('/');
  });

  it('leaves it alone when the login hands off elsewhere', () => {
    renderHook(() => usePrefetchMailView(false));
    expect(prefetch).not.toHaveBeenCalled();
  });
});
