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
