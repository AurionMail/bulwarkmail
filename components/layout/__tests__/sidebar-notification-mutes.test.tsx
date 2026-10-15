import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// #1169: folders and whole accounts can be muted from their context menu; a
// folder's own setting wins over its account's.

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
  box('inbox', 'Inbox', 'inbox'),
  box('renovate', 'Renovate', null),
  box('g1:g1-inbox', 'Inbox', 'inbox', { originalId: 'g1-inbox', accountId: 'g1', accountName: 'Postmaster', isShared: true }),
];

function client(emailPush: boolean) {
  return {
    getAccountId: () => 'me',
    getCapabilities: () => (emailPush ? { 'urn:ietf:params:jmap:emailpush': {} } : {}),
  };
}

const row = (mailboxId: string) =>
  screen.getAllByTestId('folder-row').find((el) => el.getAttribute('data-mailbox-id') === mailboxId)!;
const mutes = () => useSettingsStore.getState().notificationMutes;

describe('Sidebar notification mutes (#1169)', () => {
  beforeEach(() => {
    localStorage.setItem('sidebarSharedExpanded', 'true');
    localStorage.setItem('sidebarExpandedSharedAccounts', JSON.stringify(['shared-account-g1']));
    useAuthStore.setState({ activeAccountId: 'login-a', client: client(true) } as never);
    useSettingsStore.setState({
      hideAccountSwitcher: true,
      showSharedMailAccounts: true,
      hiddenSharedMailAccounts: {},
      notificationMutes: { accounts: [], mailboxes: {} },
    } as never);
  });

  it('mutes and unmutes one folder from its context menu', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);
    expect(row('renovate').querySelector('[data-testid="folder-muted"]')).toBeNull();

    fireEvent.contextMenu(row('renovate'));
    fireEvent.click(screen.getByTestId('mailbox-mute'));

    expect(mutes().mailboxes).toEqual({ 'me/renovate': true });
    expect(row('renovate').querySelector('[data-testid="folder-muted"]')).not.toBeNull();
    expect(row('inbox').querySelector('[data-testid="folder-muted"]')).toBeNull();

    fireEvent.contextMenu(row('renovate'));
    fireEvent.click(screen.getByTestId('mailbox-mute'));
    expect(mutes().mailboxes).toEqual({});
  });

  it('mutes a shared account, unmutes one of its folders and resets that again', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    fireEvent.contextMenu(screen.getAllByTestId('section-shared-account')[0]);
    expect(screen.queryByTestId('mailbox-reset-folder-mutes')).toBeNull();
    fireEvent.click(screen.getByTestId('mailbox-mute-account'));

    expect(mutes().accounts).toEqual(['g1']);
    expect(row('g1:g1-inbox').querySelector('[data-testid="folder-muted"]')).not.toBeNull();
    // The own account is not affected.
    expect(row('inbox').querySelector('[data-testid="folder-muted"]')).toBeNull();

    // The folder's own setting wins over the muted account, keyed by the server id.
    fireEvent.contextMenu(row('g1:g1-inbox'));
    fireEvent.click(screen.getByTestId('mailbox-mute'));
    expect(mutes().mailboxes).toEqual({ 'g1/g1-inbox': false });
    expect(row('g1:g1-inbox').querySelector('[data-testid="folder-muted"]')).toBeNull();

    fireEvent.contextMenu(screen.getAllByTestId('section-shared-account')[0]);
    fireEvent.click(screen.getByTestId('mailbox-reset-folder-mutes'));
    expect(mutes().mailboxes).toEqual({});
    expect(row('g1:g1-inbox').querySelector('[data-testid="folder-muted"]')).not.toBeNull();
  });

  it('offers no mute without the server push filter', () => {
    useAuthStore.setState({ client: client(false) } as never);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    fireEvent.contextMenu(row('renovate'));
    expect(screen.queryByTestId('mailbox-mute')).toBeNull();
  });
});
