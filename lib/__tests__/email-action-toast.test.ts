import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast }));

import { runBatchEmailAction } from '../email-action-toast';
import { useEmailStore } from '@/stores/email-store';

const messages = { success: '3 messages archived', error: 'Could not archive' };

beforeEach(() => {
  vi.clearAllMocks();
  useEmailStore.setState({ error: null });
});

describe('runBatchEmailAction', () => {
  it('reports success when the action ran', async () => {
    await runBatchEmailAction(async () => true, messages);
    expect(toast.success).toHaveBeenCalledWith('3 messages archived');
    expect(toast.error).not.toHaveBeenCalled();
  });

  // A plugin that stops an action tells the user why itself; "3 messages
  // archived" on top of that would say the opposite.
  it('says nothing when a plugin stopped the action', async () => {
    await runBatchEmailAction(async () => false, messages);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports the error the action left in the store', async () => {
    await runBatchEmailAction(async () => {
      useEmailStore.setState({ error: 'Archive folder missing' });
      return false;
    }, messages);
    expect(toast.error).toHaveBeenCalledWith('Could not archive', 'Archive folder missing');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not blame this action for an earlier error', async () => {
    useEmailStore.setState({ error: 'Failed to load the folder' });
    await runBatchEmailAction(async () => true, messages);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('3 messages archived');
  });
});
