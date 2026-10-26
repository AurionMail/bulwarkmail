import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// #1205: the folders the user made get a "Your folders" section of their own
// below the system folders, instead of being mixed in with Inbox, Sent and
// Trash. Users with no folders of their own see no change.

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
const { useSettingsStore } = await import('@/stores/settings-store');
const { useUIStore } = await import('@/stores/ui-store');
const { useAccountStore } = await import('@/stores/account-store');
const { useAuthStore } = await import('@/stores/auth-store');

const box = (id: string, name: string, role: string | null, sortOrder: number, parentId: string | null = null) =>
  ({ id, name, role, parentId, totalEmails: 0, unreadEmails: 0, sortOrder, myRights: { mayAddItems: true } });

const systemOnly = [
  box('inbox', 'Inbox', 'inbox', 0),
  box('drafts', 'Drafts', 'drafts', 1),
  box('sent', 'Sent', 'sent', 2),
  box('trash', 'Trash', 'trash', 3),
];
const withCustom = [
  ...systemOnly,
  box('receipts', 'Receipts', null, 4),
  box('projects', 'Projects', null, 5),
  box('inbox-sub', 'Newsletters', null, 6, 'inbox'),
] as unknown as Mailbox[];

const folderRow = (name: string) => document.querySelector(`[data-folder-name="${name}"]`);
const inYourFolders = (name: string) =>
  document.querySelector(`[data-testid="section-your-folders"] [data-folder-name="${name}"]`);

describe('Sidebar "Your folders" section (#1205)', () => {
  beforeEach(() => {
    localStorage.clear();
    useUIStore.setState({ sidebarCollapsed: false } as never);
    useAccountStore.setState({ accounts: [] } as never);
    useSettingsStore.setState({
      emailKeywords: [],
      enableUnifiedMailbox: false,
      hideAccountSwitcher: true,
    } as never);
  });

  it('lists the folders you made under their own heading, apart from the system folders', () => {
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" />);

    expect(screen.getByText('your_folders')).toBeInTheDocument();
    expect(inYourFolders('Receipts')).not.toBeNull();
    expect(inYourFolders('Projects')).not.toBeNull();
    for (const name of ['Inbox', 'Drafts', 'Sent', 'Trash']) {
      expect(folderRow(name)).not.toBeNull();
      expect(inYourFolders(name)).toBeNull();
    }
    // The system folders all come before the first folder of your own.
    const rows = [...document.querySelectorAll('[data-folder-name]')].map((r) => r.getAttribute('data-folder-name'));
    expect(rows.indexOf('Trash')).toBeLessThan(rows.indexOf('Receipts'));
  });

  it('keeps a folder nested under a system folder with its parent', () => {
    localStorage.setItem('expandedMailboxes', JSON.stringify(['inbox']));
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" />);

    expect(folderRow('Newsletters')).not.toBeNull();
    expect(inYourFolders('Newsletters')).toBeNull();
  });

  it('shows no section when there are no folders of your own', () => {
    render(<Sidebar mailboxes={systemOnly as unknown as Mailbox[]} selectedMailbox="inbox" />);

    expect(screen.queryByText('your_folders')).toBeNull();
    expect(document.querySelector('[data-testid="section-your-folders"]')).toBeNull();
    expect(folderRow('Trash')).not.toBeNull();
  });

  it('collapses on its own and remembers it', () => {
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" />);

    fireEvent.click(screen.getByText('your_folders'));
    expect(folderRow('Receipts')).toBeNull();
    // The system folders are untouched.
    expect(folderRow('Inbox')).not.toBeNull();

    cleanup();
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" />);
    expect(screen.getByText('your_folders')).toBeInTheDocument();
    expect(folderRow('Receipts')).toBeNull();

    fireEvent.click(screen.getByText('your_folders'));
    expect(folderRow('Receipts')).not.toBeNull();
  });

  it('creates a new folder from the heading', () => {
    const onCreateFolder = vi.fn();
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" onCreateFolder={onCreateFolder} />);

    fireEvent.click(screen.getByLabelText('create_folder'));
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
    // The click does not also fold the section away.
    expect(folderRow('Receipts')).not.toBeNull();
  });

  it('leaves Mountain View with its Labels list', () => {
    render(<Sidebar mailboxes={withCustom} selectedMailbox="inbox" mvShell />);

    expect(screen.queryByText('your_folders')).toBeNull();
    expect(document.querySelector('[data-mv-labels] [data-folder-name="Receipts"]')).not.toBeNull();
  });

  it('splits every account group in the Pro layout', () => {
    const account = (id: string) => ({
      id, label: `${id}@example.com`, email: `${id}@example.com`, username: `${id}@example.com`,
      cookieSlot: id === 'a' ? 0 : 1, isConnected: true,
    });
    useAccountStore.setState({ accounts: [account('a'), account('b')] } as never);
    useAuthStore.setState({ activeAccountId: 'a' } as never);
    const other = [box('b-inbox', 'Inbox', 'inbox', 0), box('b-clients', 'Clients', null, 1)] as unknown as Mailbox[];

    render(
      <Sidebar mailboxes={withCustom} selectedMailbox="inbox" multiAccountMode accountMailboxes={{ b: other }} />,
    );

    expect(screen.getAllByText('your_folders')).toHaveLength(2);
    expect(inYourFolders('Receipts')).not.toBeNull();
    expect(inYourFolders('Clients')).not.toBeNull();
    expect(inYourFolders('Inbox')).toBeNull();

    // Each account's section folds on its own.
    fireEvent.click(screen.getByTestId('section-your-folders-header-b'));
    expect(folderRow('Clients')).toBeNull();
    expect(folderRow('Receipts')).not.toBeNull();
  });
});
