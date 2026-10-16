import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts';

// #683: the help modal advertises `x` for thread expansion and the hook binds
// it; the handler must actually be invoked when a message is selected.

function pressX() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }));
}

describe('useKeyboardShortcuts: x toggles thread expansion', () => {
  it('calls onToggleThreadExpansion for the selected email', () => {
    const onToggleThreadExpansion = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        enabled: true,
        emails: [],
        selectedEmailId: 'e1',
        handlers: { onToggleThreadExpansion },
      }),
    );

    pressX();

    expect(onToggleThreadExpansion).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a selected email', () => {
    const onToggleThreadExpansion = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        enabled: true,
        emails: [],
        handlers: { onToggleThreadExpansion },
      }),
    );

    pressX();

    expect(onToggleThreadExpansion).not.toHaveBeenCalled();
  });
});

// #992: Shift + arrow (or j/k) extends the selection instead of moving to the
// next message; plain arrows still move.
describe('useKeyboardShortcuts: Shift + arrow extends the selection', () => {
  function press(key: string, code: string, shiftKey: boolean) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey, bubbles: true }));
  }

  it.each([
    ['ArrowDown', 'ArrowDown', 1],
    ['ArrowUp', 'ArrowUp', -1],
    ['J', 'KeyJ', 1],
    ['K', 'KeyK', -1],
  ] as const)('Shift + %s (%s) extends by %i', (key, code, direction) => {
    const onExtendSelection = vi.fn();
    const onNextEmail = vi.fn();
    const onPreviousEmail = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        emails: [],
        selectedEmailId: 'e1',
        handlers: { onExtendSelection, onNextEmail, onPreviousEmail },
      }),
    );

    press(key, code, true);

    expect(onExtendSelection).toHaveBeenCalledWith(direction);
    expect(onNextEmail).not.toHaveBeenCalled();
    expect(onPreviousEmail).not.toHaveBeenCalled();
  });

  it('plain ArrowDown still moves to the next message', () => {
    const onExtendSelection = vi.fn();
    const onNextEmail = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        emails: [],
        selectedEmailId: 'e1',
        handlers: { onExtendSelection, onNextEmail },
      }),
    );

    press('ArrowDown', 'ArrowDown', false);

    expect(onNextEmail).toHaveBeenCalledTimes(1);
    expect(onExtendSelection).not.toHaveBeenCalled();
  });
});
