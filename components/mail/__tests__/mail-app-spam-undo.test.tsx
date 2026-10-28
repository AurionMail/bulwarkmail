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

// Report spam on the open message offered an Undo that moved it to the Inbox
// and then said "Email moved", where every other Undo puts the message back
// in its own folders and says "Moved back".

vi.mock('next/dynamic', () => ({ default: (load: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
  const Component = lazy(async () => ({ default: await load() }));
  return function Dynamic(props: Record<string, unknown>) {
    return <Suspense fallback={null}><Component {...props} /></Suspense>;
  };
} }));
vi.mock('@/components/email/email-viewer', () => ({
  EmailViewer: ({ onMarkAsSpam, onUndoSpam }: { onMarkAsSpam?: () => void; onUndoSpam?: () => void }) => (
    <>
      <button onClick={() => onMarkAsSpam?.()}>stub spam</button>
      <button onClick={() => onUndoSpam?.()}>stub not spam</button>
    </>
  ),
}));
vi.mock('@/components/email/email-composer', () => ({ EmailComposer: () => null }));
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

function mailbox(id: string, role: string): Mailbox {
  return {
    id, name: role, role, sortOrder: 0, totalEmails: 1, unreadEmails: 1, totalThreads: 1, unreadThreads: 1, isSubscribed: true,
  } as Mailbox;
}
const folders = [mailbox('inbox', 'inbox'), mailbox('trash', 'trash'), mailbox('junk', 'junk')];
const unread = {
  id: 'm1', threadId: 't1', subject: 'Hello', receivedAt: '2026-10-26T10:00:00Z',
  keywords: {}, mailboxIds: { inbox: true },
} as unknown as Email;

let client: Record<string, ReturnType<typeof vi.fn> | (() => unknown)>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  usePluginStore.setState({ initializePlugins: vi.fn().mockResolvedValue(undefined) });
  useThemeStore.setState({ syncServerThemes: vi.fn().mockResolvedValue(undefined) });
  useToastStore.setState({ toasts: [] });
  clearAllHooks();
  client = {
    getAccountId: () => 'acc', getUsername: () => 'a@example.org',
    getSieveAccountId: () => null, hasDelayedSend: () => false, getSession: () => null,
    getMailboxes: vi.fn().mockResolvedValue(folders),
    moveToTrash: vi.fn().mockResolvedValue(undefined),
    moveEmail: vi.fn().mockResolvedValue(undefined),
    deleteEmail: vi.fn().mockResolvedValue(undefined),
    markAsSpam: vi.fn().mockResolvedValue(undefined),
    undoSpam: vi.fn().mockResolvedValue(undefined),
    restoreEmails: vi.fn().mockResolvedValue(undefined),
  };
  useAuthStore.setState({
    isAuthenticated: true, isLoading: false, client: client as never, activeAccountId: 'login-a', identities: [],
    getClientForAccount: (id: string) => (id === 'login-a' ? client : undefined) as never,
    getAllConnectedClients: () => new Map([['login-a', client]]) as never,
  });
  useSettingsStore.setState({ enableUnifiedMailbox: false, mailLayout: 'split', permanentlyDeleteJunk: false } as never);
  useEmailStore.setState({
    emails: [unread], selectedEmail: unread, selectedMailbox: 'inbox', selectedKeyword: null, mailboxes: folders,
    viewingAccountId: null, accountMailboxes: {}, isUnifiedView: false, unifiedRole: null,
    isScheduledView: false, isLoadingEmail: false, isLoading: false, searchQuery: '',
    searchFilters: { ...DEFAULT_SEARCH_FILTERS }, searchMailboxId: '',
    selectedEmailKeys: new Set(),
    fetchMailboxes: vi.fn().mockResolvedValue(undefined), fetchEmails: vi.fn().mockResolvedValue(undefined),
    fetchQuota: vi.fn().mockResolvedValue(undefined), fetchTagCounts: vi.fn().mockResolvedValue(undefined),
    refreshScheduledMetadata: vi.fn().mockResolvedValue(undefined),
  } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const toastTitled = (title: string) => useToastStore.getState().toasts.find(t => t.title === title);

describe('Undo after Report spam', () => {
  it('puts the message back in its folder, unread, and says "Moved back"', async () => {
    render(<MailApp />);
    fireEvent.click(await screen.findByText('stub spam', {}, { timeout: 5000 }));
    await waitFor(() => expect(toastTitled('email_viewer.spam.toast_success')).toBeTruthy());
    const reported = toastTitled('email_viewer.spam.toast_success')!;
    expect(reported.action?.label).toBe('undo');
    reported.action!.onClick();
    await waitFor(() => expect(client.restoreEmails).toHaveBeenCalled());
    expect(client.restoreEmails).toHaveBeenCalledWith([{ id: 'm1', mailboxIds: { inbox: true }, seen: false }], undefined);
    expect(client.undoSpam).not.toHaveBeenCalled();
    await waitFor(() => expect(toastTitled('undo_done')).toBeTruthy());
    expect(toastTitled('notifications.email_moved')).toBeUndefined();
  });

  it('offers the same Undo after Not spam', async () => {
    useEmailStore.setState({ selectedMailbox: 'junk', emails: [{ ...unread, mailboxIds: { junk: true } }], selectedEmail: { ...unread, mailboxIds: { junk: true } } } as never);
    render(<MailApp />);
    fireEvent.click(await screen.findByText('stub not spam', {}, { timeout: 5000 }));
    await waitFor(() => expect(toastTitled('email_viewer.spam.toast_not_spam_success')).toBeTruthy());
    const restored = toastTitled('email_viewer.spam.toast_not_spam_success')!;
    expect(restored.action?.label).toBe('undo');
    restored.action!.onClick();
    await waitFor(() => expect(client.restoreEmails).toHaveBeenCalledWith([{ id: 'm1', mailboxIds: { junk: true }, seen: false }], undefined));
  });
});
