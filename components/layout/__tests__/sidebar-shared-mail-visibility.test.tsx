import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// #1228: groups used only for shared calendars and contacts still come with an
// empty mailbox the server will not delete. Users can hide every shared
// account's mail folders, or single accounts, from the sidebar.

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

function sharedInbox(accountId: string, accountName: string): Mailbox {
  return {
    id: `${accountId}-inbox`, name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0,
    myRights: { mayAddItems: true }, accountId, accountName, isShared: true,
  } as unknown as Mailbox;
}

const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true } } as unknown as Mailbox,
  sharedInbox('g1', 'Calendar group'),
  sharedInbox('g2', 'Support'),
];

const sharedHeaders = () => screen.queryAllByTestId('section-shared-account').map((el) => el.textContent);

describe('Sidebar shared mail accounts (#1228)', () => {
  beforeEach(() => {
    localStorage.setItem('sidebarSharedExpanded', 'true');
    useAuthStore.setState({ activeAccountId: 'login-a' } as never);
    useSettingsStore.setState({
      hideAccountSwitcher: true,
      showSharedMailAccounts: true,
      hiddenSharedMailAccounts: {},
    } as never);
  });

  it('lists every shared account by default', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(sharedHeaders()).toEqual([expect.stringContaining('Calendar group'), expect.stringContaining('Support')]);
  });

  it('drops the whole Shared section when shared mail is turned off', () => {
    useSettingsStore.setState({ showSharedMailAccounts: false } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(screen.queryByTestId('section-shared')).toBeNull();
    expect(sharedHeaders()).toEqual([]);
  });

  it('hides only the accounts hidden for the active login', () => {
    useSettingsStore.setState({ hiddenSharedMailAccounts: { 'login-a': ['g1'], 'login-b': ['g2'] } } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(sharedHeaders()).toEqual([expect.stringContaining('Support')]);
  });

  it('hides an account from its context menu', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    const header = screen.getAllByTestId('section-shared-account')[0];
    fireEvent.contextMenu(header);
    fireEvent.click(screen.getByTestId('mailbox-hide-shared-account'));

    expect(useSettingsStore.getState().hiddenSharedMailAccounts).toEqual({ 'login-a': ['g1'] });
    expect(sharedHeaders()).toEqual([expect.stringContaining('Support')]);
  });
});
