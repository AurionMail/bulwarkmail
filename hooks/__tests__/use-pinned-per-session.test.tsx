import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { usePinnedPerSession } from '../use-pinned-per-session';

// #1229: a reply kept open in Mountain View's compose window must keep
// answering the message it was started from while other mail is opened.
describe('usePinnedPerSession', () => {
  it('keeps the value a session started with while the value changes', () => {
    const { result, rerender } = renderHook(({ session, value }) => usePinnedPerSession(session, value), {
      initialProps: { session: 1, value: 'first message' },
    });
    expect(result.current).toBe('first message');

    rerender({ session: 1, value: 'another message' });
    expect(result.current).toBe('first message');
  });

  it('takes the current value when a new session starts', () => {
    const { result, rerender } = renderHook(({ session, value }) => usePinnedPerSession(session, value), {
      initialProps: { session: 1, value: 'first message' },
    });
    rerender({ session: 2, value: 'second message' });
    expect(result.current).toBe('second message');

    rerender({ session: 2, value: 'third message' });
    expect(result.current).toBe('second message');
  });
});
