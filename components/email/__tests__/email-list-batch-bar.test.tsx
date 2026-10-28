import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { EmailList } from '../email-list';

// The selection bar offers what the selection's context menu offers (R6):
// Archive, Delete, Tag, Report spam and Mark read/unread as buttons, the rest
// (Move to, Forward as attachments, ...) in its ⋮, which is that menu.

vi.mock('@/stores/toast-store', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-email-drag', () => ({ useEmailDrag: () => ({ dragHandlers: {}, isDragging: false }) }));
vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));

const initial = useEmailStore.getState();
const folder = (id: string, role: string): Mailbox => ({ id, name: id, role, accountId: 'c',
  totalEmails: 2, unreadEmails: 0, totalThreads: 2, unreadThreads: 0,
  myRights: { mayReadItems: true, mayAddItems: true, mayRemoveItems: true } } as Mailbox);

beforeEach(() => {
  useAuthStore.setState({ activeAccountId: 'test', client: { getAccountId: () => 'c', getSieveAccountId: () => null, getCapabilities: () => ({}) }, getClientForAccount: () => undefined } as never);
  useSettingsStore.setState({ confirmBulkDelete: false, deleteAction: 'trash', interfaceLayout: 'default' } as never);
  useEmailStore.setState(initial, true);
  const emails = ['one', 'two'].map(id => ({ id, threadId: 't-' + id, blobId: 'b-' + id,
    mailboxIds: { inbox: true }, keywords: { $seen: true }, subject: id, receivedAt: '2026-10-01T00:00:00Z',
    from: [{ email: 'someone@example.invalid' }], size: 1, hasAttachment: false } as Email));
  useEmailStore.setState({ emails, mailboxes: [folder('inbox', 'inbox'), folder('work', '')],
    selectedMailbox: 'inbox', selectedEmailKeys: new Set(['one', 'two']), totalEmails: 2 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('selection bar', () => {
  it('archives and reports spam from its own buttons', async () => {
    const batchArchive = vi.fn().mockResolvedValue(true);
    const batchMarkAsSpam = vi.fn().mockResolvedValue(true);
    useEmailStore.setState({ batchArchive, batchMarkAsSpam });
    render(<EmailList emails={useEmailStore.getState().emails} />);

    fireEvent.click(screen.getByTestId('batch-archive'));
    await waitFor(() => expect(batchArchive).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 600));
    fireEvent.click(screen.getByTestId('batch-spam'));
    await waitFor(() => expect(batchMarkAsSpam).toHaveBeenCalledWith(expect.anything(), ['one', 'two']));
  });

  it('opens the selection’s menu from ⋮, with Move to and Forward as attachments', () => {
    render(<EmailList emails={useEmailStore.getState().emails} />);
    fireEvent.click(screen.getByTestId('batch-more'));
    expect(screen.getByText('items_selected')).toBeTruthy();
    expect(screen.getByTestId('ctx-move-to')).toBeTruthy();
    expect(screen.getByTestId('ctx-batch-forward-as-attachment')).toBeTruthy();
  });
});
