import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllHooks, keyboardHooks } from '@/lib/plugin-hooks';
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts';

function press(key: string, code: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, ...init }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearAllHooks());

describe('shortcut hooks', () => {
  it('runs the shortcut and tells plugins after it ran', () => {
    const onArchive = vi.fn();
    const after = vi.fn();
    keyboardHooks.onAfterShortcut.register('p', after);
    renderHook(() => useKeyboardShortcuts({ emails: [], selectedEmailId: 'e1', handlers: { onArchive } }));

    press('e', 'KeyE');

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith({ key: 'e', action: 'archive' });
  });

  it('lets a plugin stop a shortcut', async () => {
    const onReplyAll = vi.fn();
    const before = vi.fn().mockReturnValue(false);
    keyboardHooks.onBeforeShortcut.register('p', before);
    renderHook(() => useKeyboardShortcuts({ emails: [], selectedEmailId: 'e1', handlers: { onReplyAll } }));

    press('R', 'KeyR', { shiftKey: true });
    await flush();

    expect(before).toHaveBeenCalledWith({ key: 'shift+r', action: 'reply-all' });
    expect(onReplyAll).not.toHaveBeenCalled();
  });

  it('runs the shortcut when the plugin lets it through', async () => {
    const onCompose = vi.fn();
    keyboardHooks.onBeforeShortcut.register('p', () => true);
    renderHook(() => useKeyboardShortcuts({ emails: [], handlers: { onCompose } }));

    press('c', 'KeyC');
    await flush();

    expect(onCompose).toHaveBeenCalledTimes(1);
  });
});
