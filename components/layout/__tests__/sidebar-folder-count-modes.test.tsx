import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// #982: the per-folder counter setting overrides the global total count.

vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ startTour: vi.fn(), resetTourCompletion: vi.fn(), activeTour: null, endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/contexts/drag-drop-context', () => ({
  useDragDropContext: () => ({ isDragging: false }),
}));
vi.mock('@/hooks/use-mailbox-drop', () => ({
  useMailboxDrop: () => ({ dropHandlers: {}, isValidDropTarget: false, isInvalidDropTarget: false }),
}));
vi.mock('@/hooks/use-tag-drop', () => ({
  useTagDrop: () => ({ dropHandlers: {}, isValidDropTarget: false }),
}));
vi.mock('../account-switcher', () => ({ AccountSwitcher: () => null }));

const { Sidebar } = await import('../sidebar');
const { useAuthStore } = await import('@/stores/auth-store');
const { useSettingsStore } = await import('@/stores/settings-store');

const box = (id: string, name: string, role: string | null, extra: Partial<Mailbox> = {}) => ({
  id, name, role, parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true }, ...extra,
}) as unknown as Mailbox;

const mailboxes: Mailbox[] = [
  box('inbox', 'Inbox', 'inbox', { totalEmails: 120, unreadEmails: 4 }),
  box('drafts', 'Drafts', 'drafts', { totalEmails: 7 }),
  box('news', 'News', null, { totalEmails: 30, unreadEmails: 2 }),
];

const counts = (mailboxId: string) => {
  const row = screen.getAllByTestId('folder-row').find((el) => el.getAttribute('data-mailbox-id') === mailboxId)!;
  const el = row.querySelector('[data-testid="folder-counts"]');
  return el ? { unread: el.getAttribute('data-unread'), total: el.getAttribute('data-total') } : null;
};

describe('Sidebar folder counter modes (#982)', () => {
  beforeEach(() => {
    useAuthStore.setState({ activeAccountId: 'login-a', client: { getAccountId: () => 'me', getCapabilities: () => ({}) } } as never);
    useSettingsStore.setState({
      hideAccountSwitcher: true,
      interfaceLayout: 'default',
      showFolderTotalCount: false,
      folderCountModes: {},
    } as never);
  });

  it('keeps the Drafts counter while total counts are off elsewhere', () => {
    useSettingsStore.setState({ folderCountModes: { drafts: 'all' } } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(counts('drafts')).toEqual({ unread: '0', total: '7' });
    expect(counts('inbox')).toEqual({ unread: '4', total: '0' });
  });

  it('hides one folder counter and limits another to unread with total counts on', () => {
    useSettingsStore.setState({ showFolderTotalCount: true, folderCountModes: { news: 'none', inbox: 'unread' } } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(counts('news')).toBeNull();
    expect(counts('inbox')).toEqual({ unread: '4', total: '0' });
    expect(counts('drafts')).toEqual({ unread: '0', total: '7' });
  });
});
