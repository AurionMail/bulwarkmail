import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAllHooks, toastHooks } from '@/lib/plugin-hooks';
import { useToastStore } from '../toast-store';

beforeEach(() => {
  clearAllHooks();
  useToastStore.setState({ toasts: [] });
});

describe('toast hooks', () => {
  it('tells plugins about a toast when it is shown and when it goes away', () => {
    const shown = vi.fn();
    const dismissed = vi.fn();
    toastHooks.onToastShow.register('t', shown);
    toastHooks.onToastDismiss.register('t', dismissed);

    const id = useToastStore.getState().addToast({ type: 'success', title: 'Moved', message: '3 messages' });
    useToastStore.getState().removeToast(id);

    expect(shown).toHaveBeenCalledWith({ id, type: 'success', title: 'Moved', message: '3 messages' });
    expect(dismissed).toHaveBeenCalledWith({ id });
  });

  it('does not report a dismissal for a toast that is not there', () => {
    const dismissed = vi.fn();
    toastHooks.onToastDismiss.register('t', dismissed);

    useToastStore.getState().removeToast('gone');

    expect(dismissed).not.toHaveBeenCalled();
  });
});
