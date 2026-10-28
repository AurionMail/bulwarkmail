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

describe('selection bar and rows from the keyboard', () => {
  it('keeps the collapsed bar out of the Tab order', () => {
    useEmailStore.setState({ selectedEmailKeys: new Set() });
    render(<EmailList emails={useEmailStore.getState().emails} />);
    expect(screen.queryByTestId('batch-delete')).toBeNull();
  });

  it('names each row checkbox after its message', () => {
    // Give jsdom's virtualized rows a layout so they render.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(600);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute('data-index') ? 60 : 300;
      return { x: 0, y: 0, width: 600, height, top: 0, left: 0, right: 600, bottom: height, toJSON: () => ({}) } as DOMRect;
    });
    useEmailStore.setState({ selectedEmailKeys: new Set() });
    render(<EmailList emails={useEmailStore.getState().emails} />);
    // The i18n mock renders the key: "Select {sender}: {subject}".
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.getAttribute('aria-label')).toBe('select_row');
  });
});

describe('empty list', () => {
  it('offers Clear search when a search found nothing', () => {
    const onClearSearch = vi.fn();
    useEmailStore.setState({ emails: [], selectedEmailKeys: new Set(), searchQuery: 'zebra' });
    render(<EmailList emails={[]} onClearSearch={onClearSearch} />);
    fireEvent.click(screen.getByRole('button', { name: 'clear_search' }));
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('offers Compose in an empty Drafts folder', () => {
    const onCompose = vi.fn();
    useEmailStore.setState({ emails: [], selectedEmailKeys: new Set(), searchQuery: '', mailboxes: [folder('drafts', 'drafts')], selectedMailbox: 'drafts' });
    render(<EmailList emails={[]} onCompose={onCompose} />);
    fireEvent.click(screen.getByRole('button', { name: 'compose' }));
    expect(onCompose).toHaveBeenCalled();
  });
});
