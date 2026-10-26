import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mailbox } from '@/lib/jmap/types';

// The admin policy's tagsAboveSharedEnabled gate lists the Tags above the
// shared mailboxes, so a long list of them does not push the tags out of
// sight. Off by default: the sidebar keeps its order.

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
const { usePolicyStore } = await import('@/stores/policy-store');
const { DEFAULT_POLICY, DEFAULT_FEATURE_GATES } = await import('@/lib/admin/types');

const mailboxes = [
  { id: 'inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true } },
  { id: 'receipts', name: 'Receipts', role: null, parentId: null, totalEmails: 0, unreadEmails: 0, myRights: { mayAddItems: true } },
  {
    id: 'g1-inbox', name: 'Inbox', role: 'inbox', parentId: null, totalEmails: 0, unreadEmails: 0,
    myRights: { mayAddItems: true }, accountId: 'g1', accountName: 'Support', isShared: true,
  },
] as unknown as Mailbox[];

function setGate(on: boolean) {
  usePolicyStore.setState({
    policy: { ...DEFAULT_POLICY, features: { ...DEFAULT_FEATURE_GATES, tagsAboveSharedEnabled: on } },
  });
}

const tags = () => document.querySelector('[data-tour="keyword-tags"]');
const isBefore = (a: Element | null, b: Element | null) =>
  !!a && !!b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('Sidebar Tags above the shared mailboxes', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('sidebarSharedExpanded', 'true');
    useAuthStore.setState({ activeAccountId: 'login-a' } as never);
    useSettingsStore.setState({
      hideAccountSwitcher: true,
      enableUnifiedMailbox: false,
      showSharedMailAccounts: true,
      hiddenSharedMailAccounts: {},
      emailKeywords: [{ id: 'fair', label: 'Fair', color: 'blue' }],
    } as never);
    setGate(false);
  });

  it('lists the Tags below the shared mailboxes by default', () => {
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(isBefore(screen.getByTestId('section-shared'), tags())).toBe(true);
  });

  it('lists the Tags above the shared mailboxes with the gate on', () => {
    setGate(true);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" />);

    expect(isBefore(tags(), screen.getByTestId('section-shared'))).toBe(true);
    // Still below the folders of your own, and only once.
    expect(isBefore(screen.getByTestId('section-your-folders'), tags())).toBe(true);
    expect(document.querySelectorAll('[data-tour="keyword-tags"]')).toHaveLength(1);
  });

  it('keeps the tags right after the Labels list in Mountain View', () => {
    setGate(true);
    render(<Sidebar mailboxes={mailboxes} selectedMailbox="inbox" mvShell />);
    fireEvent.click(screen.getByText('show_more'));

    expect(isBefore(document.querySelector('[data-mv-labels]'), tags())).toBe(true);
    expect(isBefore(tags(), screen.getByTestId('section-shared'))).toBe(true);
  });
});
