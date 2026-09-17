import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// #843: the "Unified Mailbox" header used to appear as soon as two accounts
// were connected, but mail-app only populates the section when the admin gate
// and the user's cross-account toggle are both on (`crossAccountActive`), or a
// merged group inbox / cross view exists. An empty header is not shown.

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
const { useAccountStore } = await import('@/stores/account-store');
const { useSettingsStore } = await import('@/stores/settings-store');

const mailboxes: Mailbox[] = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true } },
] as unknown as Mailbox[];

function account(id: string) {
  return {
    id,
    label: `${id}@example.com`,
    email: `${id}@example.com`,
    username: `${id}@example.com`,
    cookieSlot: id === 'a' ? 0 : 1,
    isConnected: true,
  };
}

describe('Sidebar unified mailbox section (#843)', () => {
  beforeEach(() => {
    useAccountStore.setState({ accounts: [account('a'), account('b')] } as never);
    useSettingsStore.setState({
      enableUnifiedMailbox: true,
      includeGroupInUnified: false,
      hideAccountSwitcher: true,
    } as never);
  });

  it('hides the header with two accounts when cross-account is not active', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" crossAccountActive={false} />);

    expect(screen.queryByText('unified_mailbox')).toBeNull();
    expect(screen.queryByText('all_accounts')).toBeNull();
  });

  it('shows the header once cross-account is active', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" crossAccountActive />);

    expect(screen.getByText('all_accounts')).toBeInTheDocument();
  });

  it('shows the header for a cross view even without cross-account', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" crossAccountActive={false} showCrossUnread />);

    expect(screen.getByText('unified_mailbox')).toBeInTheDocument();
  });
});
