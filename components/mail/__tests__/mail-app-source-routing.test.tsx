import React, { Suspense, lazy } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Email, Mailbox } from '@/lib/jmap/types';
import { useAuthStore } from '@/stores/auth-store';
import { useEmailStore } from '@/stores/email-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePluginStore } from '@/stores/plugin-store';
import { useThemeStore } from '@/stores/theme-store';
import { useToastStore } from '@/stores/toast-store';
import { DEFAULT_SEARCH_FILTERS } from '@/lib/jmap/search-utils';
import { clearAllHooks } from '@/lib/plugin-hooks';

// Actions on the open message act in its own login and account. Stalwart
// numbers every account's folders and messages alike (Inbox `a`, Deleted
// Items `b`, first message `eaaaaab`), so a folder or message picked from
// another account's list names something else there.

vi.mock('next/dynamic', () => ({ default: (load: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
  const Component = lazy(async () => ({ default: await load() }));
  return function Dynamic(props: Record<string, unknown>) {
    return <Suspense fallback={null}><Component {...props} /></Suspense>;
  };
} }));
vi.mock('@/components/email/email-viewer', () => ({
  EmailViewer: ({ onArchive, onDelete }: { onArchive?: () => void; onDelete?: () => void }) => (
    <div>
      <button onClick={() => onArchive?.()}>stub archive</button>
      <button onClick={() => onDelete?.()}>stub delete</button>
    </div>
  ),
}));
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/navigation-rail', () => ({ NavigationRail: () => null }));
vi.mock('@/components/layout/calendar-event-notification-toaster', () => ({ CalendarEventNotificationToaster: () => null }));
vi.mock('@/components/layout/share-notification-toaster', () => ({ ShareNotificationToaster: () => null }));
vi.mock('@/components/layout/mobile-header', () => ({ MobileHeader: () => null }));
vi.mock('@/components/email/message-list-tabs', () => ({ MessageListTabs: () => null }));
vi.mock('@/components/search/search-box', () => ({ SearchBox: () => null }));
vi.mock('@/components/tour/tour-provider', () => ({ useTour: () => ({ activeTour: null, registerStep: vi.fn() }) }));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));
vi.mock('@/hooks/use-config', () => ({ useConfig: () => ({ appName: 'Mail' }) }));
vi.mock('@/hooks/use-identity-sync', () => ({ useIdentitySync: () => {} }));
vi.mock('@/hooks/use-pro-multi-account-identities', () => ({ useProMultiAccountIdentities: () => [] }));
vi.mock('@/hooks/use-pro-multi-account-mailboxes', () => ({ useProMultiAccountMailboxes: () => {} }));
vi.mock('@/hooks/use-wopi-status', () => ({ useWopiStatus: () => null, canWopiOpen: () => false }));
vi.mock('@/hooks/use-browser-navigation', () => ({ useBrowserNavigation: () => {} }));
vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
  useIsDesktop: () => true,
}));
vi.mock('@/lib/push-bindings', () => ({ reconcilePushBindings: () => {}, releasePushBindings: () => {} }));
vi.mock('@/components/email/email-list', () => ({ EmailList: () => <div>message list</div> }));

const { MailApp } = await import('../mail-app');

function mailbox(id: string, role: string | undefined, accountId: string, shared = false): Mailbox {
  return {
    id: shared ? `${accountId}:${id}` : id, originalId: id, name: role ?? id, role, accountId, isShared: shared,
    sortOrder: 0, totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0, isSubscribed: true,
  } as Mailbox;
}

// The active login's folders: its own account `cf` and the group `ce`.
const folders = [
  mailbox('a', 'inbox', 'cf'), mailbox('b', 'trash', 'cf'), mailbox('i', 'archive', 'cf'),
  mailbox('a', 'inbox', 'ce', true), mailbox('b', 'trash', 'ce', true), mailbox('k', 'archive', 'ce', true),
];

// The group's message, opened in the Red tag view, which lists own and group
// messages together and stamps each with its login and account.
const groupMessage = {
  id: 'eaaaaab', threadId: 'c', subject: 'GRP one', receivedAt: '2026-10-26T10:00:00Z',
  keywords: { $seen: true, '$label:red': true }, mailboxIds: { 'ce:a': true },
  sourceClientAccountId: 'login-a', sourceAccountId: 'ce',
} as unknown as Email;

let client: Record<string, unknown>;
const moveToMailbox = vi.fn();
const moveThreadToMailbox = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) });
  useToastStore.setState({ toasts: [] });
  clearAllHooks();
  client = {
    getAccountId: () => 'cf', getUsername: () => 'a@example.org',
    getSieveAccountId: () => null, hasDelayedSend: () => false, getSession: () => null,
    getMailboxes: vi.fn().mockResolvedValue(folders),
  };
  useAuthStore.setState({
    isAuthenticated: true, isLoading: false, client: client as never, activeAccountId: 'login-a', identities: [],
    getClientForAccount: (id: string) => (id === 'login-a' ? client : undefined) as never,
    getAllConnectedClients: () => new Map([['login-a', client]]) as never,
  });
  useSettingsStore.setState({ enableUnifiedMailbox: false, mailLayout: 'split', archiveMode: 'single', deleteAction: 'trash' } as never);
  moveToMailbox.mockReset().mockResolvedValue(true);
  moveThreadToMailbox.mockReset().mockResolvedValue(true);
  useEmailStore.setState({
    emails: [groupMessage], selectedEmail: groupMessage, selectedMailbox: '', selectedKeyword: 'red', mailboxes: folders,
    viewingAccountId: null, accountMailboxes: {}, isUnifiedView: false, unifiedRole: null,
    isScheduledView: false, isLoadingEmail: false, isLoading: false, searchQuery: '',
    searchFilters: { ...DEFAULT_SEARCH_FILTERS }, searchMailboxId: '',
    selectedEmailKeys: new Set(),
    fetchMailboxes: vi.fn().mockResolvedValue(undefined), fetchEmails: vi.fn().mockResolvedValue(undefined),
    fetchQuota: vi.fn().mockResolvedValue(undefined), fetchTagCounts: vi.fn().mockResolvedValue(undefined),
    refreshScheduledMetadata: vi.fn().mockResolvedValue(undefined),
    moveToMailbox, moveThreadToMailbox,
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the open message of a group account in a tag view', () => {
  it('is archived into the group\'s Archive, not the own one', async () => {
    render(<MailApp />);
    fireEvent.click(await screen.findByText('stub archive', {}, { timeout: 5000 }));
    await waitFor(() => expect(moveThreadToMailbox).toHaveBeenCalled());
    expect(moveThreadToMailbox).toHaveBeenCalledWith(client, 'eaaaaab', 'ce:k', 'login-a/ce:eaaaaab');
  });

  it('is deleted into the group\'s Deleted Items, not the own one', async () => {
    render(<MailApp />);
    fireEvent.click(await screen.findByText('stub delete', {}, { timeout: 5000 }));
    await waitFor(() => expect(moveToMailbox).toHaveBeenCalled());
    expect(moveToMailbox).toHaveBeenCalledWith(client, 'eaaaaab', 'ce:b', 'login-a/ce:eaaaaab');
  });
});
