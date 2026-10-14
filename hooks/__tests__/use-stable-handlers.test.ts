import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStableHandlers } from '../use-stable-handlers';

describe('useStableHandlers', () => {
  it('keeps each handler identity across renders while calling the latest closure', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onPick }) => useStableHandlers({ onPick }), {
      initialProps: { onPick: first as (id: string) => void },
    });

    const stable = result.current;
    rerender({ onPick: second });

    expect(result.current).toBe(stable);
    expect(result.current.onPick).toBe(stable.onPick);

    // A row that skipped the re-render still holds `stable.onPick`.
    stable.onPick('e1');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('e1');
  });

  it('passes arguments through and hands back the return value', () => {
    const { result } = renderHook(() => useStableHandlers({ add: (a: number, b: number) => a + b }));
    expect(result.current.add(2, 3)).toBe(5);
  });

  it('leaves an absent handler absent, and follows it when it appears or goes away', () => {
    const onDelete = vi.fn();
    const { result, rerender } = renderHook(
      ({ onDelete: handler }: { onDelete?: () => void }) => useStableHandlers({ onOpen: () => {}, onDelete: handler }),
      { initialProps: {} as { onDelete?: () => void } },
    );

    // Rows show a delete button only when there is something to call.
    expect(result.current.onDelete).toBeUndefined();
    const withoutDelete = result.current;

    rerender({ onDelete });
    expect(result.current).not.toBe(withoutDelete);
    expect(typeof result.current.onDelete).toBe('function');
    // Handlers that were there all along keep working through the old object too.
    expect(() => withoutDelete.onOpen()).not.toThrow();
    result.current.onDelete?.();
    expect(onDelete).toHaveBeenCalledTimes(1);

    rerender({});
    expect(result.current.onDelete).toBeUndefined();
  });
});
